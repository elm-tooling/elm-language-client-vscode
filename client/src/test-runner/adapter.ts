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
import * as path from "path";

import {
  TestAdapter,
  TestLoadStartedEvent,
  TestLoadFinishedEvent,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteEvent,
  TestEvent,
  RetireEvent,
  TestSuiteInfo,
  TestInfo,
  TestDecoration,
} from "vscode-test-adapter-api";
import { Log } from "vscode-test-adapter-util";
import { FindTestsRequest, IFindTestsParams, TestSuite } from "../protocol";
import { ElmTestRunner } from "./runner";
import {
  abreviateToOneLine,
  copyLocations,
  getFilesAndAllTestIds,
  getLineFun,
  getTestIdsForFile,
  getTestsRoot,
  mergeTopLevelSuites,
} from "./util";
import { RunTestItem, RunTestSuite } from "./runTestSuite";
import { buildMessage, TestStatus } from "./result";
import { BaseLanguageClient } from "vscode-languageclient";

/*
  Integration with Test Explorer UI
  see https://github.com/hbenl/vscode-test-adapter-api
  and https://github.com/hbenl/vscode-test-adapter-api/blob/master/src/index.ts
*/

export class ElmTestAdapter implements TestAdapter {
  private disposables: { dispose(): void }[] = [];

  private readonly testsEmitter = new vscode.EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >();
  private readonly testStatesEmitter = new vscode.EventEmitter<
    TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
  >();
  private readonly retireEmitter = new vscode.EventEmitter<RetireEvent>();

