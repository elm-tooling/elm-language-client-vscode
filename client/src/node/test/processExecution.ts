import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { ElmTestRunner } from "../test-runner/runner";

async function waitFor(
  check: () => Promise<boolean>,
  message: string,
  timeout = 10000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function run(): Promise<void> {
  const workspace = vscode.workspace.workspaceFolders![0];
  const root = path.resolve(workspace.uri.fsPath, "../..");
  const directory = await mkdtemp(
    path.join(root, ".vscode-test", "runner process-"),
  );
  const project = vscode.Uri.file(directory);
  const fixture = path.join(
    root,
    "client/src/node/test/fixtures/elmTestProcess.cjs",
  );
  const executable = path.join(
    directory,
    process.platform === "win32" ? "elm-test.cmd" : "elm-test",
  );
  await writeFile(
    executable,
    process.platform === "win32"
      ? `@node "${fixture}" %*\r\n`
      : `#!/bin/sh\nexec node '${fixture.replace(/'/g, "'\\''")}' "$@"\n`,
  );
  await chmod(executable, 0o755);
  const config = vscode.workspace.getConfiguration("elmLS", project);
  const keys = ["elmTestPath", "elmTestRunner.showElmTestOutput", "elmPath"];
  const previous = new Map(
    keys.map((key) => [key, config.inspect(key)?.globalValue]),
  );
  const environment = {
    ELM_RUNNER_READY: process.env.ELM_RUNNER_READY,
    ELM_RUNNER_HEARTBEAT: process.env.ELM_RUNNER_HEARTBEAT,
    ELM_RUNNER_SCENARIO: process.env.ELM_RUNNER_SCENARIO,
  };
  const ready = path.join(directory, "ready.json");
  const heartbeat = path.join(directory, "heartbeat");
  const log = vscode.window.createOutputChannel("Elm process verification", {
    log: true,
  });
  let pids: { parent: number; child: number } | undefined;
  const runner = new ElmTestRunner(workspace, project, log);
  try {
    process.env.ELM_RUNNER_READY = ready;
    process.env.ELM_RUNNER_HEARTBEAT = heartbeat;
    await config.update(
      "elmTestPath",
      executable,
      vscode.ConfigurationTarget.Global,
    );
    await config.update(
      "elmTestRunner.showElmTestOutput",
      false,
      vscode.ConfigurationTarget.Global,
    );
    await config.update("elmPath", "", vscode.ConfigurationTarget.Global);

    process.env.ELM_RUNNER_SCENARIO = "shell-error";
    const shellErrorRunner = new ElmTestRunner(workspace, project, log);
    try {
      const failure = await shellErrorRunner.runSomeTests();
      assert.equal(typeof failure, "string");
      assert.match(String(failure), /^Failed to run elm-test/);
      assert.ok(String(failure).includes(executable));
      assert.match(
        String(failure),
        /elm-runner-command-that-does-not-exist/,
        "the underlying shell diagnostic must remain visible",
      );
    } finally {
      shellErrorRunner.dispose();
    }

    process.env.ELM_RUNNER_SCENARIO = "report";
    const reportRunner = new ElmTestRunner(workspace, project, log);
    try {
      const selected = vscode.Uri.joinPath(project, "a test & example.elm");
      const report = await reportRunner.runSomeTests([selected.toString()]);
      assert.notEqual(typeof report, "string", String(report));
      if (typeof report === "string") throw new Error(report);
      const module = report.children[0];
      assert.equal(module.type, "suite");
      if (module.type !== "suite") throw new Error("Expected a module suite");
      const test = module.children[0];
      assert.equal(test.type, "test");
      if (test.type !== "test") throw new Error("Expected a test result");
      assert.equal(
        test.data.status.tag,
        "fail",
        "exit code 2 must retain the failing-test report",
      );
      assert.equal(
        test.data.messages[0],
        "λ".repeat(512 * 1024),
        "all UTF-8 output must be drained before the report is parsed",
      );
      assert.deepEqual(
        JSON.parse(await readFile(ready, "utf8")),
        [selected.fsPath, "--report", "json"],
        "file arguments must retain spaces and shell metacharacters",
      );
    } finally {
      reportRunner.dispose();
    }

    process.env.ELM_RUNNER_SCENARIO = "large-report";
    const largeReportRunner = new ElmTestRunner(workspace, project, log);
    try {
      const report = await largeReportRunner.runSomeTests();
      assert.notEqual(typeof report, "string", String(report));
      if (typeof report === "string") throw new Error(report);
      const module = report.children[0];
      if (module.type !== "suite") throw new Error("Expected a module suite");
      const test = module.children[0];
      if (test.type !== "test") throw new Error("Expected a test result");
      assert.equal(
        test.data.status.tag,
        "fail",
        "verbose output must not discard the test results",
      );
      assert.equal(test.data.messages.length, 1600);
      assert.ok(test.data.messages.every((line) => line.length === 65536));
    } finally {
      largeReportRunner.dispose();
    }

    process.env.ELM_RUNNER_SCENARIO = "cancel";
    await rm(ready);
    const result = runner.runSomeTests();
    await waitFor(async () => {
      try {
        pids = JSON.parse(await readFile(ready, "utf8")) as typeof pids;
        return true;
      } catch {
        return false;
      }
    }, "elm-test process tree did not start");
    assert.ok(pids);
    runner.dispose();
    assert.equal(await result, "cancelled");
    await waitFor(
      () => Promise.resolve(!isRunning(pids!.parent)),
      "Cancelled elm-test that ignores SIGTERM is still running",
    );
    const stopped = await readFile(heartbeat, "utf8");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      await readFile(heartbeat, "utf8"),
      stopped,
      "Cancellation must stop elm-test's descendant processes",
    );
    console.log(
      "Elm process-tree cancellation escalates when SIGTERM is ignored",
    );
  } finally {
    runner.dispose();
    if (pids) {
      for (const pid of [pids.child, pids.parent]) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Already stopped. */
        }
      }
    }
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const [key, value] of previous)
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    log.dispose();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}
