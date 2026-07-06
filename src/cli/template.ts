/**
 * Project-template generator for the `new` command, mirroring `cli.new`.
 *
 * Produces a complete, runnable Express service that follows the SDK's layered
 * architecture (router → controller → service → repository → model) and is
 * pre-wired with `createApp`, native Swagger + Redoc, Zod validation, and a
 * `tempest-db-js` model. {@link projectFiles} returns a `path → contents` map
 * the CLI writes to disk.
 */

/** SDK version the generated project depends on (kept in sync at release). */
const SDK_VERSION = "^0.17.0";

/**
 * Build the file map for a new service named `name`.
 *
 * @param name - The project (and package) name.
 * @returns A map of relative file path to file contents.
 */
export function projectFiles(name: string): Record<string, string> {
  return {
    "package.json": `${JSON.stringify(
      {
        name,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: {
          dev: "tsx watch main.ts",
          start: "tsx main.ts",
          build: "tsc -p tsconfig.json",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          express: "^5.1.0",
          "tempest-db-js": "^0.3.0",
          "tempest-express-sdk": SDK_VERSION,
          zod: "^3.24.1",
        },
        devDependencies: {
          "@types/express": "^5.0.0",
          "@types/node": "^22.10.0",
          tsx: "^4.19.2",
          typescript: "^5.7.0",
        },
      },
      null,
      2,
    )}\n`,

    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022"],
          strict: true,
          noUncheckedIndexedAccess: true,
          verbatimModuleSyntax: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          outDir: "dist",
          paths: { "@/*": ["./src/*"] },
        },
        include: ["src", "main.ts"],
      },
      null,
      2,
    )}\n`,

    ".gitignore": "node_modules\ndist\n.env\n*.log\n",

    ".env.example":
      "HOST=127.0.0.1\nPORT=8000\nDEBUG=false\nDATABASE_URL=sqlite://./app.db\nCORS_ORIGINS=*\n",

    "main.ts": `import { run } from "@/index";

run();
`,

    "src/index.ts": `import { run } from "@/server";

export { run };
`,

    "src/core/settings.ts": `import { baseAppSettingsShape, loadSettings, z } from "tempest-express-sdk";

/** Application settings — extend the SDK base shape with project fields. */
export const settingsSchema = z.object({
  ...baseAppSettingsShape,
});

export const settings = loadSettings(settingsSchema);
`,

    "src/db/models/itemModel.ts": `import { BaseModel, column, tableNameFor } from "tempest-express-sdk";

/** A sample domain model. Replace with your own. */
export class ItemModel extends BaseModel {
  static tablename = tableNameFor("ItemModel");
  name = column.text().notNull();
  price = column.integer().notNull();
}
`,

    "src/schemas/item.ts": `import { baseResponseSchema, z } from "tempest-express-sdk";

/** Request payload to create an item. */
export const itemCreateSchema = z
  .object({
    name: z.string().min(1).openapi({ description: "The item name." }),
    price: z.number().int().min(0).openapi({ description: "Price in cents." }),
  })
  .openapi("ItemCreate");

/** Response payload for an item (base columns + domain fields). */
export const itemResponseSchema = baseResponseSchema
  .extend({
    name: z.string(),
    price: z.number().int(),
  })
  .openapi("Item");

export type ItemCreate = z.infer<typeof itemCreateSchema>;
export type ItemResponse = z.infer<typeof itemResponseSchema>;
`,

    "src/db/repositories/itemRepository.ts": `import { type AsyncSession, BaseRepository } from "tempest-express-sdk";
import { ItemModel } from "@/db/models/itemModel";

/** Data-access layer for items. */
export class ItemRepository extends BaseRepository<typeof ItemModel> {
  constructor(session: AsyncSession) {
    super(ItemModel, session);
  }
}
`,

    "src/services/itemService.ts": `import { BaseService } from "tempest-express-sdk";
import type { ItemRepository } from "@/db/repositories/itemRepository";
import type { ItemModel } from "@/db/models/itemModel";
import type { ItemResponse } from "@/schemas/item";

