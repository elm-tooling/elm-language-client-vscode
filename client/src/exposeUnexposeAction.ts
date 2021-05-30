import { LanguageClient } from "vscode-languageclient/node";
import { ExtensionContext, commands } from "vscode";
import {
  ExposeRequest,
  UnexposeRequest,
  IExposeUnexposeParams,
} from "./protocol";

export function registerCommands(
  languageClient: LanguageClient,
  context: ExtensionContext,
  workspaceId: string,
): void {
  context.subscriptions.push(
    commands.registerCommand(
      `elm.expose-${workspaceId}`,
      async (params: IExposeUnexposeParams) => {
        await expose(languageClient, params);
      },
    ),
  );

  context.subscriptions.push(
    commands.registerCommand(
      `elm.unexpose-${workspaceId}`,
      async (params: IExposeUnexposeParams) => {
        await unexpose(languageClient, params);
      },
    ),
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
