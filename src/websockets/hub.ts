/**
 * In-process connection hub, mirroring `websockets.hub.WebSocketHub`.
 *
 * Transport-agnostic: it tracks {@link WebSocketLike} connections (anything with
 * `send`/`close`) so it works with the `ws` package or any compatible socket.
 * Supports per-user delivery, topic subscriptions, broadcast and a per-user
 * connection cap with oldest-eviction.
 */

import { randomUUID } from "node:crypto";
import type { WSEnvelope } from "@/websockets/schemas";

/** The minimal socket surface the hub needs. */
export interface WebSocketLike {
  /** Send a text frame. */
  send(data: string): void;
  /** Close the socket, optionally with a status code. */
  close(code?: number): void;
}

/** A registered live connection. */
export interface WebSocketConnection {
  /** Unique connection id. */
  id: string;
  /** The owning user id. */
  userId: string;
  /** The underlying socket. */
  ws: WebSocketLike;
  /** Topics this connection is subscribed to. */
  topics: Set<string>;
}

/** Options for {@link WebSocketHub}. */
export interface WebSocketHubOptions {
  /** Max simultaneous connections per user (oldest evicted). Default 5. */
  maxPerUser?: number;
}

export class WebSocketHub {
  private readonly byId = new Map<string, WebSocketConnection>();
  private readonly byUser = new Map<string, Set<string>>();
  private readonly maxPerUser: number;

  /**
   * @param options - Per-user connection cap.
   */
  constructor(options: WebSocketHubOptions = {}) {
    this.maxPerUser = options.maxPerUser ?? 5;
  }

  /**
   * Register a new connection for `userId`, evicting the oldest if over cap.
   *
   * @param userId - The owning user id.
   * @param ws - The socket to register.
   * @returns The created connection record.
   */
  register(userId: string, ws: WebSocketLike): WebSocketConnection {
    const connection: WebSocketConnection = {
      id: randomUUID(),
      userId,
      ws,
      topics: new Set(),
    };
    this.byId.set(connection.id, connection);
    const ids = this.byUser.get(userId) ?? new Set<string>();
    ids.add(connection.id);
    this.byUser.set(userId, ids);

    if (ids.size > this.maxPerUser) {
      const oldest = ids.values().next().value;
      if (oldest) this.unregister(oldest, 1008);
    }
    return connection;
  }

  /**
   * Remove a connection and close its socket.
   *
   * @param connectionId - The connection id.
   * @param code - Optional WebSocket close code.
   */
  unregister(connectionId: string, code?: number): void {
    const connection = this.byId.get(connectionId);
    if (!connection) return;
    this.byId.delete(connectionId);
    const ids = this.byUser.get(connection.userId);
    if (ids) {
      ids.delete(connectionId);
      if (ids.size === 0) this.byUser.delete(connection.userId);
    }
    try {
      connection.ws.close(code);
    } catch {
      // socket already closed — ignore.
    }
  }

  /** Subscribe a connection to a topic. */
  subscribe(connectionId: string, topic: string): void {
    this.byId.get(connectionId)?.topics.add(topic);
  }

  /** Unsubscribe a connection from a topic. */
  unsubscribe(connectionId: string, topic: string): void {
    this.byId.get(connectionId)?.topics.delete(topic);
  }

  /** Serialize and send an envelope to a single connection. */
  private deliver(connection: WebSocketConnection, payload: string): boolean {
    try {
      connection.ws.send(payload);
      return true;
    } catch {
      this.unregister(connection.id);
      return false;
    }
  }

  /**
   * Send an envelope to every connection of `userId`.
   *
   * @param userId - The target user.
   * @param envelope - The message envelope.
   * @returns The number of connections delivered to.
   */
  sendTo(userId: string, envelope: WSEnvelope): number {
    const ids = this.byUser.get(userId);
    if (!ids) return 0;
    const payload = JSON.stringify(envelope);
    let count = 0;
    for (const id of [...ids]) {
      const connection = this.byId.get(id);
      if (connection && this.deliver(connection, payload)) count += 1;
    }
    return count;
  }

  /**
   * Broadcast an envelope to all connections, or only a topic's subscribers.
   *
   * @param envelope - The message envelope.
   * @param topic - Optional topic to scope the broadcast.
   * @returns The number of connections delivered to.
   */
  broadcast(envelope: WSEnvelope, topic?: string): number {
    const payload = JSON.stringify(envelope);
    let count = 0;
    for (const connection of [...this.byId.values()]) {
      if (topic && !connection.topics.has(topic)) continue;
      if (this.deliver(connection, payload)) count += 1;
    }
    return count;
  }

  /** The set of users with at least one live connection. */
  onlineUsers(): Set<string> {
    return new Set(this.byUser.keys());
  }

  /** Total live connection count. */
  connectionCount(): number {
    return this.byId.size;
  }

  /** Number of connections subscribed to `topic`. */
  topicCount(topic: string): number {
    let count = 0;
    for (const connection of this.byId.values()) {
      if (connection.topics.has(topic)) count += 1;
    }
    return count;
  }
}
