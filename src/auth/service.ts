/**
 * User authentication service, mirroring `auth.service.UserAuthService`.
 *
 * Orchestrates signup / login / refresh over a pluggable {@link UserStore},
 * {@link PasswordUtils} and {@link JWTUtils}. It is ORM-agnostic — back the
 * store with a `tempest-db-js` repository (or anything else). MFA, email
 * activation and password-reset flows from the FastAPI SDK are not yet ported.
 */

import type {
  AuthResponse,
  LoginInput,
  SignupInput,
  TokenPair,
  UserPublic,
} from "@/auth/schemas";
import {
  ConflictException,
  UnauthorizedException,
  ValidationException,
} from "@/exceptions/http";
import type { JWTUtils } from "@/utils/jwt";
import type { PasswordUtils } from "@/utils/password";

/** A persisted user as the auth layer needs to see it. */
export interface AuthUser {
  /** Stable user id (string form). */
  id: string;
  /** Login email (lowercased by the service before lookup/create). */
  email: string;
  /** The stored bcrypt password hash. */
  passwordHash: string;
  /** Display name, or `null`. */
  name: string | null;
  /** Whether the account may log in. */
  isActive: boolean;
  /** Assigned role names. */
  roles: string[];
}

/** Persistence port the service depends on. Implement over any store. */
export interface UserStore {
  /** Find a user by (lowercased) email, or `null`. */
  findByEmail(email: string): Promise<AuthUser | null>;
  /** Find a user by id, or `null`. */
  findById(id: string): Promise<AuthUser | null>;
  /** Create a user from validated signup data + a password hash. */
  create(data: {
    email: string;
    passwordHash: string;
    name: string | null;
  }): Promise<AuthUser>;
}

/** Options for {@link UserAuthService}. */
export interface UserAuthServiceOptions {
  /** The user persistence port. */
  store: UserStore;
  /** Password hasher/verifier. */
  password: PasswordUtils;
  /** JWT encoder/decoder used to mint access + refresh tokens. */
  jwt: JWTUtils;
  /** Minimum password length enforced server-side. Default 12. */
  passwordMinLength?: number;
  /** Access-token lifetime in seconds. Default 3600. */
  accessTtlSeconds?: number;
  /** Refresh-token lifetime in seconds. Default 1209600 (14 days). */
  refreshTtlSeconds?: number;
}

/** Project an {@link AuthUser} to its public shape (no secrets). */
function toPublic(user: AuthUser): UserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isActive: user.isActive,
    roles: user.roles,
  };
}

export class UserAuthService {
  private readonly store: UserStore;
  private readonly password: PasswordUtils;
  private readonly jwt: JWTUtils;
  private readonly passwordMinLength: number;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  /**
   * @param options - Store, password/JWT helpers and token policy.
   */
  constructor(options: UserAuthServiceOptions) {
    this.store = options.store;
    this.password = options.password;
    this.jwt = options.jwt;
    this.passwordMinLength = options.passwordMinLength ?? 12;
    this.accessTtlSeconds = options.accessTtlSeconds ?? 3600;
    this.refreshTtlSeconds = options.refreshTtlSeconds ?? 60 * 60 * 24 * 14;
  }

  /** Mint a signed access + refresh token pair for `user`. */
  private async issueTokens(user: AuthUser): Promise<TokenPair> {
    const accessToken = await this.jwt.encode(
      { sub: user.id, roles: user.roles, type: "access" },
      { ttlSeconds: this.accessTtlSeconds },
    );
    const refreshToken = await this.jwt.encode(
      { sub: user.id, type: "refresh" },
      { ttlSeconds: this.refreshTtlSeconds },
    );
    return {
      accessToken,
      refreshToken,
      tokenType: "bearer",
      expiresIn: this.accessTtlSeconds,
    };
  }

  /**
   * Register a new user and issue tokens.
   *
   * @param data - Validated signup payload.
   * @returns The public user and a fresh token pair.
   * @throws {ValidationException} When the password is too short.
   * @throws {ConflictException} When the email is already registered.
   */
  async signup(data: SignupInput): Promise<AuthResponse> {
    if (data.password.length < this.passwordMinLength) {
      throw new ValidationException({
        message: `Password must be at least ${this.passwordMinLength} characters`,
        details: { minLength: this.passwordMinLength },
      });
    }
    const email = data.email.toLowerCase();
    if (await this.store.findByEmail(email)) {
      throw new ConflictException({ message: "Email already registered" });
    }
    const passwordHash = await this.password.hash(data.password);
    const user = await this.store.create({
      email,
      passwordHash,
      name: data.name ?? null,
    });
    return { user: toPublic(user), tokens: await this.issueTokens(user) };
  }

  /**
   * Authenticate a user by email + password.
   *
   * @param data - Validated login payload.
   * @returns The public user and a fresh token pair.
   * @throws {UnauthorizedException} On bad credentials or inactive account.
   */
  async login(data: LoginInput): Promise<AuthResponse> {
    const user = await this.store.findByEmail(data.email.toLowerCase());
    const ok = user && (await this.password.verify(data.password, user.passwordHash));
    if (!user || !ok) {
      throw new UnauthorizedException({ message: "Invalid email or password" });
    }
    if (!user.isActive) {
      throw new UnauthorizedException({ message: "Account is inactive" });
    }
    return { user: toPublic(user), tokens: await this.issueTokens(user) };
  }

  /**
   * Exchange a valid refresh token for a new token pair.
   *
   * @param refreshToken - The refresh token from a prior login.
   * @returns The public user and a fresh token pair.
   * @throws {UnauthorizedException} When the token is invalid or not a refresh
   *   token, or the user no longer exists / is inactive.
   */
  async refresh(refreshToken: string): Promise<AuthResponse> {
    const claims = await this.jwt.decodeOrNull(refreshToken);
    if (!claims || claims.type !== "refresh" || typeof claims.sub !== "string") {
      throw new UnauthorizedException({ message: "Invalid refresh token" });
    }
    const user = await this.store.findById(claims.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ message: "Account is inactive" });
    }
    return { user: toPublic(user), tokens: await this.issueTokens(user) };
  }
}
