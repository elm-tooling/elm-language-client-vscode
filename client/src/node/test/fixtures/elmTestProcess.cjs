const { fork, spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");

if (process.env.ELM_RUNNER_SCENARIO === "shell-error") {
  const result = spawnSync("elm-runner-command-that-does-not-exist", [], {
    shell: true,
    encoding: "utf8",
  });
  process.stderr.write(result.stderr);
  process.exitCode = 1;
  return;
}

if (["report", "large-report"].includes(process.env.ELM_RUNNER_SCENARIO)) {
  writeFileSync(
    process.env.ELM_RUNNER_READY,
    JSON.stringify(process.argv.slice(2)),
  );
  const events = [
    { event: "runStart", testCount: "1" },
    {
      event: "testCompleted",
      status: "fail",
      labels: ["Fixture", "fails"],
      duration: "3",
      failures: [
        {
          message: "Expect.equal",
          reason: {
            data: { comparison: "Expect.equal", expected: "1", actual: "2" },
          },
        },
      ],
    },
    { event: "runComplete", passed: "0", failed: "1", duration: "3" },
  ];
  process.stdout.write(JSON.stringify(events[0]) + "\n");
  if (process.env.ELM_RUNNER_SCENARIO === "large-report") {
    // 100 MiB of ASCII exceeds Execa's default output buffer limit.
    for (let line = 0; line < 1600; line++) {
      process.stdout.write("x".repeat(65536) + "\n");
    }
  } else {
    process.stdout.write("λ".repeat(512 * 1024) + "\n");
  }
  setImmediate(() => {
    process.stdout.write(
      events
        .slice(1)
        .map((event) => JSON.stringify(event))
        .join("\n"),
    );
    process.exitCode = 2;
  });
  return;
}

// Both processes ignore SIGTERM so cancellation must escalate to stop the tree.
process.on("SIGTERM", () => {});
if (process.argv[2] === "child") {
  let heartbeat = 0;
  const tick = () =>
    writeFileSync(process.env.ELM_RUNNER_HEARTBEAT, String(++heartbeat));
  tick();
  setInterval(tick, 25);
  process.send({ pid: process.pid });
} else {
  const child = fork(__filename, ["child"], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  child.once("message", ({ pid }) => {
    writeFileSync(
      process.env.ELM_RUNNER_READY,
      JSON.stringify({ parent: process.pid, child: pid }),
    );
  });
  setInterval(() => {}, 1000);
}
