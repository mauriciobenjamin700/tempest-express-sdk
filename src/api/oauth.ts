/**
 * OAuth2 / OIDC clients, mirroring `api.oauth`.
 *
 * Three clients out of the box: {@link GoogleOAuthClient},
 * {@link GitHubOAuthClient} and the generic {@link OIDCProvider} (Auth0,
 * Keycloak, Okta, Entra, Cognito). They cover only the OAuth2 dance — build an
 * authorize URL, exchange the code for tokens, fetch the user. Storing the user,
 * minting your own session token and setting cookies are the service's calls.
 */

import { randomBytes } from "node:crypto";
import { AppException } from "@/exceptions/base";
import { HTTPClient } from "@/utils/httpClient";

/** Raised when a provider rejects part of the OAuth dance. */
export class OAuthError extends AppException {
  static override statusCode = 502;
  static override code = "OAUTH_ERROR";
}

/** The single normalized identity shape the rest of the app sees. */
export interface OAuthUser {
  /** Provider label (`"google"`, `"github"`, `"oidc:auth0"`, …). */
  provider: string;
  /** Stable per-provider id; pair with `provider` for a global key. */
  subject: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  /** The raw provider payload. */
  raw: Record<string, unknown>;
}

/** The token bundle returned by a code exchange. */
export interface OAuthTokens {
  accessToken: string;
  tokenType: string;
  refreshToken: string | null;
  /** The OIDC id token (JWT), or `null` on plain OAuth2. */
  idToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  raw: Record<string, unknown>;
}

/**
 * Generate a URL-safe random `state` value. Store it server-side (or a signed
 * cookie) before redirecting and compare on callback — a mismatch is a forged
 * redirect.
 *
 * @param nBytes - Entropy bytes. Default `32`.
 * @returns A URL-safe token.
 */
export function generateOAuthState(nBytes = 32): string {
  return randomBytes(nBytes).toString("base64url");
}

/** Common constructor options for the OAuth clients. */
export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes?: string[];
  httpClient?: HTTPClient;
}

/** Base class implementing the OAuth2 dance; subclasses fill in the endpoints. */
export abstract class BaseOAuthClient {
  abstract readonly providerName: string;
  protected readonly clientId: string;
  protected readonly clientSecret: string;
  protected readonly redirectUri: string;
  protected readonly scopes: string[];
  protected readonly http: HTTPClient;

