import * as vscode from "vscode";
import * as path from "path";
import type { BaseLanguageClient } from "vscode-languageclient";
import { discoverTests } from "./discovery";
import { ElmTestController } from "./controller";

const registrations = new Map<string, vscode.Disposable>();

export function activate(
  context: vscode.ExtensionContext,
  workspace: vscode.WorkspaceFolder,
  client: BaseLanguageClient,
): void {
  deactivate(workspace);
  const controllers = new Map<string, ElmTestController>();
  let disposed = false;
  const registration = new vscode.Disposable(() => {
    disposed = true;
    controllers.forEach((controller) => controller.dispose());
    controllers.clear();
  });
  registrations.set(workspace.uri.toString(), registration);
  context.subscriptions.push(registration);
  void vscode.workspace
    .findFiles(
      new vscode.RelativePattern(workspace, "**/elm.json"),
      "**/{node_modules,elm-stuff}/**",
    )
    .then(
      async (files) => {
        for (const file of files) {
          if (disposed) return;
          const project = vscode.Uri.file(path.dirname(file.fsPath));
          const controller = new ElmTestController(workspace, project, () =>
            discoverTests(client, project.toString()),
          );
          controllers.set(project.toString(), controller);
          await controller.refresh();
        }
      },
      (error: unknown) =>
        console.error("Failed to find Elm test projects", error),
    );
}

export function deactivate(workspace: vscode.WorkspaceFolder): void {
  const key = workspace.uri.toString();
  registrations.get(key)?.dispose();
  registrations.delete(key);
}

export function dispose(): void {
  registrations.forEach((registration) => void registration.dispose());
  registrations.clear();
}
