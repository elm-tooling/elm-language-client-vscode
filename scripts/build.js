const esbuild = require("esbuild");

async function build() {
  const watch = process.argv.includes("--watch");

  const options = {
    entryPoints: {
      nodeClient: "./client/src/extension.ts",
      nodeServer: "./server/src/index.ts",
    },
    bundle: true,
    outdir: "./out",
    external: ["vscode", "fs", "path"],
    format: "cjs",
    platform: "node",
    tsconfig: "./tsconfig.json",
    sourcemap: true,
    minify: process.argv.includes("--minify"),
    plugins: [
      {
        name: "umd2esm",
        setup(build) {
          build.onResolve(
            { filter: /^(vscode-.*|estree-walker|jsonc-parser)/ },
            (args) => {
              const pathUmdMay = require.resolve(args.path, {
                paths: [args.resolveDir],
              });
              // Call twice the replace is to solve the problem of the path in Windows
              const pathEsm = pathUmdMay
                .replace("/umd/", "/esm/")
                .replace("\\umd\\", "\\esm\\");
              return { path: pathEsm };
            },
          );
        },
      },
    ],
  };

  if (watch) {
    esbuild
      .context({
        ...options,
        plugins: [
          ...options.plugins,
          {
            name: "esbuild-problem-matcher",
            setup(build) {
              build.onStart(() => {
                console.log("[watch] build started");
              });
              build.onEnd((result) => {
                if (result.errors.length) {
                  result.errors.forEach((error) =>
                    console.error(
                      `> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`,
                    ),
                  );
                } else console.log("[watch] build finished");
              });
            },
          },
        ],
      })
      .then((ctx) => ctx.watch());
  } else {
    await esbuild.build(options);
  }
}

build().catch((err) => process.exit(1));
