import { ErrorCodes, ResponseError } from "vscode-languageclient";
import type { BaseLanguageClient } from "vscode-languageclient";
import { FindTestsRequest, TestSuite } from "../../common/protocol";

export async function discoverTests(
  client: BaseLanguageClient,
  projectFolder: string,
): Promise<TestSuite[]> {
  const deadline = Date.now() + 5000;
  for (;;) {
    try {
      return (
        (await client.sendRequest(FindTestsRequest, { projectFolder }))
          .suites ?? []
      );
    } catch (error) {
      // The server registers findTests after its asynchronous configuration request
      // during initialized. client.start() can resolve before that finishes.
      if (
        !(error instanceof ResponseError) ||
        error.code !== ErrorCodes.MethodNotFound ||
        Date.now() >= deadline
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
