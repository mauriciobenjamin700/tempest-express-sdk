/**
 * Native Swagger UI and Redoc mounting from a generated OpenAPI document.
 *
 * Swagger UI is served fully self-contained: its static assets ship with the
 * `swagger-ui-dist` dependency and are mounted locally (no CDN), with a small
 * inline initializer pointing at the spec endpoint. Redoc is served as a single
 * HTML page that loads the Redoc standalone bundle from a CDN (the renderer is
 * ~1 MB and intentionally not vendored); override {@link RedocOptions.scriptUrl}
 * to self-host it.
 */

import express, { type Express, type RequestHandler } from "express";
import { getAbsoluteFSPath } from "swagger-ui-dist";

/** A JSON-serializable OpenAPI document. */
export type OpenApiDocument = Record<string, unknown>;

/**
 * Mount the OpenAPI document as JSON at `path`.
 *
 * @param app - The Express application.
 * @param path - Route to serve the document at (e.g. `/openapi.json`).
 * @param document - The generated OpenAPI document.
 */
export function mountOpenApiJson(
  app: Express,
  path: string,
  document: OpenApiDocument,
): void {
  app.get(path, (_req, res) => {
    res.json(document);
  });
}

/**
 * Build the Swagger UI bootstrap HTML pointing at `specUrl`.
 *
 * Asset URLs are **absolute** (`${assetsBase}/…`), not relative. A relative
 * `./assets/…` resolves against the request path, so visiting `/docs` (no
 * trailing slash) would fetch `/assets/…` — a 404 that leaves the UI unstyled
 * and non-functional. The absolute base resolves correctly at both `/docs` and
 * `/docs/`.
 */
function swaggerHtml(specUrl: string, title: string, assetsBase: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <link rel="stylesheet" href="${assetsBase}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${assetsBase}/swagger-ui-bundle.js"></script>
    <script src="${assetsBase}/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${JSON.stringify(specUrl)},
        dom_id: "#swagger-ui",
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: "StandaloneLayout",
      });
    </script>
  </body>
</html>`;
}

/** Options for {@link mountSwaggerUi}. */
export interface SwaggerOptions {
  /** Page title. Default `"API docs"`. */
  title?: string;
}

/**
 * Mount Swagger UI at `path`, reading the spec from `specUrl`.
 *
 * Static assets are served from `${path}/assets` so the page is fully offline.
 *
 * @param app - The Express application.
 * @param path - Mount path for the UI (e.g. `/docs`).
 * @param specUrl - URL the UI fetches the OpenAPI document from.
 * @param options - Page options.
 */
export function mountSwaggerUi(
  app: Express,
  path: string,
  specUrl: string,
  options: SwaggerOptions = {},
): void {
  const title = options.title ?? "API docs";
  const assetsPath = `${path.replace(/\/$/, "")}/assets`;
  app.use(assetsPath, express.static(getAbsoluteFSPath()));
  const handler: RequestHandler = (_req, res) => {
    res.type("html").send(swaggerHtml(specUrl, title, assetsPath));
  };
  app.get(path, handler);
}

/** Options for {@link mountRedoc}. */
export interface RedocOptions {
  /** Page title. Default `"API reference"`. */
  title?: string;
  /** URL of the Redoc standalone bundle. Defaults to the jsDelivr CDN. */
  scriptUrl?: string;
}

/** Build the Redoc HTML pointing at `specUrl`. */
function redocHtml(specUrl: string, title: string, scriptUrl: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>body { margin: 0; padding: 0; }</style>
  </head>
  <body>
    <redoc spec-url=${JSON.stringify(specUrl)}></redoc>
    <script src=${JSON.stringify(scriptUrl)}></script>
  </body>
</html>`;
}

/**
 * Mount Redoc at `path`, reading the spec from `specUrl`.
 *
 * @param app - The Express application.
 * @param path - Mount path for Redoc (e.g. `/redoc`).
 * @param specUrl - URL Redoc fetches the OpenAPI document from.
 * @param options - Page and bundle options.
 */
export function mountRedoc(
  app: Express,
  path: string,
  specUrl: string,
  options: RedocOptions = {},
): void {
  const title = options.title ?? "API reference";
  const scriptUrl =
    options.scriptUrl ??
    "https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js";
  app.get(path, (_req, res) => {
    res.type("html").send(redocHtml(specUrl, title, scriptUrl));
  });
}
