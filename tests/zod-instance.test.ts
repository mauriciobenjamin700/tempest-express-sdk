import { createOpenApiRegistry, generateOpenApiDocument, z as sdkZ } from "@/index";
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("zod instance sharing", () => {
  it("re-exports the very same zod instance the consumer imports", () => {
    expect(sdkZ).toBe(z);
    expect(z.object({}).constructor).toBe(sdkZ.object({}).constructor);
  });

  it("patches the consumer's zod with .openapi()", () => {
    expect(typeof z.string().openapi).toBe("function");
  });

  it("generates a document from schemas built with the consumer's own zod", () => {
    const registry = createOpenApiRegistry();
    registry.register(
      "SendText",
      z.object({ to: z.string(), text: z.string() }).openapi("SendText"),
    );
    const doc = generateOpenApiDocument(registry, {
      info: { title: "Zap API", version: "1.0.0" },
    });
    const components = doc.components as { schemas: Record<string, unknown> };
    expect(components.schemas.SendText).toEqual({
      type: "object",
      properties: { to: { type: "string" }, text: { type: "string" } },
      required: ["to", "text"],
    });
  });

  it("accepts zod 4 top-level string formats", () => {
    const registry = createOpenApiRegistry();
    registry.register("Ident", z.object({ id: z.uuid(), email: z.email() }));
    const doc = generateOpenApiDocument(registry, {
      info: { title: "Zap API", version: "1.0.0" },
      v31: true,
    });
    const components = doc.components as {
      schemas: { Ident: { properties: Record<string, { format?: string }> } };
    };
    expect(components.schemas.Ident.properties.id?.format).toBe("uuid");
    expect(components.schemas.Ident.properties.email?.format).toBe("email");
  });
});
