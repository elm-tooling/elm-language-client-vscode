import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runTests, runVSCodeCommand } from "@vscode/test-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const version = manifest.engines.vscode.replace(/^\D+/, "");

await runVSCodeCommand(["--install-extension", "hbenl.vscode-test-explorer"], {
  version,
});

await runTests({
  extensionDevelopmentPath: root,
  extensionTestsPath: path.join(root, "client/out/extensionTests.cjs"),
  launchArgs: [path.join(root, "client/testFixture")],
  version,
});
