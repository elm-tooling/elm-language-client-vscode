import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const manifest = JSON.parse(await readFile("package.json", "utf8"));
const entries = [
  manifest.main,
  manifest.browser,
  manifest.bin["elm-ls"],
  "./out/browserServer.js",
];

for (const entry of entries) {
  const result = spawnSync(process.execPath, ["--check", entry], {
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${entry} failed syntax check: ${result.stderr}`,
  );
}

const browserServer = await readFile("out/browserServer.js", "utf8");
assert.doesNotMatch(
  browserServer,
  /(?:from|require\(|import\()["'](?:fs\/promises|module)["']/,
  "browser server contains an unresolved Node import",
);

const wasmFiles = ["out/tree-sitter-elm.wasm", "out/web-tree-sitter.wasm"];
const wasmContents = await Promise.all(wasmFiles.map((wasm) => readFile(wasm)));
for (const [index, contents] of wasmContents.entries()) {
  assert.deepEqual(
    contents.subarray(0, 4),
    Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    `${wasmFiles[index]} is not a WebAssembly module`,
  );
}

const [treeSitterElmWasm, treeSitterWasm] = wasmContents.map(
  (contents) => `data:application/wasm;base64,${contents.toString("base64")}`,
);

const browserServerUrl = pathToFileURL("out/browserServer.js").href;
const workerSource = `
  import { parentPort } from "node:worker_threads";
  const listeners = new Map();
  globalThis.self = globalThis;
  globalThis.process = undefined;
  globalThis.addEventListener = (type, listener) => listeners.set(type, listener);
  globalThis.removeEventListener = (type) => listeners.delete(type);
  globalThis.postMessage = (message) => parentPort.postMessage(message);
  Object.defineProperty(globalThis, "onmessage", {
    get: () => listeners.get("message"),
    set: (listener) => listeners.set("message", listener)
  });
  await import(${JSON.stringify(browserServerUrl)});
  listeners.get("message")({
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        processId: null,
        rootUri: null,
        capabilities: {},
        workspaceFolders: null,
        initializationOptions: {
          elmJsonFiles: [],
          treeSitterElmWasmUri: ${JSON.stringify(treeSitterElmWasm)},
          treeSitterWasmUri: ${JSON.stringify(treeSitterWasm)}
        }
      }
    }
  });
`;
const workerUrl = new URL(
  `data:text/javascript,${encodeURIComponent(workerSource)}`,
);
const worker = new Worker(workerUrl, { type: "module" });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Browser server module worker timed out")),
      30000,
    );
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on("message", (message) => {
      if (message.id === 1) {
        clearTimeout(timeout);
        try {
          assert.equal(message.error, undefined);
          assert.ok(message.result?.capabilities);
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    });
  });
} finally {
  await worker.terminate();
}

const version = spawnSync(
  process.execPath,
  [manifest.bin["elm-ls"], "--version"],
  {
    encoding: "utf8",
  },
);
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), manifest.version);

console.log("Extension artifacts passed smoke checks.");
