import * as vscode from "vscode";

export const isWindows = process.platform === "win32";

function isPowershell() {
  return vscode.env.shell.search(/(powershell|pwsh)/i) !== -1;
}

export function getTerminalLaunchCommands(command: string): [string, string] {
  if (isWindows) {
    if (isPowershell()) {
      return [`cmd /c ${command}`, "clear"];
    } else {
      return [`${command}`, "cls"];
    }
  } else {
    return [command, "clear"];
  }
}
