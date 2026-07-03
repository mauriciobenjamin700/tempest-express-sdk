/** Shared stateless helpers: BR fields, locations, datetime, dict, tokens, auth. */

export {
  CEP_PATTERN,
  CNPJ_PATTERN,
  CPF_PATTERN,
  PHONE_BR_PATTERN,
  cepField,
  cnpjField,
  cpfField,
  cpfOrCnpjField,
  isValidCep,
  isValidCnpj,
  isValidCpf,
  isValidCpfCnpj,
  isValidPhoneBr,
  normalizeCep,
  normalizeCnpj,
  normalizeCpf,
  normalizeCpfCnpj,
  normalizePhoneBr,
  onlyDigits,
  phoneBrField,
} from "@/utils/br";
export {
  Region,
  type RegionValue,
  type StateBR,
  UF,
  type UFValue,
  citiesByUf,
  getState,
  isValidCity,
  isValidUf,
  listStates,
  normalizeUf,
  statesByRegion,
  ufField,
} from "@/utils/locations";
export { toUtc, utcnow } from "@/utils/datetime";
export { modifyDict } from "@/utils/dict";
export {
  generateOpaqueToken,
  hashOpaqueToken,
  verifyOpaqueToken,
} from "@/utils/opaqueToken";
export { PasswordUtils } from "@/utils/password";
export {
  type JWTUtilsOptions,
  type JwtClaims,
  JWTUtils,
} from "@/utils/jwt";
export {
  AttemptThrottle,
  type AttemptThrottleOptions,
  MemoryThrottleBackend,
  type ThrottleBackend,
  type ThrottleStatus,
} from "@/utils/throttle";
export { type ClientIpOptions, getClientIp } from "@/utils/clientIp";
export { TOTPHelper, type TOTPOptions } from "@/utils/totp";
export {
  CircuitOpenError,
  HTTPClient,
  type HTTPClientOptions,
  RetryPolicy,
} from "@/utils/httpClient";
export {
  type CPUMetrics,
  type GPUMetrics,
  type MemoryMetrics,
  MetricsUtils,
  type SystemMetrics,
} from "@/utils/metrics";
export { EmailUtils, type EmailMessage, type EmailOptions } from "@/utils/email";
