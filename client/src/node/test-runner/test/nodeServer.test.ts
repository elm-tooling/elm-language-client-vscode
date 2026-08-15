/// <reference types="node" />

import { spawn } from "child_process";
import * as path from "path";
import { expect } from "chai";

interface IServerResponse {
  id?: number;
  result?: unknown;
  error?: { message: string };
}

describe("node server bundle", () => {
  it("initializes with the packaged Tree-sitter WASM", async function () {
    this.timeout(5000);

    const root = path.resolve(process.cwd(), "..");
    const child = spawn(
      process.execPath,
      [path.join(root, "out/nodeServer.js"), "--stdio"],
      {
        cwd: root,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = Buffer.alloc(0);
    let protocolBuffer = Buffer.alloc(0);
    let stderr = "";

    try {
      const response = await new Promise<IServerResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for initialize response. stdout: ${stdout.toString()} stderr: ${stderr}`,
            ),
          );
        }, 3000);

        child.on("error", reject);
        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
        child.stdout.on("data", (data: Buffer) => {
          stdout = Buffer.concat([stdout, data]);
          protocolBuffer = Buffer.concat([protocolBuffer, data]);

          let headerEnd = protocolBuffer.indexOf("\r\n\r\n");
          while (headerEnd !== -1) {
            const contentLength = Number(
              /Content-Length: (\d+)/.exec(
                protocolBuffer.subarray(0, headerEnd).toString(),
              )?.[1],
            );
            const bodyStart = headerEnd + 4;
            const bodyEnd = bodyStart + contentLength;
            if (!contentLength || protocolBuffer.length < bodyEnd) {
              return;
            }

            const message = JSON.parse(
              protocolBuffer.subarray(bodyStart, bodyEnd).toString(),
            ) as IServerResponse;
            protocolBuffer = protocolBuffer.subarray(bodyEnd);
            if (message.id === 1) {
              clearTimeout(timeout);
              resolve(message);
              return;
            }

            headerEnd = protocolBuffer.indexOf("\r\n\r\n");
          }
        });

        const params = {
          processId: null,
          rootUri: null,
          capabilities: {},
        };
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params,
        });
        child.stdin.write(
          `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
        );
      });

      expect(response.error, response.error?.message).to.equal(undefined);
      expect(response).to.have.property("result");
    } finally {
      child.kill();
    }
  });
});
