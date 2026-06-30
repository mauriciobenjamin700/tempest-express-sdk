/** Authentication: schemas, service, JWT middleware/guards, router. */

export {
  type AuthResponse,
  type LoginInput,
  type RefreshInput,
  type SignupInput,
  type TokenPair,
  type UserPublic,
  authResponseSchema,
  loginSchema,
  refreshSchema,
  signupSchema,
  tokenPairSchema,
  userPublicSchema,
} from "@/auth/schemas";
export {
  type AuthUser,
  type UserAuthServiceOptions,
  type UserStore,
  UserAuthService,
} from "@/auth/service";
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
