import * as path from "path";
import {
  CancellationToken,
  CodeAction,
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
  LanguageClientOptions,
  Middleware,
  ResolveCodeLensSignature,
  RevealOutputChannelOn,
  ProvideCodeLensesSignature,
  DidChangeConfigurationNotification,
  ResolveCodeActionSignature,
  Position as LspPosition,
  Location as LspLocation,
  Range as LspRange,
} from "vscode-languageclient";
import {
  LanguageClient,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import * as Package from "./elmPackage";
import * as RefactorAction from "./refactorAction";
import * as ExposeUnexposeAction from "./exposeUnexposeAction";
import * as Restart from "./restart";

export interface IClientSettings {
  elmFormatPath: string;
  elmPath: string;
  elmTestPath: string;
  trace: { server: string };
  disableElmLSDiagnostics: boolean;
}

//Keep this in sync with the server for now
export interface IRefactorCodeAction extends CodeAction {
  data: {
    uri: string;
    refactorName: string;
    actionName: string;
    range: Range;
    renamePosition?: Position;
  };
}

const clients: Map<string, LanguageClient> = new Map<string, LanguageClient>();

let sortedWorkspaceFolders: string[] | undefined;

function getSortedWorkspaceFolders(): string[] {
  if (sortedWorkspaceFolders === void 0) {
    sortedWorkspaceFolders = Workspace.workspaceFolders
      ? Workspace.workspaceFolders
          .map((folder) => {
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

function getOuterMostWorkspaceFolder(
  folder: WorkspaceFolder,
): WorkspaceFolder | undefined {
  const sorted = getSortedWorkspaceFolders();
  for (const element of sorted) {
    let uri = folder.uri.toString();
    if (uri.charAt(uri.length - 1) !== "/") {
      uri = uri + "/";
    }
    if (uri.startsWith(element)) {
      return Workspace.getWorkspaceFolder(Uri.parse(element));
    }
  }
  return folder;
}

export function activate(context: ExtensionContext): void {
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

    if (!folder) {
      return;
    }

    if (!clients.has(folder.uri.toString())) {
      const relativeWorkspace = folder.name;
      const outputChannel: OutputChannel = Window.createOutputChannel(
        relativeWorkspace.length > 0 ? `Elm (${relativeWorkspace})` : "Elm",
      );

      const debugOptions = {
        execArgv: ["--nolazy", `--inspect=${6010 + clients.size}`],
      };
      const serverOptions: ServerOptions = {
        debug: {
          module,
          options: debugOptions,
          transport: TransportKind.ipc,
        },
        run: {
          module,
          transport: TransportKind.ipc,
        },
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
        synchronize: {
          fileEvents: Workspace.createFileSystemWatcher("**/*.elm"),
        },
        initializationOptions: getSettings(config),
        middleware: new CodeLensResolver(),
        outputChannel,
        progressOnInitialization: true,
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

      RefactorAction.registerCommands(client, context);
      ExposeUnexposeAction.registerCommands(client, context);
    }
  }

  Workspace.onDidOpenTextDocument(didOpenTextDocument);
  Workspace.textDocuments.forEach(didOpenTextDocument);
  Workspace.onDidChangeWorkspaceFolders(async (event) => {
    for (const folder of event.removed) {
      const client = clients.get(folder.uri.toString());
      if (client) {
        clients.delete(folder.uri.toString());
        await client.stop();
      }
    }
  });

  Workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration("elmLS")) {
      clients.forEach((client) =>
        client.sendNotification(DidChangeConfigurationNotification.type, {
          settings: getSettings(
            Workspace.getConfiguration().get<IClientSettings>("elmLS"),
          ),
        }),
      );
    }
  });

  const packageDisposables = Package.activatePackage();
  packageDisposables.forEach((d) => context.subscriptions.push(d));
  context.subscriptions.push(Restart.registerCommand(clients));

  function getSettings(config: IClientSettings | undefined): unknown {
    return config
      ? {
          elmFormatPath: config.elmFormatPath,
          elmPath: config.elmPath,
          elmTestPath: config.elmTestPath,
          trace: {
            server: config.trace.server,
          },
          extendedCapabilities: {
            moveFunctionRefactoringSupport: true,
            exposeUnexposeSupport: true,
          },
          disableElmLSDiagnostics: config.disableElmLSDiagnostics,
        }
      : {};
  }
}

export function deactivate(): Thenable<void> | undefined {
  const promises: Thenable<void>[] = [];
  for (const client of clients.values()) {
    promises.push(client.stop());
  }
  return Promise.all(promises).then(() => undefined);
}
class CachedCodeLensResponse {
  response?: ProviderResult<CodeLens[]>;
  version = -1;
  document = "";

  matches(document: TextDocument): boolean {
    return (
      this.version === document.version &&
      this.document === document.uri.toString()
    );
  }

  update(document: TextDocument, response: ProviderResult<CodeLens[]>) {
    this.response = response;
    this.version = document.version;
    this.document = document.uri.toString();
  }
}

const cachedCodeLens = new CachedCodeLensResponse();

export class CodeLensResolver implements Middleware {
  public provideCodeLenses(
    this: void,
    document: TextDocument,
    token: CancellationToken,
    next: ProvideCodeLensesSignature,
  ): ProviderResult<CodeLens[]> {
    if (!cachedCodeLens.matches(document)) {
      cachedCodeLens.update(document, next(document, token));
    }

    return cachedCodeLens.response;
  }

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
        const oldArgs: {
          uri: string;
          range: LspRange;
          references: LspLocation[];
        }[] = codeLensToFix.command.arguments as {
          uri: string;
          range: LspRange;
          references: LspLocation[];
        }[];

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
          oldArgs[0].references.map((position: LspLocation) => {
            return new Location(
              Uri.parse(position.uri),
              new Range(
                position.range.start.line,
                position.range.start.character,
                position.range.end.line,
                position.range.end.character,
              ),
            );
          }),
        ];
      }

      return codeLensToFix;
    };

    return (resolvedCodeLens as Thenable<CodeLens>).then(resolveFunc);
  }

  resolveCodeAction(
    item: CodeAction,
    token: CancellationToken,
    next: ResolveCodeActionSignature,
  ): ProviderResult<CodeAction> {
    // TODO: Export IRefactorAction type from the server to use here
    return (next(item, token) as Thenable<IRefactorCodeAction>).then(
      async (codeAction) => {
        if (codeAction.data?.renamePosition && codeAction.edit) {
          const success = await Workspace.applyEdit(codeAction.edit);

          if (success) {
            codeAction.edit = undefined;
            const renamePostion = codeAction.data.renamePosition as LspPosition;
            await commands.executeCommand("editor.action.rename", [
              Uri.parse(codeAction.data.uri),
              new Position(renamePostion.line, renamePostion.character),
            ]);
          }
        }

        return codeAction;
      },
    );
  }
}
