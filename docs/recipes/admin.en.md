# Admin panel

A **server-rendered** management panel mounted under `/admin`, Django-admin
style. Operators sign in with a row from your own database — there is no
separate password store — and every registered model becomes browsable:
dashboard, list view with search/filters/sorting, and create/edit/delete forms
derived from the columns.

**What you get:**

- 🔐 Signed-cookie session login, with CSRF on every write.
- 📊 Dashboard with a row count per model plus a CPU/memory panel.
- 🔎 List view with search, per-column-type filters and sortable columns.
- ✍️ CRUD with widgets derived from the column type and per-field errors.
- 📱 Responsive, with no framework JavaScript and no external asset.
- 🎨 Typed theming (`AdminTheme`) — color, logo, favicon, font, dark mode.

!!! info "No new dependency"
    The panel runs on what the SDK already ships: `tempest-db-js` for the
    models, `PasswordUtils` for the password, `node:crypto` to sign the session.
    The HTML and the CSS are strings in this package, so there is no template
    engine to install and no static file to serve.

Want the headless API instead of ready-made screens? See
[Headless admin (JSON API)](admin-json.md).

## 1. The user model

Extend `BaseUserModel` to get the columns the panel's auth backend expects
(`email`, `hashedPassword`, `isAdmin`, `lastLoginAt`) on top of `BaseModel`:

```ts
import { BaseUserModel, column, tableNameFor } from "tempest-express-sdk";

export class UserModel extends BaseUserModel {
  static override tablename = tableNameFor("UserModel"); // "user"
  name = column.varchar(120).notNull();
}
```

Only rows that are `isActive === true` **and** `isAdmin === true` get in. Seed
the first admin from a script — the same session lifecycle your repositories
already use:

```ts
import {
  BaseRepository,
  PasswordUtils,
  createEngine,
} from "tempest-express-sdk";

import { UserModel } from "./db/models";

async function main(): Promise<void> {
  const engine = createEngine(process.env.DATABASE_URL ?? "sqlite:///app.db");
  const passwords = new PasswordUtils();
  const users = new BaseRepository(UserModel, engine.session());

  await users.create({
    email: "root@example.com",
    hashedPassword: await passwords.hash("hunter2hunter2"),
    isAdmin: true,
    name: "Root",
    lastLoginAt: null,
  });

  await engine.close();
}

void main();
```

## 2. Register your models

`AdminModel` is a plain typed configuration instance — the options object is the
contract, with no metaclass magic. The defaults already work; pass the fields
you want to enrich the list view:

```ts
import { AdminModel, AdminSite } from "tempest-express-sdk";

import { OrderModel, UserModel } from "./db/models";

export const site = new AdminSite({
  title: "MyApp Admin",
  brand: "myapp-admin",          // centered header text (defaults to title)
  indexSubtitle: "Site administration",
  siteUrl: "https://myapp.com",  // optional outbound "View site" link
});

site.register(
  new AdminModel({
    model: UserModel,
    listDisplay: ["email", "name", "isAdmin", "isActive", "lastLoginAt"],
    listFilter: ["isActive", "isAdmin"],
    searchFields: ["email", "name"],
    ordering: "-createdAt",
    pageSize: 25,
  }),
);
```

The slug comes from the model's `tablename`, so URLs and tables stay in sync.
`register` also takes the options directly (`site.register({ model: OrderModel })`)
and throws when two models claim the same slug.

!!! tip "Filters derived from the column type"
    Every field in `listFilter` becomes the right control for its column type:
    **boolean** → Yes/No dropdown; **enum** → dropdown of the members;
    **date/datetime** → two date inputs (from/to); anything else → a text input
    (equality). All of it preserves search, sorting and pagination in the URL.

### Shortcut: register everything at once (`automap`)

Point `automap` at your models barrel and every concrete model is registered
with the defaults. Abstract bases (`BaseModel`, `BaseUserModel` — no
`tablename`) are skipped automatically:

```ts
import * as models from "./db/models";

site.automap(models);
```

Mix the two styles: register the models that need their own configuration by
hand, then let `automap` fill in the rest — by default it skips slugs that are
already registered:

```ts
site.register(new AdminModel({ model: UserModel, searchFields: ["email"] }));
site.automap(models, { exclude: ["audit_log"], pageSize: 50 });
```

`automap` accepts an array of classes (`site.automap([UserModel, OrderModel])`),
`exclude` (class or table name), `skipRegistered: false` to turn a collision
into an error, and any `AdminModel` option applied uniformly.

## 3. Mount the router

