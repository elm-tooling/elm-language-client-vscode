import {
  ExtensionContext,
  RelativePattern,
  Uri,
  workspace as Workspace,
} from "vscode";
import { CancellationToken, LanguageClient } from "vscode-languageclient/node";
import {
  ReadFileRequest,
  ReadDirectoryRequest,
  ProvideFileContentsRequest,
} from "./protocol";
import { TextDecoder } from "util";

export function register(
  client: LanguageClient,
  context: ExtensionContext,
): void {
  client.onRequest(ReadFileRequest, async (uri) => {
    const data = await Workspace.fs.readFile(
      client.protocol2CodeConverter.asUri(uri),
    );
    return new TextDecoder("utf8").decode(data);
  });
  client.onRequest(ReadDirectoryRequest, async (uri) => {
    const result = await Workspace.findFiles(
      new RelativePattern(client.protocol2CodeConverter.asUri(uri), "**/*.elm"),
    );
    return result.map((uri) => client.code2ProtocolConverter.asUri(uri));
  });

  context.subscriptions.push(
    Workspace.registerTextDocumentContentProvider("elm-virtual-file", {
      provideTextDocumentContent: async (
        uri: Uri,
        token: CancellationToken,
      ): Promise<string> => {
        return await client.sendRequest(
          ProvideFileContentsRequest,
          { uri: client.code2ProtocolConverter.asUri(uri) },
          token,
        );
      },
    }),
  );
}
