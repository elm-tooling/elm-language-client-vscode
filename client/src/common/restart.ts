"use strict";
import * as vscode from "vscode";
import { BaseLanguageClient } from "vscode-languageclient";

export function registerCommand(
  langClients: Map<string, BaseLanguageClient>,
): vscode.Disposable {
  return vscode.commands.registerCommand("elm.commands.restart", async () => {
    for (const langClient of langClients.values()) {
      await langClient.stop();
      await langClient.start();
    }
  });
}