  get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
    return this.testsEmitter.event;
  }
  get testStates(): vscode.Event<
    TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
  > {
    return this.testStatesEmitter.event;
  }
  get retire(): vscode.Event<RetireEvent> {
    return this.retireEmitter.event;
  }

  private isLoading = false;
  private runner?: ElmTestRunner;
  private loadedSuite?: TestSuiteInfo;
  private watcher?: vscode.Disposable;

  constructor(
    private readonly workspace: vscode.WorkspaceFolder,
    private readonly elmProjectFolder: vscode.Uri,
    private readonly client: BaseLanguageClient,
    private readonly log: Log,
  ) {
    this.log.info(
      "Initializing Elm Test Runner adapter",
      workspace,
      elmProjectFolder,
    );

    this.disposables.push(this.testsEmitter);
    this.disposables.push(this.testStatesEmitter);
    this.disposables.push(this.retireEmitter);

    this.watch();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async load(): Promise<void> {
    if (this.isLoading) {
      return;
    }
    this.loadedSuite = undefined;
    return this.doLoad();
  }

  private async doLoad(): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.log.info("Loading tests");
    this.isLoading = true;

    const input: IFindTestsParams = {
      projectFolder: this.elmProjectFolder.toString(),
    };
    try {
      this.testsEmitter.fire({ type: "started" });

      const response = await this.client.sendRequest(FindTestsRequest, input);

      const children =
        response.suites
          ?.map((s) => fromTestSuite(s, ""))
          .filter(notUndefined) ?? [];
      const suite: TestSuiteInfo = this.getRootSuite(children);
      const loadedEvent: TestLoadFinishedEvent = {
        type: "finished",
        suite,
      };
      if (this.loadedSuite) {
        copyLocations(suite, this.loadedSuite);
      } else {
        this.loadedSuite = suite;
      }
      this.testsEmitter.fire(loadedEvent);
      this.log.info("Loaded tests");
    } catch (error) {
      this.log.info("Failed to load tests", error);
      this.testsEmitter.fire(<TestLoadFinishedEvent>{
        type: "finished",
        errorMessage: String(error),
      });
    } finally {
      this.isLoading = false;
    }
  }

  async run(tests: string[]): Promise<void> {
    if (this.runner) {
      this.log.debug("Already running tests");
      return;
    }

    this.runner = new ElmTestRunner(
      this.workspace,
      this.elmProjectFolder,
      this.log,
    );

    this.log.info("Running tests", tests);

    if (!this.loadedSuite) {
      this.log.info("Not loaded", tests);
      return;
    }

    const [uris, testIds] = getFilesAndAllTestIds(tests, this.loadedSuite);
    this.testStatesEmitter.fire(<TestRunStartedEvent>{
      type: "started",
      tests: testIds,
    });

    let errorMessage = undefined;
    try {
      const suiteOrError: RunTestSuite | string =
        await this.runner.runSomeTests(uris);
      if (typeof suiteOrError === "string") {
        errorMessage = suiteOrError;
      } else {
        const suites = suiteOrError.children
          .map((s) => fromRunTestItem(s, ""))
          .filter(notUndefined);
        const suite = this.getRootSuite(suites);
        this.loadedSuite = mergeTopLevelSuites(suite, this.loadedSuite);
        this.fireLoaded(this.loadedSuite);
        this.fireRun(suiteOrError, getLineFun(this.loadedSuite));
      }
    } catch (err) {
      console.log("Error running tests", err);
      errorMessage = String(err);
    } finally {
      this.runner = undefined;
      this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: "finished" });
      if (errorMessage && errorMessage != "cancelled") {
        this.log.error("Error running tests", errorMessage);
        this.testsEmitter.fire(<TestLoadFinishedEvent>{
          type: "finished",
          errorMessage,
        });
      }
    }
  }

  private fireLoaded(suite: TestSuiteInfo): void {
    this.testsEmitter.fire(<TestLoadFinishedEvent>{
      type: "finished",
      suite,
    });
  }

  private fireRun(
    item: RunTestItem,
    getLine: (id: string) => number | undefined,
  ): void {
    if (item.type === "suite") {
      item.children.forEach((child) => this.fireRun(child, getLine));
    } else {
      const data = item.data;
      const message = buildMessage(data);
      switch (data.status.tag) {
        case "pass": {
          this.testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: item.id,
            state: "passed",
            message,
            description: `${data.duration}s`,
          });
          break;
        }
        case "todo": {
          this.testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: item.id,
            state: "skipped",
            message,
          });
          break;
        }
        case "fail": {
          const line = getLine(item.id);
          const decorations: TestDecoration[] | undefined =
            line !== undefined
              ? createDecorations(data.status, line)
              : undefined;
          this.testStatesEmitter.fire(<TestEvent>{
            type: "test",
            test: item.id,
            state: "failed",
            message,
            decorations,
          });
          break;
        }
      }
    }
  }

  private watch() {
    this.watcher?.dispose();
    this.watcher = undefined;

    this.watcher = vscode.workspace.onDidSaveTextDocument(async (e) => {
      if (this.isTestFile(e.fileName)) {
        if (this.loadedSuite) {
          await this.doLoad();
          const ids = getTestIdsForFile(e.fileName, this.loadedSuite);
          this.retireEmitter.fire({ tests: ids });
        }
      } else if (this.isSourceFile(e.fileName)) {
        this.retireEmitter.fire({});
      }
    });
  }

  private isTestFile(file: string): boolean {
    const testsRoot = getTestsRoot(this.elmProjectFolder.fsPath);
    return file.startsWith(testsRoot);
  }

  private isSourceFile(file: string): boolean {
    return file.startsWith(`${this.elmProjectFolder.fsPath}`);
  }

  private getRootSuite(suites: (TestSuiteInfo | TestInfo)[]): TestSuiteInfo {
    const relativePath = path.relative(
      this.workspace.uri.fsPath,
      this.elmProjectFolder.fsPath,
    );
    const id = relativePath.length > 0 ? relativePath : this.workspace.name;

    const root: TestSuiteInfo = {
      type: "suite",
      label: id,
      id,
      children: suites,
    };
    return root;
  }

  cancel(): void {
    this.runner?.dispose();
    this.watcher?.dispose();
  }

  dispose(): void {
    this.cancel();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}

function fromTestSuite(
  suite: TestSuite,
  prefixId: string,
): TestSuiteInfo | TestInfo | undefined {
  const id = toId(prefixId, suite);
  const label = suite.label;
  if (!label || !id) {
    return undefined;
  }
  return suite.tests && suite.tests.length > 0
    ? {
        type: "suite",
        id,
        label,
        file: suite.file,
        line: suite.position.line,
        children: suite.tests
          .map((s) => fromTestSuite(s, id))
          .filter(notUndefined),
      }
    : {
        type: "test",
        id,
        label,
        file: suite.file,
        line: suite.position.line,
      };
}

function fromRunTestItem(
  suite: RunTestItem,
  prefixId: string,
): TestSuiteInfo | TestInfo | undefined {
  const id = toId(prefixId, suite);
  const label = suite.label;
  if (!label || !id) {
    return undefined;
  }

  return suite.type === "suite"
    ? {
        type: "suite",
        id,
        label: suite.label,
        children: suite.children
          .map((s) => fromRunTestItem(s, id))
          .filter(notUndefined),
      }
    : {
        type: "test",
        id,
        label,
      };
}

function toId(
  prefix: string,
  suite: TestSuite | RunTestItem,
): string | undefined {
  return `${prefix}/${suite.label}`;
}

// TODO share?
function notUndefined<T>(x: T | undefined): x is T {
  return x !== undefined;
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
