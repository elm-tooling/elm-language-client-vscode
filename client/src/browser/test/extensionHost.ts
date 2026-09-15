import * as vscode from "vscode";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor<T>(
  get: () => T | PromiseLike<T>,
  ready: (value: T) => boolean,
  message: string,
): Promise<T> {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const value = await get();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

export async function run(): Promise<void> {
  const id = "elmTooling.elm-ls-vscode";
  assert(
    !vscode.extensions.getExtension(id),
    "Elm must not be preinstalled or loaded as a development extension",
  );
  // The browser workbench installs web extensions from an unpacked HTTP location.
  // The Node launcher fills this native installation prompt with the VSIX contents.
  const installCommand =
    "workbench.extensions.action.installExtensionFromLocation";
  await waitFor(
    () => vscode.commands.getCommands(true),
    (commands) => commands.includes(installCommand),
    "Web workbench installation command was not registered",
  );
  await vscode.commands.executeCommand(installCommand);
  const extension = await waitFor(
    () => vscode.extensions.getExtension(id),
    (value) => !!value,
    "Packaged Elm extension was not installed",
  );
  assert(extension, "Elm extension is missing");
  await extension.activate();
  assert(extension.isActive, "Installed Elm extension did not activate");
  assert(
    !vscode.extensions.getExtension("hbenl.vscode-test-explorer"),
    "Legacy Test Explorer was installed",
  );
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert(folder, "Missing virtual workspace");
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, "src", "Main.elm"),
  );
  await vscode.window.showTextDocument(document);
  const symbols = await waitFor(
    () =>
      vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri,
      ),
    (value) => !!value?.some((symbol) => symbol.name === "main"),
    "Installed browser extension did not return the main document symbol",
  );
  assert(
    symbols?.some((symbol) => symbol.name === "main"),
    "Missing main symbol",
  );
  console.log(
    "Packaged web extension installation, activation, and document symbols passed",
  );
}
