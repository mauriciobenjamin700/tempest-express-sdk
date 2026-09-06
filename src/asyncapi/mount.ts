/** Serving the AsyncAPI document over HTTP. */

import type { Express } from "express";

/** A generated AsyncAPI document, as a plain JSON-serializable object. */
export type AsyncApiDocument = Record<string, unknown>;

/**
 * Serve the AsyncAPI document as JSON.
 *
 * @param app - The Express application.
 * @param path - Route to serve it at, e.g. `/asyncapi.json`.
 * @param document - The document from `generateAsyncApiDocument`.
 * @returns Nothing.
 *
 * The mirror of `mountOpenApiJson`, and mounted next to it: a service that
 * speaks both HTTP and WebSocket publishes two documents, because no single
 * format describes both.
 */
export function mountAsyncApiJson(
  app: Express,
  path: string,
  document: AsyncApiDocument,
): void {
  app.get(path, (_req, res) => {
    res.json(document);
  });
}
