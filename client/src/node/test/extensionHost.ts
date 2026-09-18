import assert from "node:assert/strict";
import { commands, extensions } from "vscode";
import { runNativeTesting, withTimeout } from "./nativeTesting";
import { run as runProcessExecutionTests } from "./processExecution";

export async function run(): Promise<void> {
  const extension = extensions.getExtension("elmTooling.elm-ls-vscode");
  assert.ok(extension, "Elm extension was not loaded by the extension host");

  await extension.activate();
  assert.equal(extension.isActive, true);

  const registeredCommands = await commands.getCommands(true);
  assert.ok(registeredCommands.includes("elm.commands.restart"));
  assert.equal(
    extensions.getExtension("hbenl.vscode-test-explorer"),
    undefined,
  );
  await withTimeout(
    runNativeTesting(),
    120000,
    "Native testing checks timed out",
  );
  await withTimeout(
    runProcessExecutionTests(),
    30000,
    "Process execution checks timed out",
  );
}
