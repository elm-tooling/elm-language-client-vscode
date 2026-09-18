/** VS Code wraps nested workers in importScripts, so bootstrap from a classic script. */
export async function createLanguageServerWorker(
  moduleUrl: string,
): Promise<Worker> {
  const bootstrap = URL.createObjectURL(
    new Blob(
      [
        `import(${JSON.stringify(
          moduleUrl,
        )}).then(() => postMessage({ elmWorkerReady: true }), error => postMessage({ elmWorkerError: String(error) }));`,
      ],
      { type: "application/javascript" },
    ),
  );
  let worker: Worker | undefined;
  try {
    worker = new Worker(bootstrap, { name: "elm-language-server" });
    const started = worker;
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeout);
        started.removeEventListener("message", message);
        started.removeEventListener("error", error);
      };
      const message = (
        event: MessageEvent<{
          elmWorkerReady?: boolean;
          elmWorkerError?: string;
        }>,
      ): void => {
        if (event.data.elmWorkerReady) {
          cleanup();
          resolve();
        } else if (event.data.elmWorkerError) {
          cleanup();
          reject(new Error(event.data.elmWorkerError));
        }
      };
      const error = (event: ErrorEvent): void => {
        cleanup();
        reject(new Error(event.message));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Elm language worker startup timed out"));
      }, 30000);
      started.addEventListener("message", message);
      started.addEventListener("error", error);
    });
    return started;
  } catch (error) {
    worker?.terminate();
    throw error;
  } finally {
    URL.revokeObjectURL(bootstrap);
  }
}
