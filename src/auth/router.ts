/**
 * Auth router, mirroring `auth.router.make_auth_router`.
 *
 * Wires `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh` and a
 * guarded `GET /auth/me` to a {@link UserAuthService}. Pass an
 * {@link OpenAPIRegistry} to register the paths so they appear in Swagger/Redoc.
 */

import type { OpenAPIRegistry } from "@/api/openapi";
import type { ActivationService } from "@/auth/activation";
import type { MfaService } from "@/auth/mfa";
import { getAuth, makeJwtAuthMiddleware } from "@/auth/middleware";
import type { PasswordResetService } from "@/auth/passwordReset";
import {
  activationSchema,
  authResponseSchema,
  loginSchema,
  mfaChallengeSchema,
  mfaCodeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  refreshSchema,
  signupSchema,
  userPublicSchema,
} from "@/auth/schemas";
import type { UserAuthService } from "@/auth/service";
import { UnauthorizedException } from "@/exceptions/http";
import type { JWTUtils } from "@/utils/jwt";
import { type Router, Router as createRouter } from "express";

/** Options for {@link makeAuthRouter}. */
export interface AuthRouterOptions {
  /** The authentication service handling the flows. */
  service: UserAuthService;
  /** The JWT helper used to guard `GET /auth/me`. */
  jwt: JWTUtils;
  /** Route prefix. Default `/auth`. */
  prefix?: string;
  /** When provided, OpenAPI paths are registered for Swagger/Redoc. */
  registry?: OpenAPIRegistry;
  /** Mount `POST /auth/activate` when provided. */
  activation?: ActivationService;
  /** Mount `POST /auth/password-reset/{request,confirm}` when provided. */
  passwordReset?: PasswordResetService;
  /**
   * Mount guarded `POST /auth/mfa/{enroll,confirm,disable}` when provided. The
   * enrolling account label defaults to the `email` claim (falls back to `sub`).
   */
  mfa?: MfaService;
}

/** Register the auth OpenAPI paths on `registry`. */
function registerPaths(registry: OpenAPIRegistry, prefix: string): void {
  const json = (schema: unknown) => ({
    content: { "application/json": { schema: schema as never } },
  });
  registry.registerPath({
    method: "post",
    path: `${prefix}/signup`,
    summary: "Register a new user",
    request: { body: json(signupSchema) },
    responses: { 201: { description: "Created", ...json(authResponseSchema) } },
  });
  registry.registerPath({
    method: "post",
    path: `${prefix}/login`,
    summary: "Authenticate and receive tokens",
    request: { body: json(loginSchema) },
    responses: { 200: { description: "OK", ...json(authResponseSchema) } },
  });
  registry.registerPath({
    method: "post",
    path: `${prefix}/refresh`,
    summary: "Exchange a refresh token for new tokens",
    request: { body: json(refreshSchema) },
    responses: { 200: { description: "OK", ...json(authResponseSchema) } },
  });
  registry.registerPath({
    method: "get",
    path: `${prefix}/me`,
    summary: "Current authenticated user",
    security: [{ bearerAuth: [] }],
    responses: { 200: { description: "OK", ...json(userPublicSchema) } },
  });
}

/**
 * Build the auth router.
 *
 * @param options - Service, JWT helper, prefix and optional OpenAPI registry.
 * @returns An Express router exposing the auth endpoints.
 */
export function makeAuthRouter(options: AuthRouterOptions): Router {
  const { service, jwt, prefix = "/auth", registry } = options;
  if (registry) registerPaths(registry, prefix);

  const router = createRouter();

  router.post(`${prefix}/signup`, async (req, res) => {
    const result = await service.signup(signupSchema.parse(req.body));
    res.status(201).json(result);
  });

  router.post(`${prefix}/login`, async (req, res) => {
    res.json(await service.login(loginSchema.parse(req.body)));
  });

  router.post(`${prefix}/refresh`, async (req, res) => {
    const { refreshToken } = refreshSchema.parse(req.body);
    res.json(await service.refresh(refreshToken));
  });

  router.get(`${prefix}/me`, makeJwtAuthMiddleware(jwt), async (req, res) => {
    const claims = getAuth(req);
    if (!claims || typeof claims.sub !== "string") {
      throw new UnauthorizedException({ message: "Not authenticated" });
    }
    res.json(claims);
  });

  if (options.activation) {
    const activation = options.activation;
    router.post(`${prefix}/activate`, async (req, res) => {
      const { token } = activationSchema.parse(req.body);
      const userId = await activation.activate(token);
      res.json({ activated: true, userId });
    });
  }

  if (options.passwordReset) {
    const reset = options.passwordReset;
    // Always 202 — never reveal whether the email exists. `token` is returned
    // only in dev-style setups where the caller emails it themselves.
    router.post(`${prefix}/password-reset/request`, async (req, res) => {
      const { email } = passwordResetRequestSchema.parse(req.body);
      const token = await reset.request(email);
      res.status(202).json({ requested: true, ...(token ? { token } : {}) });
    });
    router.post(`${prefix}/password-reset/confirm`, async (req, res) => {
      const { token, password } = passwordResetConfirmSchema.parse(req.body);
      await reset.confirm(token, password);
      res.json({ reset: true });
    });
  }

  if (options.mfa) {
    const mfa = options.mfa;
    // Unguarded: completes the login challenge using the short-lived mfaToken.
    router.post(`${prefix}/mfa/challenge`, async (req, res) => {
      const { mfaToken, code } = mfaChallengeSchema.parse(req.body);
      res.json(await service.verifyMfaChallenge(mfaToken, code));
    });
    const requireUser = (req: Parameters<typeof getAuth>[0]): string => {
      const claims = getAuth(req);
      if (!claims || typeof claims.sub !== "string") {
        throw new UnauthorizedException({ message: "Not authenticated" });
      }
      return claims.sub;
    };
    router.post(`${prefix}/mfa/enroll`, makeJwtAuthMiddleware(jwt), async (req, res) => {
      const claims = getAuth(req);
      const userId = requireUser(req);
      const label = typeof claims?.email === "string" ? claims.email : userId;
      res.json(await mfa.enroll(userId, label));
    });
    router.post(`${prefix}/mfa/confirm`, makeJwtAuthMiddleware(jwt), async (req, res) => {
      const { code } = mfaCodeSchema.parse(req.body);
      await mfa.confirm(requireUser(req), code);
      res.json({ enabled: true });
    });
    router.post(`${prefix}/mfa/disable`, makeJwtAuthMiddleware(jwt), async (req, res) => {
      const { code } = mfaCodeSchema.parse(req.body);
      await mfa.disable(requireUser(req), code);
      res.json({ enabled: false });
    });
  }

  return router;
}
