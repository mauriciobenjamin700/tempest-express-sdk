/** Application exception primitives exposed at module level. */

export {
  AppException,
  type AppExceptionOptions,
  type ExceptionDetails,
} from "@/exceptions/base";
export {
  ConflictException,
  ExpiredTokenException,
  ForbiddenException,
  InvalidTokenException,
  NotFoundException,
  TooManyRequestsException,
  type TooManyRequestsOptions,
  UnauthorizedException,
  ValidationException,
} from "@/exceptions/http";
export {
  type CatalogData,
  DEFAULT_LOCALE,
  MessageCatalog,
  defaultMessageCatalog,
  parseAcceptLanguage,
} from "@/exceptions/i18n";
