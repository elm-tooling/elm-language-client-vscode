import assert from "node:assert/strict";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import * as vscode from "vscode";
import { LanguageClient, TransportKind } from "vscode-languageclient/node";
import { discoverTests } from "../test-runner/discovery";
import { ElmTestController } from "../test-runner/controller";
import { testId } from "../test-runner/selection";

/** Exercise real LSP discovery and elm-test through the native TestRun boundary. */
export async function runConnectedTesting(
  root: string,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const directory = await realpath(
    await mkdtemp(path.join(root, ".vscode-test", "native-project-")),
  );
  const project = vscode.Uri.file(directory);
  const workspace: vscode.WorkspaceFolder = {
    uri: project,
    name: "native-project",
    index: 0,
  };
  await mkdir(path.join(directory, "tests"));
  await mkdir(path.join(directory, "src"));
  await copyFile(
    path.join(root, "client/testFixture/elm.json"),
    path.join(directory, "elm.json"),
  );
  await copyFile(
    path.join(root, "client/testFixture/tests/Tests.elm"),
    path.join(directory, "tests/Tests.elm"),
  );
  const client = new LanguageClient(
    "elm-test-verification",
    "Elm test verification",
    {
      module: path.join(root, "out/nodeServer.mjs"),
      transport: TransportKind.ipc,
    },
    {
      documentSelector: [],
      workspaceFolder: workspace,
      outputChannel: log,
      initializationOptions: {
        elmPath: path.join(
          root,
          "node_modules",
          ".bin",
          process.platform === "win32" ? "elm.cmd" : "elm",
        ),
        elmTestPath: path.join(
          root,
          "node_modules",
          ".bin",
          process.platform === "win32" ? "elm-test.cmd" : "elm-test",
        ),
        elmJsonFiles: [vscode.Uri.joinPath(project, "elm.json").toString()],
        treeSitterWasmUri: path.join(root, "out/web-tree-sitter.wasm"),
      },
    },
  );
  let staticDiscovery = true;
  const controller = new ElmTestController(workspace, project, async () =>
    staticDiscovery ? await discoverTests(client, project.toString()) : [],
  );
  const states = new Map<string, string>();
  const failures = new Map<string, readonly vscode.TestMessage[]>();
  let ended = 0;
  const createRun = controller.controller.createTestRun.bind(
    controller.controller,
  );
  controller.controller.createTestRun = (request, name, persist) => {
    const run = createRun(request, name, persist);
    const passed = run.passed.bind(run);
    const failed = run.failed.bind(run);
    const skipped = run.skipped.bind(run);
    const errored = run.errored.bind(run);
    const end = run.end.bind(run);
    run.passed = (item, duration) => {
      states.set(item.id, "passed");
      passed(item, duration);
    };
    run.failed = (item, messages, duration) => {
      states.set(item.id, "failed");
      failures.set(
        item.id,
        Array.isArray(messages) ? messages : [messages as vscode.TestMessage],
      );
      failed(item, messages, duration);
    };
    run.skipped = (item) => {
      states.set(item.id, "skipped");
      skipped(item);
    };
    run.errored = (item, messages, duration) => {
      states.set(item.id, "errored");
      errored(item, messages, duration);
    };
    run.end = () => {
      ended++;
      end();
    };
    return run;
  };
  const token = new vscode.CancellationTokenSource();
  try {
    await client.start();
    await controller.refresh();
    const module = controller.root.children.get(testId(["Tests"]))!;
    const discoveryError = controller.root.error;
    assert.ok(
      module,
      `real language server discovers the Tests module: ${
        typeof discoveryError === "string"
          ? discoveryError
          : discoveryError?.value ?? "no suites returned"
      }`,
    );
    const suite = module.children.get(testId(["Tests", "native testing"]))!;
    const passing = suite.children.get(
      testId(["Tests", "native testing", "passes"]),
    )!;
    assert.ok(passing.range, "real discovery provides source navigation");
    await controller.run(new vscode.TestRunRequest([passing]), token.token);
    assert.equal(ended, 1, "native run ends exactly once");
    assert.equal(states.get(passing.id), "passed");
    assert.equal(
      states.get(testId(["Tests", "native testing", "fails"])),
      "failed",
    );
    assert.equal(
      states.get(testId(["Tests", "native testing", "later"])),
      "skipped",
    );
    const comparison = failures.get(
      testId(["Tests", "native testing", "fails"]),
    )![0];
    assert.equal(comparison.expectedOutput, "1");
    assert.equal(comparison.actualOutput, "2");
    assert.equal(
      comparison.location?.uri.toString(),
      vscode.Uri.joinPath(project, "tests/Tests.elm").toString(),
    );
    assert.ok(
      ![...states.values()].includes("errored"),
      "a complete report has no native execution errors",
    );

    staticDiscovery = false;
    await controller.refresh();
    await controller.run(new vscode.TestRunRequest(), token.token);
    const runtimeModule = controller.root.children.get(testId(["Tests"]))!;
    assert.equal(
      runtimeModule.uri?.toString(),
      vscode.Uri.joinPath(project, "tests/Tests.elm").toString(),
      "runtime-only modules acquire their containing file",
    );
    const runtimeTest = runtimeModule.children
      .get(testId(["Tests", "native testing"]))!
      .children.get(passing.id)!;
    states.clear();
    await controller.run(new vscode.TestRunRequest([runtimeTest]), token.token);
    assert.equal(
      states.get(runtimeTest.id),
      "passed",
      "runtime-only tests can be rerun through elm-test",
    );
    assert.equal(ended, 3);
  } finally {
    controller.dispose();
    token.dispose();
    const server = client.serverProcess;
    // LanguageClient.dispose() sends exit but does not wait for the process.
    // Windows keeps the project's working directory locked until it exits.
    const closed =
      server && server.exitCode === null && server.signalCode === null
        ? once(server, "close")
        : undefined;
    await client.dispose();
    await closed;
    assert.ok(
      !server || server.exitCode !== null || server.signalCode !== null,
      "test server has exited before deleting its project directory",
    );
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
  console.log(
    "Real language-server discovery to native results and runtime-only reruns passed",
  );
}
