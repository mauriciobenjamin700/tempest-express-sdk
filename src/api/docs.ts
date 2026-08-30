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
 * The Swagger UI constructor options this SDK sets before the caller's own.
 *
 * `layout` is `"BaseLayout"`, not the `"StandaloneLayout"` the Swagger demo
 * uses: standalone renders the **Explore** topbar, an editable URL field that
 * loads any spec from any origin. That is the point of the Swagger editor and
 * the wrong surface for a page documenting one service. `deepLinking` and
 * `persistAuthorization` are the two settings a reader of an authenticated
 * reference notices immediately when they are missing — a linkable operation,
 * and credentials that survive a reload.
 */
const SWAGGER_UI_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  deepLinking: true,
  persistAuthorization: true,
  layout: "BaseLayout",
});

/**
 * Reject Swagger UI options that cannot survive the trip into the page.
 *
 * The options are serialized as JSON into an inline `<script>`, and
 * `JSON.stringify` drops function values **silently** — a `requestInterceptor`
 * passed here would simply never run, with nothing to indicate why.
 *
 * @param options - The caller's Swagger UI options.
 * @param trail - Key path walked so far, for the error message.
 * @throws {Error} When a value is a function.
 */
function assertSerializableUiOptions(options: unknown, trail: string[] = []): void {
  if (typeof options === "function") {
    throw new Error(
      [
        `mountSwaggerUi: \`ui.${trail.join(".")}\` is a function, and the options are`,
        "serialized as JSON into the page, so it would be dropped silently. Swagger UI",
        "options that take a callback have to be wired in the browser.",
      ].join(" "),
    );
  }
  if (Array.isArray(options)) {
    options.forEach((entry, index) =>
      assertSerializableUiOptions(entry, [...trail, String(index)]),
    );
    return;
  }
  if (typeof options === "object" && options !== null) {
    for (const [key, value] of Object.entries(options)) {
      assertSerializableUiOptions(value, [...trail, key]);
    }
  }
}

/**
 * Build the Swagger UI bootstrap HTML pointing at `specUrl`.
 *
 * Asset URLs are **absolute** (`${assetsBase}/…`), not relative. A relative
 * `./assets/…` resolves against the request path, so visiting `/docs` (no
 * trailing slash) would fetch `/assets/…` — a 404 that leaves the UI unstyled
 * and non-functional. The absolute base resolves correctly at both `/docs` and
 * `/docs/`.
 *
 * `presets` is assigned after the merge rather than passed through `ui`: its
 * entries are live objects off `SwaggerUIBundle`, which JSON cannot carry. The
 * standalone preset is loaded — and included — only when the effective layout
 * is `"StandaloneLayout"`, so the default page ships neither the extra script
 * nor the Explore topbar it powers.
 */
function swaggerHtml(options: {
  specUrl: string;
  title: string;
  assetsBase: string;
  favicon: string | false;
  ui: Record<string, unknown>;
}): string {
  const { specUrl, title, assetsBase, favicon, ui } = options;
  const merged: Record<string, unknown> = {
    url: specUrl,
    dom_id: "#swagger-ui",
    ...SWAGGER_UI_DEFAULTS,
    ...ui,
  };
  const standalone = merged.layout === "StandaloneLayout";
  const presetScript = standalone
    ? `\n    <script src="${escapeHtml(assetsBase)}/swagger-ui-standalone-preset.js"></script>`
    : "";
  const presets = standalone
    ? "[SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset]"
    : "[SwaggerUIBundle.presets.apis]";
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
    <script src="${escapeHtml(assetsBase)}/swagger-ui-bundle.js"></script>${presetScript}
    <script>
      var options = ${scriptLiteral(merged)};
      options.presets = ${presets};
      window.ui = SwaggerUIBundle(options);
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
  /**
   * Options merged into the `SwaggerUIBundle` constructor, after
   * {@link SWAGGER_UI_DEFAULTS} and before `presets`. Anything Swagger UI
   * accepts and JSON can carry.
   *
   * Two worth knowing:
   *
   * - `supportedSubmitMethods` — which verbs get a working **Try it out**.
   *   Swagger UI enables all of them, so on an API with irreversible side
   *   effects (sending, charging, dispatching) the docs page fires the real
   *   thing. `["get"]` or `[]` narrows that.
   * - `layout: "StandaloneLayout"` — restores the Explore topbar, along with
   *   the standalone preset script it needs.
   *
   * Function values throw at mount time rather than being dropped silently by
   * the JSON serialization.
   */
  ui?: Record<string, unknown>;
}

/**
 * Mount Swagger UI at `path`, reading the spec from `specUrl`.
 *
 * Static assets are served from `${path}/assets` so the page is fully offline.
 *
 * @param app - The Express application.
 * @param path - Mount path for the UI (e.g. `/docs`).
 * @param specUrl - URL the UI fetches the OpenAPI document from.
 * @param options - Page and Swagger UI options.
 * @throws {Error} When `options.ui` carries a function value.
 */
export function mountSwaggerUi(
  app: Express,
  path: string,
  specUrl: string,
  options: SwaggerOptions = {},
): void {
  const title = options.title ?? "API docs";
  const favicon = options.favicon ?? DEFAULT_DOCS_FAVICON;
  const ui = options.ui ?? {};
  assertSerializableUiOptions(ui);
  const assetsPath = `${path.replace(/\/$/, "")}/assets`;
  app.use(assetsPath, express.static(getAbsoluteFSPath()));
  const handler: RequestHandler = (_req, res) => {
    res
      .type("html")
      .send(swaggerHtml({ specUrl, title, assetsBase: assetsPath, favicon, ui }));
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
