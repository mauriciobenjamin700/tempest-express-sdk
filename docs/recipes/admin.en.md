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
| `POST /admin/m/{slug}/bulk` | Bulk actions on the checked rows |
| `GET /admin/m/{slug}/export.csv` · `.json` | Export of the current result set |
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

## 6. Bulk actions

The list view shows a checkbox per row, a select-all, and an action bar that
operates on the checked rows. Three actions ship built in — **Activate**,
**Deactivate** (when `canEdit` and the model has an `isActive` column) and
**Delete** (when `canDelete`) — and each comes back with a banner saying how
many rows changed.

### Custom actions

Anything domain-specific — "send welcome email", "mark as shipped",
"recalculate totals" — is a **custom action**: a handler built with
`adminAction` and passed to `AdminModel({ actions: [...] })`.

```ts
import { AdminModel, adminAction } from "tempest-express-sdk";

import { site } from "./site";
import { OrderModel } from "../db/models";
import { mailer } from "../core/email";

const markPaid = adminAction({ label: "Mark as paid" }, async (ctx) => {
  const changed = await ctx.repository.update(
    { id: { in: ctx.ids } },
    { status: "paid" },
  );
  return { message: `${changed} order(s) marked as paid.` };
});

const notifyCustomers = adminAction(
  { label: "Notify customers", dangerous: false },
  async (ctx) => {
    const orders = await ctx.repository.list({ id: { in: ctx.ids } });
    for (const order of orders) await mailer.send(order.email, "Your order");
    return { message: `${orders.length} emails sent.` };
  },
);

site.register(
  new AdminModel({ model: OrderModel, actions: [markPaid, notifyCustomers] }),
);
```

The handler receives a context with:

| Field | What it is |
| --- | --- |
| `ids` | Identities of the checked rows. |
| `repository` | The model's `BaseRepository`, on the request's session. |
| `dbSession` | The DB session, for work beyond the repository. |
| `request` | The inbound request. |
| `session` | The authenticated admin session. |
| `principal` | The operator row that triggered the action. |

Return `{ message, category }` to show a banner (`category` accepts
`"success"` — the default —, `"error"` and `"warning"`), or `null` to show
nothing. `dangerous: true` marks the action as destructive in the dropdown.

!!! tip "The handler stays an ordinary function"
    The Python SDK uses an `@admin_action` decorator; here `adminAction`
    **returns** the descriptor. The handler stays directly callable and testable
    (`markPaid.handler(ctx)`), with no decorator syntax for a consumer to enable
    in their build.

!!! info "The name comes from the label"
    The submitted identifier is a slug of the label (`"Mark as paid"` →
    `mark-as-paid`), namespaced as `custom:<name>` so it can never collide with a
    built-in action. Pass `name` to pin it — the value ships in the HTML, so
    changing it changes the surface. Two identical names on one model throw at
    construction.

!!! warning "A throwing handler becomes a banner, not a 500"
    An action that throws is logged and comes back as an error banner on the list
    view carrying the exception's message. The operator sees what failed instead
    of a generic error page — but that message reaches the browser, so keep
    secrets out of exception text.

## 7. CSV / JSON export

The **Export CSV** and **Export JSON** buttons download the **current** result
set — same search, same filters, same ordering, same `listDisplay` columns:

```text
GET {prefix}/m/{slug}/export.csv?q=...&filter_status=paid&sort=createdAt&dir=desc
GET {prefix}/m/{slug}/export.json?...
```

The CSV follows RFC 4180 (doubled quotes, a field quoted when it carries a
comma, quote or newline) and the JSON is an array of column→value objects.
`Date` becomes ISO, `bigint` a decimal string, binary base64.

!!! danger "The cap is there for a reason"
    An export is a full table scan streamed to a browser.
    `makeAdminRouter(site, { exportMaxRows: 5000 })` bounds how many rows leave
    (default `5000`) — it is what keeps a curious click on a large table from
    becoming an outage. Raise it deliberately.

## 8. Foreign-key select

A foreign-key column whose target model is **registered on the same site**
becomes a `<select>` of related rows, both in the form and in the list filter,
instead of a raw UUID field. The option label comes from the referenced admin's
first `searchFields`; failing that from `name` / `title` / `email` / `label` /
`reference`; and last from the identity.

```ts
class OrderModel extends BaseModel {
  static override tablename = "sales_order";
  userId = column.uuid().references("user.id");
}

site.register(new AdminModel({ model: UserModel, searchFields: ["name"] }));
site.register(
  new AdminModel({ model: OrderModel, listFilter: ["userId"] }),
);
```

A foreign key to an **unregistered** table stays a text input — an empty
dropdown would be worse than the raw field. Options are capped at 1000 rows;
past that the target table wants a search box, not a list.

## 9. Role-based access control

By default every operator who signs in (`isAdmin`) can do everything the
`AdminModel` flags allow. To narrow a principal to a subset of models or
actions, pass an `accessPolicy`:

