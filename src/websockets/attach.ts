/**
 * Attach a {@link WebSocketHub} to an HTTP server, mirroring
 * `websockets.router`.
 *
 * Uses the optional `ws` peer (lazily imported). Authenticates each handshake
 * (e.g. a `?token=` query param), registers the socket into the hub, runs a
 * ping/pong heartbeat to drop half-open peers, and unregisters on close.
 */

import type { Server } from "node:http";
import type { WebSocketConnection, WebSocketHub } from "@/websockets/hub";

/** Handshake info passed to the authenticator. */
export interface HandshakeInfo {
  /** The request URL (includes the query string, e.g. `/ws?token=…`). */
  url: string;
  /** The raw request headers. */
  headers: Record<string, string | string[] | undefined>;
}

/** Options for {@link attachWebSocketHub}. */
export interface AttachWebSocketOptions {
  /** Path the WebSocket server listens on. Default `/ws`. */
  path?: string;
  /**
   * Resolve a user id from the handshake, or `null` to reject (closes 1008).
   * Default accepts every connection as `"anonymous"`.
   */
  authenticate?: (info: HandshakeInfo) => Promise<string | null> | string | null;
  /** Heartbeat interval in seconds (`0` disables). Default 30. */
  heartbeatSeconds?: number;
  /** Handler invoked for each inbound text message. */
  onMessage?: (connection: WebSocketConnection, message: string) => void;
}

/** Read a `token` query param from a handshake URL, or `null`. */
export function tokenFromUrl(url: string): string | null {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("token");
}

/**
 * Attach a hub to an HTTP server over the `ws` package.
 *
 * @param server - The Node HTTP server (e.g. from `runServer`).
 * @param hub - The hub to register connections into.
 * @param options - Path, authenticator, heartbeat and message handler.
 * @returns The created `ws` `WebSocketServer` instance.
 * @throws {Error} When the optional `ws` peer is not installed.
 */
export async function attachWebSocketHub(
  server: Server,
  hub: WebSocketHub,
  options: AttachWebSocketOptions = {},
): Promise<import("ws").WebSocketServer> {
  let ws: typeof import("ws");
  try {
    ws = await import("ws");
  } catch (cause) {
    throw new Error(
      "attachWebSocketHub requires the 'ws' peer dependency. Install with `npm i ws`.",
      { cause },
    );
  }

  const path = options.path ?? "/ws";
  const heartbeatMs = (options.heartbeatSeconds ?? 30) * 1000;
  const authenticate = options.authenticate ?? (() => "anonymous");
  const wss = new ws.WebSocketServer({ server, path });

  wss.on("connection", (socket: import("ws").WebSocket, req) => {
    void (async () => {
      const userId = await authenticate({
        url: req.url ?? "",
        headers: req.headers,
      });
      if (userId === null) {
        socket.close(1008);
        return;
      }
      const connection = hub.register(userId, socket);

      let alive = true;
      socket.on("pong", () => {
        alive = true;
      });
      socket.on("message", (data: unknown) => {
        options.onMessage?.(connection, String(data));
      });
      socket.on("close", () => {
        alive = false;
        hub.unregister(connection.id);
      });

      if (heartbeatMs > 0) {
        const timer = setInterval(() => {
          if (!alive) {
            clearInterval(timer);
            hub.unregister(connection.id);
            return;
          }
          alive = false;
          socket.ping();
        }, heartbeatMs);
        socket.on("close", () => clearInterval(timer));
      }
    })();
  });

  return wss;
}
