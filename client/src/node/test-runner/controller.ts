// Copyright 2021 Frank Wagner. Licensed under the MIT License; see LICENSE.
import * as vscode from "vscode";
import * as path from "path";
import type { TestSuite } from "../../common/protocol";
import { ElmTestRunner } from "./runner";
import { buildMessage } from "./result";
import type { RunTestItem, RunTestSuite } from "./runTestSuite";
import { selectFiles, testId, TestNode } from "./selection";

export interface ITestRunner extends vscode.Disposable {
  runSomeTests(files?: string[]): Promise<RunTestSuite | string>;
}

/** Owns discovery, native test items, and serialized runs for one Elm project. */
export class ElmTestController implements vscode.Disposable {
  readonly controller: vscode.TestController;
  readonly root: vscode.TestItem;
  private readonly log: vscode.LogOutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly items = new Map<string, vscode.TestItem>();
  private readonly runtimeItems = new Set<string>();
  private disposed = false;
  private discovered = false;
  private refreshPending = false;
  private refreshing?: Promise<void>;
  private running = false;
  private queue: Promise<void> = Promise.resolve();
  private runner?: ITestRunner;
  private activeCancellation?: vscode.CancellationTokenSource;

  constructor(
    workspace: vscode.WorkspaceFolder,
    readonly project: vscode.Uri,
    private readonly findTests: () => Promise<TestSuite[]>,
    private readonly createRunner: (
      log: vscode.LogOutputChannel,
    ) => ITestRunner = (log) => new ElmTestRunner(workspace, project, log),
  ) {
    const label =
      path.relative(workspace.uri.fsPath, project.fsPath) || workspace.name;
    this.controller = vscode.tests.createTestController(
      `elm:${project.toString()}`,
      label,
    );
    this.log = vscode.window.createOutputChannel(`Elm tests (${label})`, {
      log: true,
    });
    this.root = this.controller.createTestItem(testId([]), label, project);
    this.root.canResolveChildren = true;
    this.controller.items.add(this.root);
    this.items.set(this.root.id, this.root);
    this.controller.resolveHandler = () => this.refresh();
    this.controller.refreshHandler = () => this.refresh();
    this.controller.createRunProfile(
      "Run Elm tests",
      vscode.TestRunProfileKind.Run,
      (request, token) => this.run(request, token),
      true,
    );

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(project, "**/*.elm"),
    );
    const changed = (uri: vscode.Uri): void => {
      const relative = path.relative(project.fsPath, uri.fsPath);
      if (
        relative
          .split(path.sep)
          .some((part) => ["node_modules", "elm-stuff"].includes(part))
      )
        return;
      this.controller.invalidateTestResults();
      void this.refresh();
    };
    this.disposables.push(
      watcher,
      watcher.onDidCreate(changed),
      watcher.onDidDelete(changed),
      watcher.onDidChange(changed),
    );
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.refreshPending = true;
    if (this.running) return Promise.resolve();
    if (!this.refreshing) {
      this.refreshing = this.discover().finally(() => {
        this.refreshing = undefined;
      });
    }
    return this.refreshing;
  }

  private async discover(): Promise<void> {
    while (this.refreshPending && !this.disposed && !this.running) {
      this.refreshPending = false;
      this.root.busy = true;
      try {
        const suites = await this.findTests();
        // Entire modules can be invisible to static discovery. Keep them while
        // their source file exists; the next completed run reconciles results.
        const runtimeModules: vscode.TestItem[] = [];
        for (const [, item] of this.root.children) {
          if (!this.runtimeItems.has(item.id) || !item.uri) continue;
          try {
            await vscode.workspace.fs.stat(item.uri);
            runtimeModules.push(item);
          } catch (error) {
            if (
              !(error instanceof vscode.FileSystemError) ||
              error.code !== "FileNotFound"
            )
              throw error;
          }
        }
        if (this.disposed) return;
        const retained = new Set([this.root.id]);
        const retainRuntime = (item: vscode.TestItem): void => {
          retained.add(item.id);
          item.children.forEach(retainRuntime);
        };
        const convert = (
          suite: TestSuite,
          parents: string[],
        ): vscode.TestItem => {
          const labels = [...parents, suite.label];
          const id = testId(labels);
          const previous = this.items.get(id);
          const item =
            previous?.uri?.toString() === suite.file
              ? previous
              : this.controller.createTestItem(
                  id,
                  suite.label,
                  vscode.Uri.parse(suite.file),
                );
          item.label = suite.label;
          item.range = new vscode.Range(
            suite.position.line,
            suite.position.character,
            suite.position.line,
            suite.position.character,
          );
          const children = (suite.tests ?? []).map((child) =>
            convert(child, labels),
          );
          item.children.forEach((child) => {
            if (this.runtimeItems.has(child.id) && !retained.has(child.id)) {
              retainRuntime(child);
              children.push(child);
            }
          });
          item.children.replace(children);
          this.runtimeItems.delete(id);
          this.items.set(id, item);
          retained.add(id);
          return item;
        };
        const modules = suites.map((suite) => convert(suite, []));
        for (const item of runtimeModules) {
          if (!retained.has(item.id)) {
            retainRuntime(item);
            modules.push(item);
          }
        }
        this.root.children.replace(modules);
        for (const id of this.items.keys())
          if (!retained.has(id)) {
            this.items.delete(id);
            this.runtimeItems.delete(id);
          }
        this.root.error = undefined;
        this.discovered = true;
      } catch (error) {
        if (!this.disposed) {
          this.root.error = String(error);
          this.log.error("Failed to discover Elm tests", error);
        }
      } finally {
        if (!this.disposed) this.root.busy = false;
      }
    }
  }

  run(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const next = this.queue.then(() => this.execute(request, token));
    this.queue = next.catch((error: unknown) => {
      if (!this.disposed) this.log.error("Elm test run failed", error);
    });
    return next;
  }

  private async execute(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    if (this.disposed || token.isCancellationRequested) return;
    if (!this.discovered || this.refreshPending || this.root.error)
      await this.refresh();
    else await this.refreshing;
    if (this.disposed || token.isCancellationRequested) return;
    this.running = true;
    const run = this.controller.createTestRun(request);
    const cancellation = new vscode.CancellationTokenSource();
    this.activeCancellation = cancellation;
    const cancel = (): void => {
      cancellation.cancel();
      this.runner?.dispose();
    };
    const subscriptions = [
      token.onCancellationRequested(cancel),
      run.token.onCancellationRequested(cancel),
    ];
    const pending = new Set<vscode.TestItem>();
    try {
      if (this.root.error) throw new Error(String(this.root.error));
      const toNode = (item: vscode.TestItem): TestNode => {
        const children: TestNode[] = [];
        item.children.forEach((child) => children.push(toNode(child)));
        return {
          id: item.id,
          file: item === this.root ? undefined : item.uri?.toString(),
          children,
        };
      };
      const runAll =
        (!request.include ||
          request.include.some((item) => item.id === this.root.id)) &&
        !request.exclude?.length;
      const files = runAll
        ? undefined
        : selectFiles(
            toNode(this.root),
            request.include?.map((item) => item.id),
            request.exclude?.map((item) => item.id) ?? [],
          );
      if (files?.length === 0) return;
      for (const item of this.items.values()) {
        if (
          item.children.size === 0 &&
          item.uri &&
          (!files || files.includes(item.uri.toString()))
        ) {
          pending.add(item);
          run.enqueued(item);
          run.started(item);
        }
      }
      run.appendOutput("Elm runs all tests in each selected file.\r\n");
      if (token.isCancellationRequested || run.token.isCancellationRequested)
        cancel();
      if (cancellation.token.isCancellationRequested) return;
      this.runner = this.createRunner(this.log);
      const result = await this.runner.runSomeTests(files);
      if (cancellation.token.isCancellationRequested) return;
      if (typeof result === "string") throw new Error(result);
      const reported = new Set<string>();
      const collect = (node: RunTestItem, parents: string[]): void => {
        const labels = [...parents, node.label];
        reported.add(testId(labels));
        if (node.type === "suite")
          node.children.forEach((child) => collect(child, labels));
      };
      result.children.forEach((child) => collect(child, []));
      const prune = (parent: vscode.TestItem): void => {
        for (const [, item] of parent.children) {
          prune(item);
          if (
            this.runtimeItems.has(item.id) &&
            !reported.has(item.id) &&
            (!files || (item.uri && files.includes(item.uri.toString())))
          ) {
            parent.children.delete(item.id);
            this.items.delete(item.id);
            this.runtimeItems.delete(item.id);
            if (pending.delete(item)) run.skipped(item);
          }
        }
      };
      prune(this.root);
      const runtimeFiles = new Map<string, vscode.Uri>();
      for (const module of result.children) {
        if (this.items.get(testId([module.label]))?.uri) continue;
        const suffix = `/${module.label.split(".").join("/")}.elm`;
        const selectedFile = files?.find((file) =>
          vscode.Uri.parse(file).path.endsWith(suffix),
        );
        const candidates = selectedFile
          ? [vscode.Uri.parse(selectedFile)]
          : await vscode.workspace.findFiles(
              new vscode.RelativePattern(this.project, `**${suffix}`),
              "**/{node_modules,elm-stuff}/**",
            );
        if (candidates.length === 1)
          runtimeFiles.set(module.label, candidates[0]);
      }
      if (cancellation.token.isCancellationRequested) return;
      const report = (
        node: RunTestItem,
        parent: vscode.TestItem,
        labels: string[],
      ): void => {
        const names = [...labels, node.label];
        const id = testId(names);
        let item = this.items.get(id);
        if (!item) {
          item = this.controller.createTestItem(
            id,
            node.label,
            parent === this.root ? runtimeFiles.get(node.label) : parent.uri,
          );
          item.range = parent === this.root ? undefined : parent.range;
          this.items.set(id, item);
          this.runtimeItems.add(id);
          parent.children.add(item);
        }
        if (node.type === "suite") {
          // A dynamically generated suite can have looked like a leaf during discovery.
          if (pending.delete(item)) run.skipped(item);
          node.children.forEach((child) => report(child, item, names));
          return;
        }
        if (!pending.delete(item)) {
          run.enqueued(item);
          run.started(item);
        }
        const data = node.data;
        const text = buildMessage(data) ?? "";
        if (text)
          run.appendOutput(
            text.replace(/\r?\n/g, "\r\n") + "\r\n",
            undefined,
            item,
          );
        // elm-test's JSON report expresses duration in milliseconds.
        const duration = Number.isFinite(data.duration)
          ? data.duration
          : undefined;
        switch (data.status.tag) {
          case "pass":
            run.passed(item, duration);
            break;
          case "todo":
            run.appendOutput(`${data.status.comment}\r\n`, undefined, item);
            run.skipped(item);
            break;
          case "fail": {
            const messages = data.status.failures.map((failure) => {
              const message =
                failure.tag === "comparison"
                  ? vscode.TestMessage.diff(
                      text,
                      failure.expected,
                      failure.actual,
                    )
                  : new vscode.TestMessage(text);
              if (item?.uri && item.range)
                message.location = new vscode.Location(item.uri, item.range);
              return message;
            });
            run.failed(
              item,
              messages.length
                ? messages
                : new vscode.TestMessage("Elm test failed"),
              duration,
            );
            break;
          }
        }
      };
      result.children.forEach((child) => report(child, this.root, []));
      for (const item of pending)
        run.errored(
          item,
          new vscode.TestMessage(
            "elm-test returned no result for this test. Refresh test discovery and try again.",
          ),
        );
      pending.clear();
    } catch (error) {
      if (!cancellation.token.isCancellationRequested) {
        const message = new vscode.TestMessage(String(error));
        run.appendOutput(`${String(error)}\r\n`);
        for (const item of pending.size ? pending : [this.root])
          run.errored(item, message);
        pending.clear();
      }
    } finally {
      for (const item of pending) run.skipped(item);
      this.runner?.dispose();
      this.runner = undefined;
      subscriptions.forEach((subscription) => void subscription.dispose());
      cancellation.dispose();
      this.activeCancellation = undefined;
      run.end();
      this.running = false;
      if (this.refreshPending && !this.disposed) await this.refresh();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeCancellation?.cancel();
    this.runner?.dispose();
    this.disposables.forEach((disposable) => void disposable.dispose());
    this.controller.dispose();
    this.log.dispose();
  }
}
