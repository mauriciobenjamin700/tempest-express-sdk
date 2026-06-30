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
   */
  register<P = unknown>(name: string, handler: TaskHandler<P>): void {
    this.handlers.set(name, handler as TaskHandler);
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
