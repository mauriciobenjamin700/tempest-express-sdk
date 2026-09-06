/**
 * OpenAPI document generation from Zod schemas.
 *
 * Thin wrapper over `@asteasolutions/zod-to-openapi`. Register schemas and
 * paths on a registry, then call {@link generateOpenApiDocument} to produce a
 * spec that drives both Swagger UI and Redoc.
 *
 * ## Why the registry normalizes schemas
 *
 * `zod-to-openapi` adds `.openapi()` by patching `ZodType.prototype`. Zod v4
 * copies prototype members into each instance at construction, so the patch
 * does **not** reach schemas built *before* this module was evaluated — and
 * declaring schemas in `schemas/*.ts` while importing the SDK only in the docs
 * layer is the natural order, which means the failing order is the common one.
 * The symptom was a `TypeError: zodSchema.openapi is not a function` thrown
 * from inside `node_modules` at boot.
 *
 * {@link createOpenApiRegistry} therefore returns a registry that re-tags such
 * a schema through `.meta({ id })` — which builds a fresh instance, and so a
 * patched one — before handing it to the library. The same call site works
 * whatever order the modules happened to evaluate in.
 */

import type { z } from "@/schemas/base";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

export { OpenAPIRegistry, extendZodWithOpenApi };

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

/** The shape this module needs from a schema to normalize it. */
interface MaybeExtendedSchema {
  openapi?: unknown;
  meta?: (metadata: { id: string }) => unknown;
}

/**
 * Return a schema the library can register, whatever order the caller's
 * modules evaluated in.
 *
 * A schema that already carries `.openapi()` is returned untouched. One that
 * does not is re-tagged with `.meta({ id })`: zod builds a fresh instance for
 * that call, which picks up the prototype patch, and the `id` is exactly the
 * component name the registry was going to assign anyway.
 *
 * @param refId - The component name being registered under.
 * @param schema - The schema handed in by the caller.
 * @returns A schema carrying `.openapi()`.
 * @throws Error When the value is neither an extended schema nor a zod v4
 *   schema that can be re-tagged — with the cause spelled out, because the
 *   library's own failure points into `node_modules` and explains nothing.
 */
function normalizeSchema<T>(refId: string, schema: T): T {
  const candidate = schema as MaybeExtendedSchema;
  if (typeof candidate.openapi === "function") return schema;
  if (typeof candidate.meta === "function") {
    return candidate.meta({ id: refId }) as T;
  }
  throw new Error(
    `Cannot register "${refId}" for OpenAPI: the value carries neither \`.openapi()\` nor zod v4's \`.meta()\`. This usually means it is not a zod schema, or it comes from a second copy of zod in node_modules — check \`npm ls zod\` shows a single deduped instance.`,
  );
}

/**
 * A registry that accepts schemas built before this module was evaluated.
 *
 * Only the two entry points that reach into a schema for its metadata are
 * overridden. `registerPath` and `registerWebhook` take nested route configs
 * and already tolerate un-patched schemas — they simply inline the shape, which
 * is why a component name (via `register` or `.meta({ id })`) is what turns a
 * body into a `$ref`.
 */
class TempestOpenApiRegistry extends OpenAPIRegistry {
  /**
   * Register a component schema, normalizing it first.
   *
   * @param refId - The component name.
   * @param zodSchema - The schema to register.
   * @returns The registered schema, as the library returns it.
   */
  override register<T extends z.ZodType>(refId: string, zodSchema: T): T {
    return super.register(refId, normalizeSchema(refId, zodSchema));
  }

  /**
   * Register a parameter schema, normalizing it first.
   *
   * @param refId - The parameter name.
   * @param zodSchema - The schema to register.
   * @returns The registered schema, as the library returns it.
   */
  override registerParameter<T extends z.ZodType>(refId: string, zodSchema: T): T {
    return super.registerParameter(refId, normalizeSchema(refId, zodSchema));
  }
}

/**
 * Create a fresh, empty registry.
 *
 * @returns A registry to register schemas and paths on, tolerant of the order
 *   the caller's modules evaluated in.
 */
export function createOpenApiRegistry(): OpenAPIRegistry {
  return new TempestOpenApiRegistry();
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
