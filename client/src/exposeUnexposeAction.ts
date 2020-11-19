import { LanguageClient } from "vscode-languageclient/node";
import { ExtensionContext, commands } from "vscode";
import { Protocol } from "@elm-tooling/elm-language-server";

export function registerCommands(
  languageClient: LanguageClient,
  context: ExtensionContext,
): void {
  context.subscriptions.push(
    commands.registerCommand(
      "elm.expose",
      async (params: Protocol.IExposeUnexposeParams) => {
        await expose(languageClient, params);
      },
    ),
  );

  context.subscriptions.push(
    commands.registerCommand(
      "elm.unexpose",
      async (params: Protocol.IExposeUnexposeParams) => {
        await unexpose(languageClient, params);
      },
    ),
  );
}

async function expose(
  languageClient: LanguageClient,
  params: Protocol.IExposeUnexposeParams,
) {
  await languageClient.sendRequest(Protocol.ExposeRequest, params);
}

async function unexpose(
  languageClient: LanguageClient,
  params: Protocol.IExposeUnexposeParams,
) {
  await languageClient.sendRequest(Protocol.UnexposeRequest, params);
}
