/*
MIT License

 Copyright 2021 Frank Wagner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import * as vscode from "vscode";
import path = require("path");
import * as child_process from "child_process";
import * as fs from "fs";

import {
  Result,
  parseOutput,
  parseErrorOutput,
  buildErrorMessage,
  TestCompleted,
} from "./result";
import {
  IElmBinaries,
  buildElmTestArgs,
  buildElmTestArgsWithReport,
} from "./util";
import { Log } from "vscode-test-adapter-util";
import { IClientSettings } from "../extension";
import { insertRunTestData, RunTestSuite } from "./runTestSuite";

export class ElmTestRunner implements vscode.Disposable {
  private resolve?: (
    value: RunTestSuite | string | PromiseLike<RunTestSuite | string>,
  ) => void = undefined;

  private currentSuite?: RunTestSuite = undefined;
  private errorMessage?: string = undefined;
  private pendingMessages: string[] = [];

  private taskExecution?: vscode.TaskExecution = undefined;
  private process?: child_process.ChildProcessWithoutNullStreams = undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private workspaceFolder: vscode.WorkspaceFolder,
    private readonly elmProjectFolder: vscode.Uri,
    private readonly log: Log,
  ) {}

  dispose(): void {
    this.cancel();
  }

  private cancel(): void {
    if (this.resolve) {
      this.log.info("Running Elm Tests cancelled", this.relativeProjectFolder);
      this.resolve("cancelled");
    }
    this.taskExecution?.terminate();
    this.process?.kill();
    this.disposables.forEach((d) => void d.dispose());
  }

  private finish(result: RunTestSuite | string): void {
    this.log.debug("Running Elm Tests finished");
    this.resolve?.(result);
    this.resolve = undefined;
    this.cancel();
  }

  private get relativeProjectFolder(): string {
    return path.relative(
      this.workspaceFolder.uri.fsPath,
      this.elmProjectFolder.fsPath,
    );
  }

  async runSomeTests(uris?: string[]): Promise<RunTestSuite | string> {
    if (this.resolve) {
      return Promise.reject("already running");
    }
    return new Promise<RunTestSuite | string>((resolve) => {
      this.resolve = resolve;
      this.currentSuite = {
        type: "suite",
        id: "",
        label: "root",
        children: [],
      };
      this.errorMessage = undefined;
      this.pendingMessages = [];
      this.runElmTests(uris);
    });
  }

  private runElmTests(uris?: string[]) {
    const withOutput = vscode.workspace
      .getConfiguration("elmLS.elmTestRunner", null)
      .get("showElmTestOutput");
    const args = this.elmTestArgs(uris);
    const cwdPath = this.elmProjectFolder.fsPath;
    if (withOutput) {
      this.runElmTestsWithOutput(cwdPath, args);
    } else {
      this.runElmTestWithReport(cwdPath, args);
    }
  }

  private runElmTestsWithOutput(cwdPath: string, args: string[]) {
    const kind: vscode.TaskDefinition = {
      type: "elm-test",
    };

    this.log.info("Running Elm Tests as task", args);

    const task = new vscode.Task(
      kind,
      this.workspaceFolder,
      this.relativeProjectFolder.length > 0
        ? `Run Elm Test (${this.relativeProjectFolder})`
        : "Run Elm Test",
      "Elm Test Run",
      new vscode.ShellExecution(args[0], args.slice(1), {
        cwd: cwdPath,
      }),
    );
    task.group = vscode.TaskGroup.Test;
    task.presentationOptions = {
      clear: true,
      echo: true,
      focus: false,
      reveal: vscode.TaskRevealKind.Never,
      showReuseMessage: false,
    };

    void vscode.tasks.executeTask(task).then((taskExecution) => {
      this.taskExecution = taskExecution;
    });

    this.disposables.push(
      vscode.tasks.onDidEndTaskProcess((event) => {
        if (event.execution === this.taskExecution) {
          this.taskExecution = undefined;
          if ((event.exitCode ?? 0) <= 3) {
            this.runElmTestWithReport(cwdPath, args);
          } else {
            console.error("elm-test failed", event.exitCode, args);
            this.log.info("Running Elm Test task failed", event.exitCode, args);
            const errorMessage = [
              "elm-test failed.",
              "Check for Elm errors,",
              `find details in the "Task - ${event.execution.task.name}" terminal.`,
            ].join("\n");
            this.finish(errorMessage);
          }
        }
      }),
    );
  }

  private runElmTestWithReport(cwdPath: string, args: string[]) {
    this.log.info("Running Elm Tests", args);

    const argsWithReport = buildElmTestArgsWithReport(args);
    const elm = child_process.spawn(
      argsWithReport[0],
      argsWithReport.slice(1),
      {
        cwd: cwdPath,
        env: process.env,
      },
    );
    this.process = elm;

    const outChunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    elm.stdout.on("data", (chunk) => outChunks.push(Buffer.from(chunk)));

    const errChunks: Buffer[] = [];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    elm.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));

    elm.on("error", (err) => {
      this.process = undefined;
      const message = `Failed to run Elm Tests, is elm-test installed at "${args[0]}"?`;
      this.log.error(message, err);
      this.finish(message);
    });

    elm.once("exit", () => {
      this.process = undefined;
      const data = Buffer.concat(outChunks).toString("utf8");
      const lines = data.split("\n");
      try {
        this.parse(lines);
      } catch (err) {
        this.log.warn("Failed to parse line", args);
      }

      if (errChunks.length > 0) {
        const data = Buffer.concat(errChunks).toString("utf8");
        const lines = data.split("\n");
        this.errorMessage = lines
          .map(parseErrorOutput)
          .map(buildErrorMessage)
          .join("\n");
      }

      if (this.errorMessage) {
        this.finish(this.errorMessage);
      } else if (this.currentSuite) {
        this.finish(this.currentSuite);
      }
    });
  }

  private elmTestArgs(uris?: string[]): string[] {
    const files = uris?.map((uri) => vscode.Uri.parse(uri).fsPath);
    return buildElmTestArgs(this.getElmBinaries(), files);
  }

  private getConfiguredElmBinaries(): IElmBinaries {
    const config = vscode.workspace
      .getConfiguration()
      .get<IClientSettings>("elmLS");
    return <IElmBinaries>{
      elm: nonEmpty(config?.elmPath),
      elmTest: nonEmpty(config?.elmTestPath),
    };
  }

  private getElmBinaries(): IElmBinaries {
    const configured = this.getConfiguredElmBinaries();
    return resolveElmBinaries(
      configured,
      this.elmProjectFolder,
      this.workspaceFolder.uri,
    );
  }

  private parse(lines: string[]): void {
    lines
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          return parseOutput(line);
        } catch (err) {
          this.log.warn("Failed to parse line", line, err);
          return undefined;
        }
      })
      .forEach((output) => {
        switch (output?.type) {
          case "message":
            this.pushMessage(output.line);
            break;
          case "result":
            this.accept(output);
        }
      });
  }

  private pushMessage(message: string): void {
    if (!message) {
      return;
    }
    this.pendingMessages.push(message);
  }

  private popMessages(): string[] {
    const result = this.pendingMessages;
    this.pendingMessages = [];
    return result;
  }

  private accept(result: Result): void {
    switch (result?.event.tag) {
      case "testCompleted": {
        if (!this.currentSuite) {
          throw new Error("not loading?");
        }
        const event: TestCompleted = {
          ...result.event,
          messages: this.popMessages(),
        };
        this.currentSuite = insertRunTestData(this.currentSuite, event);
        break;
      }
      case "runStart":
        break;
      case "runComplete":
        break;
    }
  }
}

function resolveElmBinaries(
  configured: IElmBinaries,
  ...roots: vscode.Uri[]
): IElmBinaries {
  const rootPaths = Array.from(new Set(roots.map((r) => r.fsPath)).values());
  return <IElmBinaries>{
    elmTest:
      configured.elmTest ??
      rootPaths
        .map((r) => findLocalNpmBinary("elm-test", r))
        .filter((p) => p)[0],
    elm:
      configured.elm ??
      rootPaths.map((r) => findLocalNpmBinary("elm", r)).filter((p) => p)[0],
  };
}

function findLocalNpmBinary(
  binary: string,
  projectRoot: string,
): string | undefined {
  const binaryPath = path.join(projectRoot, "node_modules", ".bin", binary);
  return fs.existsSync(binaryPath) ? binaryPath : undefined;
}

function nonEmpty(text: string | undefined): string | undefined {
  return text && text.length > 0 ? text : undefined;
}
