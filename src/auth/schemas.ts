/**
 * Auth DTOs (Zod), mirroring `auth.schemas`.
 *
 * Request/response schemas for the bundled signup/login/refresh flows. All are
 * OpenAPI-registered shapes so they render in Swagger/Redoc when the auth
 * router's paths are registered.
 */

import { z } from "@/schemas/base";

/** Request body for `POST /auth/signup`. */
export const signupSchema = z
  .object({
    email: z.string().email().openapi({ description: "Login identifier (email)." }),
    password: z
      .string()
      .min(1)
      .openapi({ description: "Plaintext password (hashed server-side)." }),
    name: z
      .string()
      .max(120)
      .optional()
      .openapi({ description: "Optional display name." }),
  })
  .openapi("Signup");

/** Request body for `POST /auth/login`. */
export const loginSchema = z
  .object({
    email: z.string().email().openapi({ description: "Login identifier (email)." }),
    password: z.string().min(1).openapi({ description: "Plaintext password." }),
  })
  .openapi("Login");

/** Request body for `POST /auth/refresh`. */
export const refreshSchema = z
  .object({
    refreshToken: z.string().min(1).openapi({ description: "A valid refresh token." }),
  })
  .openapi("Refresh");

/** A signed access/refresh token pair. */
export const tokenPairSchema = z
  .object({
    accessToken: z.string().openapi({ description: "Short-lived bearer access token." }),
    refreshToken: z.string().openapi({ description: "Long-lived refresh token." }),
    tokenType: z.literal("bearer").openapi({ description: "Always 'bearer'." }),
    expiresIn: z
      .number()
      .int()
      .openapi({ description: "Access-token lifetime in seconds." }),
  })
  .openapi("TokenPair");

/** Public user projection returned by `GET /auth/me` and signup/login. */
export const userPublicSchema = z
  .object({
    id: z.string().openapi({ description: "User id." }),
    email: z.string().email().openapi({ description: "User email." }),
    name: z.string().nullable().openapi({ description: "Display name, or null." }),
    isActive: z.boolean().openapi({ description: "Whether the account is active." }),
    roles: z.array(z.string()).openapi({ description: "Assigned role names." }),
  })
  .openapi("UserPublic");

/** Response body for `POST /auth/signup` and `POST /auth/login`. */
export const authResponseSchema = z
  .object({
    user: userPublicSchema,
    tokens: tokenPairSchema,
  })
  .openapi("AuthResponse");

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type UserPublic = z.infer<typeof userPublicSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
