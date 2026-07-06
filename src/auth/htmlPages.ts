/**
 * Optional server-rendered HTML pages for the bundled auth flows, mirroring the
 * FastAPI SDK's activation/reset templates.
 *
 * This SDK favors the JSON auth API + a decoupled frontend, but a link in an
 * email (activation, password reset) sometimes has to land on a *server* page —
 * there's no SPA to route to. These helpers render small, self-contained,
 * theme-aware HTML pages (no template engine, no external assets) for exactly
 * those landings.
 */

/** Escape a string for safe interpolation into HTML text/attributes. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; display: grid; min-height: 100vh; place-items: center; background: #f6f7f9; color: #1a1a1a; }
  @media (prefers-color-scheme: dark) { body { background: #16181d; color: #e8e8e8; } .card { background: #1f2229 !important; } input { background: #16181d !important; color: inherit !important; border-color: #3a3f4b !important; } }
  .card { background: #fff; max-width: 26rem; width: calc(100% - 3rem); padding: 2rem; border-radius: 14px; box-shadow: 0 6px 30px rgba(0,0,0,.08); text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 .5rem; }
  p { margin: .25rem 0 1rem; opacity: .85; }
  .ico { font-size: 2.5rem; }
  a.btn, button.btn { display: inline-block; margin-top: .5rem; padding: .6rem 1.2rem; border-radius: 9px; border: 0; background: #4f46e5; color: #fff; text-decoration: none; font-weight: 600; cursor: pointer; }
  form { text-align: left; margin-top: 1rem; }
  label { display: block; font-size: .85rem; font-weight: 600; margin-bottom: .3rem; }
  input { width: 100%; box-sizing: border-box; padding: .6rem .7rem; border: 1px solid #d0d3d9; border-radius: 9px; font: inherit; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main class="card">${body}</main></body>
</html>`;
}

/** Options for {@link renderAuthResultPage}. */
export interface AuthResultPageOptions {
  /** `true` renders a success state, `false` an error state. */
  ok: boolean;
  /** Page + heading title. */
  title: string;
  /** Body message. */
  message: string;
  /** Optional call-to-action link. */
  cta?: { href: string; label: string };
}

/**
 * Render a success/error result page (e.g. "account activated", "link
 * expired").
 *
 * @param options - Success flag, title, message and an optional CTA.
 * @returns A complete HTML document.
 */
export function renderAuthResultPage(options: AuthResultPageOptions): string {
  const icon = options.ok ? "✅" : "⚠️";
  const cta = options.cta
    ? `<a class="btn" href="${esc(options.cta.href)}">${esc(options.cta.label)}</a>`
    : "";
  return page(
    options.title,
    `<div class="ico">${icon}</div><h1>${esc(options.title)}</h1><p>${esc(options.message)}</p>${cta}`,
  );
}

/** Options for {@link renderPasswordResetFormPage}. */
export interface PasswordResetFormOptions {
  /** Form POST target. */
  action: string;
  /** The reset token, embedded as a hidden field. */
  token: string;
  /** Page + heading title. Default `"Redefinir senha"`. */
  title?: string;
  /** Name of the hidden token field. Default `"token"`. */
  tokenField?: string;
  /** Name of the password field. Default `"password"`. */
  passwordField?: string;
  /** Submit button label. Default `"Redefinir senha"`. */
  submitLabel?: string;
}

/**
 * Render a "set a new password" form that POSTs the token + new password to
 * `action`.
 *
 * @param options - Form action, token and field/label overrides.
 * @returns A complete HTML document.
 */
export function renderPasswordResetFormPage(options: PasswordResetFormOptions): string {
  const title = options.title ?? "Redefinir senha";
  const tokenField = options.tokenField ?? "token";
  const passwordField = options.passwordField ?? "password";
  const submitLabel = options.submitLabel ?? "Redefinir senha";
  return page(
    title,
    `<h1>${esc(title)}</h1>
     <form method="post" action="${esc(options.action)}">
       <input type="hidden" name="${esc(tokenField)}" value="${esc(options.token)}">
       <label for="pw">Nova senha</label>
       <input id="pw" type="password" name="${esc(passwordField)}" required minlength="8" autocomplete="new-password">
       <button class="btn" type="submit" style="margin-top:1rem;width:100%">${esc(submitLabel)}</button>
     </form>`,
  );
}
