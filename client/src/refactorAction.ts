import { commands, ExtensionContext, window } from "vscode";
import { CodeActionParams, LanguageClient } from "vscode-languageclient";
import { GetMoveDestinationRequest, MoveRequest } from "./protocol";

export function registerCommands(
  languageClient: LanguageClient,
  context: ExtensionContext,
): void {
  context.subscriptions.push(
    commands.registerCommand(
      "elm.refactor",
      async (
        command: string,
        params: CodeActionParams,
        commandInfo: string,
      ) => {
        if (command === "moveFunction") {
          await moveFunction(languageClient, params, commandInfo);
        }
      },
    ),
  );
}

async function moveFunction(
  languageClient: LanguageClient,
  params: CodeActionParams,
  commandInfo: string,
) {
  const moveDestinations = await languageClient.sendRequest(
    GetMoveDestinationRequest,
    {
      sourceUri: params.textDocument.uri,
      params,
    },
  );

  if (
    !moveDestinations ||
    !moveDestinations.destinations ||
    !moveDestinations.destinations.length
  ) {
    void window.showErrorMessage(
      "Cannot find possible file targets to move the selected method to.",
    );
    return;
  }

  const destinationNodeItems = moveDestinations.destinations.map(
    (destination) => {
      return {
        label: destination.name,
        description: destination.path,
        destination,
      };
    },
  );

  const functionName = commandInfo || "";
  const selected = await window.showQuickPick(destinationNodeItems, {
    placeHolder: `Select the new file for the function ${functionName}.`,
  });

  if (!selected) {
    return;
  }

  await languageClient.sendRequest(MoveRequest, {
    sourceUri: params.textDocument.uri,
    params,
    destination: selected.destination,
  });
}
