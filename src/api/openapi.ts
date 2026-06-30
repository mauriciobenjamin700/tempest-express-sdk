/**
 * OpenAPI document generation from Zod schemas.
 *
 * Thin wrapper over `@asteasolutions/zod-to-openapi`. Register schemas and
 * paths on a {@link OpenAPIRegistry}, then call {@link generateOpenApiDocument}
 * to produce a spec that drives both Swagger UI and Redoc. Because every SDK
 * schema is built from the `.openapi()`-augmented `z`, descriptions, examples
 * and component names flow straight into the document.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";

export { OpenAPIRegistry };

/** The config object accepted by the generator's `generateDocument`. */
type OpenApiDocumentConfig = Parameters<OpenApiGeneratorV3["generateDocument"]>[0];

/** Minimal `info` block for the generated document. */
export interface OpenApiInfo {
  /** API title shown in the docs header. */
  title: string;
  /** API version string. */
  version: string;
  /** Optional long description (Markdown supported by the renderers). */
  description?: string;
}

/** Options for {@link generateOpenApiDocument}. */
export interface GenerateOpenApiOptions {
  /** The document `info` block. */
  info: OpenApiInfo;
  /** Server entries (`{ url, description }`). */
  servers?: Array<{ url: string; description?: string }>;
  /** Emit OpenAPI 3.1 instead of 3.0. Default `false` (3.0). */
  v31?: boolean;
}

/**
 * Create a fresh, empty {@link OpenAPIRegistry}.
 *
 * @returns A registry to register schemas and paths on.
 */
export function createOpenApiRegistry(): OpenAPIRegistry {
  return new OpenAPIRegistry();
}

/**
 * Generate an OpenAPI document from a populated registry.
 *
 * @param registry - The registry holding registered schemas and paths.
 * @param options - The `info` block, optional servers and version flag.
 * @returns The generated OpenAPI document (plain object, JSON-serializable).
 */
export function generateOpenApiDocument(
  registry: OpenAPIRegistry,
  options: GenerateOpenApiOptions,
): Record<string, unknown> {
  const config: OpenApiDocumentConfig = {
    openapi: options.v31 ? "3.1.0" : "3.0.0",
    info: {
      title: options.info.title,
      version: options.info.version,
      ...(options.info.description !== undefined
        ? { description: options.info.description }
        : {}),
    },
    ...(options.servers !== undefined ? { servers: options.servers } : {}),
  };
  const Generator = options.v31 ? OpenApiGeneratorV31 : OpenApiGeneratorV3;
  const document = new Generator(registry.definitions).generateDocument(config);
  return document as unknown as Record<string, unknown>;
}
