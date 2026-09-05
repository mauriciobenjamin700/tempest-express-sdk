/**
 * Typed theming for the server-rendered admin panel, mirroring `admin.theme`.
 *
 * The bundled stylesheet is driven entirely by CSS custom properties declared
 * on `:root`. An {@link AdminTheme} overrides those properties — plus the logo,
 * favicon, font and footer — through typed, documented fields instead of
 * forking the stylesheet. The values are injected as a `<style>` block after
 * the stylesheet (so they win), which means there is no CSS file to maintain on
 * the project side and every knob is discoverable in the editor.
 *
 * For anything the fields do not cover, point `customCssUrl` at your own
 * stylesheet — it is linked last, so it overrides everything, including this.
 */

/**
 * Characters that would let a theme value break out of the injected `<style>`
 * block or an HTML attribute. Theme values are developer-set, not end-user
 * input, but rejecting these keeps a careless value from silently producing
 * broken — or injectable — markup.
 */
const FORBIDDEN_CHARS: readonly string[] = ["<", ">", "{", "}", '"'];

/**
 * Appearance overrides for the admin panel. Every field is optional and
 * defaults to the stock look, so `{}` is a no-op.
 */
export interface AdminTheme {
  /** Primary accent — links, primary buttons, active sidebar item. Default `#2563eb`. */
  accent?: string;
  /** Hover/active shade of {@link AdminTheme.accent}. Default `#1d4ed8`. */
  accentHover?: string;
  /** Color for destructive actions and error messages. Default `#b91c1c`. */
  danger?: string;
  /** Background of the top header band. Default `#0f172a`. */
  headerBg?: string;
  /** Background of the left sidebar. Falls back to `headerBg` so the chrome reads as one surface. */
  sidebarBg?: string;
  /** Main content background. Omitted uses the mode default (light grey, or near-black in dark mode). */
  pageBg?: string;
  /** Border radius for buttons, inputs, cards and tables. Default `6px`. */
  radius?: string;
  /** CSS `font-family` for the whole panel. Omitted keeps the system stack. */
  fontFamily?: string;
  /** URL of an image shown in the header instead of the brand text. */
  logoUrl?: string;
  /** `alt` text for the logo image. Default `Logo`. */
  logoAlt?: string;
  /** URL of the browser-tab favicon. */
  faviconUrl?: string;
  /** Text shown in the page footer. Default `Powered by tempest-express-sdk`. */
  footerText?: string;
  /** Switch the content surfaces to a dark palette (the chrome is already dark). */
  darkMode?: boolean;
  /** URL of an extra stylesheet linked **after** the theme, so it overrides everything. */
  customCssUrl?: string;
}

/** An {@link AdminTheme} with every default filled in. */
export interface ResolvedAdminTheme {
  accent: string;
  accentHover: string;
  danger: string;
  headerBg: string;
  sidebarBg: string;
  pageBg: string | null;
  radius: string;
  fontFamily: string | null;
  logoUrl: string | null;
  logoAlt: string;
  faviconUrl: string | null;
  footerText: string;
  darkMode: boolean;
  customCssUrl: string | null;
}

/**
 * Reject a theme value that would corrupt the injected markup.
 *
 * @param field - The theme field name, for the error message.
 * @param value - The value to check.
 * @throws Error When the value contains `<`, `>`, `{`, `}` or `"`.
 */
function assertSafe(field: string, value: string | undefined): void {
  if (value === undefined) return;
  const bad = FORBIDDEN_CHARS.filter((char) => value.includes(char));
  if (bad.length > 0) {
    throw new Error(
      `AdminTheme.${field} contains forbidden character(s) ${bad.join(" ")}; ` +
        `these would break the injected <style>/HTML. Got: ${value}`,
    );
  }
}

/**
 * Fill a theme with its defaults, validating every string field.
 *
 * @param theme - The partial theme (or nothing, for the stock look).
 * @returns The theme with every field resolved.
 * @throws Error When a string field contains a character that would break the markup.
 */
export function resolveAdminTheme(theme: AdminTheme = {}): ResolvedAdminTheme {
  for (const [field, value] of Object.entries(theme)) {
    if (typeof value === "string") assertSafe(field, value);
  }
  const headerBg = theme.headerBg ?? "#0f172a";
  return {
    accent: theme.accent ?? "#2563eb",
    accentHover: theme.accentHover ?? "#1d4ed8",
    danger: theme.danger ?? "#b91c1c",
    headerBg,
    sidebarBg: theme.sidebarBg ?? headerBg,
    pageBg: theme.pageBg ?? null,
    radius: theme.radius ?? "6px",
    fontFamily: theme.fontFamily ?? null,
    logoUrl: theme.logoUrl ?? null,
    logoAlt: theme.logoAlt ?? "Logo",
    faviconUrl: theme.faviconUrl ?? null,
    footerText: theme.footerText ?? "Powered by tempest-express-sdk",
    darkMode: theme.darkMode ?? false,
    customCssUrl: theme.customCssUrl ?? null,
  };
}

/**
 * Render the `<style>` body for a resolved theme.
 *
 * Dark mode only overrides the content-area surfaces — the header and sidebar
 * are already dark via `--tempest-bg` — and is skipped entirely when the
 * project pinned its own `pageBg`, since an explicit value always wins.
 *
 * @param theme - The resolved theme.
 * @returns CSS text, ready to inject verbatim inside a `<style>` element.
 */
export function adminThemeCss(theme: ResolvedAdminTheme): string {
  const variables: Record<string, string> = {
    "--tempest-accent": theme.accent,
    "--tempest-accent-hover": theme.accentHover,
    "--tempest-danger": theme.danger,
    "--tempest-bg": theme.headerBg,
    "--tempest-bg-soft": theme.sidebarBg,
    "--tempest-radius": theme.radius,
  };
  if (theme.fontFamily !== null) variables["--tempest-font"] = theme.fontFamily;
  if (theme.pageBg !== null) variables["--tempest-page-bg"] = theme.pageBg;

  const rootLines = Object.entries(variables)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  const blocks: string[] = [`:root {\n${rootLines}\n}`];

  if (theme.darkMode && theme.pageBg === null) {
    blocks.push(
      [
        ":root {",
        "  --tempest-page-bg: #0b1120;",
        "  --tempest-bg-row: #1e293b;",
        "  --tempest-bg-row-alt: #172033;",
        "  --tempest-fg: #e2e8f0;",
        "  --tempest-fg-soft: #94a3b8;",
        "}",
        "body { color: var(--tempest-fg); }",
        "input, select, textarea {",
        "  background: #1e293b;",
        "  color: var(--tempest-fg);",
        "  border-color: #334155;",
        "}",
      ].join("\n"),
    );
  }

  if (theme.fontFamily !== null) {
    blocks.push("body { font-family: var(--tempest-font); }");
  }

  return blocks.join("\n");
}
