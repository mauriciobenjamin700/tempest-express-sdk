/** Web Push DTOs (Zod), mirroring `webpush.schemas`. */

import { z } from "@/schemas/base";

/** The browser-provided push subscription keys. */
export const webPushKeysSchema = z
  .object({
    p256dh: z.string().openapi({ description: "Client public key (base64url)." }),
    auth: z.string().openapi({ description: "Client auth secret (base64url)." }),
  })
  .openapi("WebPushKeys");

/** A browser push subscription. */
export const webPushSubscriptionSchema = z
  .object({
    endpoint: z.string().url().openapi({ description: "Push service endpoint URL." }),
    keys: webPushKeysSchema,
  })
  .openapi("WebPushSubscription");

/** A push notification payload. */
export const webPushPayloadSchema = z
  .object({
    title: z.string().openapi({ description: "Notification title." }),
    body: z.string().optional().openapi({ description: "Notification body." }),
    url: z.string().optional().openapi({ description: "URL opened on click." }),
    data: z.record(z.unknown()).optional().openapi({ description: "Extra data." }),
  })
  .openapi("WebPushPayload");

export type WebPushKeys = z.infer<typeof webPushKeysSchema>;
export type WebPushSubscription = z.infer<typeof webPushSubscriptionSchema>;
export type WebPushPayload = z.infer<typeof webPushPayloadSchema>;
