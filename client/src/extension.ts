import * as path from "path";
import {
  ExtensionContext,
  OutputChannel,
  TextDocument,
  Uri,
  window as Window,
  workspace as Workspace,
  WorkspaceFolder,
} from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  RevealOutputChannelOn,
  TransportKind,
} from "vscode-languageclient";

import * as Package from "./elmPackage";

export type ElmAnalyseTrigger = "change" | "save" | "never";

export interface IClientSettings {
  elmFormatPath: string;
  elmPath: string;
  elmTestPath: string;
  trace: { server: string };
  elmAnalyseTrigger: ElmAnalyseTrigger;
}

const clients: Map<string, LanguageClient> = new Map();

let sortedWorkspaceFolders: string[] | undefined;

function getSortedWorkspaceFolders(): string[] {
  if (sortedWorkspaceFolders === void 0) {
    sortedWorkspaceFolders = Workspace.workspaceFolders
      ? Workspace.workspaceFolders
          .map(folder => {
            let result = folder.uri.toString();
            if (result.charAt(result.length - 1) !== "/") {
              result = result + "/";
            }
            return result;
          })
          .sort((a, b) => {
            return a.length - b.length;
          })
      : [];
  }
  return sortedWorkspaceFolders;
}
Workspace.onDidChangeWorkspaceFolders(
  () => (sortedWorkspaceFolders = undefined),
);

function getOuterMostWorkspaceFolder(folder: WorkspaceFolder): WorkspaceFolder {
  const sorted = getSortedWorkspaceFolders();
  for (const element of sorted) {
    let uri = folder.uri.toString();
    if (uri.charAt(uri.length - 1) !== "/") {
      uri = uri + "/";
    }
    if (uri.startsWith(element)) {
      return Workspace.getWorkspaceFolder(Uri.parse(element))!;
    }
  }
  return folder;
}

export async function activate(context: ExtensionContext) {
  const module = context.asAbsolutePath(path.join("server", "out", "index.js"));

  function didOpenTextDocument(document: TextDocument) {
    // We are only interested in everything elm, no handling for untitled files for now
    if (document.languageId !== "elm") {
      return;
    }

    const config = Workspace.getConfiguration().get<IClientSettings>("elmLS");

    const uri = document.uri;
    let folder = Workspace.getWorkspaceFolder(uri);
    // Files outside a folder can't be handled. This might depend on the language.
    // Single file languages like JSON might handle files outside the workspace folders.
    if (!folder) {
      return;
    }
    // If we have nested workspace folders we only start a server on the outer most workspace folder.
    folder = getOuterMostWorkspaceFolder(folder);

    if (!clients.has(folder.uri.toString())) {
      const relativeWorkspace = folder.name;
      const outputChannel: OutputChannel = Window.createOutputChannel(
        relativeWorkspace.length > 1 ? `elmLS (${relativeWorkspace})` : "elmLS",
      );

      const debugOptions = {
        execArgv: ["--nolazy", `--inspect=${6010 + clients.size}`],
      };
      const serverOptions = {
        debug: {
          module,
          options: debugOptions,
          transport: TransportKind.ipc,
        },
        run: { module, transport: TransportKind.ipc },
      };
      const clientOptions: LanguageClientOptions = {
        diagnosticCollectionName: "elmLS",
        documentSelector: [
          {
            language: "elm",
            pattern: `${folder.uri.fsPath}/**/*`,
            scheme: "file",
          },
        ],
        initializationOptions: config
          ? {
              elmAnalyseTrigger: config.elmAnalyseTrigger,
              elmFormatPath: config.elmFormatPath,
              elmPath: config.elmPath,
              elmTestPath: config.elmTestPath,
              trace: {
                server: config.trace.server,
              },
            }
          : {},
        outputChannel,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        workspaceFolder: folder,
      };
      const client = new LanguageClient(
        "elmLS",
        "Elm Language Server",
        serverOptions,
        clientOptions,
      );
      client.start();
      clients.set(folder.uri.toString(), client);
    }
  }

  Workspace.onDidOpenTextDocument(didOpenTextDocument);
  Workspace.textDocuments.forEach(didOpenTextDocument);
  Workspace.onDidChangeWorkspaceFolders(event => {
    for (const folder of event.removed) {
      const client = clients.get(folder.uri.toString());
      if (client) {
        clients.delete(folder.uri.toString());
        client.stop();
      }
    }
  });

  const packageDisposables = Package.activatePackage();
  packageDisposables.forEach(d => context.subscriptions.push(d));
}

export function deactivate(): Thenable<void> | undefined {
  const promises: Array<Thenable<void>> = [];
  for (const client of clients.values()) {
    promises.push(client.stop());
  }
  return Promise.all(promises).then(() => undefined);
}
