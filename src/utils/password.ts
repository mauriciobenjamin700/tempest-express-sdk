/**
 * Password hashing backed by bcrypt, mirroring `utils.password.PasswordUtils`.
 *
 * `bcryptjs` is an optional peer dependency, imported lazily so that
 * `import "tempest-express-sdk"` keeps working when it is not installed — the
 * clear error is deferred to first use. Methods are async (the idiomatic Node
 * bcrypt surface).
 */

type BcryptModule = typeof import("bcryptjs");

let cached: BcryptModule | null = null;

/** Lazily load `bcryptjs`, with a clear install hint when missing. */
async function loadBcrypt(): Promise<BcryptModule> {
  if (cached) return cached;
  try {
    const mod = (await import("bcryptjs")) as BcryptModule & { default?: BcryptModule };
    cached = mod.default ?? mod;
  } catch (cause) {
    throw new Error(
      "PasswordUtils requires the 'bcryptjs' peer dependency. Install with `npm i bcryptjs`.",
      { cause },
    );
  }
  return cached;
}

/** Hash and verify passwords using bcrypt. Stateless — construct once, reuse. */
export class PasswordUtils {
  /**
   * @param rounds - The bcrypt cost factor. Higher is slower and harder to
   *   brute-force. Defaults to 12.
   */
  constructor(private readonly rounds: number = 12) {}

  /**
   * Hash a plaintext password.
   *
   * @param plain - The plaintext password.
   * @returns The bcrypt hash, ready to persist.
   */
  async hash(plain: string): Promise<string> {
    const bcrypt = await loadBcrypt();
    const salt = await bcrypt.genSalt(this.rounds);
    return bcrypt.hash(plain, salt);
  }

  /**
   * Verify a plaintext password against a stored hash. Returns `false` for
   * malformed hashes rather than throwing.
   *
   * @param plain - The plaintext password to verify.
   * @param hashed - The previously stored bcrypt hash.
   * @returns `true` when the password matches.
   */
  async verify(plain: string, hashed: string): Promise<boolean> {
    try {
      const bcrypt = await loadBcrypt();
      return await bcrypt.compare(plain, hashed);
    } catch {
      return false;
    }
  }
}
