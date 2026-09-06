import {
  createOpenApiRegistry,
  extendZodWithOpenApi,
  generateOpenApiDocument,
  z as sdkZod,
} from "@/index";
import { describe, expect, it } from "vitest";
import { z as rawZod } from "zod";

/**
 * Reproduce a schema that never received the prototype patch.
 *
 * `extendZodWithOpenApi` patches `ZodType.prototype`, and zod v4 copies
 * prototype members onto each instance at construction — so a schema built
 * before the SDK loaded simply has no own `openapi` property, and the prototype
 * is not in its chain to fall back to. Deleting the own property on a fresh
 * schema reproduces exactly that state, without faking a zod internal.
 *
 * @param schema - A freshly built schema.
 * @returns The same schema, with `.openapi()` removed.
 */
function unpatched<T extends object>(schema: T): T {
  Object.defineProperty(schema, "openapi", { value: undefined, configurable: true });
  return schema;
}

describe("OpenAPI registry · module evaluation order", () => {
  it("registers a schema that never received the prototype patch", () => {
    const schema = unpatched(rawZod.object({ to: rawZod.string() }));
    expect(typeof (schema as { openapi?: unknown }).openapi).not.toBe("function");

    const registry = createOpenApiRegistry();
    expect(() => registry.register("SendText", schema as never)).not.toThrow();

    const document = generateOpenApiDocument(registry, {
      info: { title: "t", version: "1" },
    }) as { components?: { schemas?: Record<string, unknown> } };
    expect(Object.keys(document.components?.schemas ?? {})).toEqual(["SendText"]);
  });

  it("keeps the schema's shape and constraints through normalization", () => {
    const schema = unpatched(
      rawZod.object({ to: rawZod.string(), text: rawZod.string().max(4096) }),
    );
    const registry = createOpenApiRegistry();
    registry.register("SendText", schema as never);

    const document = generateOpenApiDocument(registry, {
      info: { title: "t", version: "1" },
    }) as {
      components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
    };
    expect(document.components?.schemas?.SendText?.properties?.text).toEqual({
      type: "string",
      maxLength: 4096,
    });
  });

  it("normalizes a parameter schema too", () => {
    const schema = unpatched(rawZod.string().min(1));
    const registry = createOpenApiRegistry();
    expect(() => registry.registerParameter("TraceId", schema as never)).not.toThrow();
  });

  it("leaves an already-extended schema untouched", () => {
    const schema = sdkZod
      .object({ ok: sdkZod.boolean() })
      .openapi({ description: "kept" });
    const registry = createOpenApiRegistry();
    registry.register("Ok", schema);

    const document = generateOpenApiDocument(registry, {
      info: { title: "t", version: "1" },
    }) as {
      components?: { schemas?: Record<string, { description?: string }> };
    };
    expect(document.components?.schemas?.Ok?.description).toBe("kept");
  });

  it("explains the cause when the value cannot be normalized", () => {
    const registry = createOpenApiRegistry();
    expect(() => registry.register("Bogus", { nope: true } as never)).toThrow(
      /neither `\.openapi\(\)` nor zod v4's `\.meta\(\)`/,
    );
    expect(() => registry.register("Bogus", { nope: true } as never)).toThrow(
      /single deduped instance/,
    );
  });

  it("re-exports extendZodWithOpenApi so a consumer can patch its own entrypoint", () => {
    expect(typeof extendZodWithOpenApi).toBe("function");
    expect(() => extendZodWithOpenApi(rawZod as never)).not.toThrow();
  });
});

describe("OpenAPI components · $ref emission", () => {
  it("emits a $ref when the path uses the value register() returned", () => {
    const registry = createOpenApiRegistry();
    const schema = registry.register(
      "ViaRegister",
      sdkZod.object({ to: sdkZod.string() }),
    );
    registry.registerPath({
      method: "post",
      path: "/a",
      responses: { 200: { description: "ok" } },
      request: { body: { content: { "application/json": { schema } } } },
    });

    const document = generateOpenApiDocument(registry, {
      info: { title: "t", version: "1" },
    }) as never as {
      paths: Record<
        string,
        Record<string, { requestBody: { content: Record<string, { schema: unknown }> } }>
      >;
    };
    expect(
      document.paths["/a"]?.post?.requestBody.content["application/json"]?.schema,
    ).toEqual({ $ref: "#/components/schemas/ViaRegister" });
  });

  it("emits a $ref from `.meta({ id })` without registering at all", () => {
    const schema = sdkZod.object({ to: sdkZod.string() }).meta({ id: "ViaMeta" });
    const registry = createOpenApiRegistry();
    registry.registerPath({
      method: "post",
      path: "/b",
      responses: { 200: { description: "ok" } },
      request: { body: { content: { "application/json": { schema } } } },
    });

    const document = generateOpenApiDocument(registry, {
      info: { title: "t", version: "1" },
    }) as never as {
      components: { schemas: Record<string, unknown> };
      paths: Record<
        string,
        Record<string, { requestBody: { content: Record<string, { schema: unknown }> } }>
      >;
    };
    expect(Object.keys(document.components.schemas)).toEqual(["ViaMeta"]);
    expect(
      document.paths["/b"]?.post?.requestBody.content["application/json"]?.schema,
    ).toEqual({ $ref: "#/components/schemas/ViaMeta" });
  });

  it("works with `.meta({ id })` on a schema that never got the patch", () => {
    const schema = unpatched(rawZod.object({ to: rawZod.string() })) as never as {
      meta: (m: { id: string }) => unknown;
    };
    const tagged = schema.meta({ id: "PreSdkMeta" });
    const registry = createOpenApiRegistry();
    registry.registerPath({
      method: "get",
      path: "/c",
      responses: {
        200: {
          description: "ok",
          content: { "application/json": { schema: tagged as never } },
        },
      },
    });

    const document = generateOpenApiDocument(registry, {
      info: { title: "t", version: "1" },
    }) as never as {
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(document.components.schemas)).toEqual(["PreSdkMeta"]);
  });
});
