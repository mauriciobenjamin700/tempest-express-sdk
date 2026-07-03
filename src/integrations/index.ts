/** External-service integrations: messaging providers (WhatsApp via zap-api). */

export {
  type InboundHandler,
  type InboundMessage,
  inboundMessageSchema,
  type MediaKind,
  type MessagingProvider,
  type OutboundMedia,
  type OutboundResult,
  type SendOptions,
} from "@/integrations/provider";
export {
  WhatsAppProvider,
  type WhatsAppProviderOptions,
} from "@/integrations/whatsapp";
export {
  makeWhatsAppWebhookRouter,
  type WhatsAppWebhookOptions,
} from "@/integrations/webhook";
export {
  TelegramProvider,
  type TelegramProviderOptions,
} from "@/integrations/telegram";
export {
  TwilioSmsProvider,
  type TwilioSmsProviderOptions,
  type TwilioWebhookOptions,
  makeTwilioWebhookRouter,
  validateTwilioSignature,
} from "@/integrations/sms";
export {
  EmailProvider,
  type EmailProviderOptions,
} from "@/integrations/email";
