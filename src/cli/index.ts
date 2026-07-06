#!/usr/bin/env node
/**
 * `tempest-express` command-line interface, mirroring `cli.main`.
 *
 * Commands:
 *   - `new <name>`  — scaffold a runnable Express service from the SDK template.
 *   - `--version`   — print the CLI/SDK version.
 *   - `--help`      — print usage.
 */

import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { dockerComposeFile, projectFiles, resourceFiles } from "@/cli/template";
import { baseAppSettingsSchema, loadSettings } from "@/settings/base";
import { PasswordUtils } from "@/utils/password";
import { VERSION } from "@/version";

const USAGE = `tempest-express — Express SDK CLI

Usage:
  tempest-express new <name> [--dir <path>]        Scaffold a new service
  tempest-express generate <Name> [--dir <path>]   Scaffold a CRUD resource
  tempest-express secret [--bytes <n>]             Print a random secret
  tempest-express docker-compose [--dir <path>]    Write a docker-compose.yml
  tempest-express db                               Migration guidance
  tempest-express lint [--dir <path>]              Run Biome check in a project
  tempest-express config [--dir <path>]            Print the resolved base settings
  tempest-express user --email <e> --password <p> [--admin]
                                                   Print a ready-to-insert user record
  tempest-express --version                        Print the version
  tempest-express --help                           Show this help
`;

const DB_HELP = `Migrations are handled by tempest-db-js (programmatic API):

  import { ... } from "tempest-db-js/migrations";

See https://www.npmjs.com/package/tempest-db-js for the migration workflow.
`;

/** Parse a `.env` file's `KEY=VALUE` lines into a record (ignores comments). */
function parseDotEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Write a project file map under `root`, creating directories as needed. */
async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
}

/** Scaffold a new project named `name` into `dir/name`. */
async function runNew(name: string, dir: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    throw new Error(`Invalid project name: ${JSON.stringify(name)}`);
  }
  const root = resolve(dir, name);
  await writeFiles(root, projectFiles(name));
  process.stdout.write(
    `Created ${name} at ${root}\n\nNext steps:\n  cd ${name}\n  npm install\n  cp .env.example .env\n  npm run dev\n`,
  );
}

/** Scaffold a CRUD resource into `dir` (PascalCase name required). */
async function runGenerate(name: string, dir: string): Promise<void> {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(`Resource name must be PascalCase, got ${JSON.stringify(name)}`);
  }
  const files = resourceFiles(name);
  await writeFiles(resolve(dir), files);
  const written = Object.keys(files)
    .map((path) => `  ${path}`)
    .join("\n");
  process.stdout.write(`Generated ${name} resource:\n${written}\n`);
}

/**
 * Parse `argv` and dispatch to the matching command.
 *
 * @param argv - Arguments after `node script` (defaults to `process.argv`).
 * @returns The process exit code.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
      dir: { type: "string", default: "." },
      bytes: { type: "string", default: "32" },
      email: { type: "string" },
      password: { type: "string" },
      admin: { type: "boolean", default: false },
    },
  });

  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const [command, ...rest] = positionals;

  if (values.help || command === undefined || command === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const dir = values.dir ?? ".";

  if (command === "new") {
    const name = rest[0];
    if (!name) {
      process.stderr.write(`error: \`new\` requires a project name\n\n${USAGE}`);
      return 1;
    }
    await runNew(name, dir);
    return 0;
  }

  if (command === "generate" || command === "g") {
    const name = rest[0];
    if (!name) {
      process.stderr.write(`error: \`generate\` requires a resource name\n\n${USAGE}`);
      return 1;
    }
    await runGenerate(name, dir);
    return 0;
  }

  if (command === "secret") {
    const nbytes = Number.parseInt(values.bytes ?? "32", 10);
    if (!Number.isInteger(nbytes) || nbytes < 16) {
      process.stderr.write("error: --bytes must be an integer >= 16\n");
      return 1;
    }
    process.stdout.write(`${randomBytes(nbytes).toString("base64url")}\n`);
    return 0;
  }

  if (command === "docker-compose") {
    await writeFiles(resolve(dir), { "docker-compose.yml": dockerComposeFile("app") });
    process.stdout.write(`Wrote ${resolve(dir, "docker-compose.yml")}\n`);
    return 0;
  }

  if (command === "db") {
    process.stdout.write(DB_HELP);
    return 0;
  }

  if (command === "lint") {
    const target = resolve(dir);
    const result = spawnSync("npx", ["biome", "check", target], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    return result.status ?? 1;
  }

  if (command === "config") {
    const env = { ...process.env, ...parseDotEnv(join(resolve(dir), ".env")) };
    const settings = loadSettings(baseAppSettingsSchema, env);
    process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
    return 0;
  }

  if (command === "user") {
    const { email, password } = values;
    if (!email || !password) {
      process.stderr.write("error: `user` requires --email and --password\n");
      return 1;
    }
    const hashedPassword = await new PasswordUtils().hash(password);
    const record = {
      id: randomUUID(),
      email,
      hashedPassword,
      isAdmin: Boolean(values.admin),
      isActive: true,
    };
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return 0;
  }

  process.stderr.write(`error: unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
  return 1;
}

// Auto-run as a binary, but stay importable from tests without executing.
if (!process.env.VITEST) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`error: ${message}\n`);
      process.exitCode = 1;
    });
}
