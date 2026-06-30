/**
 * Environment-driven settings, mirroring `settings.base.BaseAppSettings`.
 *
 * Pydantic-settings reads env vars into a frozen, validated model. Here a zod
 * schema plays the same role: {@link loadSettings} parses `process.env` (env
 * names are matched case-sensitively, like the FastAPI SDK) and returns a
 * frozen, fully-typed object. Composable fragments ({@link serverSettingsShape}
 * etc.) cover the common server/database/CORS knobs.
 */

import { z } from "@/schemas/base";

/** Server bind/runtime settings. Defaults bind to localhost. */
export const serverSettingsShape = {
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(0).max(65535).default(8000),
  DEBUG: z.coerce.boolean().default(false),
} as const;

/** Database connection settings. */
export const databaseSettingsShape = {
  DATABASE_URL: z.string().default("sqlite://./app.db"),
} as const;

/** CORS settings. `CORS_ORIGINS` is a comma-separated list. */
export const corsSettingsShape = {
  CORS_ORIGINS: z
    .string()
    .default("*")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
} as const;

/** The combined base settings shape (server + database + CORS). */
export const baseAppSettingsShape = {
  ...serverSettingsShape,
  ...databaseSettingsShape,
  ...corsSettingsShape,
} as const;

/** A zod object built from {@link baseAppSettingsShape}. */
export const baseAppSettingsSchema = z.object(baseAppSettingsShape);

/** The parsed shape of {@link baseAppSettingsSchema}. */
export type BaseAppSettings = z.infer<typeof baseAppSettingsSchema>;

/**
 * Parse and freeze settings from an environment source.
 *
 * Extend the base shape with project fields:
 *
 * ```ts
 * const settings = loadSettings(
 *   z.object({ ...baseAppSettingsShape, JWT_SECRET: z.string() }),
 * );
 * ```
 *
 * @param schema - The settings zod schema.
 * @param env - The environment source (defaults to `process.env`).
 * @returns The validated, frozen settings object.
 * @throws {z.ZodError} When required env vars are missing or malformed.
 */
export function loadSettings<S extends z.ZodTypeAny>(
  schema: S,
  env: NodeJS.ProcessEnv = process.env,
): Readonly<z.infer<S>> {
  return Object.freeze(schema.parse(env));
}
