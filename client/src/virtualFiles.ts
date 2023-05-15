import {
  ExtensionContext,
  RelativePattern,
  Uri,
  workspace as Workspace,
} from "vscode";
import { CancellationToken, BaseLanguageClient } from "vscode-languageclient";
import {
  ReadFileRequest,
  ReadDirectoryRequest,
  ProvideFileContentsRequest,
} from "./protocol";

export function register(
  client: BaseLanguageClient,
  context: ExtensionContext,
): void {
  client.onRequest(ReadFileRequest, async (uri) => {
    return Array.from(
      await Workspace.fs.readFile(client.protocol2CodeConverter.asUri(uri)),
    );
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
