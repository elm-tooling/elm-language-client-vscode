import {
  CancellationStrategy,
  LanguageClient,
  LanguageClientOptions,
  MessageTransports,
  NodeModule,
  ShutdownMode,
  State,
} from "vscode-languageclient/node";
import { FileBasedCancellationStrategy } from "./cancellation";

export class ElmLanguageClient extends LanguageClient {
  private cancellation?: FileBasedCancellationStrategy;
  private readonly runArgs: string[];
  private readonly debugArgs: string[];

  constructor(
    id: string,
    name: string,
    private readonly serverOptions: { run: NodeModule; debug: NodeModule },
    clientOptions: LanguageClientOptions,
  ) {
    super(id, name, serverOptions, clientOptions);
    this.runArgs = serverOptions.run.args ?? [];
    this.debugArgs = serverOptions.debug.args ?? [];
  }

  start(): Promise<void> {
    const previous = this.cancellation;
    // Transport setup starts synchronously and creates this attempt's strategy.
    const starting = super.start();
    const cancellation = this.cancellation;
    if (cancellation === previous) return starting;
    return starting.catch((error: unknown) => {
      // A crashed initialization may already have started a replacement client.
      cancellation?.dispose();
      if (this.cancellation === cancellation) this.cancellation = undefined;
      throw error;
    });
  }

  protected async createMessageTransports(
    encoding: string,
  ): Promise<MessageTransports> {
    this.disposeCancellation();
    let strategy: CancellationStrategy = CancellationStrategy.Message;
    let args: string[] = [];
    try {
      this.cancellation = new FileBasedCancellationStrategy((error) => {
        this.warn("File-based cancellation failed", error, false);
      });
      strategy = this.cancellation;
      args = this.cancellation.getCommandLineArguments();
    } catch (error) {
      this.warn(
        "Using message cancellation because the cancellation directory could not be created",
        error,
        false,
      );
    }
    this.serverOptions.run.args = [...this.runArgs, ...args];
    this.serverOptions.debug.args = [...this.debugArgs, ...args];
    this.clientOptions.connectionOptions = {
      ...this.clientOptions.connectionOptions,
      cancellationStrategy: strategy,
    };
    const cancellation = this.cancellation;
    try {
      return await super.createMessageTransports(encoding);
    } catch (error) {
      cancellation?.dispose();
      if (this.cancellation === cancellation) this.cancellation = undefined;
      throw error;
    }
  }

  protected async shutdown(
    mode: ShutdownMode,
    timeout?: number,
  ): Promise<void> {
    const cancellation = this.cancellation;
    try {
      await super.shutdown(mode, timeout);
    } finally {
      if (this.state === State.Stopped || this.state === State.StartFailed) {
        cancellation?.dispose();
        if (this.cancellation === cancellation) this.cancellation = undefined;
      }
    }
  }

  protected async handleConnectionClosed(): Promise<void> {
    this.disposeCancellation();
    await super.handleConnectionClosed();
  }

  private disposeCancellation(): void {
    this.cancellation?.dispose();
    this.cancellation = undefined;
  }
}
