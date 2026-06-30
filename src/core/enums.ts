/**
 * Enum helpers mirroring `BaseStrEnum` / `BaseIntEnum`.
 *
 * TypeScript has no Python-style `Enum`, so this module offers a factory that
 * turns a plain literal map into a frozen object carrying the same
 * introspection helpers (`values`/`keys`/`choices`/`has`/`from`) the FastAPI
 * SDK exposes. The inferred type is the literal union of the member values, so
 * it stays as strongly typed as a hand-written `as const` map.
 */

/** A member-name → member-value map (string- or number-valued). */
export type EnumSpec = Record<string, string | number>;

/** Introspection helpers attached to every built enum. */
export interface EnumHelpers<S extends EnumSpec> {
  /** Every member value, in declaration order. */
  values(): Array<S[keyof S]>;
  /** Every member name, in declaration order. */
  keys(): Array<keyof S & string>;
  /** `[value, name]` pairs, e.g. for building `<select>` options. */
  choices(): Array<[S[keyof S], keyof S & string]>;
  /** Whether `value` is the value of some member. */
  hasValue(value: unknown): value is S[keyof S];
  /** Whether `key` is the name of some member. */
  hasKey(key: string): key is keyof S & string;
  /** Resolve a member value from a raw value or member name, else `fallback`. */
  from(value: unknown, fallback?: S[keyof S]): S[keyof S] | undefined;
}

/** A built enum: the literal member map plus {@link EnumHelpers}. */
export type Enum<S extends EnumSpec> = Readonly<S> & EnumHelpers<S>;

/**
 * Build a frozen enum object with introspection helpers from a literal spec.
 *
 * @param spec - The member-name → value map. Pass it inline so TypeScript
 *   infers the precise literal union (e.g. `defineEnum({ RED: "red" })`).
 * @returns The frozen members merged with {@link EnumHelpers}.
 */
export function defineEnum<const S extends EnumSpec>(spec: S): Enum<S> {
  const names = Object.keys(spec) as Array<keyof S & string>;
  const valueSet = new Set<unknown>(names.map((name) => spec[name]));

  const helpers: EnumHelpers<S> = {
    values: () => names.map((name) => spec[name]) as Array<S[keyof S]>,
    keys: () => [...names],
    choices: () =>
      names.map((name) => [spec[name], name]) as Array<[S[keyof S], keyof S & string]>,
    hasValue: (value: unknown): value is S[keyof S] => valueSet.has(value),
    hasKey: (key: string): key is keyof S & string => key in spec,
    from: (value: unknown, fallback?: S[keyof S]): S[keyof S] | undefined => {
      if (valueSet.has(value)) return value as S[keyof S];
      if (typeof value === "string" && value in spec) return spec[value] as S[keyof S];
      return fallback;
    },
  };

  return Object.freeze({ ...spec, ...helpers }) as Enum<S>;
}
