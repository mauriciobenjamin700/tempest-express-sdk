/**
 * Application factory and server runner, mirroring `api.app` + `api.server`.
 *
 * {@link createApp} wires the conventional middleware stack (JSON body parsing,
 * request-id propagation, optional CORS), mounts the health endpoint, lets the
 * caller register routers and OpenAPI paths via a `configure` hook, mounts
 * native Swagger UI + Redoc, then registers the error-handling stack last.
 * {@link runServer} starts listening and logs the bound address.
 */

import type { Server } from "node:http";
import {
  type OpenApiDocument,
  type RedocOptions,
  type SwaggerOptions,
  mountOpenApiJson,
  mountRedoc,
  mountSwaggerUi,
} from "@/api/docs";
import {
  type RegisterExceptionHandlersOptions,
  registerExceptionHandlers,
  requestIdMiddleware,
} from "@/api/handlers";
import {
  type HealthCheck,
  type HealthRouterOptions,
  makeHealthRouter,
} from "@/api/health";
import {
  type GenerateOpenApiOptions,
  type OpenAPIRegistry,
  generateOpenApiDocument,
} from "@/api/openapi";
import { JSONLogger } from "@/core";
import type { MessageCatalog } from "@/exceptions/i18n";
import express, { type Express, type RequestHandler } from "express";

const logger = new JSONLogger("tempest_express_sdk.api.server");

/** OpenAPI documentation configuration for {@link createApp}. */
export interface CreateAppOpenApi extends GenerateOpenApiOptions {
  /** Registry holding the registered schemas and paths. */
  registry: OpenAPIRegistry;
  /** Route serving the spec JSON. Default `/openapi.json`. */
  jsonPath?: string;
  /** Swagger UI mount path, or `false` to disable. Default `/docs`. */
  swaggerPath?: string | false;
  /** Redoc mount path, or `false` to disable. Default `/redoc`. */
  redocPath?: string | false;
  /** Extra Swagger UI options. */
  swagger?: SwaggerOptions;
  /** Extra Redoc options. */
  redoc?: RedocOptions;
}

/** Options for {@link createApp}. */
export interface CreateAppOptions {
  /** Allowed CORS origins. `"*"` or a list; omit/`false` to disable CORS. */
  corsOrigins?: string | string[] | false;
  /** Health endpoint options, or `false` to omit it. Default mounts `/health`. */
  health?: HealthRouterOptions | false;
  /** Hook to mount routers and register OpenAPI paths before the error stack. */
  configure?: (app: Express) => void | Promise<void>;
  /** OpenAPI docs configuration; omit to skip Swagger/Redoc. */
  openapi?: CreateAppOpenApi;
  /** Message catalog for localized error responses. */
  catalog?: MessageCatalog;
  /** Error-handling options forwarded to {@link registerExceptionHandlers}. */
  errorHandling?: Omit<RegisterExceptionHandlersOptions, "catalog">;
  /** JSON body size limit (e.g. `"1mb"`). Default `"100kb"`. */
  jsonLimit?: string;
}

/** Minimal CORS middleware (no external dependency). */
function corsMiddleware(origins: string | string[]): RequestHandler {
  const allowAll = origins === "*";
  const allowList = new Set(Array.isArray(origins) ? origins : [origins]);
  return (req, res, next) => {
    const origin = req.header("origin");
    if (allowAll) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (origin && allowList.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Request-ID",
    );
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

/**
 * Build a fully wired Express application.
 *
 * @param options - Middleware, health, OpenAPI docs and error options.
 * @returns The configured Express app, ready to {@link runServer}.
 */
export async function createApp(options: CreateAppOptions = {}): Promise<Express> {
  const app = express();
  app.use(express.json({ limit: options.jsonLimit ?? "100kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestIdMiddleware());

  if (options.corsOrigins) {
    app.use(corsMiddleware(options.corsOrigins));
  }

  if (options.health !== false) {
    app.use(makeHealthRouter(options.health ?? {}));
  }

  if (options.configure) await options.configure(app);

  if (options.openapi) {
    const { registry, jsonPath, swaggerPath, redocPath, swagger, redoc, ...genOptions } =
      options.openapi;
    const document = generateOpenApiDocument(registry, genOptions) as OpenApiDocument;
    const specPath = jsonPath ?? "/openapi.json";
    mountOpenApiJson(app, specPath, document);
    if (swaggerPath !== false) {
      mountSwaggerUi(app, swaggerPath ?? "/docs", specPath, swagger ?? {});
    }
    if (redocPath !== false) {
      mountRedoc(app, redocPath ?? "/redoc", specPath, redoc ?? {});
    }
  }

  registerExceptionHandlers(app, {
    ...options.errorHandling,
    ...(options.catalog !== undefined ? { catalog: options.catalog } : {}),
  });

  return app;
}

/** Options for {@link runServer}. */
export interface RunServerOptions {
  /** Bind host. Default `127.0.0.1`. */
  host?: string;
  /** Bind port. Default `8000`. */
  port?: number;
}

/**
 * Start listening and log the bound address.
 *
 * @param app - The Express application from {@link createApp}.
 * @param options - Host and port.
 * @returns A promise resolving to the live HTTP server once listening.
 */
export function runServer(app: Express, options: RunServerOptions = {}): Promise<Server> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8000;
  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      logger.info("Server listening", { host, port });
      resolve(server);
    });
  });
}

/** Re-export so a `HealthCheck` is reachable from the server module too. */
export type { HealthCheck };
