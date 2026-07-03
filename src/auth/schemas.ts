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

/** MFA enrollment response (`POST /auth/mfa/enroll`). */
export const mfaEnrollResponseSchema = z
  .object({
    secret: z.string().openapi({ description: "Base32 TOTP secret (manual entry)." }),
    otpauthUri: z.string().openapi({ description: "otpauth:// URI to render as QR." }),
  })
  .openapi("MfaEnrollResponse");

/** A 6-digit MFA code body (`POST /auth/mfa/confirm|disable`). */
export const mfaCodeSchema = z
  .object({ code: z.string().min(1).openapi({ description: "Authenticator code." }) })
  .openapi("MfaCode");

/** MFA login-challenge body (`POST /auth/mfa/challenge`). */
export const mfaChallengeSchema = z
  .object({
    mfaToken: z.string().min(1).openapi({ description: "Challenge token from login." }),
    code: z.string().min(1).openapi({ description: "Authenticator code." }),
  })
  .openapi("MfaChallenge");

/** Activation body (`POST /auth/activate`). */
export const activationSchema = z
  .object({ token: z.string().min(1).openapi({ description: "Activation token." }) })
  .openapi("Activation");

/** Password-reset request body (`POST /auth/password-reset/request`). */
export const passwordResetRequestSchema = z
  .object({ email: z.string().email().openapi({ description: "Account email." }) })
  .openapi("PasswordResetRequest");

/** Password-reset confirm body (`POST /auth/password-reset/confirm`). */
export const passwordResetConfirmSchema = z
  .object({
    token: z.string().min(1).openapi({ description: "Reset token." }),
    password: z.string().min(1).openapi({ description: "New plaintext password." }),
  })
  .openapi("PasswordResetConfirm");

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type TokenPair = z.infer<typeof tokenPairSchema>;
export type UserPublic = z.infer<typeof userPublicSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;
export type MfaChallengeInput = z.infer<typeof mfaChallengeSchema>;
export type ActivationInput = z.infer<typeof activationSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
