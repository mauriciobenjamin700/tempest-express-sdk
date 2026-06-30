/** WebSocket primitives: envelope, connection hub, `ws` attach helper. */

export { type WSEnvelope, wsEnvelopeSchema } from "@/websockets/schemas";
export {
  type WebSocketConnection,
  WebSocketHub,
  type WebSocketHubOptions,
  type WebSocketLike,
} from "@/websockets/hub";
export {
  type AttachWebSocketOptions,
  type HandshakeInfo,
  attachWebSocketHub,
  tokenFromUrl,
} from "@/websockets/attach";
