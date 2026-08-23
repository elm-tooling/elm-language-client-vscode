import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>Elm browser worker smoke test</title>");
    return;
  }

  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }

  try {
    response.setHeader(
      "Content-Type",
      path.extname(file) === ".wasm"
        ? "application/wasm"
        : "text/javascript; charset=utf-8",
    );
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(origin);
  const capabilities = await page.evaluate(
    (workerOrigin) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(`${workerOrigin}/out/browserServer.js`, {
          type: "module",
        });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error("Browser server module worker timed out"));
        }, 30000);
        worker.onerror = (event) => {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.onmessage = (event) => {
          if (event.data.id === 1) {
            clearTimeout(timeout);
            worker.terminate();
            if (event.data.error) {
              reject(new Error(JSON.stringify(event.data.error)));
            } else {
              resolve(event.data.result?.capabilities);
            }
          }
        };
        worker.postMessage({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            capabilities: {},
            initializationOptions: {
              elmJsonFiles: [],
              treeSitterElmWasmUri: `${workerOrigin}/out/tree-sitter-elm.wasm`,
              treeSitterWasmUri: `${workerOrigin}/out/web-tree-sitter.wasm`,
            },
            processId: null,
            rootUri: null,
            workspaceFolders: null,
          },
        });
      }),
    origin,
  );
  assert.ok(capabilities, "browser server did not return capabilities");
} finally {
  await browser?.close();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

console.log("Browser module worker passed Chromium smoke test.");
