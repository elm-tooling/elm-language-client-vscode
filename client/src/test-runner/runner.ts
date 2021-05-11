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
  TestDecoration,
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
  TestStatus,
} from "./result";
import {
  IElmBinaries,
  buildElmTestArgs,
  buildElmTestArgsWithReport,
  getFilePath,
  getTestsRoot,
  abreviateToOneLine,
} from "./util";
import { Log } from "vscode-test-adapter-util";
import { IClientSettings } from "../extension";

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
    getLine: (id: string) => number | undefined,
  ): void {
    if (node.type === "suite") {
      for (const child of node.children) {
        this.fireEvents(child, testStatesEmitter, getLine);
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
        case "fail": {
          const line = getLine(node.id);
          const decorations: TestDecoration[] | undefined =
            line !== undefined
              ? createDecorations(event.status, line)
              : undefined;
          testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: node.id,
            file: node.file,
            state: "failed",
            message,
            decorations,
          });
          break;
        }
      }
    }
  }

  async runSomeTests(uris?: string[]): Promise<TestSuiteInfo | string> {
    return new Promise<TestSuiteInfo | string>((resolve) => {
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

function nonEmpty(text: string | undefined): string | undefined {
  return text && text.length > 0 ? text : undefined;
}

function createDecorations(status: TestStatus, line: number): TestDecoration[] {
  if (status.tag !== "fail") {
    return [];
  }
  return status.failures.map((failure) => {
    switch (failure.tag) {
      case "comparison": {
        const expected = abreviateToOneLine(failure.expected);
        const actual = abreviateToOneLine(failure.actual);
        return <TestDecoration>{
          line: line,
          message: `${failure.comparison} ${expected} ${actual}`,
        };
      }
      case "message": {
        return <TestDecoration>{
          line,
          message: `${failure.message}`,
        };
      }
      case "data": {
        const message = Object.keys(failure.data)
          .map((key) => `$(key): ${failure.data[key]}`)
          .join("\n");
        return <TestDecoration>{
          line,
          message,
        };
      }
    }
  });
}
