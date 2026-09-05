/**
 * Background task manager, mirroring `tasks.manager.AsyncTaskBrokerManager`.
 *
 * Rides on a {@link BrokerManager}: enqueue publishes a `{ name, payload }`
 * envelope to a task queue; a worker started with {@link TaskManager.start}
 * consumes it and dispatches to the registered handler. Defaults to an
 * in-process {@link MemoryBroker} so it works with zero infrastructure.
 */

import { JSONLogger } from "@/core";
import { type BrokerManager, MemoryBroker } from "@/queue/broker";

/** A handler for a registered task. */
export type TaskHandler<P = unknown> = (payload: P) => Promise<void> | void;

/** The envelope published for each enqueued task. */
interface TaskEnvelope {
  name: string;
  payload: unknown;
}

/** One registered task, as the inventory reports it. */
export interface TaskInventoryEntry {
  /** The task name handlers are registered under. */
  name: string;
  /** A human-readable description, when the registration supplied one. */
  description: string | null;
  /** The declared schedule, when the registration supplied one. */
  schedule: string | null;
}

/** Optional metadata attached at registration, surfaced by the inventory. */
export interface TaskRegistrationOptions {
  /** What the task does, for an operator reading the panel. */
  description?: string;
  /**
   * The schedule this task is expected to run on (a cron expression, an
   * interval — whatever your scheduler speaks). Recorded and displayed, never
   * interpreted: the manager consumes a queue, it does not schedule.
   */
  schedule?: string;
}

/** Options for {@link TaskManager}. */
export interface TaskManagerOptions {
  /** The broker to publish/consume on. Defaults to a {@link MemoryBroker}. */
  broker?: BrokerManager;
  /** Queue name used for the task stream. Default `tasks`. */
  queue?: string;
}

const logger = new JSONLogger("tempest_express_sdk.tasks");

export class TaskManager {
  private readonly broker: BrokerManager;
  private readonly queue: string;
  private readonly handlers = new Map<string, TaskHandler>();
  private readonly metadata = new Map<string, TaskRegistrationOptions>();
  private unsubscribe: (() => Promise<void>) | null = null;

  /**
   * @param options - Broker and queue name.
   */
  constructor(options: TaskManagerOptions = {}) {
    this.broker = options.broker ?? new MemoryBroker();
    this.queue = options.queue ?? "tasks";
  }

  /**
   * Register a handler for a named task.
   *
   * @param name - The task name.
   * @param handler - The handler invoked with the task payload.
   * @param options - Description and declared schedule, surfaced by
   *   {@link TaskManager.inventory} and by the admin panel's tasks page.
   */
  register<P = unknown>(
    name: string,
    handler: TaskHandler<P>,
    options: TaskRegistrationOptions = {},
  ): void {
    this.handlers.set(name, handler as TaskHandler);
    this.metadata.set(name, options);
  }

  /**
   * Return what this process would run, ordered by name.
   *
   * This is the **declared** side of background work — the handlers this
   * process knows about — not queue state. A broker's pending depth is not
   * something the manager can see, and a screen that implied otherwise would
   * be worse than one that says nothing.
   *
   * @returns One entry per registered task.
   */
  inventory(): TaskInventoryEntry[] {
    return [...this.handlers.keys()]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const meta = this.metadata.get(name) ?? {};
        return {
          name,
          description: meta.description ?? null,
          schedule: meta.schedule ?? null,
        };
      });
  }

  /**
   * Enqueue a task by name.
   *
   * @param name - The registered task name.
   * @param payload - The JSON-serializable payload.
   */
  async enqueue(name: string, payload: unknown = {}): Promise<void> {
    const envelope: TaskEnvelope = { name, payload };
    await this.broker.publish(this.queue, envelope);
  }

  /**
   * Start the worker: subscribe to the task queue and dispatch to handlers.
   * A task with no registered handler is logged and skipped.
   */
  async start(): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = await this.broker.subscribe(this.queue, async (message) => {
      const { name, payload } = message as TaskEnvelope;
      const handler = this.handlers.get(name);
      if (!handler) {
        logger.warning("No handler for task", { task: name });
        return;
      }
      await handler(payload);
    });
  }

  /** Stop the worker (stops consuming; does not close the broker). */
  async stop(): Promise<void> {
    await this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
