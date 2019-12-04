import * as path from "path";
import {
  CancellationToken,
  CodeLens,
  commands,
  ExtensionContext,
  Location,
  OutputChannel,
  Position,
  ProviderResult,
  Range,
  TextDocument,
  Uri,
  window as Window,
  workspace as Workspace,
  WorkspaceFolder,
} from "vscode";

import {
  LanguageClient,
  LanguageClientOptions,
  Middleware,
  ResolveCodeLensSignature,
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
let elmCommandsRegistered: boolean = false;

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
        relativeWorkspace.length > 1 ? `Elm (${relativeWorkspace})` : "Elm",
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
        diagnosticCollectionName: "Elm",
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
        middleware: new CodeLensResolver(),
        outputChannel,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        workspaceFolder: folder,
      };
      const client = new LanguageClient(
        "elmLS",
        "Elm",
        serverOptions,
        clientOptions,
      );
      client.start();
      clients.set(folder.uri.toString(), client);
    }
    if (elmCommandsRegistered) {
      registerElmCommand("elmLS.runTests", context);
      registerElmCommand("elmLS.runTestsCurrentFile", context);
      elmCommandsRegistered = true;
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

async function registerElmCommand(command: string, context: ExtensionContext) {
  const editorCmd = commands.registerTextEditorCommand(
    command,
    (editor, edit) => {
      const cmd = {
        arguments: [
          {
            file: editor.document.uri.toString(),
            pos: editor.selections[0].active,
          },
        ],
        command,
      };
      // Get the current file and workspace folder.
      const uri = editor.document.uri;
      const folder = Workspace.getWorkspaceFolder(uri);
      // If there is a client registered for this workspace, use that client.
      if (folder !== undefined && clients.has(folder.uri.toString())) {
        const client = clients.get(folder.uri.toString());
        if (client !== undefined) {
          client.sendRequest("workspace/executeCommand", cmd).then(_ => {
            return true;
          });
        }
      }
    },
  );
  context.subscriptions.push(editorCmd);
}

export function deactivate(): Thenable<void> | undefined {
  const promises: Array<Thenable<void>> = [];
  for (const client of clients.values()) {
    promises.push(client.stop());
  }
  return Promise.all(promises).then(() => undefined);
}

export class CodeLensResolver implements Middleware {
  public resolveCodeLens(
    codeLens: CodeLens,
    token: CancellationToken,
    next: ResolveCodeLensSignature,
  ): ProviderResult<CodeLens> {
    const resolvedCodeLens = next(codeLens, token);
    const resolveFunc = (codeLensToFix: CodeLens): CodeLens => {
      if (
        codeLensToFix &&
        codeLensToFix.command &&
        codeLensToFix.command.command === "editor.action.showReferences" &&
        codeLensToFix.command.arguments
      ) {
        const oldArgs = codeLensToFix.command.arguments;

        // Our JSON objects don't get handled correctly by
        // VS Code's built in editor.action.showReferences
        // command so we need to convert them into the
        // appropriate types to send them as command
        // arguments.

        codeLensToFix.command.arguments = [
          Uri.parse(oldArgs[0].uri),
          new Position(
            oldArgs[0].range.start.line,
            oldArgs[0].range.start.character,
          ),
          oldArgs[0].references.map(
            (position: {
              uri: string;
              range: {
                start: { line: number; character: number };
                end: { line: number; character: number };
              };
            }) => {
              return new Location(
                Uri.parse(position.uri),
                new Range(
                  position.range.start.line,
                  position.range.start.character,
                  position.range.end.line,
                  position.range.end.character,
                ),
              );
            },
          ),
        ];
      }

      return codeLensToFix;
    };

    if ((resolvedCodeLens as Thenable<CodeLens>).then) {
      return (resolvedCodeLens as Thenable<CodeLens>).then(resolveFunc);
    } else if (resolvedCodeLens as CodeLens) {
      return resolveFunc(resolvedCodeLens as CodeLens);
    }

    return resolvedCodeLens;
  }
}
