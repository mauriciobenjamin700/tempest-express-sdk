/** WebSocket message envelope, mirroring `websockets.schemas`. */

import { z } from "@/schemas/base";

/** The canonical message envelope exchanged over a socket. */
export const wsEnvelopeSchema = z
  .object({
    type: z.string().openapi({ description: "Message type discriminator." }),
    data: z.unknown().optional().openapi({ description: "Arbitrary payload." }),
  })
  .openapi("WSEnvelope");

/** A typed message envelope. */
export type WSEnvelope = z.infer<typeof wsEnvelopeSchema>;
