import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import * as esbuild from "esbuild";

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

const nodeImports = new Set();
await esbuild.build({
  bundle: true,
  entryPoints: ["out/browserServer.js"],
  logLevel: "silent",
  platform: "browser",
  plugins: [
    {
      name: "unresolved-node-imports",
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (isBuiltin(args.path)) {
            nodeImports.add(args.path);
            return { external: true, path: args.path };
          }
        });
      },
    },
  ],
  write: false,
});
assert.deepEqual(
  [...nodeImports],
  [],
  `browser server contains unresolved Node imports: ${[...nodeImports].join(", ")}`,
);

const nodeClientSource = await readFile(manifest.main, "utf8");
const vscodeExports = new Set(
  [...nodeClientSource.matchAll(/import\s*{([^}]+)}\s*from\s*["']vscode["']/gs)]
    .flatMap(([, imports]) => imports.split(","))
    .map((name) => name.trim().split(/\s+as\s+/)[0])
    .filter(Boolean),
);
assert.ok(vscodeExports.size > 0, "desktop client has no VS Code imports");

const smokeDirectory = await mkdtemp(path.join(tmpdir(), "elm-ls-smoke-"));
try {
  const vscodeStub = `
      const stub = new Proxy(class {}, {
        apply: () => stub,
        construct: () => stub,
        get: (target, property) => {
          const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
          if (descriptor && !descriptor.configurable) {
            return Reflect.get(target, property);
          }
          if (property === "then") return undefined;
          if (property === Symbol.toPrimitive) return () => "";
          return stub;
        }
      });
  `;
  const vscodeModule = path.join(smokeDirectory, "vscode.mjs");
  await writeFile(
    vscodeModule,
    `${vscodeStub}
      ${[...vscodeExports].map((name) => `export { stub as ${name} };`).join("\n")}
      export default stub;
    `,
  );
  const loader = path.join(smokeDirectory, "loader.mjs");
  await writeFile(
    loader,
    `
      const vscodeModule = ${JSON.stringify(pathToFileURL(vscodeModule).href)};
      export async function resolve(specifier, context, nextResolve) {
        return specifier === "vscode"
          ? { shortCircuit: true, url: vscodeModule }
          : nextResolve(specifier, context);
      }
    `,
  );
  const preload = path.join(smokeDirectory, "preload.cjs");
  await writeFile(
    preload,
    `${vscodeStub}
      const Module = require("node:module");
      const load = Module._load;
      Module._load = function(request, ...args) {
        return request === "vscode" ? stub : load.call(this, request, ...args);
      };
    `,
  );
  const desktopImport = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-loader",
      loader,
      "--require",
      preload,
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(pathToFileURL(path.resolve(manifest.main)).href)})`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(
    desktopImport.status,
    0,
    `desktop client failed to import: ${desktopImport.stderr}`,
  );
} finally {
  await rm(smokeDirectory, { force: true, recursive: true });
}

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
