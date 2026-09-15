import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const version = manifest.engines.vscode.replace(/^\D+/, "");

// A checkout-relative profile exceeds macOS's Unix socket path limit on CI.
const temporary = await mkdtemp(path.join(tmpdir(), "elm-"));
try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, "client/out/extensionTests.cjs"),
    launchArgs: [
      path.join(root, "client/testFixture"),
      `--user-data-dir=${path.join(temporary, "user")}`,
    ],
    // Cold-cache discovery must work; a developer's existing packages can hide
    // an invalid fixture or a missing dependency-installation step.
    extensionTestsEnv: {
      ELM_HOME: process.env.ELM_HOME ?? path.join(temporary, "elm-home"),
    },
    version,
  });
} finally {
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