```ts
import {
  UserModelAuthBackend,
  createApp,
  createEngine,
  makeAdminRouter,
} from "tempest-express-sdk";

import { site } from "./admin/site";
import { settings } from "./core/settings";
import { UserModel } from "./db/models";

const engine = createEngine(settings.DATABASE_URL);

const app = await createApp({
  configure: (a) => {
    a.use(
      makeAdminRouter(site, {
        engine,
        authBackend: new UserModelAuthBackend(UserModel),
        secretKey: settings.JWT_SECRET,   // at least 32 characters
        prefix: "/admin",
        cookieSecure: !settings.DEBUG,    // true on production HTTPS
      }),
    );
  },
});
```

`makeAdminRouter` mounts:

| Route | What it does |
|---|---|
| `GET /admin/login` · `POST /admin/login` | Sign-in flow |
| `GET /admin/mfa` · `POST /admin/mfa` | TOTP challenge (backends with MFA) |
| `POST /admin/logout` | Drop the session |
| `GET /admin/` | Dashboard: row counts + CPU/memory |
| `GET /admin/m/{slug}` | List view: search, filters, sorting, pagination |
| `GET/POST /admin/m/{slug}/new` | Create (when `canCreate`) |
| `GET /admin/m/{slug}/{id}` | Detail, with Edit/Delete |
| `GET/POST /admin/m/{slug}/{id}/edit` | Edit (when `canEdit`) |
| `POST /admin/m/{slug}/{id}/delete` | Delete (when `canDelete`) |
| `GET /admin/static/admin.css` | The bundled stylesheet |

!!! danger "`secretKey` is what separates an operator from an attacker"
    The session is **stateless**: principal id, display name, CSRF token and
    expiry travel in the cookie, signed with HMAC-SHA256 over this key. It must
    be at least 32 characters (the constructor refuses less), come from the
    environment, and never reach the repository. Rotating the key logs everyone
    out — exactly what you want if it ever leaks.

!!! info "Writes (CRUD) and permissions"
    Create/edit/delete are gated by `canCreate` / `canEdit` / `canDelete` on the
    `AdminModel` (all `true` by default; a disabled view answers `404` and
    disappears from the UI). Every POST carries the session's CSRF token,
    validated server-side (`403` on mismatch). **Widgets** are derived from the
    column type — text / textarea (long strings) / number / checkbox /
    `datetime-local` / date / time / `select` for enums / JSON textarea — with
    required-field validation and per-field errors re-rendered in the form. A
    write the **database** refuses (unique, FK, `NOT NULL`) comes back the same
    way: `400` with the message at the top of the form, never `500`.

## 4. Second factor (optional)

A principal who enrolled TOTP goes through `/admin/mfa` after the password — the
panel never becomes the weaker door into an MFA-protected account. Turn it on by
passing a verifier to the backend:

```ts
import { MfaService, TOTPHelper, UserModelAuthBackend } from "tempest-express-sdk";

const mfaService = new MfaService({ store: mfaStore, totp: new TOTPHelper() });

const authBackend = new UserModelAuthBackend(UserModel, {
  mfa: {
    isEnabled: (userId) => mfaStore.isConfirmed(userId),
    verify: (userId, code) => mfaService.verify(userId, code),
  },
});
```

Without `mfa`, the backend declares that it has no second factor and every
correct password completes the login.

## 5. Theming

Every knob is a typed field, injected as a CSS custom property:

```ts
const site = new AdminSite({
  title: "MyApp Admin",
  theme: {
    accent: "#7c3aed",
    headerBg: "#1e1b4b",
    logoUrl: "/static/logo.svg",
    faviconUrl: "/static/favicon.ico",
    fontFamily: "'Inter', sans-serif",
    radius: "10px",
    footerText: "MyApp | 2026",
    darkMode: true,
  },
});
```

For anything the fields do not cover, point `customCssUrl` at your own
stylesheet — it is linked last and overrides everything.

!!! warning "Theme values are validated"
    `<`, `>`, `{`, `}` and `"` are rejected at construction: they would break the
    injected `<style>` block. That is a configuration defect, so it fails loudly
    instead of producing corrupted markup.

!!! tip "Sidebar + burger navigation"
    Every authenticated page has a sidebar: Dashboard plus one link per
    registered model, with the current item highlighted. On desktop it is always
    visible; on mobile (≤768px) it goes off-canvas, opened by the burger icon and
    closed by tapping the scrim — pure CSS, no JS.

## Recap

1. `BaseUserModel` plus one seeded `isAdmin` row gives you the login.
2. `AdminSite` + `AdminModel` (or `automap`) says what is manageable.
3. `makeAdminRouter(site, { engine, authBackend, secretKey })` mounts the panel.
4. Widgets, filters and validation come from the **model's columns** — there is
   no duplicated schema to keep in sync.
