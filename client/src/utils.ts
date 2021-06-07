import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { IClientSettings } from "./extension";

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

function findLocalNpmBinary(
  binary: string,
  projectRoot: string,
): string | undefined {
  const binaryPath = path.join(projectRoot, "node_modules", ".bin", binary);
  return fs.existsSync(binaryPath) ? binaryPath : undefined;
}

function getConfiguredElmBinaries(): IElmBinaries {
  const config = vscode.workspace
    .getConfiguration()
    .get<IClientSettings>("elmLS");
  return <IElmBinaries>{
    elm: nonEmpty(config?.elmPath),
    elmTest: nonEmpty(config?.elmTestPath),
  };
}

export function getElmBinaries(...rootFolders: vscode.Uri[]): IElmBinaries {
  const configured = getConfiguredElmBinaries();
  return resolveElmBinaries(configured, ...rootFolders);
}

function nonEmpty(text: string | undefined): string | undefined {
  return text && text.length > 0 ? text : undefined;
}

export interface IElmBinaries {
  elmTest?: string;
  elm?: string;
}

function resolveElmBinaries(
  configured: IElmBinaries,
  ...roots: vscode.Uri[]
): IElmBinaries {
  const rootPaths = Array.from(new Set(roots.map((r) => r.fsPath)).values());
  return <IElmBinaries>{
    elmTest:
      configured.elmTest ??
      rootPaths
        .map((r) => findLocalNpmBinary("elm-test", r))
        .filter((p) => p)[0],
    elm:
      configured.elm ??
      rootPaths.map((r) => findLocalNpmBinary("elm", r)).filter((p) => p)[0],
  };
}
