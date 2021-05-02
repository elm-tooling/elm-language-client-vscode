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
import { Test } from "mocha";
import { toUnicode } from "punycode";
import * as vscode from "vscode";
import { WorkspaceFolder } from "vscode";
import {
  ExecuteCommandParams,
  ExecuteCommandRequest,
  LanguageClient,
  Position,
  ReferenceParams,
  ReferencesRequest,
  WorkspaceSymbolParams,
  WorkspaceSymbolRequest,
} from "vscode-languageclient/node";
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
import {
  FindTestsRequest,
  IFindTestsParams,
  IFindTestsResponse,
  TestSuite,
} from "../protocol";
import { ElmTestRunner } from "./runner";
import { getFilesAndAllTestIds, getTestsRoot, IElmBinaries } from "./util";

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
    private readonly log: Log,
    configuredElmBinaries: () => IElmBinaries,
    private readonly getClient: (
      folder: WorkspaceFolder,
    ) => LanguageClient | undefined,
  ) {
    this.log.info("Initializing Elm Test Runner adapter");

    this.disposables.push(this.testsEmitter);
    this.disposables.push(this.testStatesEmitter);
    this.disposables.push(this.retireEmitter);

    this.runner = new ElmTestRunner(
      this.workspace,
      this.elmProjectFolder,
      this.log,
      configuredElmBinaries,
    );
  }

  async load(): Promise<void> {
    if (this.isLoading) {
      return;
    }

    this.log.info("Loading tests");

    const client = this.getClient(this.workspace);
    if (client) {
      this.isLoading = true;
      void client.onReady().then(async () => {
        const input: IFindTestsParams = {
          workspaceRoot: this.workspace.uri.toString(),
        };
        try {
          const response = await client.sendRequest(FindTestsRequest, input);
          const id = this.workspace.name;
          const children =
            response.suites?.map((s) => {
              // TODO move into LSP
              const modulePath = vscode.Uri.parse(s.file).fsPath.split("/");
              const moduleFile = modulePath[modulePath.length - 1];
              const module = moduleFile.substring(
                0,
                moduleFile.indexOf(".elm"),
              );
              return toTestSuiteInfo(s, id + "/" + module);
            }) ?? [];
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
          console.log("Failed to load tests", error);
          this.log.info("Failed to load tests", error);
          this.testsEmitter.fire(<TestLoadFinishedEvent>{
            type: "finished",
            errorMessage: String(error),
          });
        } finally {
          this.isLoading = false;
        }
      });
    }
  }

  async run(tests: string[]): Promise<void> {
    this.log.info("Running tests", tests);

    if (!this.loadedSuite) {
      this.log.info("Not loaded", tests);
      return;
    }

    console.log("FW loaded", this.loadedSuite);
    const [files, testIds] = getFilesAndAllTestIds(tests, this.loadedSuite);
    this.testStatesEmitter.fire(<TestRunStartedEvent>{
      type: "started",
      tests: testIds,
    });

    try {
      const suiteOrError = await this.runner.runSomeTests(files);
      if (typeof suiteOrError === "string") {
        console.log("Error running tests", suiteOrError);
        // TODO raise error into UI
      } else {
        void this.fire(suiteOrError);
      }
    } catch (err) {
      console.log("Error running tests", err);
    } finally {
      this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: "finished" });
    }
  }

  private async fire(suite: TestSuiteInfo): Promise<void> {
    console.log("FW run", suite);
    // TODO fire events directly out of runner
    await this.runner.fireEvents(suite, this.testStatesEmitter);
    this.watch();
  }

  private watch() {
    this.watcher?.dispose();
    this.watcher = undefined;

    this.watcher = vscode.workspace.onDidSaveTextDocument((e) => {
      if (this.isTestFile(e.fileName)) {
        void this.load();
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
  parentId: string,
): TestSuiteInfo | TestInfo {
  const id = toId(parentId, suite);
  return suite.tests && suite.tests.length > 0
    ? {
        type: "suite",
        id,
        label: toLabel(suite),
        file: suite.file,
        line: suite.position.line,
        children: suite.tests.map((s) => toTestSuiteInfo(s, id)),
      }
    : {
        type: "test",
        id,
        label: toLabel(suite),
        file: suite.file,
        line: suite.position.line,
      };
}

function toLabel(suite: TestSuite): string {
  return typeof suite.label === "string" ? suite.label : suite.label.join("..");
}

function toId(parentId: string, suite: TestSuite): string {
  // TODO push into LSP?
  return typeof suite.label === "string"
    ? parentId + "/" + JSON.parse(suite.label)
    : parentId + "/" + suite.label.map((l) => JSON.parse(l)).join("-");
}
