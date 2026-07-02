/** Authentication: schemas, service, JWT middleware/guards, router. */

export {
  type ActivationInput,
  activationSchema,
  type AuthResponse,
  authResponseSchema,
  type LoginInput,
  loginSchema,
  type MfaCodeInput,
  mfaCodeSchema,
  mfaEnrollResponseSchema,
  type PasswordResetConfirmInput,
  passwordResetConfirmSchema,
  type PasswordResetRequestInput,
  passwordResetRequestSchema,
  type RefreshInput,
  refreshSchema,
  type SignupInput,
  signupSchema,
  type TokenPair,
  tokenPairSchema,
  type UserPublic,
  userPublicSchema,
} from "@/auth/schemas";
export {
  type AuthUser,
  type UserAuthServiceOptions,
  type UserStore,
  UserAuthService,
} from "@/auth/service";
export {
  type MfaEnrollment,
  MfaService,
  type MfaServiceOptions,
  type MfaStore,
} from "@/auth/mfa";
export {
  ActivationService,
  type ActivationServiceOptions,
  type ActivationStore,
} from "@/auth/activation";
export {
  PasswordResetService,
  type PasswordResetServiceOptions,
  type PasswordResetStore,
} from "@/auth/passwordReset";
export {
  type JwtAuthOptions,
  bearerToken,
  getAuth,
  makeJwtAuthMiddleware,
  requireRoles,
} from "@/auth/middleware";
export {
  type AuthRouterOptions,
  makeAuthRouter,
} from "@/auth/router";
