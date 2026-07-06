/**
 * Database backup helper, mirroring `db.backup`.
 *
 * `backupDatabase` detects the dialect from the URL and produces a backup file:
 * a `pg_dump` for PostgreSQL, a file copy for SQLite. It shells out to `pg_dump`
 * for Postgres (must be on `PATH`), so the heavy lifting stays with the battle-
 * tested tool rather than a hand-rolled dump.
 */

import { spawn } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { detectDialect } from "tempest-db-js";

/** Options for {@link backupDatabase}. */
export interface BackupOptions {
  /** Path to the `pg_dump` binary. Default `"pg_dump"` (resolved on `PATH`). */
  pgDumpPath?: string;
  /** Extra `pg_dump` arguments (e.g. `["--no-owner", "-Fc"]`). */
  pgDumpArgs?: string[];
}

/** Resolve the on-disk file path from a `sqlite://` URL. */
function sqlitePath(url: string): string {
  // sqlite://./app.db, sqlite:///abs/app.db, sqlite://:memory:
  const withoutScheme = url.replace(/^sqlite:\/\//, "");
  if (withoutScheme === ":memory:" || withoutScheme === "") {
    throw new Error("Cannot back up an in-memory SQLite database");
  }
  // sqlite:///abs → "/abs"; sqlite://./rel → "./rel"
  return withoutScheme.startsWith("/")
    ? withoutScheme
    : withoutScheme.replace(/^\.?\//, "./");
}

/**
 * Back up a database to `destPath`.
 *
 * @param databaseUrl - The connection URL (SQLite or PostgreSQL).
 * @param destPath - Where to write the backup.
 * @param options - `pg_dump` binary path and extra args (Postgres only).
 * @returns The `destPath` on success.
 * @throws {Error} For in-memory SQLite, an unsupported dialect, or a non-zero
 *   `pg_dump` exit.
 */
export async function backupDatabase(
  databaseUrl: string,
  destPath: string,
  options: BackupOptions = {},
): Promise<string> {
  const dialect = detectDialect(databaseUrl);

  if (dialect === "sqlite") {
    await copyFile(sqlitePath(databaseUrl), destPath);
    return destPath;
  }

  if (dialect === "postgresql") {
    const bin = options.pgDumpPath ?? "pg_dump";
    const args = [...(options.pgDumpArgs ?? []), "-f", destPath, databaseUrl];
    await runPgDump(bin, args);
    return destPath;
  }

  throw new Error(`backupDatabase does not support the '${dialect}' dialect`);
}

function runPgDump(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exited with code ${code}: ${stderr.trim()}`));
    });
  });
}
