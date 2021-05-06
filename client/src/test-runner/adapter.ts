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

import { LanguageClient } from "vscode-languageclient/node";
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
} from "vscode-test-adapter-api";
import { Log } from "vscode-test-adapter-util";
import { FindTestsRequest, IFindTestsParams, TestSuite } from "../protocol";
import { ElmTestRunner } from "./runner";
import {
  getFilesAndAllTestIds,
  getTestIdsForFile,
  getTestsRoot,
  mergeTopLevelSuites,
} from "./util";

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
  private runner: ElmTestRunner;
  private loadedSuite?: TestSuiteInfo;
  private watcher?: vscode.Disposable;

  constructor(
    private readonly workspace: vscode.WorkspaceFolder,
    private readonly elmProjectFolder: vscode.Uri,
    private readonly client: LanguageClient,
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

    this.runner = new ElmTestRunner(
      this.workspace,
      this.elmProjectFolder,
      this.log,
    );

    this.watch();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async load(): Promise<void> {
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

      const id = path.basename(this.elmProjectFolder.fsPath);
      const children =
        response.suites
          ?.map((s) => toTestSuiteInfo(s, id))
          .filter(notUndefined) ?? [];
      const suite: TestSuiteInfo = {
        type: "suite",
        label: id,
        id,
        children,
      };
      const loadedEvent: TestLoadFinishedEvent = {
        type: "finished",
        suite,
      };
      this.loadedSuite = suite;
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
    if (this.runner.isBusy) {
      this.log.debug("Already running tests");
      return;
    }

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

    try {
      const suiteOrError = await this.runner.runSomeTests(uris);
      if (typeof suiteOrError === "string") {
        console.log("Error running tests", suiteOrError);
        this.testsEmitter.fire(<TestLoadFinishedEvent>{
          type: "finished",
          errorMessage: String(suiteOrError),
        });
      } else {
        this.loadedSuite = mergeTopLevelSuites(suiteOrError, this.loadedSuite);
        this.fireLoaded(this.loadedSuite);
        this.fireRun(suiteOrError);
      }
    } catch (err) {
      console.log("Error running tests", err);
    } finally {
      this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: "finished" });
    }
  }

  private fireLoaded(suite: TestSuiteInfo): void {
    this.testsEmitter.fire(<TestLoadFinishedEvent>{
      type: "finished",
      suite,
    });
  }

  private fireRun(suite: TestSuiteInfo): void {
    this.runner.fireEvents(suite, this.testStatesEmitter);
  }

  private watch() {
    this.watcher?.dispose();
    this.watcher = undefined;

    this.watcher = vscode.workspace.onDidSaveTextDocument((e) => {
      if (this.isTestFile(e.fileName)) {
        if (this.loadedSuite) {
          const ids = getTestIdsForFile(e.fileName, this.loadedSuite);
          this.retireEmitter.fire({ tests: ids });
          // Do not reload, that will confuse the UI if the user has dynamic tests suites.
          // Users will reload manually, if desired.
          // void this.load();
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

  cancel(): void {
    this.runner.cancel();
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

function toTestSuiteInfo(
  suite: TestSuite,
  prefixId: string,
): TestSuiteInfo | TestInfo | undefined {
  const id = toId(prefixId, suite);
  const label = toLabel(suite);
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
          .map((s) => toTestSuiteInfo(s, id))
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

function toLabel(suite: TestSuite): string {
  return typeof suite.label === "string" ? suite.label : suite.label.join("..");
}

function toId(prefix: string, suite: TestSuite): string | undefined {
  return typeof suite.label === "string"
    ? `${prefix}/${suite.label}`
    : // : `${prefix}/${suite.label.join("-")}`;
      undefined;
}

// TODO share?
function notUndefined<T>(x: T | undefined): x is T {
  return x !== undefined;
}
