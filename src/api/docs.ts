/**
 * Native Swagger UI and Redoc mounting from a generated OpenAPI document.
 *
 * Swagger UI is served fully self-contained: its static assets ship with the
 * `swagger-ui-dist` dependency and are mounted locally (no CDN), with a small
 * inline initializer pointing at the spec endpoint.
 *
 * Redoc's renderer is ~1 MB and is **not** vendored — the `redoc` package pulls
 * 22 dependencies and peers on `react`, `react-dom`, `styled-components`,
 * `mobx` and `core-js`, bounds no backend service should inherit just to render
 * a reference page. It is an **optional peer** instead: install `redoc` and
 * {@link mountRedoc} serves its standalone bundle from disk, so the page works
 * offline; without it the page falls back to the jsDelivr CDN and says so
 * out loud when the network blocks the bundle.
 *
 * Both pages declare an inline `<link rel="icon">`. Without one the browser
 * requests `/favicon.ico` at the origin root, which on an API-only service is a
 * 401, a 404 or an SPA catch-all — a red console error on every page load.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import express, { type Express, type RequestHandler } from "express";
import { getAbsoluteFSPath } from "swagger-ui-dist";

/** A JSON-serializable OpenAPI document. */
export type OpenApiDocument = Record<string, unknown>;

/**
 * The bundled default favicon: a small SVG bolt as a `data:` URI.
 *
 * Inline on purpose — an asset route would be one more thing to mount, and the
 * whole point is to stop the browser from issuing a request the service cannot
 * answer. Pass {@link SwaggerOptions.favicon} to override it, or `false` to emit
 * no tag at all and let the browser fall back to `/favicon.ico`.
 */
export const DEFAULT_DOCS_FAVICON =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzRjNmVmNSIvPjxwYXRoIGQ9Ik0xNy45IDQuNSA4LjYgMTguNGg1LjJMMTMgMjcuNWw5LjQtMTMuOWgtNS4zeiIgZmlsbD0iI2ZmZiIvPjwvc3ZnPg==";

/** The jsDelivr URL used when no local Redoc bundle is available. */
export const REDOC_CDN_URL =
  "https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js";

/** Path the `redoc` package publishes its standalone browser bundle at. */
const REDOC_BUNDLE_SPECIFIER = "redoc/bundles/redoc.standalone.js";

/**
 * Escape a value for interpolation into HTML text or a quoted attribute.
 *
 * Page titles and favicon URLs come from the caller, and a caller reading them
 * from configuration is reading them from outside the program.
 *
 * @param value - The raw value.
 * @returns The escaped value.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize a value as a JavaScript literal safe to inline in a `<script>`.
 *
 * `JSON.stringify` alone is not: a `</script>` inside the string closes the
 * element early, so `<` is escaped to its `<` form.
 *
 * @param value - The value to serialize.
 * @returns The escaped JavaScript literal.
 */
function scriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * Build the `<link rel="icon">` tag for a docs page.
 *
 * @param favicon - The favicon URL, or `false` to emit nothing.
 * @returns The tag, or an empty string.
 */
function faviconTag(favicon: string | false): string {
  if (favicon === false) return "";
  return `\n    <link rel="icon" href="${escapeHtml(favicon)}" />`;
}

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
function swaggerHtml(
  specUrl: string,
  title: string,
  assetsBase: string,
  favicon: string | false,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>${faviconTag(favicon)}
    <link rel="stylesheet" href="${escapeHtml(assetsBase)}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${escapeHtml(assetsBase)}/swagger-ui-bundle.js"></script>
    <script src="${escapeHtml(assetsBase)}/swagger-ui-standalone-preset.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: ${scriptLiteral(specUrl)},
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
  /**
   * Favicon URL or `data:` URI. Default {@link DEFAULT_DOCS_FAVICON}. Pass
   * `false` to emit no tag, letting the browser request `/favicon.ico`.
   */
  favicon?: string | false;
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
  const favicon = options.favicon ?? DEFAULT_DOCS_FAVICON;
  const assetsPath = `${path.replace(/\/$/, "")}/assets`;
  app.use(assetsPath, express.static(getAbsoluteFSPath()));
  const handler: RequestHandler = (_req, res) => {
    res.type("html").send(swaggerHtml(specUrl, title, assetsPath, favicon));
  };
  app.get(path, handler);
}

/** Where {@link mountRedoc} takes the standalone renderer bundle from. */
export type RedocBundleSource = "auto" | "local" | "cdn";

/** Options for {@link mountRedoc}. */
export interface RedocOptions {
  /** Page title. Default `"API reference"`. */
  title?: string;
  /**
   * Favicon URL or `data:` URI. Default {@link DEFAULT_DOCS_FAVICON}. Pass
   * `false` to emit no tag, letting the browser request `/favicon.ico`.
   */
  favicon?: string | false;
  /**
   * Where the renderer comes from. Default `"auto"`.
   *
   * - `"auto"` — serve the `redoc` optional peer's bundle from disk when it is
   *   installed, fall back to the CDN when it is not.
   * - `"local"` — serve it from disk, and **throw at mount time** when `redoc`
   *   is not installed. Use this when an air-gapped deploy must not silently
   *   degrade into a CDN request.
   * - `"cdn"` — always load from {@link REDOC_CDN_URL}.
   */
  bundle?: RedocBundleSource;
  /**
   * Absolute path to a Redoc standalone bundle to serve, instead of resolving
   * the `redoc` package. For a vendored copy, or a layout the resolver cannot
   * reach (the bundle is resolved from `process.cwd()`).
   */
  bundlePath?: string;
  /**
   * Explicit URL for the bundle. Wins over {@link RedocOptions.bundle} and
   * {@link RedocOptions.bundlePath} — use it to point at a copy you already
   * serve yourself.
   */
  scriptUrl?: string;
}

