import * as path from "path";
import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeLens,
  Command,
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
} from "vscode";
import {
  LanguageClientOptions,
  Middleware,
  ResolveCodeLensSignature,
  RevealOutputChannelOn,
  ProvideCodeLensesSignature,
  DidChangeConfigurationNotification,
  ResolveCodeActionSignature,
  Location as LspLocation,
  Range as LspRange,
  ProvideCodeActionsSignature,
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
import * as TestRunner from "./test-runner/extension";

export interface IClientSettings {
  elmFormatPath: string;
  elmReviewPath: string;
  elmReviewDiagnostics: "off" | "warning" | "error";
  elmPath: string;
  elmTestPath: string;
  trace: { server: string };
  disableElmLSDiagnostics: boolean;
  skipInstallPackageConfirmation: boolean;
  onlyUpdateDiagnosticsOnSave: boolean;
}

//Keep this in sync with the server for now
export interface IRefactorCodeAction extends Omit<CodeAction, "isPreferred"> {
  data: {
    uri: string;
    refactorName: string;
    actionName: string;
    range: Range;
    renamePosition?: Position;
  };
}

const clients: Map<string, LanguageClient> = new Map<string, LanguageClient>();

export async function activate(context: ExtensionContext): Promise<void> {
  const module = context.asAbsolutePath(path.join("server", "out", "index.js"));

  const config = Workspace.getConfiguration().get<IClientSettings>("elmLS");

  // If we have nested workspace folders we only start a server on the outer most workspace folder.
  const workspaceFolders = await Workspace.findFiles(
    "**/elm.json",
    "**/{node_modules,elm-stuff}/**",
  );
  workspaceFolders.map((workspaceFolderUri) => {
    const workspaceFolder = Workspace.getWorkspaceFolder(workspaceFolderUri);
    if (workspaceFolder && !clients.has(workspaceFolder.uri.toString())) {
      const relativeWorkspace = workspaceFolder.name;
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
            pattern: `${workspaceFolder.uri.fsPath}/**/*`,
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
        workspaceFolder,
      };
      const client = new LanguageClient(
        "elmLS",
        "Elm",
        serverOptions,
        clientOptions,
      );

      const workspaceId = workspaceFolder.uri.toString();
      clients.set(workspaceId, client);
    }
  });

  for (const [workspaceId, client] of clients) {
    await client.start();

    RefactorAction.registerCommands(client, context, workspaceId);
    ExposeUnexposeAction.registerCommands(client, context, workspaceId);

    TestRunner.activate(
      context,
      Workspace.getWorkspaceFolder(Uri.parse(workspaceId))!,
      client,
    );
  }

  registerDidApplyRefactoringCommand(context);

  Workspace.onDidChangeWorkspaceFolders(async (event) => {
    for (const folder of event.removed) {
      const client = clients.get(folder.uri.toString());
      if (client) {
        TestRunner.deactivate(folder);
        clients.delete(folder.uri.toString());
        await client.stop();
      }
    }
  });

  Workspace.onDidChangeConfiguration(async (event) => {
    if (event.affectsConfiguration("elmLS")) {
      const promises: Promise<void>[] = [];

      clients.forEach((client) => {
        promises.push(
          client.sendNotification(DidChangeConfigurationNotification.type, {
            settings: getSettings(
              Workspace.getConfiguration().get<IClientSettings>("elmLS"),
            ),
          }),
        );
      });

      await Promise.all(promises);
    }
  });

  const packageDisposables = Package.activatePackage();
  packageDisposables.forEach((d) => context.subscriptions.push(d));
  context.subscriptions.push(Restart.registerCommand(clients));

  function getSettings(config: IClientSettings | undefined): unknown {
    return config
      ? {
          elmFormatPath: config.elmFormatPath,
          elmReviewPath: config.elmReviewPath,
          elmReviewDiagnostics: config.elmReviewDiagnostics,
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

const didApplyRefactoringCommandId = "elm.didApplyRefactoring";
function registerDidApplyRefactoringCommand(context: ExtensionContext): void {
  context.subscriptions.push(
    commands.registerCommand(
      didApplyRefactoringCommandId,
      async (codeAction: IRefactorCodeAction) => {
        if (codeAction.data.renamePosition) {
          await commands.executeCommand("editor.action.rename", [
            Uri.parse(codeAction.data.uri),
            new Position(
              codeAction.data.renamePosition.line,
              codeAction.data.renamePosition.character,
            ),
          ]);
        }
      },
    ),
  );
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

  provideCodeActions(
    this: void,
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken,
    next: ProvideCodeActionsSignature,
  ): ProviderResult<(CodeAction | Command)[]> {
    // TODO: Export IRefactorAction type from the server to use here
    return (
      next(document, range, context, token) as Thenable<IRefactorCodeAction[]>
    ).then((codeActions) =>
      codeActions.map((codeAction) => {
        // Maybe use 'Did apply refactoring' for more refactor actions later, but for now this is all that is needed
        if (codeAction.data.refactorName === "extract_function") {
          codeAction.command = codeAction.command ?? {
            title: "Did apply refactoring",
            command: didApplyRefactoringCommandId,
            arguments: [codeAction],
          };
        }
        return codeAction;
      }),
    );
  }

  resolveCodeAction(
    item: CodeAction,
    token: CancellationToken,
    next: ResolveCodeActionSignature,
  ): ProviderResult<CodeAction> {
    const refactorItem = item as IRefactorCodeAction;
    // We can't send the command to the server, because it has circular json
    // VS code already has reference to the command, so we don't need to send it back
    // The `didApplyRefactoring` command argument has a reference to `refactorItem`,
    // so when we update the data here, the command will know
    refactorItem.command = undefined;
    return (next(refactorItem, token) as Thenable<IRefactorCodeAction>).then(
      (codeAction) => {
        refactorItem.edit = codeAction.edit;
        refactorItem.data = codeAction.data;

        return refactorItem;
      },
    );
  }
}
