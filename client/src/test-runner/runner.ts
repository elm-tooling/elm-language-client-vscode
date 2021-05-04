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
import {
  TestSuiteInfo,
  TestInfo,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteEvent,
  TestEvent,
} from "vscode-test-adapter-api";
import path = require("path");
import * as child_process from "child_process";
import * as fs from "fs";

import {
  Result,
  buildMessage,
  parseOutput,
  parseErrorOutput,
  buildErrorMessage,
  EventTestCompleted,
} from "./result";
import {
  IElmBinaries,
  buildElmTestArgs,
  buildElmTestArgsWithReport,
  getFilePath,
  getTestsRoot,
} from "./util";
import { Log } from "vscode-test-adapter-util";

export class ElmTestRunner {
  private eventById: Map<string, EventTestCompleted> = new Map<
    string,
    EventTestCompleted
  >();

  private resolve: (
    value: TestSuiteInfo | string | PromiseLike<TestSuiteInfo | string>,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
  ) => void = () => {};

  private currentSuite?: TestSuiteInfo = undefined;
  private errorMessage?: string = undefined;
  private pendingMessages: string[] = [];

  private taskExecution?: vscode.TaskExecution = undefined;
  private process?: child_process.ChildProcessWithoutNullStreams = undefined;

  constructor(
    private workspaceFolder: vscode.WorkspaceFolder,
    private readonly elmProjectFolder: vscode.Uri,
    private readonly log: Log,
    private readonly configuredElmBinaries: () => IElmBinaries,
  ) {}

  cancel(): void {
    this.taskExecution?.terminate();
    this.taskExecution = undefined;
    this.process?.kill();
    this.process = undefined;
    this.log.info("Running Elm Tests cancelled", this.relativeProjectFolder);
  }

  get isBusy(): boolean {
    return this.taskExecution !== undefined || this.process !== undefined;
  }

  private get relativeProjectFolder(): string {
    return path.relative(
      this.workspaceFolder.uri.fsPath,
      this.elmProjectFolder.fsPath,
    );
  }

  fireEvents(
    node: TestSuiteInfo | TestInfo,
    testStatesEmitter: vscode.EventEmitter<
      TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
    >,
  ): void {
    if (node.type === "suite") {
      for (const child of node.children) {
        this.fireEvents(child, testStatesEmitter);
      }
    } else {
      const event = this.eventById.get(node.id);
      if (!event) {
        throw new Error(`result for ${node.id}?`);
      }
      const message = buildMessage(event);
      switch (event.status.tag) {
        case "pass": {
          testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: node.id,
            state: "passed",
            message,
            description: `${event.duration}s`,
          });
          break;
        }
        case "todo": {
          testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: node.id,
            state: "skipped",
            message,
          });
          break;
        }
        case "fail":
          testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: node.id,
            state: "failed",
            message,
          });
          break;
      }
    }
  }

  async runSomeTests(files?: string[]): Promise<TestSuiteInfo | string> {
    return new Promise<TestSuiteInfo | string>((resolve) => {
      this.resolve = resolve;
      const relativePath = path.relative(
        this.workspaceFolder.uri.fsPath,
        this.elmProjectFolder.fsPath,
      );
      const name =
        relativePath.length > 0 ? relativePath : this.workspaceFolder.name;
      this.currentSuite = {
        type: "suite",
        id: name,
        label: name,
        children: [],
      };
      this.errorMessage = undefined;
      this.pendingMessages = [];
      this.runElmTests(files);
    });
  }

  private runElmTests(files?: string[]) {
    const withOutput = vscode.workspace
      .getConfiguration("elmLS.elmTestRunner", null)
      .get("showElmTestOutput");
    const args = this.elmTestArgs(files);
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

    vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.definition.type == "elm-test") {
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
          this.resolve(errorMessage);
        }
      }
    });
  }

  private runElmTestWithReport(cwdPath: string, args: string[]) {
    this.log.info("Running Elm Tests", args);

    this.eventById.clear();

    const argsWithReport = buildElmTestArgsWithReport(args);
    const elm = child_process.spawn(
      argsWithReport[0],
      argsWithReport.slice(1),
      {
        cwd: cwdPath,
        env: process.env,
      },
    );

    const outChunks: Buffer[] = [];
    elm.stdout.on("data", (chunk) => outChunks.push(Buffer.from(chunk)));

    const errChunks: Buffer[] = [];
    elm.stderr.on("data", (chunk) => errChunks.push(Buffer.from(chunk)));

    elm.on("error", (err) => {
      this.process = undefined;
      const message = `Failed to run Elm Tests, is elm-test installed at "${args[0]}"?`;
      this.log.error(message, err);
      this.resolve(message);
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
        this.resolve(this.errorMessage);
      } else if (this.currentSuite) {
        this.resolve(this.currentSuite);
      }
    });
  }

  private elmTestArgs(files?: string[]): string[] {
    return buildElmTestArgs(this.getElmBinaries(), files);
  }

  private getElmBinaries(): IElmBinaries {
    const configured = this.configuredElmBinaries();
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
        const event: EventTestCompleted = {
          ...result.event,
          messages: this.popMessages(),
        };
        const labels: string[] = [...event.labels];
        const id = this.addEvent(this.currentSuite, labels, event);
        this.eventById.set(id, event);
        break;
      }
      case "runStart":
        break;
      case "runComplete":
        break;
    }
  }

  private addEvent(
    suite: TestSuiteInfo,
    labels: string[],
    event: EventTestCompleted,
  ): string {
    if (labels.length === 1) {
      let testInfo: TestInfo = {
        type: "test",
        id: suite.id + "/" + labels[0],
        label: labels[0],
        file: this.getFilePath(event),
      };
      if (event.status.tag === "todo") {
        testInfo = {
          ...testInfo,
          skipped: true,
        };
      }
      suite.children.push(testInfo);
      return testInfo.id;
    }

    const label = labels.shift();

    if (!label) {
      throw new Error("empty labels?");
    }

    const found = suite.children.find((child) => child.label === label);
    if (found && found.type === "suite") {
      return this.addEvent(found, labels, event);
    }

    const newSuite: TestSuiteInfo = {
      type: "suite",
      id: suite.id + "/" + label,
      label: label,
      children: [],
      file: this.getFilePath(event),
    };
    suite.children.push(newSuite);
    return this.addEvent(newSuite, labels, event);
  }

  private getFilePath(event: EventTestCompleted): string {
    const path = getFilePath(event);
    const testsRoot = getTestsRoot(this.elmProjectFolder.fsPath);
    return `${testsRoot}/${path}`;
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
