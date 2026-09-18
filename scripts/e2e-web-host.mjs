import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { open } from "@vscode/test-web";
import { chromium } from "playwright";
import yauzl from "yauzl";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = path.join(root, ".vscode-test-web");
await mkdir(cache, { recursive: true });
const driver = await mkdtemp(path.join(cache, "package-test-"));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function extractPackage() {
  await new Promise((resolve, reject) => {
    yauzl.open(
      path.join(root, "elm-ls-vscode.vsix"),
      { lazyEntries: true },
      (error, zip) => {
        if (error) return reject(error);
        zip.on("error", reject);
        zip.on("end", resolve);
        zip.on("entry", (entry) => {
          if (
            !entry.fileName.startsWith("extension/") ||
            entry.fileName.endsWith("/")
          ) {
            zip.readEntry();
            return;
          }
          const target = path.resolve(driver, entry.fileName);
          if (!target.startsWith(`${driver}${path.sep}extension${path.sep}`)) {
            zip.close();
            reject(new Error("Invalid VSIX entry"));
            return;
          }
          zip.openReadStream(entry, (error, stream) => {
            if (error) return reject(error);
            void mkdir(path.dirname(target), { recursive: true })
              .then(() => pipeline(stream, createWriteStream(target)))
              .then(
                () => zip.readEntry(),
                (error) => {
                  zip.close();
                  reject(error);
                },
              );
          });
        });
        zip.readEntry();
      },
    );
  });
}

let browser;
let server;
try {
  await extractPackage();
  const manifest = JSON.parse(
    await readFile(path.join(driver, "extension/package.json"), "utf8"),
  );
  assert.equal(
    manifest.extensionDependencies?.includes("hbenl.vscode-test-explorer") ??
      false,
    false,
  );
  await writeFile(
    path.join(driver, "package.json"),
    JSON.stringify({
      name: "elm-web-test-driver",
      publisher: "elmTooling",
      version: "0.0.0",
      engines: { vscode: manifest.engines.vscode },
      browser: "./tests.cjs",
      capabilities: { virtualWorkspaces: true },
    }),
  );
  await copyFile(
    path.join(root, "client/out/browserTests.cjs"),
    path.join(driver, "tests.cjs"),
  );
  const minimum = manifest.engines.vscode.replace(/^\D+/, "");
  const versionResponse = await fetch(
    `https://update.code.visualstudio.com/api/versions/${minimum}/linux-x64/stable`,
  );
  assert.ok(versionResponse.ok, `Could not resolve VS Code ${minimum}`);
  const { version: commit } = await versionResponse.json();
  const port = await unusedPort();
  server = await open({
    browserType: "none",
    quality: "stable",
    commit,
    extensionDevelopmentPath: driver,
    extensionTestsPath: path.join(driver, "tests.cjs"),
    folderPath: path.join(root, "client/testFixture"),
    // test-web deletes its download directory before fetching an uncached build.
    // Keep that directory separate from the extracted package and test driver.
    testRunnerDataDir: path.join(cache, "builds"),
    port,
    host: "localhost",
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let finish;
  const tests = new Promise((resolve) => {
    finish = resolve;
  });
  await page.exposeFunction("codeAutomationLog", (type, args) =>
    console[type](...args),
  );
  await page.exposeFunction("codeAutomationExit", (code) => finish(code));
  page.on("pageerror", (error) => console.error(error));
  await page.goto(`http://localhost:${port}`);
  const location = page.getByPlaceholder("Location of the web extension");
  await Promise.race([
    (async () => {
      await location.fill(
        `http://localhost:${port}/static/devextensions/extension`,
        { timeout: 60000 },
      );
      await location.press("Enter");
    })(),
    tests.then((code) =>
      assert.equal(code, 0, "Web tests failed before installation completed"),
    ),
  ]);
  let timeout;
  try {
    const code = await Promise.race([
      tests,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Web extension tests timed out")),
          90000,
        );
      }),
    ]);
    assert.equal(code, 0, "Web extension host tests failed");
  } finally {
    clearTimeout(timeout);
  }
} finally {
  await browser?.close();
  server?.dispose();
  await rm(driver, { recursive: true, force: true });
}
