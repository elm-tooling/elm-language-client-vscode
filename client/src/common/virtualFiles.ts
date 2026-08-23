import {
  ExtensionContext,
  RelativePattern,
  workspace as Workspace,
} from "vscode";
import { BaseLanguageClient } from "vscode-languageclient";
import { ReadFileRequest, ReadDirectoryRequest } from "./protocol";

export function register(
  client: BaseLanguageClient,
  context: ExtensionContext,
): void {
  context.subscriptions.push(
    client.onRequest(ReadFileRequest, async (uri) => {
      return Array.from(
        await Workspace.fs.readFile(client.protocol2CodeConverter.asUri(uri)),
      );
    }),
    client.onRequest(ReadDirectoryRequest, async (uri) => {
      const result = await Workspace.findFiles(
        new RelativePattern(
          client.protocol2CodeConverter.asUri(uri),
          "**/*.elm",
        ),
      );
      return result.map((uri) => client.code2ProtocolConverter.asUri(uri));
    }),
  );
}
