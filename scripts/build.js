const esbuild = require("esbuild");

async function build() {
  const watch = process.argv.includes("--watch");

  const umdToElmPlugin = {
    name: "umd2esm",
    setup(build) {
      build.onResolve({ filter: /^(estree-walker|jsonc-parser)/ }, (args) => {
        const pathUmdMay = require.resolve(args.path, {
          paths: [args.resolveDir],
        });
        // Call twice the replace is to solve the problem of the path in Windows
        const pathEsm = pathUmdMay
          .replace("/umd/", "/esm/")
          .replace("\\umd\\", "\\esm\\");
        return { path: pathEsm };
      });
    },
  };

  const options = {
    bundle: true,
    outdir: "./out",
    format: "cjs",
    sourcemap: true,
    minify: process.argv.includes("--minify"),
    loader: { ".node": "file" },
  };

  const browserOptions = {
    inject: ["./server/src/browser/process-shim.ts"],
    plugins: [
      {
        name: "node-deps",
        setup(build) {
          build.onResolve({ filter: /^path$/ }, (args) => {
            const path = require.resolve("../node_modules/path-browserify", {
              paths: [__dirname],
            });
            return { path: path };
          });

          build.onResolve({ filter: /^util$/ }, (args) => {
            const path = require.resolve("../node_modules/util", {
              paths: [__dirname],
            });
            return { path: path };
          });

          build.onResolve({ filter: /^perf_hooks$/ }, (args) => {
            const path = require.resolve(
              "../server/src/browser/perf_hooks.ts",
              {
                paths: [__dirname],
              },
            );
            return { path: path };
          });
        },
      },
    ],
  };

  const nodeOptions = {
    plugins: [umdToElmPlugin],
  };

  const clientOptions = { ...options, external: ["vscode"], format: "cjs" };
  const serverOptions = {
    ...options,
    external: ["fs", "path"],
    format: "iife",
  };

  const clientBrowserOptions = {
    ...clientOptions,
    ...browserOptions,
    entryPoints: { browserClient: "./client/src/browser/extension.ts" },
    tsconfig: "./client/tsconfig.browser.json",
  };

  const serverBrowserOptions = {
    ...serverOptions,
    ...browserOptions,
    entryPoints: { browserServer: "./server/src/browser/index.ts" },
    tsconfig: "./server/tsconfig.browser.json",
  };

  const clientNodeOptions = {
    ...clientOptions,
    ...nodeOptions,
    entryPoints: { nodeClient: "./client/src/node/extension.ts" },
    platform: "node",
    tsconfig: "./client/tsconfig.node.json",
  };

  const serverNodeOptions = {
    ...serverOptions,
    ...nodeOptions,
    entryPoints: { nodeServer: "./server/src/node/index.ts" },
    platform: "node",
    tsconfig: "./server/tsconfig.node.json",
  };

  if (watch) {
    let pending = 0;
    const problemMatcherPlugin = {
      name: "esbuild-problem-matcher",
      setup(build) {
        build.onStart(() => {
          if (pending++ === 0) {
            console.log("[watch] build started");
          }
        });
        build.onEnd((result) => {
          pending--;
          if (result.errors.length) {
            result.errors.forEach((error) =>
              console.error(
                `> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`,
              ),
            );
          } else {
            if (pending === 0) {
              console.log("[watch] build finished");
            }
          }
        });
      },
    };

    const withProblemMatcher = (options) => ({
      ...options,
      plugins: [...options.plugins, problemMatcherPlugin],
    });

    esbuild
      .context(withProblemMatcher(clientBrowserOptions))
      .then((ctx) => ctx.watch());
    esbuild
      .context(withProblemMatcher(serverBrowserOptions))
      .then((ctx) => ctx.watch());
    esbuild
      .context(withProblemMatcher(clientNodeOptions))
      .then((ctx) => ctx.watch());
    esbuild
      .context(withProblemMatcher(serverNodeOptions))
      .then((ctx) => ctx.watch());
  } else {
    await Promise.all([
      esbuild.build(clientBrowserOptions),
      esbuild.build(serverBrowserOptions),
      esbuild.build(clientNodeOptions),
      esbuild.build(serverNodeOptions),
    ]);
  }
}

build().catch((err) => {
  console.error("Build failed: ", err);
  process.exit(1);
});
