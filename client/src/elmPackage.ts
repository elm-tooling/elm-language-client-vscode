import * as vscode from "vscode";
import * as utils from "./utils";
import request from "request-light";

let packageTerminal: vscode.Terminal;

interface IElmPackageQuickPickItem extends vscode.QuickPickItem {
  info: string[];
}

function transformToPackageQuickPickItems(packages: {
  [K in string]: string[];
}): IElmPackageQuickPickItem[] {
  return Object.keys(packages).map((item: string) => {
    return { label: item, description: item, info: packages[item] };
  });
}

function transformToPackageVersionQuickPickItems(
  selectedPackage: IElmPackageQuickPickItem,
): vscode.QuickPickItem[] {
  return selectedPackage.info.map((version: string) => {
    return { label: version, description: undefined };
  });
}

function transformToQuickPickItems(packages: {
  [K in string]: string[];
}): vscode.QuickPickItem[] {
  return Object.keys(packages).map((item: string) => {
    return { label: item, description: "", info: packages[item] };
  });
}

async function getJSON(): Promise<{ [K in string]: string[] }> {
  const response = await request.xhr({
    url: "https://package.elm-lang.org/all-packages",
  });
  return JSON.parse(response.body.toString()) as { [x: string]: string[] };
}

function getInstallPackageCommand(packageToInstall: string): string {
  const config: vscode.WorkspaceConfiguration =
    vscode.workspace.getConfiguration("elmLS");
  let t: string = config.get("elmPath") as string;

  if (t === "") {
    t = "elm";
  }

  return t + " install " + packageToInstall;
}

function installPackageInTerminal(packageToInstall: string) {
  try {
    const installPackageCommand = getInstallPackageCommand(packageToInstall);
    if (packageTerminal !== undefined) {
      packageTerminal.dispose();
    }
    packageTerminal = vscode.window.createTerminal("Elm Package Install");
    const [installPackageLaunchCommand, clearCommand] =
      utils.getTerminalLaunchCommands(installPackageCommand);
    packageTerminal.sendText(clearCommand, true);
    packageTerminal.sendText(installPackageLaunchCommand, true);
    packageTerminal.show(false);
  } catch (error) {
    void vscode.window.showErrorMessage(
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
      "Cannot start Elm Package install. " + error,
    );
  }
}

function browsePackage(): Thenable<void> {
  const quickPickPackageOptions: vscode.QuickPickOptions = {
    matchOnDescription: true,
    placeHolder: "Choose a package",
  };
  const quickPickVersionOptions: vscode.QuickPickOptions = {
    matchOnDescription: false,
    placeHolder: "Choose a version, or press <esc> to browse the latest",
  };

  return getJSON()
    .then(transformToPackageQuickPickItems)
    .then((packages) =>
      vscode.window.showQuickPick(packages, quickPickPackageOptions),
    )
    .then((selectedPackage) => {
      if (selectedPackage === undefined) {
        return; // no package
      }
      return vscode.window
        .showQuickPick(
          transformToPackageVersionQuickPickItems(selectedPackage),
          quickPickVersionOptions,
        )
        .then(async (selectedVersion) => {
          const uri = selectedVersion
            ? vscode.Uri.parse(
                "https://package.elm-lang.org/packages/" +
                  selectedPackage.label +
                  "/" +
                  selectedVersion.label,
              )
            : vscode.Uri.parse(
                "https://package.elm-lang.org/packages/" +
                  selectedPackage.label +
                  "/latest",
              );
          await vscode.commands.executeCommand("vscode.open", uri);
        })
        .then(() => undefined);
    });
}

function runInstall(): Thenable<void> {
  const quickPickOptions: vscode.QuickPickOptions = {
    matchOnDescription: true,
    placeHolder: "Choose a package, or press <esc> to cancel",
  };

  return getJSON()
    .then(transformToQuickPickItems)
    .then((items) => vscode.window.showQuickPick(items, quickPickOptions))
    .then((value) => {
      if (value === undefined) {
        return; // no package
      }
      const packageName = value ? value.label : "";
      return installPackageInTerminal(packageName);
    });
}

export function activatePackage(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("elm.install", runInstall),
    vscode.commands.registerCommand("elm.browsePackage", browsePackage),
  ];
}
