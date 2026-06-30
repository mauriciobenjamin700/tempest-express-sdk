/** Core primitives: request context, structured logging, enum helpers. */

export {
  type RequestContext,
  getRequestId,
  runWithRequestContext,
  setRequestId,
} from "@/core/context";
export {
  HTTP_500_MARKER,
  JSONLogger,
  type LogExtra,
  type LogLevel,
  configureLogging,
} from "@/core/logging";
export {
  type Enum,
  type EnumHelpers,
  type EnumSpec,
  defineEnum,
} from "@/core/enums";
