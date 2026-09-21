import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CancellationId,
  CancellationReceiverStrategy,
  CancellationSenderStrategy,
  CancellationStrategy,
  MessageConnection,
} from "vscode-languageclient/node";

// Based on Jon Bockhorst's file-based cancellation implementation in #135.
export class FileBasedCancellationStrategy
  implements CancellationStrategy, CancellationSenderStrategy
{
  readonly receiver = CancellationReceiverStrategy.Message;
  readonly sender = this;
  private readonly folder: string;
  private readonly cancelled = new Set<CancellationId>();
  private disposed = false;

  constructor(private readonly onError: (error: unknown) => void) {
    const root = path.join(os.tmpdir(), "elm-language-server-cancellation");
    fs.mkdirSync(root, { recursive: true });
    this.folder = fs.mkdtempSync(path.join(root, "client-"));
  }

  getCommandLineArguments(): string[] {
    return [`--cancellationReceive=file:${path.basename(this.folder)}`];
  }

  sendCancellation(
    connection: MessageConnection,
    id: CancellationId,
  ): Promise<void> {
    if (this.disposed) return Promise.resolve();
    try {
      // Write before yielding so a busy server can observe cancellation immediately.
      fs.writeFileSync(this.filePath(id), "");
      this.cancelled.add(id);
      return Promise.resolve();
    } catch (error) {
      this.onError(error);
      return CancellationSenderStrategy.Message.sendCancellation(
        connection,
        id,
      );
    }
  }

  cleanup(id: CancellationId): void {
    if (!this.cancelled.delete(id)) return;
    try {
      fs.rmSync(this.filePath(id), { force: true });
    } catch (error) {
      this.onError(error);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelled.clear();
    try {
      fs.rmSync(this.folder, { recursive: true, force: true });
    } catch (error) {
      this.onError(error);
    }
  }

  private filePath(id: CancellationId): string {
    return path.join(this.folder, `cancellation-${String(id)}.tmp`);
  }
}