  constructor(options: OAuthClientOptions) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.redirectUri = options.redirectUri;
    this.scopes = options.scopes ?? this.defaultScopes();
    this.http = options.httpClient ?? new HTTPClient({ timeoutMs: 10000 });
  }

  protected defaultScopes(): string[] {
    return [];
  }

  /** The provider's authorization endpoint. */
  protected abstract authorizeUrl(): string;
  /** The provider's token endpoint. */
  protected abstract tokenUrl(): string;
  /** The provider's userinfo endpoint, or `null` when unavailable. */
  protected userinfoUrl(): string | null {
    return null;
  }
  /** Map a raw userinfo payload to {@link OAuthUser}. */
  protected abstract parseUser(payload: Record<string, unknown>): OAuthUser;

  /**
   * Build the fully-formed authorize URL to redirect the user to.
   *
   * @param state - A value from {@link generateOAuthState}, saved server-side.
   * @param extra - Extra query params (e.g. `{ access_type: "offline" }`).
   * @returns The authorize URL.
   */
  buildAuthorizeUrl(state: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: this.scopes.join(" "),
      state,
      ...extra,
    });
    return `${this.authorizeUrl()}?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens.
   *
   * @param code - The `code` query param from the callback.
   * @returns The parsed token bundle.
   * @throws {OAuthError} When the provider rejects the exchange.
   */
  async exchangeCode(code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = await this.http.request("POST", this.tokenUrl(), {
      body: body.toString(),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
    });
    if (response.status >= 400) {
      throw new OAuthError({
        message: `token exchange failed (${response.status})`,
        details: { body: await safeText(response) },
      });
    }
    const payload = (await response.json()) as Record<string, unknown>;
    return {
      accessToken: String(payload.access_token),
      tokenType: (payload.token_type as string) ?? "Bearer",
      refreshToken: (payload.refresh_token as string) ?? null,
      idToken: (payload.id_token as string) ?? null,
      expiresIn: (payload.expires_in as number) ?? null,
      scope: (payload.scope as string) ?? null,
      raw: payload,
    };
  }

  /**
   * Fetch the normalized user identity for a token bundle.
   *
   * @param tokens - The tokens from {@link exchangeCode}.
   * @returns The normalized user.
   * @throws {OAuthError} When userinfo is unconfigured or the call fails.
   */
  async fetchUser(tokens: OAuthTokens): Promise<OAuthUser> {
    const url = this.userinfoUrl();
    if (url === null) {
      throw new OAuthError({
        message: `${this.providerName}: userinfo endpoint not configured`,
      });
    }
    const response = await this.http.request("GET", url, {
      headers: {
        authorization: `${tokens.tokenType} ${tokens.accessToken}`,
        accept: "application/json",
        "user-agent": "tempest-express-sdk",
      },
    });
    if (response.status >= 400) {
      throw new OAuthError({
        message: `userinfo failed (${response.status})`,
        details: { body: await safeText(response) },
      });
    }
    return this.parseUser((await response.json()) as Record<string, unknown>);
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

/** Google identity (OIDC). Default scopes: `openid email profile`. */
export class GoogleOAuthClient extends BaseOAuthClient {
  readonly providerName = "google";
  protected override defaultScopes(): string[] {
    return ["openid", "email", "profile"];
  }
  protected authorizeUrl(): string {
    return "https://accounts.google.com/o/oauth2/v2/auth";
  }
  protected tokenUrl(): string {
    return "https://oauth2.googleapis.com/token";
  }
  protected override userinfoUrl(): string {
    return "https://openidconnect.googleapis.com/v1/userinfo";
  }
  protected parseUser(payload: Record<string, unknown>): OAuthUser {
    return {
      provider: this.providerName,
      subject: String(payload.sub),
      email: (payload.email as string) ?? null,
      name: (payload.name as string) ?? null,
      picture: (payload.picture as string) ?? null,
      raw: payload,
    };
  }
}

/** GitHub OAuth (no id_token; identity from `GET /user`). */
export class GitHubOAuthClient extends BaseOAuthClient {
  readonly providerName = "github";
  protected override defaultScopes(): string[] {
    return ["read:user", "user:email"];
  }
  protected authorizeUrl(): string {
    return "https://github.com/login/oauth/authorize";
  }
  protected tokenUrl(): string {
    return "https://github.com/login/oauth/access_token";
  }
  protected override userinfoUrl(): string {
    return "https://api.github.com/user";
  }
  protected parseUser(payload: Record<string, unknown>): OAuthUser {
    return {
      provider: this.providerName,
      subject: String(payload.id),
      email: (payload.email as string) ?? null,
      name: (payload.name as string) ?? (payload.login as string) ?? null,
      picture: (payload.avatar_url as string) ?? null,
      raw: payload,
    };
  }
}

/** Options for {@link OIDCProvider}. */
export interface OIDCProviderOptions extends OAuthClientOptions {
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl?: string | null;
  providerName?: string;
}

/**
 * Generic discovery-driven OIDC client. Pass the authorize / token / userinfo
 * endpoints (fetch them once at boot from `${issuer}/.well-known/openid-configuration`).
 * Default scopes: `openid email profile`.
 */
export class OIDCProvider extends BaseOAuthClient {
  readonly providerName: string;
  private readonly _authorizeUrl: string;
  private readonly _tokenUrl: string;
  private readonly _userinfoUrl: string | null;

  constructor(options: OIDCProviderOptions) {
    super(options);
    this.providerName = options.providerName ?? "oidc";
    this._authorizeUrl = options.authorizeUrl;
    this._tokenUrl = options.tokenUrl;
    this._userinfoUrl = options.userinfoUrl ?? null;
  }

  protected override defaultScopes(): string[] {
    return ["openid", "email", "profile"];
  }
  protected authorizeUrl(): string {
    return this._authorizeUrl;
  }
  protected tokenUrl(): string {
    return this._tokenUrl;
  }
  protected override userinfoUrl(): string | null {
    return this._userinfoUrl;
  }
  protected parseUser(payload: Record<string, unknown>): OAuthUser {
    return {
      provider: this.providerName,
      subject: String(payload.sub ?? payload.id),
      email: (payload.email as string) ?? null,
      name: (payload.name as string) ?? null,
      picture: (payload.picture as string) ?? null,
      raw: payload,
    };
  }
}
