"use strict";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export function registerCommand(
  langClients: Map<string, LanguageClient>,
): vscode.Disposable {
  return vscode.commands.registerCommand("elm.commands.restart", async () => {
    for (const langClient of langClients.values()) {
      await langClient.stop();
      await langClient.start();
    }
  });
}
