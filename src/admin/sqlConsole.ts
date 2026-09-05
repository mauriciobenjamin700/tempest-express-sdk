/**
 * A SQL console for the admin, with a policy in front of it — mirroring
 * `admin.sql_shell`.
 *
 * Every serious admin panel grows one of these, because eventually someone
 * needs an answer the list view cannot give. This is that console, plus the
 * guard rails to make it survivable.
 *
 * ## Read this before enabling it
 *
 * **A SQL filter in the application is defence in depth, not a security
 * boundary.** The analyser here parses statements properly (via
 * `node-sql-parser`) rather than matching strings, which stops the ordinary
 * mistakes: a `DROP` typed by someone who meant to `SELECT`, an `UPDATE` with
 * no `WHERE`, a query against a table holding card data. It will not stop a
 * determined operator with time — SQL has CTEs, subqueries, functions, dialect
 * extensions and comment tricks, and any parser-based allowlist is a game of
 * coverage.
 *
 * The boundary that actually holds is the **database user**. A role granted
 * only `SELECT` on three tables cannot `DROP` anything, whatever reaches it:
 *
 * ```sql
 * CREATE ROLE admin_console LOGIN PASSWORD '…';
 * GRANT CONNECT ON DATABASE app TO admin_console;
 * GRANT SELECT ON orders, customers, invoices TO admin_console;
 * ```
 *
 * Point the console's `run` at *that* connection, then use the policy to narrow
 * further and to produce a readable refusal instead of a database error. Used
 * that way the two layers complement each other. Used alone, the policy is a
 * speed bump.
 *
 * The console is **off by default**, and every attempt — allowed or refused —
 * reaches the audit hook.
 */

/**
 * What a console may do, one statement family per member.
 *
 * Split the way an operator thinks about risk rather than the way SQL groups
 * keywords: `DELETE` is separate from `UPDATE` because losing rows and
 * corrupting them are different incidents, and `DROP` is separate from the rest
 * of DDL because it is the one nobody undoes.
 */
export const SqlCapability = {
  /** `SELECT`, `WITH … SELECT`, `EXPLAIN`, `SHOW`. */
  READ: "read",
  /** Adds rows. */
  INSERT: "insert",
  /** Changes rows. */
  UPDATE: "update",
  /** Removes rows. */
  DELETE: "delete",
  /** `CREATE` / `ALTER` / `COMMENT`. */
  DDL: "ddl",
  /** `DROP` and `TRUNCATE`: irreversible structure loss. */
  DROP: "drop",
  /**
   * `GRANT` / `REVOKE` / `SET`, and anything the analyser cannot classify.
   * Unknown statements land here on purpose, so a construct nobody anticipated
   * needs the most privileged capability rather than the least.
   */
  ADMIN: "admin",
} as const;

/** A {@link SqlCapability} value. */
export type SqlCapability = (typeof SqlCapability)[keyof typeof SqlCapability];

/** Statement types the parser reports, mapped to the capability they need. */
const STATEMENT_CAPABILITIES: Record<string, SqlCapability> = {
  select: SqlCapability.READ,
  with: SqlCapability.READ,
  explain: SqlCapability.READ,
  show: SqlCapability.READ,
  desc: SqlCapability.READ,
  describe: SqlCapability.READ,
  insert: SqlCapability.INSERT,
  replace: SqlCapability.INSERT,
  update: SqlCapability.UPDATE,
  delete: SqlCapability.DELETE,
  create: SqlCapability.DDL,
  alter: SqlCapability.DDL,
  comment: SqlCapability.DDL,
  rename: SqlCapability.DDL,
  drop: SqlCapability.DROP,
  truncate: SqlCapability.DROP,
};

/** What the analyser concluded about a submitted statement. */
export interface SqlAnalysis {
  /** How many statements the text carries. */
  statements: number;
  /** The capabilities the text needs, deduplicated. */
  capabilities: SqlCapability[];
  /** Tables the parser could name, lowercased. */
  tables: string[];
  /** Whether the parser understood the text at all. */
  parsed: boolean;
  /** Whether any statement mutates rows without a `WHERE`. */
  unscopedWrite: boolean;
}

/** The rules a console enforces before running anything. */
export interface SqlConsolePolicy {
  /** Capabilities the console may use. Default `["read"]`. */
  capabilities?: readonly SqlCapability[];
  /** When set, only these tables may be touched (lowercased comparison). */
  allowTables?: readonly string[];
  /** Tables that may never be touched, whatever `allowTables` says. */
  denyTables?: readonly string[];
  /** Refuse an `UPDATE`/`DELETE` with no `WHERE`. Default `true`. */
  requireWhereOnWrites?: boolean;
  /** Rows returned to the browser. Default `200`. */
  maxRows?: number;
}