/** Business logic for items. Maps raw rows to the response shape. */
export class ItemService extends BaseService<typeof ItemModel, ItemResponse> {
  constructor(repository: ItemRepository) {
    super(repository, (row) => ({
      id: row.id,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      name: row.name,
      price: row.price,
    }));
  }
}
`,

    "src/controllers/itemController.ts": `import { BaseController } from "tempest-express-sdk";
import type { ItemModel } from "@/db/models/itemModel";
import type { ItemResponse } from "@/schemas/item";
import type { ItemService } from "@/services/itemService";

/** Orchestration boundary between the router and the item service. */
export class ItemController extends BaseController<typeof ItemModel, ItemResponse> {
  constructor(service: ItemService) {
    super(service);
  }
}
`,

    "src/api/routers/items.ts": `import { Router } from "express";
import type { OpenAPIRegistry } from "tempest-express-sdk";
import { itemCreateSchema, itemResponseSchema } from "@/schemas/item";

/**
 * Build the items router and register its OpenAPI paths.
 *
 * NOTE: wire a real controller (with a DB session) here. This stub returns
 * static data so a freshly generated project boots without a database.
 */
export function makeItemsRouter(registry: OpenAPIRegistry): Router {
  const router = Router();

  registry.registerPath({
    method: "get",
    path: "/api/items",
    summary: "List items",
    responses: {
      200: {
        description: "The items",
        content: { "application/json": { schema: itemResponseSchema.array() } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/api/items",
    summary: "Create an item",
    request: {
      body: { content: { "application/json": { schema: itemCreateSchema } } },
    },
    responses: {
      201: {
        description: "The created item",
        content: { "application/json": { schema: itemResponseSchema } },
      },
    },
  });

  router.get("/api/items", (_req, res) => {
    res.json([]);
  });

  router.post("/api/items", (req, res) => {
    const data = itemCreateSchema.parse(req.body);
    res.status(201).json({
      id: "00000000-0000-0000-0000-000000000000",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    });
  });

  return router;
}
`,

    "src/api/app.ts": `import type { Express } from "express";
import { createApp, createOpenApiRegistry } from "tempest-express-sdk";
import { settings } from "@/core/settings";
import { makeItemsRouter } from "@/api/routers/items";

/** Build the configured Express application. */
export async function makeApp(): Promise<Express> {
  const registry = createOpenApiRegistry();

  return createApp({
    corsOrigins: settings.CORS_ORIGINS,
    openapi: {
      registry,
      info: { title: "${name}", version: "0.1.0", description: "Powered by tempest-express-sdk." },
    },
    configure: (app) => {
      app.use(makeItemsRouter(registry));
    },
  });
}
`,

    "src/server.ts": `import { runServer } from "tempest-express-sdk";
import { settings } from "@/core/settings";
import { makeApp } from "@/api/app";

/** Build the app and start listening. */
export async function run(): Promise<void> {
  const app = await makeApp();
  await runServer(app, { host: settings.HOST, port: settings.PORT });
}
`,

    "docker-compose.yml": dockerComposeFile(name),

    "README.md": `# ${name}

Generated with \`tempest-express new\` — an Express + Zod + tempest-db-js service.

## Develop

\`\`\`bash
npm install
cp .env.example .env
npm run dev
\`\`\`

- API: http://127.0.0.1:8000/api/items
- Swagger UI: http://127.0.0.1:8000/docs
- Redoc: http://127.0.0.1:8000/redoc
- Health: http://127.0.0.1:8000/health
\`\`\`
`,
  };
}

/** Lowercase the first letter (PascalCase → camelCase). */
function toCamel(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Convert `CamelCase` to `snake_case`. */
function toSnake(name: string): string {
  return name.replace(/(?<!^)(?=[A-Z])/g, "_").toLowerCase();
}

/**
 * Build a full CRUD resource file map for a PascalCase resource name.
 *
 * Generates model + schema + repository + service + controller + router under
 * `src/`, mirroring the layered slice the `new` template ships with.
 *
 * @param pascal - The resource name in PascalCase (e.g. `Product`).
 * @returns A map of relative file path to file contents.
 */
export function resourceFiles(pascal: string): Record<string, string> {
  const camel = toCamel(pascal);
  const table = toSnake(pascal);

  return {
    [`src/db/models/${camel}Model.ts`]: `import { BaseModel, column, tableNameFor } from "tempest-express-sdk";

/** The ${pascal} domain model. */
export class ${pascal}Model extends BaseModel {
  static tablename = tableNameFor("${pascal}Model"); // "${table}"
  name = column.text().notNull();
}
`,

    [`src/schemas/${camel}.ts`]: `import { baseResponseSchema, z } from "tempest-express-sdk";

/** Request payload to create a ${pascal}. */
export const ${camel}CreateSchema = z
  .object({ name: z.string().min(1) })
  .openapi("${pascal}Create");

/** Response payload for a ${pascal}. */
export const ${camel}ResponseSchema = baseResponseSchema
  .extend({ name: z.string() })
  .openapi("${pascal}");

export type ${pascal}Create = z.infer<typeof ${camel}CreateSchema>;
export type ${pascal}Response = z.infer<typeof ${camel}ResponseSchema>;
`,

    [`src/db/repositories/${camel}Repository.ts`]: `import { type AsyncSession, BaseRepository } from "tempest-express-sdk";
import { ${pascal}Model } from "@/db/models/${camel}Model";

/** Data-access layer for ${pascal}. */
export class ${pascal}Repository extends BaseRepository<typeof ${pascal}Model> {
  constructor(session: AsyncSession) {
    super(${pascal}Model, session);
  }
}
`,

    [`src/services/${camel}Service.ts`]: `import { BaseService } from "tempest-express-sdk";
import type { ${pascal}Model } from "@/db/models/${camel}Model";
import type { ${pascal}Repository } from "@/db/repositories/${camel}Repository";
import type { ${pascal}Response } from "@/schemas/${camel}";

/** Business logic for ${pascal}. */
export class ${pascal}Service extends BaseService<typeof ${pascal}Model, ${pascal}Response> {
  constructor(repository: ${pascal}Repository) {
    super(repository, (row) => ({
      id: row.id,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      name: row.name,
    }));
  }
}
`,

    [`src/controllers/${camel}Controller.ts`]: `import { BaseController } from "tempest-express-sdk";
import type { ${pascal}Model } from "@/db/models/${camel}Model";
import type { ${pascal}Response } from "@/schemas/${camel}";
import type { ${pascal}Service } from "@/services/${camel}Service";

/** Orchestration boundary for ${pascal}. */
export class ${pascal}Controller extends BaseController<typeof ${pascal}Model, ${pascal}Response> {
  constructor(service: ${pascal}Service) {
    super(service);
  }
}
`,

    [`src/api/routers/${camel}s.ts`]: `import { Router } from "express";
import type { OpenAPIRegistry } from "tempest-express-sdk";
import { ${camel}CreateSchema, ${camel}ResponseSchema } from "@/schemas/${camel}";

/** Build the ${pascal} router and register its OpenAPI paths. */
export function make${pascal}sRouter(registry: OpenAPIRegistry): Router {
  const router = Router();

  registry.registerPath({
    method: "get",
    path: "/api/${camel}s",
    summary: "List ${camel}s",
    responses: {
      200: {
        description: "OK",
        content: { "application/json": { schema: ${camel}ResponseSchema.array() } },
      },
    },
  });
  registry.registerPath({
    method: "post",
    path: "/api/${camel}s",
    summary: "Create a ${camel}",
    request: {
      body: { content: { "application/json": { schema: ${camel}CreateSchema } } },
    },
    responses: {
      201: {
        description: "Created",
        content: { "application/json": { schema: ${camel}ResponseSchema } },
      },
    },
  });

  router.get("/api/${camel}s", (_req, res) => res.json([]));
  router.post("/api/${camel}s", (req, res) => {
    const data = ${camel}CreateSchema.parse(req.body);
    res.status(201).json({
      id: "00000000-0000-0000-0000-000000000000",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...data,
    });
  });

  return router;
}
`,
  };
}

/** Build a `docker-compose.yml` with Postgres + Redis for local dev. */
export function dockerComposeFile(name: string): string {
  return `services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${name}
      POSTGRES_PASSWORD: ${name}
      POSTGRES_DB: ${name}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
`;
}
