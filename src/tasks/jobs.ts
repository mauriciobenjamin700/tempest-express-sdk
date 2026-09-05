/**
 * Persisted job records for long background work, mirroring `tasks.jobs`.
 *
 * A {@link TaskManager} moves messages; it keeps no history, because a broker
 * has none to keep. Anything an operator has to answer afterwards — did last
 * night's export finish, why did that import fail, which job is running right
 * now — needs a row somewhere. {@link BaseJobModel} is that row and
 * {@link JobStore} is the small surface the workers write it through.
 *
 * The store is deliberately not wired into `TaskManager`: not every enqueued
 * message deserves a durable row, and a worker that writes one usually wants to
 * record domain fields the envelope never carried.
 */

import type { AsyncSession, ModelClass } from "@/db";
import { BaseRepository } from "@/db";
import { BaseModel } from "@/db/model";
import { column } from "tempest-db-js";

/** Lifecycle state of a job row. */
export const JobStatus = {
  /** Written, not started. */
  QUEUED: "queued",
  /** A worker picked it up. */
  RUNNING: "running",
  /** Finished cleanly. */
  SUCCEEDED: "succeeded",
  /** Finished with an error. */
  FAILED: "failed",
  /** An operator stopped it before it finished. */
  CANCELLED: "cancelled",
} as const;

/** A {@link JobStatus} value. */
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

/** Statuses a job can no longer leave. */
const TERMINAL: readonly string[] = [
  JobStatus.SUCCEEDED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
];

/**
 * Base for a persisted job record. Subclass it, set `tablename`, and index
 * `name` plus `status` in a migration.
 *
 * ```ts
 * export class JobModel extends BaseJobModel {
 *   static override tablename = "job";
 * }
 * ```
 */
export abstract class BaseJobModel extends BaseModel {
  /** The task name this run belongs to. */
  name = column.varchar(128).notNull();
  /** Lifecycle state — a {@link JobStatus} value. */
  status = column.varchar(16).notNull().default(JobStatus.QUEUED);
  /** The payload the run was started with. */
  payload = column.json<Record<string, unknown>>();
  /** Whatever the run produced, for an operator to read afterwards. */
  result = column.json<Record<string, unknown>>();
  /** The failure message, when the run failed. */
  error = column.text();
  /** How many times the run has been attempted. */
  attempts = column.integer().notNull().default(0);
  /** When a worker picked it up. */
  startedAt = column.datetime();
  /** When it reached a terminal state. */
  finishedAt = column.datetime();
}

/**
 * The small surface workers write job rows through.
 *
 * Every transition is a method rather than a raw update, so "finished" always
 * means the same three columns moved together — a status without a
 * `finishedAt` is the kind of half-written row that makes a history screen lie.
 */
export class JobStore<C extends ModelClass = ModelClass> {
  private readonly repository: BaseRepository<C>;

  /**
   * @param model - The concrete {@link BaseJobModel} subclass.
   * @param session - The session rows are written on.
   */
  constructor(
    readonly model: C,
    session: AsyncSession,
  ) {
    this.repository = new BaseRepository(model, session);
  }

  /**
   * Record a job about to run.
   *
   * @param name - The task name.
   * @param payload - The payload the run was started with.
   * @returns The created row.
   */
  async enqueue(
    name: string,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return (await this.repository.create({
      name,
      status: JobStatus.QUEUED,
      payload,
      result: null,
      error: null,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
    } as never)) as unknown as Record<string, unknown>;
  }

  /**
   * Mark a job as picked up, counting the attempt.
   *
   * @param id - The job id.
   * @param attempt - Which attempt this is. Default `1`.
   * @returns How many rows changed.
   */
  async start(id: string, attempt = 1): Promise<number> {
    return await this.repository.update(
      { id } as never,
      {
        status: JobStatus.RUNNING,
        startedAt: new Date(),
        attempts: attempt,
      } as never,
    );
  }

  /**
   * Mark a job as finished cleanly.
   *
   * @param id - The job id.
   * @param result - Whatever the run produced.
   * @returns How many rows changed.
   */
  async succeed(id: string, result: Record<string, unknown> = {}): Promise<number> {
    return await this.repository.update(
      { id } as never,
      {
        status: JobStatus.SUCCEEDED,
        result,
        error: null,
        finishedAt: new Date(),
      } as never,
    );
  }

  /**
   * Mark a job as failed.
   *
   * @param id - The job id.
   * @param error - The failure, as an `Error` or a message.
   * @returns How many rows changed.
   */
  async fail(id: string, error: unknown): Promise<number> {
    return await this.repository.update(
      { id } as never,
      {
        status: JobStatus.FAILED,
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      } as never,
    );
  }

  /**
   * Ask a job to stop.
   *
   * A job already in a terminal state is left alone and reported as not
   * cancelled, so an operator clicking cancel on a run that just finished sees
   * the truth rather than a row rewritten under them.
   *
   * @param id - The job id.
   * @returns Whether the row moved to `cancelled`.
   */
  async cancel(id: string): Promise<boolean> {
    const row = (await this.repository.getByIdOrNull(id)) as Record<
      string,
      unknown
    > | null;
    if (row === null || TERMINAL.includes(String(row.status))) return false;
    const changed = await this.repository.update(
      { id } as never,
      {
        status: JobStatus.CANCELLED,
        finishedAt: new Date(),
      } as never,
    );
    return changed > 0;
  }

  /**
   * Read one job row.
   *
   * @param id - The job id.
   * @returns The row, or `null`.
   */
  async get(id: string): Promise<Record<string, unknown> | null> {
    return (await this.repository.getByIdOrNull(id)) as Record<string, unknown> | null;
  }

  /**
   * Read a page of jobs, newest first.
   *
   * @param filter - Page, size and optional `name` / `status` filters.
   * @returns The page plus its metadata.
   */
  async list(
    filter: { page?: number; pageSize?: number; name?: string; status?: JobStatus } = {},
  ): Promise<{
    items: Record<string, unknown>[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
  }> {
    const filters: Record<string, unknown> = {};
    if (filter.name !== undefined && filter.name !== "") filters.name = filter.name;
    if (filter.status !== undefined) filters.status = filter.status;

    const result = await this.repository.paginate({
      page: filter.page ?? 1,
      pageSize: filter.pageSize ?? 25,
      orderBy: "createdAt" as never,
      ascending: false,
      ...(Object.keys(filters).length === 0 ? {} : { filters: filters as never }),
    });
    return {
      items: result.items as unknown as Record<string, unknown>[],
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      pages: result.pages,
    };
  }
}
