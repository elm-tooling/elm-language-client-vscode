import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import { Disposable } from "vscode";
import {
  CancellationId,
  CancellationReceiverStrategy,
  CancellationSenderStrategy,
  CancellationStrategy,
  MessageConnection,
} from "vscode-languageclient";
import path = require("path");

function getCancellationFolderPath(folderName: string) {
  return path.join(os.tmpdir(), "elm-language-server-cancellation", folderName);
}

function getCancellationFilePath(
  folderName: string,
  id: CancellationId,
): string {
  return path.join(
    getCancellationFolderPath(folderName),
    `cancellation-${String(id)}.tmp`,
  );
}

function tryRun(callback: () => void) {
  try {
    callback();
  } catch (e) {
    /* empty */
  }
}

class FileCancellationSenderStrategy implements CancellationSenderStrategy {
  constructor(readonly folderName: string) {
    const folder = getCancellationFolderPath(folderName);
    tryRun(() => fs.mkdirSync(folder, { recursive: true }));
  }

  sendCancellation(_: MessageConnection, id: CancellationId): void {
    const file = getCancellationFilePath(this.folderName, id);
    tryRun(() => fs.writeFileSync(file, "", { flag: "w" }));
  }

  cleanup(id: CancellationId): void {
    tryRun(() => fs.unlinkSync(getCancellationFilePath(this.folderName, id)));
  }

  dispose(): void {
    const folder = getCancellationFolderPath(this.folderName);
    tryRun(() => rimraf(folder));

    function rimraf(location: string) {
      const stat = fs.lstatSync(location);
      if (stat) {
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          for (const dir of fs.readdirSync(location)) {
            rimraf(path.join(location, dir));
          }

          fs.rmdirSync(location);
        } else {
          fs.unlinkSync(location);
        }
      }
    }
  }
}

export class FileBasedCancellationStrategy
  implements CancellationStrategy, Disposable {
  private _sender: FileCancellationSenderStrategy;

  constructor() {
    const folderName = randomBytes(21).toString("hex");
    this._sender = new FileCancellationSenderStrategy(folderName);
  }

  get receiver(): CancellationReceiverStrategy {
    return CancellationReceiverStrategy.Message;
  }

  get sender(): CancellationSenderStrategy {
    return this._sender;
  }

  getCommandLineArguments(): string[] {
    return [`--cancellationReceive=file:${this._sender.folderName}`];
  }

  dispose(): void {
    this._sender.dispose();
  }
}
