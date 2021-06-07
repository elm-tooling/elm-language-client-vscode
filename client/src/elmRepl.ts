import * as vscode from "vscode";
import * as utils from "./utils";
import { TextEditor, window } from "vscode";

export class ElmRepl {
  replTerminal: vscode.Terminal | undefined;
  binaries: utils.IElmBinaries;
  constructor(elmProjectFolder: vscode.Uri) {
    this.binaries = utils.getElmBinaries(elmProjectFolder);

    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal.processId === this.replTerminal?.processId) {
        this.replTerminal = undefined;
      }
    });
  }

  startRepl(): void {
    try {
      const replCommand = `${this.binaries.elm!} repl`;
      if (this.replTerminal !== undefined) {
        this.replTerminal.dispose();
      }
      this.replTerminal = window.createTerminal("Elm repl");
      const [replLaunchCommand, clearCommand] =
        utils.getTerminalLaunchCommands(replCommand);
      this.replTerminal.sendText(clearCommand, true);
      this.replTerminal.sendText(replLaunchCommand, true);
      this.replTerminal.show(true);
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      void vscode.window.showErrorMessage(`Cannot start Elm REPL. ${error}`);
    }
  }

  send(editor: TextEditor, msg: string): void {
    if (editor.document.languageId !== "elm") {
      return;
    }
    if (this.replTerminal === undefined) {
      this.startRepl();
    } else {
      const // Multiline input has to have '\' at the end of each line
        inputMsg = msg.replace(/\n/g, "\\\n") + "\n";

      this.replTerminal.sendText("\n", false); // workaround to avoid repl commands on the same line
      this.replTerminal.sendText(inputMsg, false);
    }
  }

  sendLine(editor: TextEditor): void {
    this.send(editor, editor.document.lineAt(editor.selection.start).text);
  }

  sendSelection(editor: vscode.TextEditor): void {
    this.send(editor, editor.document.getText(editor.selection));
  }

  sendFile(editor: vscode.TextEditor): void {
    this.send(editor, editor.document.getText());
  }

  public activateRepl(): vscode.Disposable[] {
    return [
      vscode.commands.registerCommand("elm.replStart", () => this.startRepl()),
      vscode.commands.registerTextEditorCommand(
        "elm.replSendLine",
        this.sendLine.bind(this),
      ),
      vscode.commands.registerTextEditorCommand(
        "elm.replSendSelection",
        this.sendSelection.bind(this),
      ),
      vscode.commands.registerTextEditorCommand(
        "elm.replSendFile",
        this.sendFile.bind(this),
      ),
    ];
  }
}