```ts
import { AdminPermission, makeAdminRouter } from "tempest-express-sdk";

makeAdminRouter(site, {
  engine,
  authBackend,
  secretKey: settings.JWT_SECRET,
  accessPolicy: (user, admin, action) => {
    const principal = user as { role: string };
    if (principal.role === "superadmin") return true;
    if (principal.role === "support") return action === AdminPermission.VIEW;
    return admin.slug() === "article";
  },
});
```

The policy **composes with** `canCreate` / `canEdit` / `canDelete`: both have to
allow. And the panel never shows a door that answers an error — a model without
`VIEW` disappears from the sidebar and the dashboard, an action without
permission drops out of the bulk dropdown, and the **+ New**, **Edit** and
**Delete** buttons appear only when the policy allows them.

!!! info "404 and 403 mean different things"
    A disabled flag answers **404** — that view does not exist in this panel. A
    policy refusal answers **403** — the view exists and this operator may not
    use it. Collapsing the two would hide misconfiguration behind "no
    permission".

## 10. Audit trail

A model carrying `createdBy` / `updatedBy` (via `createdByColumn()` /
`updatedByColumn()`) is stamped with the operator's id automatically, on create
and on edit through the panel. The detail view grows an **Audit** panel with the
timestamps and the actors already resolved to names through the auth backend.

To see **what** changed, not just who and when, pass an `auditModel` — the same
`BaseAuditLogModel` table your services already write:

```ts
import { BaseAuditLogModel } from "tempest-express-sdk";

class AuditLogModel extends BaseAuditLogModel {
  static override tablename = "audit_log";
}

site.register(new AdminModel({ model: OrderModel, auditModel: AuditLogModel }));
```

The detail view then shows a per-record timeline (the 50 most recent entries):
action, actor, when, the field-by-field diff table and the `context` the writer
recorded. Each entry is a collapsed `<details>`, so a long history stays
scannable — and needs no JavaScript.

!!! warning "The panel reads the trail, it does not write it"
    `auditModel` only feeds the screen. Your service writes the rows, with
    `snapshot` / `diffSnapshots`. Registering the model without writing anything
    leaves the timeline empty — the panel does not invent history.

## 11. Dashboard metric cards

Beyond the CPU/memory panel, the dashboard takes **business cards** computed
from your own database on load:

```ts
import { metricCard } from "tempest-express-sdk";

const site = new AdminSite({
  title: "Shop",
  dashboardCards: [
    metricCard(
      "Orders today",
      async (session) => ({
        kind: "value",
        value: await new BaseRepository(OrderModel, session).count({ ... }),
        unit: "orders",
      }),
      "Since midnight",
    ),
    metricCard("Week over week", async (session) => ({
      kind: "trend",
      value: 18,
      previous: 12,
    })),
    metricCard("By status", async (session) => ({
      kind: "partition",
      segments: [
        { label: "Paid", value: 8 },
        { label: "Pending", value: 6 },
      ],
    })),
  ],
});
```

Three shapes: `value` (a headline number), `trend` (▲/▼ with the percentage
change against the previous period) and `partition` (a bar per segment).
`trendPercent` returns `null` when the previous period is zero — a percentage
against zero is undefined, not infinite.

!!! check "A broken card does not take the dashboard down"
    A card whose `compute` throws is logged and renders as "Could not compute
    this metric." — one bad query should not cost the operator every other
    number on the page.

## 12. Lenses (saved list presets)

A lens bundles filters and an ordering under a label, and renders as a tab above
the table:

```ts
import { adminLens } from "tempest-express-sdk";

site.register(
  new AdminModel({
    model: TicketModel,
    lenses: [
      adminLens({
        name: "Open triage",
        filters: { status: "open", priority: { gte: 3 } },
        orderBy: "-createdAt",
      }),
      adminLens({ name: "Closed", filters: { status: "closed" } }),
    ],
  }),
);
```

Clicking a tab applies `?lens=<slug>`. A lens's filters are **ANDed** with
whatever the operator typed, so search and filters keep working on top of it;
the lens ordering holds until the operator clicks a column header. The **All**
tab returns to the unfiltered list, and `lens` travels through the pagination,
sorting and export links.

## 13. File and image uploads

A String column holding a file path/key can render as an **upload input**. List
it in `uploadFields` and pass an `uploadStorage` — the backends the SDK already
ships will do:

```ts
import { AdminModel, LocalUploadStorage } from "tempest-express-sdk";

site.register(
  new AdminModel({
    model: DocumentModel,
    uploadFields: ["attachment"],
    uploadStorage: new LocalUploadStorage({ root: "media/", baseUrl: "/media" }),
  }),
);
```

- The form becomes `multipart/form-data` on its own when an upload field exists.
- **Create**: a file is required only when the column is `NOT NULL` with no default.
- **Edit**: no new file keeps the current one (the form shows `Current: …`); a
  new file replaces it.
- The column stores the storage **key** (`<slug>/<field>/<uuid>.<ext>`); use the
  `uploadStorage` to serve or download it later.

