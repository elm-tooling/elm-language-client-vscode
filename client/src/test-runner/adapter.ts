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
  TestAdapter,
  TestLoadStartedEvent,
  TestLoadFinishedEvent,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteEvent,
  TestEvent,
  RetireEvent,
  TestSuiteInfo,
} from "vscode-test-adapter-api";
import { Log } from "vscode-test-adapter-util";
import { ElmTestRunner } from "./runner";
import { getTestsRoot, IElmBinaries, walk } from "./util";

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

  private runner: ElmTestRunner;
  private watcher?: vscode.Disposable;
  private nextRunLoads = false;

  constructor(
    private readonly workspace: vscode.WorkspaceFolder,
    private readonly elmProjectFolder: vscode.Uri,
    private readonly log: Log,
    configuredElmBinaries: () => IElmBinaries,
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
    this.log.info("Loading tests");

    this.testsEmitter.fire(<TestLoadStartedEvent>{ type: "started" });

    try {
      const loadedEvent: TestLoadFinishedEvent = await this.runner.runAllTests();
      void this.fire(loadedEvent);
    } catch (error) {
      this.log.info("Failed to load tests", error);
      this.testsEmitter.fire(<TestLoadFinishedEvent>{
        type: "finished",
        errorMessage: String(error),
      });
    }
  }

  async run(tests: string[]): Promise<void> {
    this.log.info("Running tests", tests);

    if (this.nextRunLoads) {
      this.nextRunLoads = false;
      return this.load();
    }

    const [files, testIds] = this.runner.getFilesAndAllTestIds(tests);
    this.testStatesEmitter.fire(<TestRunStartedEvent>{
      type: "started",
      tests: testIds,
    });

    const loadedEvent = await this.runner.runSomeTests(files);
    if (loadedEvent.suite) {
      void this.fire(loadedEvent);
    }
    this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: "finished" });
  }

  private async fire(loadedEvent: TestLoadFinishedEvent): Promise<void> {
    this.testsEmitter.fire(loadedEvent);
    if (!loadedEvent.errorMessage && loadedEvent.suite) {
      const suite = loadedEvent.suite;
      await this.runner.fireEvents(suite, this.testStatesEmitter).then(() => {
        void this.runner.fireDecorationEvents(suite, this.testStatesEmitter);
        return true;
      });
      this.watch(suite);
    }
  }

  private watch(suite: TestSuiteInfo) {
    this.watcher?.dispose();
    this.watcher = undefined;

    this.watcher = vscode.workspace.onDidSaveTextDocument((e) => {
      if (this.isTestFile(e.fileName)) {
        const fileName = e.fileName;
        const tests = Array.from(walk(suite))
          .filter((test) => test.file === fileName)
          .map((test) => test.id);
        this.nextRunLoads = true;
        this.retireEmitter.fire({ tests });
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
