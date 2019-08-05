import * as vscode from 'vscode';
import * as utils from './utils'

const request = require('request');
let packageTerminal: vscode.Terminal;

interface ElmPackageQuickPickItem extends vscode.QuickPickItem {
	info: any;
}

function transformToPackageQuickPickItems(
	packages: any[],
): ElmPackageQuickPickItem[] {
	return Object.keys(packages).map((item: any) => {
		return { label: item, description: item, info: packages[item] };
	});
}

function transformToPackageVersionQuickPickItems(
	selectedPackage: ElmPackageQuickPickItem,
): vscode.QuickPickItem[] {
	return selectedPackage.info.map((version: any) => {
		return { label: version, description: null };
	});
}

function transformToQuickPickItems(packages: any[]): vscode.QuickPickItem[] {
	return Object.keys(packages).map((item: any) => {
		return { label: item, description: '', info: packages[item] };
	});
}

function getJSON(): Thenable<any[]> {
	return new Promise((resolve, reject) => {
		request('https://package.elm-lang.org/all-packages', (err: any, _: any, body: any) => {
			if (err) {
				reject(err);
			} else {
				let json;
				try {
					json = JSON.parse(body);
				} catch (e) {
					reject(e);
				}
				resolve(json);
			}
		});
	});
}

function getInstallPackageCommand(packageToInstall: string): string {
	const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
		'ElmLS',
	);
	let t: string = <string>config.get('elmLS.elmPath');
	t = t == undefined ? "elm" : t

	return t + ' install ' + packageToInstall;
}

function installPackageInTerminal(packageToInstall: string) {
	try {
		let installPackageCommand = getInstallPackageCommand(packageToInstall);
		if (packageTerminal !== undefined) {
			packageTerminal.dispose();
		}
		packageTerminal = vscode.window.createTerminal('Elm Package Install');
		let [
			installPackageLaunchCommand,
			clearCommand,
		] = utils.getTerminalLaunchCommands(installPackageCommand);
		packageTerminal.sendText(clearCommand, true);
		packageTerminal.sendText(installPackageLaunchCommand, true);
		packageTerminal.show(false);
	} catch (error) {
		vscode.window.showErrorMessage(
			'Cannot start Elm Package install. ' + error,
		);
	}
}

function browsePackage(): Thenable<void> {
	const quickPickPackageOptions: vscode.QuickPickOptions = {
		matchOnDescription: true,
		placeHolder: 'Choose a package',
	};
	const quickPickVersionOptions: vscode.QuickPickOptions = {
		matchOnDescription: false,
		placeHolder: 'Choose a version, or press <esc> to browse the latest',
	};

	return getJSON()
		.then(transformToPackageQuickPickItems)
		.then(packages =>
			vscode.window.showQuickPick(packages, quickPickPackageOptions),
		)
		.then(selectedPackage => {
			if (selectedPackage === undefined) {
				return; // no package
			}
			return vscode.window
				.showQuickPick(
					transformToPackageVersionQuickPickItems(selectedPackage),
					quickPickVersionOptions,
				)
				.then(selectedVersion => {
					let uri = selectedVersion
						? vscode.Uri.parse(
							'https://package.elm-lang.org/packages/' +
							selectedPackage.label +
							'/' +
							selectedVersion.label,
						)
						: vscode.Uri.parse(
							'https://package.elm-lang.org/packages/' +
							selectedPackage.label +
							'/latest',
						);
					vscode.commands.executeCommand('vscode.open', uri);
				})
				.then(() => { });
		});
}

function runInstall(): Thenable<void> {
	const quickPickOptions: vscode.QuickPickOptions = {
		matchOnDescription: true,
		placeHolder:
			'Choose a package, or press <esc> to install all packages in elm-package.json',
	};

	return getJSON()
		.then(transformToQuickPickItems)
		.then(items => vscode.window.showQuickPick(items, quickPickOptions))
		.then(value => {
			const packageName = value ? value.label : '';
			return installPackageInTerminal(packageName);
		});
}


export function activatePackage(): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('elm.install', runInstall),
		vscode.commands.registerCommand('elm.browsePackage', browsePackage),
	];
}