!!! info "`busboy` is an optional peer"
    Express does not parse multipart. The panel uses `busboy` — an **optional**
    peer, needed only by projects that configure `uploadFields` or `canImport`,
    with an error naming the install command. `npm install busboy`. A wire-format
    parser has a long tail of correctness (boundaries, transfer encodings,
    filename escaping): the case for depending rather than reimplementing.

!!! danger "Upload cap"
    `makeAdminRouter(site, { maxUploadBytes })` bounds what is accepted (default
    10 MB). A file over the cap comes back as a form error with nothing written.
    Files are buffered in memory — which is what a panel needs (an operator
    attaching a document), not a streaming ingest path.

!!! warning "`uploadFields` requires `uploadStorage`"
    Registering one without the other throws when the `AdminModel` is built:
    with no storage there is nowhere to write, and failing at boot beats failing
    on the first production upload.

## 14. CSV import

`canImport: true` (alongside `canCreate`) exposes an import page that bulk-creates
rows from an uploaded file:

```ts
site.register(new AdminModel({ model: OrderModel, canImport: true }));
```

The file is UTF-8 with a header row; unknown columns are ignored and the
recognised ones are the same the form edits. Every row goes through the same
coercion and validation as the form, and the ones that fail come back in a table
with the **spreadsheet row number** (starting at 2, since row 1 is the header)
and the reason. The ones that pass are created — a partial import is a normal
outcome, not an error.

!!! tip "The parser follows RFC 4180"
    A quoted field may contain commas, newlines and doubled quotes, and the BOM
    Excel writes is stripped — without that the first column name would never
    match. An import that mangles exactly the rows someone took the trouble to
    quote is worse than no import.

## 15. Foreign-key autocomplete

A foreign key whose target table is too large for a `<select>` becomes a search
box:

```ts
site.register(
  new AdminModel({
    model: OrderModel,
    autocompleteFields: ["userId"],
  }),
);
```

The field then searches `GET {prefix}/m/{slug}/autocomplete/{field}?q=`, which
queries the **referenced** admin's `searchFields` and returns up to 20 options.
On edit the box opens showing the current row's label, not its UUID.

!!! info "No CDN"
    The Python SDK reaches for HTMX from a CDN here. This panel uses ~30 lines of
    plain DOM instead, because a third-party script on an operator console is an
    external request an air-gapped deployment cannot make and a strict CSP has to
    whitelist — and what is needed is one fetch and one list.

## 16. Inlines (children on the parent's screen)

An inline shows, on the parent's screen, the child rows that point back at it —
an order's line items, a user's API keys — with no trip to another screen:

```ts
import { AdminModel, adminInline } from "tempest-express-sdk";

site.register(
  new AdminModel({
    model: OrderModel,
    inlines: [
      adminInline({
        model: OrderItemModel,
        fkField: "orderId",
        label: "Order items",
        editable: true,
        canDelete: true,
      }),
      adminInline({ model: OrderNoteModel, fkField: "orderId" }),
    ],
  }),
);
```

Without `editable` the block is a **read-only table** linking into the child's
own admin, with an **Add** button. With `editable` it becomes an **in-place
formset**: one input row per child plus a blank row to add another, saved in a
single submit that creates, edits and deletes at once.

- An editable formset needs the child model **registered on the same site** with
  `canEdit`; `canDelete` (on the inline **and** the child admin) adds the
  per-row delete checkbox.
- A blank add row with every field empty is skipped — submitting the formset
  without filling the extra row does not create an empty child.
- A row that fails validation comes back with what the operator typed plus the
  per-field error, while the other rows in the same submit are saved.

!!! danger "The parent foreign key stays out of the formset"
    The column pointing at the parent is not offered as a field: a row's parent
    is the page it is on. Offering it would let an operator move a child to
    another parent by typing a UUID into a table cell.

    Stronger than that: **every submitted row is checked as belonging to this
    parent** before it is edited or deleted. Row keys arrive from the browser,
    so a crafted submission could name some other parent's child — the ownership
    check is what keeps the page from becoming an edit surface for the whole
    table.

!!! info "Row cap"
    The block renders at most 50 children and says how many exist in total. A
    parent with more than that wants the child's own list view with a filter,
    not a giant formset on the parent's page.

## Recap

1. `BaseUserModel` plus one seeded `isAdmin` row gives you the login.
2. `AdminSite` + `AdminModel` (or `automap`) says what is manageable.
3. `makeAdminRouter(site, { engine, authBackend, secretKey })` mounts the panel.
4. Widgets, filters and validation come from the **model's columns** — there is
   no duplicated schema to keep in sync.
5. `actions: [...]` brings day-to-day operations into the panel; export and
   FK-select fall out of what the model already declares.
6. `accessPolicy` narrows who does what; `auditModel` answers who changed what;
   `dashboardCards` and `lenses` bring the numbers and the queries your team
   repeats every day into the panel.
