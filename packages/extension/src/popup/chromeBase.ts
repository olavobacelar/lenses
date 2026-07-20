import { Effect } from "effect";

export function logPopupError(event: string, details: Record<string, unknown> = {}) {
  console.error("[Lenses][popup]", event, details);
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function lastRuntimeError(): Error | null {
  const error = chrome.runtime.lastError;
  return error ? new Error(error.message) : null;
}

export function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new Promise<T>((resolve, reject) => {
          chrome.runtime.sendMessage(message, (response) => {
            const error = lastRuntimeError();
            if (error) {
              reject(error);
              return;
            }
            resolve(response as T);
          });
        }),
      catch: toError,
    })
  );
}

export function sendTabMessage<T>(tabId: number, message: unknown): Promise<T> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new Promise<T>((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, message, (response) => {
            const error = lastRuntimeError();
            if (error) {
              reject(error);
              return;
            }
            resolve(response as T);
          });
        }),
      catch: toError,
    })
  );
}

export function createTab(url: string): Promise<void> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          chrome.tabs.create({ url }, () => {
            const error = lastRuntimeError();
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
      catch: toError,
    })
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
