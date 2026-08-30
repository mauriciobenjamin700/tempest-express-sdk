import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  DEFAULT_DOCS_FAVICON,
  REDOC_CDN_URL,
  mountRedoc,
  mountSwaggerUi,
  resolveRedocBundle,
  runServer,
} from "@/index";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

let server: Server | undefined;

/**
 * Boot an Express app on an ephemeral port and return its base URL.
 */
async function serve(app: express.Express): Promise<string> {
  server = await runServer(app, { port: 0 });
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(() => {
  server?.close();
  server = undefined;
  vi.restoreAllMocks();
});

describe("docs favicon", () => {
  it("declares an inline icon so the browser never asks for /favicon.ico", async () => {
    const app = express();
    mountSwaggerUi(app, "/docs", "/openapi.json");
    mountRedoc(app, "/redoc", "/openapi.json");
    const base = await serve(app);

    for (const path of ["/docs", "/redoc"]) {
      const html = await (await fetch(`${base}${path}`)).text();
      expect(html).toContain(`<link rel="icon" href="${DEFAULT_DOCS_FAVICON}" />`);
    }
  });

  it("honours a custom favicon and omits the tag when false", async () => {
    const app = express();
    mountSwaggerUi(app, "/custom", "/openapi.json", { favicon: "/brand.png" });
    mountSwaggerUi(app, "/bare", "/openapi.json", { favicon: false });
    const base = await serve(app);

    expect(await (await fetch(`${base}/custom`)).text()).toContain(
      '<link rel="icon" href="/brand.png" />',
    );
    expect(await (await fetch(`${base}/bare`)).text()).not.toContain('rel="icon"');
  });

  it("escapes the title instead of letting it close the tag", async () => {
    const app = express();
    mountSwaggerUi(app, "/docs", "/openapi.json", {
      title: "</title><script>alert(1)</script>",
    });
    const base = await serve(app);

    const html = await (await fetch(`${base}/docs`)).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("redoc bundle source", () => {
  it("resolves the redoc package installed next to the app", () => {
    expect(resolveRedocBundle()).toMatch(/redoc[\\/]bundles[\\/]redoc\.standalone\.js$/);
  });

  it("serves the bundle locally by default, with no CDN in the page", async () => {
    const app = express();
    mountRedoc(app, "/redoc", "/openapi.json");
    const base = await serve(app);

    const html = await (await fetch(`${base}/redoc`)).text();
    expect(html).toContain('<script src="/redoc/assets/redoc.standalone.js"');
    expect(html).not.toContain(REDOC_CDN_URL);

    const bundle = await fetch(`${base}/redoc/assets/redoc.standalone.js`);
    expect(bundle.status).toBe(200);
    expect(bundle.headers.get("content-type")).toContain("javascript");
    expect((await bundle.text()).length).toBeGreaterThan(100_000);
  });

  it("uses the CDN only when asked", async () => {
    const app = express();
    mountRedoc(app, "/redoc", "/openapi.json", { bundle: "cdn" });
    const base = await serve(app);

    const html = await (await fetch(`${base}/redoc`)).text();
    expect(html).toContain(REDOC_CDN_URL);
  });

  it("refuses to fall back to the CDN when the bundle is 'local'", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/");
    const app = express();
    expect(() => mountRedoc(app, "/redoc", "/openapi.json", { bundle: "local" })).toThrow(
      /requires the `redoc` package/,
    );
  });

  it("falls back to the CDN on 'auto' when redoc is not installed", async () => {
    vi.spyOn(process, "cwd").mockReturnValue("/");
    const app = express();
    mountRedoc(app, "/redoc", "/openapi.json");
    const base = await serve(app);

    const html = await (await fetch(`${base}/redoc`)).text();
    expect(html).toContain(REDOC_CDN_URL);
  });

  it("explains itself instead of rendering blank when the bundle fails to load", async () => {
    const app = express();
    mountRedoc(app, "/redoc", "/openapi.json", { bundle: "cdn" });
    const base = await serve(app);

    const html = await (await fetch(`${base}/redoc`)).text();
    expect(html).toContain('onerror="window.__redocLoadFailed()"');
    expect(html).toContain("The API reference could not load");
  });
});

describe("swagger ui options", () => {
  it("documents one service: BaseLayout, no Explore topbar, no standalone preset", async () => {
    const app = express();
    mountSwaggerUi(app, "/docs", "/openapi.json");
    const base = await serve(app);

    const html = await (await fetch(`${base}/docs`)).text();
    expect(html).toContain('"layout":"BaseLayout"');
    expect(html).toContain("options.presets = [SwaggerUIBundle.presets.apis];");
    expect(html).not.toContain("swagger-ui-standalone-preset.js");
    expect(html).not.toContain("StandaloneLayout");
  });

  it("turns on deepLinking and persistAuthorization by default", async () => {
    const app = express();
    mountSwaggerUi(app, "/docs", "/openapi.json");
    const base = await serve(app);

    const html = await (await fetch(`${base}/docs`)).text();
    expect(html).toContain('"deepLinking":true');
    expect(html).toContain('"persistAuthorization":true');
  });

  it("merges caller options over the defaults", async () => {
    const app = express();
    mountSwaggerUi(app, "/docs", "/openapi.json", {
      ui: { supportedSubmitMethods: ["get"], persistAuthorization: false },
    });
    const base = await serve(app);

    const html = await (await fetch(`${base}/docs`)).text();
    expect(html).toContain('"supportedSubmitMethods":["get"]');
    expect(html).toContain('"persistAuthorization":false');
  });

  it("restores the standalone preset script when the layout asks for it", async () => {
    const app = express();
    mountSwaggerUi(app, "/docs", "/openapi.json", {
      ui: { layout: "StandaloneLayout" },
    });
    const base = await serve(app);

    const html = await (await fetch(`${base}/docs`)).text();
    expect(html).toContain("swagger-ui-standalone-preset.js");
    expect(html).toContain(
      "options.presets = [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset];",
    );
  });

  it("refuses a function instead of letting JSON drop it", () => {
    const app = express();
    expect(() =>
      mountSwaggerUi(app, "/docs", "/openapi.json", {
        ui: { requestInterceptor: (request: unknown) => request },
      }),
    ).toThrow(/`ui.requestInterceptor` is a function/);
  });

  it("escapes a closing script tag hidden in a ui value", async () => {
    const app = express();
    mountSwaggerUi(app, "/docs", "/openapi.json", {
      ui: { validatorUrl: "</script><script>alert(1)</script>" },
    });
    const base = await serve(app);

    const html = await (await fetch(`${base}/docs`)).text();
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });
});
