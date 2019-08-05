import * as vscode from 'vscode';

export const isWindows = process.platform === 'win32';

function isPowershell() {
  try {
    const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
      'ElmLS',
    );
    const t: string = <string>config.get('terminal.integrated.shell.windows');
    return t.toLowerCase().includes('powershell');
  } catch (error) {
    return false;
  }
}

export function getTerminalLaunchCommands(command: string): [string, string] {
  if (isWindows) {
    if (isPowershell()) {
      return [`cmd /c ${command}`, 'clear'];
    } else {
      return [`${command}`, 'cls'];
    }
  } else {
    return [command, 'clear'];
  }
}