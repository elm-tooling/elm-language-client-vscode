import assert from "node:assert/strict";
import { commands, extensions } from "vscode";

export async function run(): Promise<void> {
  const extension = extensions.getExtension("elmTooling.elm-ls-vscode");
  assert.ok(extension, "Elm extension was not loaded by the extension host");

  await extension.activate();
  assert.equal(extension.isActive, true);

  const registeredCommands = await commands.getCommands(true);
  assert.ok(registeredCommands.includes("elm.commands.restart"));
}
