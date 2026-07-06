/**
 * Transactional outbox model + relay, mirroring `db.outbox`.
 *
 * Write a domain change and its "event to publish" **in the same transaction**
 * (into `BaseOutboxModel`), so the event can never be lost even if the broker is
 * down at write time. {@link OutboxRelay} then polls pending rows and publishes
 * them with at-least-once delivery, retrying failures with a backoff.
 */

import { JSONLogger } from "@/core";
import { BaseModel } from "@/db/model";
import type { BaseRepository, InferModel, ModelClass } from "tempest-db-js";
import { column, sql } from "tempest-db-js";

/** Delivery state of an outbox event. */
export const OutboxStatus = {
  PENDING: "pending",
  SENT: "sent",
  FAILED: "failed",
} as const;

/** An `OutboxStatus` value. */
export type OutboxStatus = (typeof OutboxStatus)[keyof typeof OutboxStatus];

/**
 * Base for a transactional outbox row. Subclass it and set `tablename`. Insert a
 * row in the same transaction as the write it describes.
 */
export abstract class BaseOutboxModel extends BaseModel {
  /** Destination topic / routing key. */
  topic = column.varchar(255).notNull();
  /** The event body, serialized as JSON. */
  payload = column.json<Record<string, unknown>>().notNull();
  /** Delivery state (an {@link OutboxStatus} value). */
  status = column.varchar(16).notNull().default(OutboxStatus.PENDING);
  /** How many delivery attempts have been made. */
  attempts = column.integer().notNull().default(0);
  /** Give up (mark `failed`) after this many attempts. */
  maxAttempts = column.integer().notNull().default(5);
  /** Earliest time the row may be delivered (drives retry backoff). */
  availableAt = column.datetime().notNull().default(sql.now());
  /** When the row was successfully delivered, or `null`. */
  sentAt = column.datetime();
  /** The last delivery error message, or `null`. */
  lastError = column.text();
}

/** Publishes one event to the broker; throws to signal a delivery failure. */
export type OutboxPublisher = (
  topic: string,
  payload: Record<string, unknown>,
) => Promise<void>;

/** Options for {@link OutboxRelay}. */
export interface OutboxRelayOptions {
  /** Max rows to drain per pass. Default `100`. */
  batchSize?: number;
  /** Base backoff (seconds) between retries; scaled by attempt count. Default `30`. */
  retryBackoffSeconds?: number;
}

/**
 * Polls a `BaseOutboxModel` table and publishes pending events with retries.
 *
 * @typeParam C - the concrete outbox model class.
 */
export class OutboxRelay<C extends ModelClass> {
  private readonly logger = new JSONLogger("tempest_express_sdk.db.outbox");
  private readonly batchSize: number;
  private readonly retryBackoffSeconds: number;
  private running = false;

  /**
   * @param repository - Repository over the outbox model.
   * @param publish - Callback that delivers one event to the broker.
   * @param options - Batch size and retry backoff.
   */
  constructor(
    private readonly repository: BaseRepository<C>,
    private readonly publish: OutboxPublisher,
    options: OutboxRelayOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 100;
    this.retryBackoffSeconds = options.retryBackoffSeconds ?? 30;
  }

  /**
   * Deliver one batch of due pending events.
   *
   * @param now - The current time (injectable for tests). Defaults to `new Date()`.
   * @returns The number of events successfully delivered.
   */
  async drainOnce(now: Date = new Date()): Promise<number> {
    // `list` has no LIMIT; fetch the due pending rows and process a batch.
    const due = (await this.repository.list({
      status: OutboxStatus.PENDING,
      availableAt: { lte: now },
    } as never)) as Array<InferModel<C> & Record<string, unknown>>;

    let delivered = 0;
    for (const event of due.slice(0, this.batchSize)) {
      try {
        await this.publish(
          event.topic as string,
          event.payload as Record<string, unknown>,
        );
        await this.repository.update(
          { id: event.id } as never,
          {
            status: OutboxStatus.SENT,
            sentAt: now,
            lastError: null,
          } as never,
        );
        delivered += 1;
      } catch (error) {
        await this.markFailure(event, error, now);
      }
    }
    return delivered;
  }

  private async markFailure(
    event: InferModel<C> & Record<string, unknown>,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const attempts = (event.attempts as number) + 1;
    const maxAttempts = event.maxAttempts as number;
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = attempts >= maxAttempts;
    const nextAvailable = new Date(
      now.getTime() + attempts * this.retryBackoffSeconds * 1000,
    );
    await this.repository.update(
      { id: event.id } as never,
      {
        attempts,
        status: exhausted ? OutboxStatus.FAILED : OutboxStatus.PENDING,
        availableAt: exhausted ? (event.availableAt as Date) : nextAvailable,
        lastError: message,
      } as never,
    );
    this.logger.warning("outbox delivery failed", {
      id: String(event.id),
      topic: String(event.topic),
      attempts,
      exhausted,
    });
  }

  /**
   * Run `drainOnce` on an interval until {@link stop} is called.
   *
   * @param intervalMs - Delay between passes in milliseconds. Default `1000`.
   */
  async run(intervalMs = 1000): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.drainOnce();
      } catch (error) {
        this.logger.error("outbox relay pass failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /** Stop the {@link run} loop after the current pass. */
  stop(): void {
    this.running = false;
  }
}
