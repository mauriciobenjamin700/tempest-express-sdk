/**
 * Request-scoped context propagation via `AsyncLocalStorage`.
 *
 * Mirrors `tempest_fastapi_sdk.core.context`: a per-request id that any layer
 * (logger, exception handler, service) can read without threading it through
 * every call. The store is populated by the request-id middleware and survives
 * across `await` boundaries within the same request.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** The shape of the per-request store. */
export interface RequestContext {
  /** Stable id correlating every log line of a single request. */
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with `context` bound as the active request context.
 *
 * @param context - The context to bind for the duration of `fn`.
 * @param fn - The function to run within the bound context.
 * @returns Whatever `fn` returns.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Read the current request id, or `null` when called outside a request.
 *
 * @returns The active request id, or `null`.
 */
export function getRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

/**
 * Overwrite the request id on the active context (no-op outside a request).
 *
 * @param requestId - The id to set.
 */
export function setRequestId(requestId: string): void {
  const store = storage.getStore();
  if (store) store.requestId = requestId;
}