/** One console attempt, handed to the audit hook whether or not it ran. */
export interface SqlAuditEntry {
  /** The submitted text, verbatim. */
  sql: string;
  /** The operator's display name. */
  principal: string;
  /** Whether the policy let it run. */
  allowed: boolean;
  /** Why it was refused, or `null` when it ran. */
  reason: string | null;
  /** What the analyser concluded. */
  analysis: SqlAnalysis;
  /** Wall-clock duration in milliseconds, or `null` when it never ran. */
  durationMs: number | null;
  /** Rows returned, or `null` when it never ran or returned none. */
  rowCount: number | null;
}

/** Called for every attempt, allowed or refused. */
export type SqlAuditHook = (entry: SqlAuditEntry) => void | Promise<void>;

/** Message pointing at the optional peer when it is missing. */
const PARSER_HINT =
  "The admin SQL console needs the optional peer `node-sql-parser`. " +
  "Install it with: npm install node-sql-parser";

/** The subset of `node-sql-parser` this module uses. */
interface SqlParser {
  astify(sql: string, options: { database: string }): unknown;
  tableList(sql: string, options: { database: string }): string[];
}

/**
 * Load `node-sql-parser`, or throw an error naming the install command.
 *
 * @returns A parser instance.
 * @throws Error When the optional peer is not installed.
 */
export async function loadSqlParser(): Promise<SqlParser> {
  try {
    const module = (await import("node-sql-parser")) as unknown as {
      Parser: new () => SqlParser;
      default?: { Parser: new () => SqlParser };
    };
    const Parser = module.Parser ?? module.default?.Parser;
    if (Parser === undefined) throw new Error(PARSER_HINT);
    return new Parser();
  } catch {
    throw new Error(PARSER_HINT);
  }
}

/**
 * Classify a submitted statement.
 *
 * Text the parser cannot understand is not rejected here — it comes back as
 * `parsed: false` needing {@link SqlCapability.ADMIN}, so an unanticipated
 * construct requires the most privileged capability instead of slipping through
 * as the least.
 *
 * @param sql - The submitted text.
 * @param dialect - The parser dialect (`postgresql`, `sqlite`, `mysql`, …).
 * @param parser - The loaded parser.
 * @returns What the text needs and touches.
 */
export function analyzeSql(sql: string, dialect: string, parser: SqlParser): SqlAnalysis {
  const capabilities = new Set<SqlCapability>();
  const tables = new Set<string>();
  let statements = 0;
  let parsed = true;
  let unscopedWrite = false;

  try {
    const ast = parser.astify(sql, { database: dialect });
    const list = (Array.isArray(ast) ? ast : [ast]) as Record<string, unknown>[];
    statements = list.length;
    for (const statement of list) {
      const type = String(statement.type ?? "").toLowerCase();
      capabilities.add(STATEMENT_CAPABILITIES[type] ?? SqlCapability.ADMIN);
      if ((type === "update" || type === "delete") && !statement.where) {
        unscopedWrite = true;
      }
    }
  } catch {
    parsed = false;
    statements = 1;
    capabilities.add(SqlCapability.ADMIN);
  }

  try {
    for (const entry of parser.tableList(sql, { database: dialect })) {
      const name = entry.split("::").pop();
      if (name !== undefined && name !== "null") tables.add(name.toLowerCase());
    }
  } catch {
    // The statement type already decided the capability; an unlistable table
    // set only costs the table rules, which fail closed below when configured.
  }

  return {
    statements,
    capabilities: [...capabilities],
    tables: [...tables],
    parsed,
    unscopedWrite,
  };
}

/**
 * Decide whether a policy lets an analysed statement run.
 *
 * @param analysis - What the analyser concluded.
 * @param policy - The console's rules.
 * @returns The verdict and, on refusal, a reason the operator can act on.
 */
export function checkSqlPolicy(
  analysis: SqlAnalysis,
  policy: SqlConsolePolicy,
): { allowed: boolean; reason: string | null } {
  const granted = new Set<SqlCapability>(policy.capabilities ?? [SqlCapability.READ]);

  for (const capability of analysis.capabilities) {
    if (!granted.has(capability)) {
      return {
        allowed: false,
        reason: analysis.parsed
          ? `This console may not run ${capability} statements.`
          : "The statement could not be parsed, so it needs the admin capability.",
      };
    }
  }

  if ((policy.requireWhereOnWrites ?? true) && analysis.unscopedWrite) {
    return {
      allowed: false,
      reason: "An UPDATE or DELETE without a WHERE clause is refused.",
    };
  }

  const denied = new Set((policy.denyTables ?? []).map((name) => name.toLowerCase()));
  for (const table of analysis.tables) {
    if (denied.has(table)) {
      return { allowed: false, reason: `Table "${table}" is not available here.` };
    }
  }

  if (policy.allowTables !== undefined) {
    const allowed = new Set(policy.allowTables.map((name) => name.toLowerCase()));
    if (analysis.tables.length === 0) {
      return {
        allowed: false,
        reason: "This console only runs statements naming an allowed table.",
      };
    }
    for (const table of analysis.tables) {
      if (!allowed.has(table)) {
        return { allowed: false, reason: `Table "${table}" is not on the allow list.` };
      }
    }
  }

  return { allowed: true, reason: null };
}
