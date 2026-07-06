/** Environment-driven settings primitives. */

export {
  type BaseAppSettings,
  baseAppSettingsSchema,
  baseAppSettingsShape,
  corsSettingsShape,
  databaseSettingsShape,
  loadSettings,
  serverSettingsShape,
} from "@/settings/base";
export {
  authSettingsShape,
  emailSettingsShape,
  envBoolean,
  envList,
  jwtSettingsShape,
  logSettingsShape,
  minioSettingsShape,
  rabbitmqSettingsShape,
  redisSettingsShape,
  sessionSettingsShape,
  tokenSettingsShape,
  uploadSettingsShape,
  webPushSettingsShape,
  webSocketSettingsShape,
} from "@/settings/mixins";
