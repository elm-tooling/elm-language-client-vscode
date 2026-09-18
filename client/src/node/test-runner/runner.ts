// Copyright 2021 Frank Wagner. Licensed under the MIT License; see LICENSE.
import * as vscode from "vscode";
import path from "path";
import * as fs from "fs";
import { execa } from "execa";
import { parseErrorOutput, buildErrorMessage } from "./result";
import {
  IElmBinaries,
  buildElmTestArgs,
  buildElmTestArgsWithReport,
} from "./util";
import { readReport } from "./report";
import type { RunTestSuite } from "./runTestSuite";

/** One cancellable execution, including the optional terminal-output task. */
export class ElmTestRunner implements vscode.Disposable {
  private resolve?: (value: RunTestSuite | string) => void;
  private cancelled = false;
  private readonly cancellation = new AbortController();
  private taskExecution?: vscode.TaskExecution;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly workspaceFolder: vscode.WorkspaceFolder,
    private readonly elmProjectFolder: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
    private readonly tasks: Pick<
      typeof vscode.tasks,
      "executeTask" | "onDidEndTask" | "onDidEndTaskProcess"
    > = vscode.tasks,
  ) {}

  dispose(): void {
    this.cancelled = true;
    this.cancellation.abort();
    this.finish("cancelled");
  }

  private finish(result: RunTestSuite | string): void {
    const resolve = this.resolve;
    this.resolve = undefined;
    this.taskExecution?.terminate();
    this.taskExecution = undefined;
    this.disposables.forEach((disposable) => void disposable.dispose());
    this.disposables = [];
    resolve?.(result);
  }

  runSomeTests(uris?: string[]): Promise<RunTestSuite | string> {
    if (this.cancelled) return Promise.resolve("cancelled");
    if (this.resolve)
      return Promise.reject(new Error("Already running Elm tests"));
    return new Promise((resolve) => {
      this.resolve = resolve;
      try {
        const config = vscode.workspace.getConfiguration(
          "elmLS",
          this.elmProjectFolder,
        );
        const configured: IElmBinaries = {
          elm: config.get<string>("elmPath") || undefined,
          elmTest: config.get<string>("elmTestPath") || undefined,
        };
        const roots = [
          this.elmProjectFolder.fsPath,
          this.workspaceFolder.uri.fsPath,
        ];
        const local = (name: string): string | undefined =>
          roots
            .map((root) =>
              path.join(
                root,
                "node_modules",
                ".bin",
                name + (process.platform === "win32" ? ".cmd" : ""),
              ),
            )
            .find((file) => fs.existsSync(file));
        const args = buildElmTestArgs(
          {
            elm: configured.elm ?? local("elm"),
            elmTest: configured.elmTest ?? local("elm-test"),
          },
          uris?.map((uri) => vscode.Uri.parse(uri).fsPath),
        );
        if (config.get<boolean>("elmTestRunner.showElmTestOutput")) {
          void this.runWithOutput(args).catch((error: unknown) =>
            this.finish(String(error)),
          );
        } else {
          this.runReport(args);
        }
      } catch (error) {
        this.finish(String(error));
      }
    });
  }

  private async runWithOutput(args: string[]): Promise<void> {
    const task = new vscode.Task(
      { type: "elm-test" },
      this.workspaceFolder,
      `Run Elm tests (${
        path.relative(
          this.workspaceFolder.uri.fsPath,
          this.elmProjectFolder.fsPath,
        ) || this.workspaceFolder.name
      })`,
      "Elm",
      new vscode.ShellExecution(args[0], args.slice(1), {
        cwd: this.elmProjectFolder.fsPath,
      }),
    );
    task.group = vscode.TaskGroup.Test;
    task.presentationOptions = {
      clear: true,
      echo: true,
      focus: false,
      reveal: vscode.TaskRevealKind.Always,
      showReuseMessage: false,
    };
    // Subscribe before executeTask: a short-lived process can finish during startup.
    const processExits = new Map<vscode.TaskExecution, number | undefined>();
    const endedTasks = new Set<vscode.TaskExecution>();
    const settle = (): void => {
      const execution = this.taskExecution;
      if (!execution || !this.resolve || this.cancelled) return;
      if (processExits.has(execution)) {
        const code = processExits.get(execution);
        this.taskExecution = undefined;
        if (code !== undefined && code <= 3) this.runReport(args);
        else
          this.finish(
            `elm-test failed with exit code ${code ?? "unknown"}. See the "${
              task.name
            }" terminal.`,
          );
      } else if (endedTasks.has(execution)) {
        this.taskExecution = undefined;
        this.finish(
          `elm-test task ended without starting a process or returning an exit status. See the "${task.name}" terminal.`,
        );
      }
    };
    this.disposables.push(
      this.tasks.onDidEndTaskProcess((event) => {
        processExits.set(event.execution, event.exitCode);
        settle();
      }),
      this.tasks.onDidEndTask((event) => {
        endedTasks.add(event.execution);
        settle();
      }),
    );
    const execution = await this.tasks.executeTask(task);
    if (this.cancelled || !this.resolve) {
      execution.terminate();
      return;
    }
    this.taskExecution = execution;
    settle();
  }

  private runReport(args: string[]): void {
    if (this.cancelled || !this.resolve) return;
    const reportArgs = buildElmTestArgsWithReport(args);
    this.log.info("Running Elm tests", reportArgs);
    const child = execa(reportArgs[0], reportArgs.slice(1), {
      cwd: this.elmProjectFolder.fsPath,
      env: process.env,
      cancelSignal: this.cancellation.signal,
      killDescendants: true,
      // Nonzero exit codes can carry valid failing-test reports.
      reject: false,
      stripFinalNewline: false,
      // Preserve the previous runner's unbounded report buffering.
      maxBuffer: Infinity,
    });
    // Execa settles after the process and its output streams have completed.
    void child
      .then((result) => {
        if (this.cancelled || !this.resolve) return;
        if (result.failed && result.exitCode === undefined) {
          this.finish(
            `Failed to run elm-test at "${args[0]}": ${result.shortMessage}`,
          );
          return;
        }
        try {
          const errors = result.stderr.trim();
          if (errors) {
            this.finish(
              errors
                .split(/\r?\n/)
                .map(parseErrorOutput)
                .map(buildErrorMessage)
                .join("\n"),
            );
          } else if (result.exitCode === undefined || result.exitCode > 3) {
            this.finish(
              `elm-test exited with code ${result.exitCode ?? "unknown"}.\n${
                result.stdout
              }`,
            );
          } else {
            this.finish(readReport(result.stdout));
          }
        } catch (error) {
          this.finish(`Failed to read elm-test results: ${String(error)}`);
        }
      })
      .catch((error: unknown) => {
        if (!this.cancelled)
          this.finish(
            `Failed to run elm-test at "${args[0]}": ${String(error)}`,
          );
      });
  }
}
