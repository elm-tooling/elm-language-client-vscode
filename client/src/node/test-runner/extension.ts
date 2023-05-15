/*
MIT License

 Copyright 2021 Frank Wagner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

import { Log } from "vscode-test-adapter-util";
import { TestHub, testExplorerExtensionId } from "vscode-test-adapter-api";
import { ElmTestAdapter } from "./adapter";

import { LanguageClient } from "vscode-languageclient/node";

class ElmTestAdapterRegister {
  private readonly adapters: Map<string, Map<string, ElmTestAdapter>> = new Map(
    [],
  );

  dispose(): void {
    const adapters = Array.from(this.adapters.values()).flatMap((value) =>
      Array.from(value.values()),
    );
    this.adapters.clear();
    this.disposeAdapters(adapters);
  }

  private disposeAdapters(adapters: ElmTestAdapter[]): void {
    const testHub = this.getTestHub();
    if (testHub) {
      adapters.forEach((adapter) => testHub.unregisterTestAdapter(adapter));
    }
    adapters.forEach((adapter) => adapter.dispose());
  }

  private getTestHub(): TestHub | undefined {
    const testExplorerExtension = vscode.extensions.getExtension<TestHub>(
      testExplorerExtensionId,
    );
    return testExplorerExtension ? testExplorerExtension.exports : undefined;
  }

  activate(
    workspaceFolder: vscode.WorkspaceFolder,
    client: LanguageClient,
    log: Log,
  ): void {
    const testHub = this.getTestHub();
    log.info(`Test Explorer ${testHub ? "" : "not "}found`);

    if (testHub) {
      void vscode.workspace
        .findFiles(
          new vscode.RelativePattern(workspaceFolder, "**/elm.json"),
          new vscode.RelativePattern(
            workspaceFolder,
            "**/{node_modules,elm-stuff}/**",
          ),
        )
        .then((elmJsons) => {
          elmJsons.forEach((elmJsonPath) => {
            const elmProjectFolder = vscode.Uri.parse(
              path.dirname(elmJsonPath.fsPath),
            );
            if (fs.existsSync(path.join(elmProjectFolder.fsPath, "tests"))) {
              log.info(`Elm Test Runner for ${elmProjectFolder.fsPath}`);
              const adapter = new ElmTestAdapter(
                workspaceFolder,
                elmProjectFolder,
                client,
                log,
              );
              this.add(workspaceFolder, elmProjectFolder, adapter);
              testHub.registerTestAdapter(adapter);
            }
          });
        });
    }
  }

  private add(
    workspaceFolder: vscode.WorkspaceFolder,
    elmProjectFolder: vscode.Uri,
    adapter: ElmTestAdapter,
  ): void {
    const key = workspaceFolder.uri.fsPath;
    const subKey = elmProjectFolder.fsPath;
    const value = this.adapters.get(key);
    if (!value) {
      const newValue = new Map<string, ElmTestAdapter>([[subKey, adapter]]);
      this.adapters.set(key, newValue);
      return;
    }
    value.set(subKey, adapter);

    // TODO observe when elmProjectFolder gets deleted
    // vscode.workspace.onDidDeleteFiles((e) => {
    // });
    // TODO observe when a new elmProjectFolder gets added
    // vscode.workspace.onDidCreateFiles((e) => {
    // });
  }

  deactivate(workspaceFolder: vscode.WorkspaceFolder): void {
    const key = workspaceFolder.uri.fsPath;
    const value = this.adapters.get(key);
    if (value) {
      this.disposeAdapters(Array.from(value.values()));
      this.adapters.delete(key);
    }
  }
}

let register: ElmTestAdapterRegister;

export function activate(
  context: vscode.ExtensionContext,
  workspaceFolder: vscode.WorkspaceFolder,
  client: LanguageClient,
): void {
  if (!register) {
    register = new ElmTestAdapterRegister();
    context.subscriptions.push(register);
  }

  const log = new Log(
    "elmTestRunner",
    workspaceFolder,
    `Elm Test Runner (${workspaceFolder.name})`,
  );
  context.subscriptions.push(log);

  register.activate(workspaceFolder, client, log);
}

export function deactivate(workspaceFolder: vscode.WorkspaceFolder): void {
  if (register) {
    register.deactivate(workspaceFolder);
  }
}
