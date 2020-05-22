import { LanguageClient } from "vscode-languageclient";
import { ExtensionContext, commands } from "vscode";
import {
  ExposeRequest,
  UnexposeRequest,
  IExposeUnexposeParams,
} from "./protocol";

export function registerCommands(
  languageClient: LanguageClient,
  context: ExtensionContext,
) {
  context.subscriptions.push(
    commands.registerCommand("elm.expose", async (params: any) => {
      await expose(languageClient, params);
    }),
  );

  context.subscriptions.push(
    commands.registerCommand("elm.unexpose", async (params: any) => {
      await unexpose(languageClient, params);
    }),
  );
}

async function expose(
  languageClient: LanguageClient,
  params: IExposeUnexposeParams,
) {
  await languageClient.sendRequest(ExposeRequest, params);
}

async function unexpose(
  languageClient: LanguageClient,
  params: IExposeUnexposeParams,
) {
  await languageClient.sendRequest(UnexposeRequest, params);
}
