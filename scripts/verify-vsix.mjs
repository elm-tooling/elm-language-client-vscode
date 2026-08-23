import assert from "node:assert/strict";
import yauzl from "yauzl";

const vsixPath = process.argv[2];
assert.ok(vsixPath, "Usage: node scripts/verify-vsix.mjs <extension.vsix>");

const entries = new Set();
let manifest;

await new Promise((resolve, reject) => {
  yauzl.open(vsixPath, { lazyEntries: true }, (openError, zipFile) => {
    if (openError) {
      reject(openError);
      return;
    }

    zipFile.on("error", reject);
    zipFile.on("end", resolve);
    zipFile.on("entry", (entry) => {
      entries.add(entry.fileName);
      if (entry.fileName !== "extension/package.json") {
        zipFile.readEntry();
        return;
      }

      zipFile.openReadStream(entry, (streamError, stream) => {
        if (streamError) {
          reject(streamError);
          return;
        }

        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("error", reject);
        stream.on("end", () => {
          manifest = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          zipFile.readEntry();
        });
      });
    });
    zipFile.readEntry();
  });
});

assert.ok(manifest, "VSIX does not contain extension/package.json");

const manifestEntries = [
  manifest.main,
  manifest.browser,
  manifest.bin["elm-ls"],
];
for (const entry of manifestEntries) {
  assert.ok(
    entries.has(`extension/${entry.replace(/^\.\//, "")}`),
    `Manifest entry does not exist in VSIX: ${entry}`,
  );
}

for (const entry of [
  "extension/out/browserServer.js",
  "extension/out/tree-sitter-elm.wasm",
  "extension/out/web-tree-sitter.wasm",
  "extension/language-configuration.json",
  "extension/schemas/elm.schema.json",
  "extension/schemas/elm-analyse.schema.json",
  "extension/syntaxes/codeblock.json",
  "extension/syntaxes/elm-syntax.json",
]) {
  assert.ok(entries.has(entry), `VSIX is missing ${entry}`);
}

for (const prefix of [
  "extension/client/",
  "extension/docs/",
  "extension/server/",
]) {
  assert.equal(
    [...entries].some((entry) => entry.startsWith(prefix)),
    false,
    `VSIX contains development files under ${prefix}`,
  );
}

console.log("VSIX contents passed verification.");