/**
 * Resolve the `redoc` package's standalone bundle from the application.
 *
 * Resolution starts at `process.cwd()`, not at this file: `redoc` is an
 * **optional peer**, so the copy that matters is the one the application
 * installed, and Node walks up from there to the project's `node_modules`.
 *
 * @returns The absolute path to the bundle, or `null` when `redoc` is absent.
 */
export function resolveRedocBundle(): string | null {
  try {
    const requireFrom = createRequire(join(process.cwd(), "package.json"));
    return requireFrom.resolve(REDOC_BUNDLE_SPECIFIER);
  } catch {
    return null;
  }
}

/**
 * Build the Redoc HTML pointing at `specUrl`.
 *
 * The `onerror` handler matters: when the bundle fails to load — an air-gapped
 * network, a CSP that blocks the CDN — Redoc never initializes and the page
 * renders **blank**, which reads as a broken service rather than a missing
 * script. This replaces the blank page with the reason and the fix.
 */
function redocHtml(
  specUrl: string,
  title: string,
  scriptUrl: string,
  favicon: string | false,
): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>${faviconTag(favicon)}
    <style>
      body { margin: 0; padding: 0; }
      #redoc-load-error {
        display: none;
        font: 14px/1.6 system-ui, sans-serif;
        margin: 3rem auto;
        max-width: 40rem;
        padding: 0 1rem;
      }
      #redoc-load-error code {
        background: #f1f3f5;
        border-radius: 3px;
        padding: 0.1rem 0.3rem;
      }
    </style>
  </head>
  <body>
    <div id="redoc-load-error">
      <h1>The API reference could not load</h1>
      <p>
        The Redoc renderer was requested from
        <code id="redoc-script-url"></code> and did not load. The OpenAPI
        document itself is fine — it is served at
        <code id="redoc-spec-url"></code>.
      </p>
      <p>
        On a closed network, install the renderer next to the service
        (<code>npm install redoc</code>) so it is served locally, or point
        <code>scriptUrl</code> at a copy you host.
      </p>
    </div>
    <redoc spec-url="${escapeHtml(specUrl)}"></redoc>
    <script>
      window.__redocLoadFailed = function () {
        document.getElementById("redoc-script-url").textContent = ${scriptLiteral(scriptUrl)};
        document.getElementById("redoc-spec-url").textContent = ${scriptLiteral(specUrl)};
        document.getElementById("redoc-load-error").style.display = "block";
        var element = document.querySelector("redoc");
        if (element) element.style.display = "none";
      };
    </script>
    <script src="${escapeHtml(scriptUrl)}" onerror="window.__redocLoadFailed()"></script>
  </body>
</html>`;
}

/**
 * Mount Redoc at `path`, reading the spec from `specUrl`.
 *
 * By default the renderer is served from the `redoc` optional peer when it is
 * installed, so the page works offline; otherwise it falls back to the CDN.
 *
 * @param app - The Express application.
 * @param path - Mount path for Redoc (e.g. `/redoc`).
 * @param specUrl - URL Redoc fetches the OpenAPI document from.
 * @param options - Page and bundle options.
 * @throws {Error} When `bundle` is `"local"` and no bundle can be resolved.
 */
export function mountRedoc(
  app: Express,
  path: string,
  specUrl: string,
  options: RedocOptions = {},
): void {
  const title = options.title ?? "API reference";
  const favicon = options.favicon ?? DEFAULT_DOCS_FAVICON;
  const source = options.bundle ?? "auto";
  const assetsPath = `${path.replace(/\/$/, "")}/assets`;
  const bundleRoute = `${assetsPath}/redoc.standalone.js`;

  let scriptUrl = options.scriptUrl;
  if (scriptUrl === undefined && source !== "cdn") {
    const bundlePath = options.bundlePath ?? resolveRedocBundle();
    if (bundlePath !== null && bundlePath !== undefined) {
      app.get(bundleRoute, (_req, res) => {
        res.sendFile(bundlePath);
      });
      scriptUrl = bundleRoute;
    } else if (source === "local") {
      throw new Error(
        'mountRedoc: bundle "local" requires the `redoc` package. Install it ' +
          "(`npm install redoc`) or pass `bundlePath` with an absolute path to " +
          "a Redoc standalone bundle.",
      );
    }
  }

  const resolvedScriptUrl = scriptUrl ?? REDOC_CDN_URL;
  app.get(path, (_req, res) => {
    res.type("html").send(redocHtml(specUrl, title, resolvedScriptUrl, favicon));
  });
}
