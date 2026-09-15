import assert from "node:assert/strict";
import path from "node:path";
import * as vscode from "vscode";
import type { TestSuite } from "../../common/protocol";
import { ElmTestController } from "../test-runner/controller";
import { ElmTestRunner } from "../test-runner/runner";
import { testId } from "../test-runner/selection";
import type { RunTestSuite } from "../test-runner/runTestSuite";
import { runConnectedTesting } from "./connectedTesting";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function runNativeTesting(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders![0];
  const project = vscode.Uri.joinPath(workspace.uri, "controller-fixture");
  const file = vscode.Uri.joinPath(project, "tests", "Tests.elm");
  let suites: TestSuite[] = [
    {
      label: "Tests",
      file: file.toString(),
      position: { line: 0, character: 0 },
      tests: [
        {
          label: "passes",
          file: file.toString(),
          position: { line: 8, character: 4 },
        },
        {
          label: "sibling",
          file: file.toString(),
          position: { line: 9, character: 4 },
        },
      ],
    },
  ];
  let discoveryError = false;
  let blockDiscovery: ReturnType<typeof deferred<TestSuite[]>> | undefined;
  let discoveries = 0;
  const calls: string[][] = [];
  let started = deferred<void>();
  let result = deferred<RunTestSuite | string>();
  const controller = new ElmTestController(
    workspace,
    project,
    () => {
      discoveries++;
      if (discoveryError)
        return Promise.reject(new Error("Discovery unavailable"));
      return blockDiscovery?.promise ?? Promise.resolve(suites);
    },
    () => ({
      runSomeTests: (files) => {
        calls.push(files ?? []);
        started.resolve();
        return result.promise;
      },
      dispose: () => result.resolve("cancelled"),
    }),
  );
  const cancellation = new vscode.CancellationTokenSource();
  try {
    await controller.refresh();
    const module = controller.root.children.get(testId(["Tests"]))!;
    const leaf = module.children.get(testId(["Tests", "passes"]))!;
    assert.equal(
      leaf.range?.start.line,
      8,
      "discovery preserves source navigation",
    );
    assert.equal(leaf.uri?.toString(), file.toString());

    const run = controller.run(
      new vscode.TestRunRequest([leaf]),
      cancellation.token,
    );
    await started.promise;
    assert.deepEqual(
      calls,
      [[file.toString()]],
      "a leaf selects its containing file",
    );
    const oldDiscoveries = discoveries;
    suites = [
      {
        ...suites[0],
        tests: [
          { ...suites[0].tests![0], position: { line: 20, character: 0 } },
        ],
      },
    ];
    await controller.refresh();
    assert.equal(
      discoveries,
      oldDiscoveries,
      "discovery is deferred during a run",
    );
    cancellation.cancel();
    await run;
    assert.equal(
      leaf.range?.start.line,
      20,
      "pending discovery runs after cancellation",
    );
    assert.equal(module.children.size, 1, "deleted tests disappear");

    started = deferred<void>();
    result = deferred<RunTestSuite | string>();
    const nextToken = new vscode.CancellationTokenSource();
    try {
      const next = controller.run(
        new vscode.TestRunRequest([leaf]),
        nextToken.token,
      );
      await started.promise;
      const cancelledQueue = new vscode.CancellationTokenSource();
      const queued = controller.run(
        new vscode.TestRunRequest([leaf]),
        cancelledQueue.token,
      );
      cancelledQueue.cancel();
      result.resolve({
        type: "suite",
        id: "",
        label: "root",
        children: [
          {
            type: "suite",
            id: "/Tests",
            label: "Tests",
            children: [
              {
                type: "test",
                id: "/Tests/passes",
                label: "passes",
                data: {
                  tag: "testCompleted",
                  labels: ["Tests", "passes"],
                  duration: 12,
                  messages: [],
                  status: { tag: "pass" },
                },
              },
              {
                type: "test",
                id: "/Tests/generated",
                label: "generated",
                data: {
                  tag: "testCompleted",
                  labels: ["Tests", "generated"],
                  duration: 0,
                  messages: [],
                  status: { tag: "todo", comment: "later" },
                },
              },
            ],
          },
        ],
      });
      await Promise.all([next, queued]);
      assert.equal(
        calls.length,
        2,
        "cancelled queued runs do not start a process",
      );
      assert.ok(
        module.children.get(testId(["Tests", "generated"])),
        "runtime-only tests appear in the tree",
      );
      assert.equal(
        module.children.get(leaf.id),
        leaf,
        "run reconciliation retains source items",
      );
      cancelledQueue.dispose();
    } finally {
      nextToken.dispose();
    }

    const generated = module.children.get(testId(["Tests", "generated"]))!;
    const rerunToken = new vscode.CancellationTokenSource();
    try {
      await controller.run(
        new vscode.TestRunRequest([generated]),
        rerunToken.token,
      );
      assert.equal(
        calls.length,
        3,
        "runtime-only tests can be selected for another run",
      );
    } finally {
      rerunToken.dispose();
    }

    discoveryError = true;
    await controller.refresh();
    assert.match(String(controller.root.error), /Discovery unavailable/);
    discoveryError = false;
    await controller.refresh();
    assert.equal(controller.root.error, undefined);

    blockDiscovery = deferred<TestSuite[]>();
    const refresh = controller.refresh();
    const before = discoveries;
    void controller.refresh();
    const blocked = blockDiscovery;
    blockDiscovery = undefined;
    blocked.resolve(suites);
    await refresh;
    assert.equal(
      discoveries,
      before + 1,
      "a refresh during discovery is not lost",
    );

    const other = new ElmTestController(
      workspace,
      vscode.Uri.joinPath(workspace.uri, "other", "controller-fixture"),
      () => Promise.resolve(suites),
    );
    try {
      await other.refresh();
      assert.notEqual(other.controller.id, controller.controller.id);
      assert.notEqual(
        other.root.children.get(module.id),
        module,
        "matching labels in different projects remain independent",
      );
    } finally {
      other.dispose();
    }
  } finally {
    controller.dispose();
    cancellation.dispose();
  }
  console.log(
    "Native testing discovery, selection, cancellation, and isolation passed",
  );

  const log = vscode.window.createOutputChannel("Elm runner verification", {
    log: true,
  });
  const config = vscode.workspace.getConfiguration("elmLS", workspace.uri);
  const root = path.resolve(workspace.uri.fsPath, "../..");
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const settings = [
    "elmPath",
    "elmTestPath",
    "elmTestRunner.showElmTestOutput",
  ];
  const previous = settings.map((key) => config.inspect(key)?.globalValue);
  try {
    await config.update(
      "elmPath",
      path.join(root, "node_modules", ".bin", `elm${suffix}`),
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "elmTestPath",
      path.join(root, "node_modules", ".bin", `elm-test${suffix}`),
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "elmTestRunner.showElmTestOutput",
      false,
      vscode.ConfigurationTarget.Global,
    );
    const runner = new ElmTestRunner(workspace, workspace.uri, log);
    await runConnectedTesting(root, log);
    try {
      const report = await runner.runSomeTests([
        vscode.Uri.joinPath(workspace.uri, "tests", "Tests.elm").toString(),
      ]);
      assert.notEqual(typeof report, "string", String(report));
      if (typeof report === "string") throw new Error(report);
      const statuses: string[] = [];
      const visit = (suite: RunTestSuite): void =>
        suite.children.forEach((item) => {
          if (item.type === "suite") visit(item);
          else statuses.push(item.data.status.tag);
        });
      visit(report);
      assert.deepEqual(statuses.sort(), ["fail", "pass", "todo"]);
    } finally {
      runner.dispose();
    }

    const broken = vscode.Uri.joinPath(workspace.uri, "tests", "Broken.elm");
    await vscode.workspace.fs.writeFile(
      broken,
      Buffer.from("module Broken exposing (broken)\n\nbroken =\n"),
    );
    const compileError = new ElmTestRunner(workspace, workspace.uri, log);
    try {
      const failure = await compileError.runSomeTests([broken.toString()]);
      assert.equal(
        typeof failure,
        "string",
        "compiler errors are reported as execution failures",
      );
      assert.match(String(failure), /Broken|PROBLEM|EXPRESSION/i);
    } finally {
      compileError.dispose();
      await vscode.workspace.fs.delete(broken);
    }

    const inFlight = new ElmTestRunner(workspace, workspace.uri, log);
    const cancelledProcess = inFlight.runSomeTests();
    inFlight.dispose();
    assert.equal(
      await cancelledProcess,
      "cancelled",
      "cancellation settles an in-flight process",
    );

    await config.update(
      "elmTestRunner.showElmTestOutput",
      true,
      vscode.ConfigurationTarget.Global,
    );
    const taskEnded = new vscode.EventEmitter<vscode.TaskEndEvent>();
    const processEnded = new vscode.EventEmitter<vscode.TaskProcessEndEvent>();
    const noProcess = new ElmTestRunner(workspace, workspace.uri, log, {
      onDidEndTask: taskEnded.event,
      onDidEndTaskProcess: processEnded.event,
      executeTask: (task) => {
        const execution: vscode.TaskExecution = {
          task,
          terminate: () => undefined,
        };
        // This event can arrive before executeTask's promise resolves.
        taskEnded.fire({ execution });
        return Promise.resolve(execution);
      },
    });
    try {
      assert.match(
        String(
          await withTimeout(
            noProcess.runSomeTests(),
            1000,
            "Task without process hung",
          ),
        ),
        /without starting a process/,
      );
    } finally {
      noProcess.dispose();
      taskEnded.dispose();
      processEnded.dispose();
    }
    const taskRunner = new ElmTestRunner(workspace, workspace.uri, log);
    const taskFinished = deferred<void>();
    const taskSubscription = vscode.tasks.onDidEndTask((event) => {
      if (event.execution.task.definition.type === "elm-test")
        taskFinished.resolve();
    });
    try {
      const cancelledTask = taskRunner.runSomeTests();
      taskRunner.dispose();
      assert.equal(
        await cancelledTask,
        "cancelled",
        "cancellation settles asynchronous task startup",
      );
      await withTimeout(
        taskFinished.promise,
        30000,
        "Cancelled terminal task did not terminate",
      );
    } finally {
      taskSubscription.dispose();
      taskRunner.dispose();
    }
    await config.update(
      "elmTestRunner.showElmTestOutput",
      false,
      vscode.ConfigurationTarget.Global,
    );

    await config.update(
      "elmTestPath",
      path.join(root, "missing-elm-test"),
      vscode.ConfigurationTarget.Global,
    );
    const missing = new ElmTestRunner(workspace, workspace.uri, log);
    try {
      assert.match(
        String(await missing.runSomeTests()),
        /Failed to run elm-test/,
      );
    } finally {
      missing.dispose();
    }
    const cancelled = new ElmTestRunner(workspace, workspace.uri, log);
    cancelled.dispose();
    assert.equal(await cancelled.runSomeTests(), "cancelled");
  } finally {
    for (let i = 0; i < settings.length; i++)
      await config.update(
        settings[i],
        previous[i],
        vscode.ConfigurationTarget.Global,
      );
    log.dispose();
  }
  console.log(
    "Real elm-test results, compiler errors, process/task cancellation, and missing-binary checks passed",
  );
}

export async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
