/**
 * Auth router, mirroring `auth.router.make_auth_router`.
 *
 * Wires `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh` and a
 * guarded `GET /auth/me` to a {@link UserAuthService}. Pass an
 * {@link OpenAPIRegistry} to register the paths so they appear in Swagger/Redoc.
 */

import type { OpenAPIRegistry } from "@/api/openapi";
import { getAuth, makeJwtAuthMiddleware } from "@/auth/middleware";
import {
  authResponseSchema,
  loginSchema,
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

  return router;
}
