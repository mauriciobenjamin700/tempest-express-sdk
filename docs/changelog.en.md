# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres
to [SemVer](https://semver.org/).

!!! info "Full history"
    This page lists recent highlights. The full version-by-version history
    (0.2.0–0.11.0) lives in the repository's
    [`CHANGELOG.md`](https://github.com/mauriciobenjamin700/tempest-express-sdk/blob/main/CHANGELOG.md).

## [0.30.0] — 2026-09-05

### Added

- **tasks**: `TaskManager.register` takes an optional `{ description, schedule }`
  and `TaskManager.inventory()` reports what this process would run, ordered by
  name. The schedule is recorded and displayed, never interpreted — the manager
  consumes a queue, it does not schedule.

- **tasks**: `BaseJobModel` and `JobStore` — a persisted row per unit of long
  work, so the questions a broker cannot answer (did last night's export finish,
  why did that import fail, what is running now) have somewhere to live. Every
  transition is a method rather than a raw update, so "finished" always moves the
  same columns together, and `cancel` refuses a run already in a terminal state
  instead of rewriting it under the operator. The store is deliberately not wired
  into `TaskManager`: not every enqueued message deserves a durable row, and a
  worker writing one usually wants domain fields the envelope never carried.

- **admin**: the **tasks page**. `makeAdminRouter({ tasks })` serves
  `{prefix}/tasks` with both halves — the declared inventory and the recorded
  runs, filtered by status and name — plus a per-run screen showing payload,
  result, error and attempts, with a Cancel button while the run is not terminal.
  Either half may be omitted, and a section with no source is left out rather
  than rendered empty. What the page deliberately does not show is live queue
  depth: no broker exposes it, and a number that looked like that answer would be
  worse than none.

- **admin**: the bundled stylesheet gains job-status badge colours, kept in their
  own constant so the ported base stays a verbatim copy that can be re-synced.

## [0.29.0] — 2026-09-05

### Added

- **admin**: the **logs page**. `makeAdminRouter({ logDir })` reads the
  structured JSON files `configureFileLogging` writes and serves them at
  `{prefix}/logs` — filtered by source and search term, paginated, newest first,
  with colour-coded level badges. A record carrying a traceback becomes a
  collapsed `<details>` whose summary is the message, so a page full of 500s
  stays scannable without JavaScript. Search matches the message, the logger
  **and the traceback**, because someone hunting a 500 usually has a fragment of
  the trace. `{prefix}/logs/export?format=md|json` downloads the same filtered
  selection (at most 500 records): markdown puts each traceback in a fenced
  block and declares how many of the matches it carries, so a partial export
  never reads as a complete one. The page is opt-in — without `logDir` it 404s,
  because the payload exposes tracebacks and request metadata.

- **admin**: the **SQL console**, off by default. `makeAdminRouter({ sqlConsole })`
  serves `{prefix}/sql` behind a policy: capabilities (`read` / `insert` /
  `update` / `delete` / `ddl` / `drop` / `admin`), table allow and deny lists, a
  refusal of `UPDATE`/`DELETE` without `WHERE`, and a row cap. Statements are
  classified by parsing them (`node-sql-parser`, a new optional peer) rather
  than by matching strings, and anything the parser cannot understand needs the
  `admin` capability — the most privileged, not the least. Every attempt,
  allowed or refused, reaches `onAudit`; a hook that throws is logged and
  swallowed, since an audit trail that can break the thing it audits gets turned
  off.

  The docs state plainly what this is: **defence in depth, not a security
  boundary**. The boundary that holds is the database user, and `sqlConsole.run`
  exists so the console can be pointed at a restricted role.

  `analyzeSql`, `checkSqlPolicy`, `SqlCapability` and the log helpers
  (`toLogEntry`, `filterLogEntries`, `renderLogEntriesMarkdown`,
  `renderLogEntriesJson`) are exported for projects building their own screens.

- **api**: `readLogEntries(dir, source)` is exported — the reader the JSON logs
  endpoint and the admin page now share, so the two can never disagree about
  what "the error log" contains.

## [0.28.0] — 2026-09-05

### Added

- **admin**: **inlines** — related child models surfaced on a parent's detail
  view. `adminInline({ model, fkField })` entries passed to
  `AdminModel({ inlines })` render the children pointing back at the record: a
  read-only table linking into the child's own admin, or — with `editable` — an
  in-place formset with one input row per child plus a blank add row, saved in a
  single submit that creates, edits and deletes at once. `canDelete` adds the
  per-row delete checkbox, gated on the child admin's own flag.

  The column pointing at the parent is held out of the formset, and **every
  submitted row is verified as belonging to this parent** before it is written
  or deleted: row keys arrive from the browser, so a crafted submission could
  otherwise name another parent's child and turn the page into an edit surface
  for the whole table. A blank add row is skipped, and a row that fails
  validation comes back with the submitted values and per-field errors while the
  rest of the submit is saved.

  `groupInlineSubmission` is exported for projects parsing the same
  `row.<key>.<column>` convention themselves.

## [0.27.0] — 2026-09-05

### Added

- **admin**: **file and image uploads**. `AdminModel({ uploadFields,
  uploadStorage })` renders those String columns as file inputs, switches the
  form to `multipart/form-data`, writes the file through the storage backend and
  stores the returned key (`<slug>/<field>/<uuid>.<ext>`). On create a file is
  required only for a `NOT NULL` column with no default; on edit, uploading
  nothing keeps the current file rather than clearing the column. Registering
  `uploadFields` without an `uploadStorage` throws at construction, because
  failing at boot beats failing on the first production upload.
  `makeAdminRouter({ maxUploadBytes })` bounds the size (default 10 MB).

- **admin**: **CSV import**. `AdminModel({ canImport: true })` exposes
  `GET/POST {prefix}/m/{slug}/import`, which bulk-creates rows from an uploaded
  UTF-8 CSV. Each row goes through the same coercion and validation as the form;
  failures come back in a table numbered the way a spreadsheet numbers them
  (starting at 2, since row 1 is the header) with the reason, and the rows that
  passed are created — a partial import is a normal outcome, not an error. The
  exported `parseCsv` follows RFC 4180 (quoted commas, embedded newlines,
  doubled quotes) and strips the BOM Excel writes.

- **admin**: **foreign-key autocomplete**. `AdminModel({ autocompleteFields })`
  turns a foreign key into a typed search box backed by
  `GET {prefix}/m/{slug}/autocomplete/{field}?q=`, which queries the referenced
  admin's `searchFields` and returns up to 20 options — removing the 1000-row
  pre-load a `<select>` needs. On edit the box opens on the current row's label
  rather than its id. Where the Python SDK pulls HTMX from a CDN, this ships ~30
  lines of plain DOM: a third-party script on an operator console is a request an
  air-gapped deployment cannot make and a strict CSP has to whitelist.

- **deps**: `busboy` joins as an **optional peer**, needed only by projects that
  configure `uploadFields` or `canImport`; the error names the install command.
  Express does not parse multipart, and a wire-format parser is the case for
  depending rather than reimplementing. `parseMultipart` / `isMultipart` /
  `MultipartLimitError` are exported for projects that need the same handling.

### Fixed

- **admin**: `createdBy` / `updatedBy` are no longer offered as form inputs. The
  panel stamps them itself, so a value typed there was silently discarded on
  submit — a field that does nothing is worse than no field.

## [0.26.0] — 2026-09-05

### Added

- **admin**: **role-based access control**. `makeAdminRouter({ accessPolicy })`
  takes a `(principal, admin, action)` predicate consulted for every model
  action. It composes with — never replaces — the `canCreate` / `canEdit` /
  `canDelete` flags, and the panel hides what it refuses: a model without `VIEW`
  drops out of the sidebar and dashboard, a refused action leaves the bulk
  dropdown, and the **+ New** / **Edit** / **Delete** buttons appear only when
  the policy allows them. A disabled flag answers `404` (the view does not
  exist) while a policy refusal answers `403` (it exists, you may not use it) —
  collapsing the two would hide misconfiguration behind "no permission".

- **admin**: **audit trail**. Create and edit stamp `createdBy` / `updatedBy`
  with the acting operator when the model declares those columns, and the detail
  view grows an **Audit** panel holding the timestamps and the actors resolved
  to display names through the auth backend. Pass `AdminModel({ auditModel })`
  and the panel also renders a per-record change timeline read from that
  `BaseAuditLogModel` table — action, actor, the field-by-field diff and the
  recorded context, each entry a collapsed `<details>` so a long history stays
  scannable without JavaScript. The panel only reads the trail; the service
  still writes it.

- **admin**: **dashboard metric cards**. `new AdminSite({ dashboardCards })`
  takes `metricCard(label, compute, helpText?)` entries computed from the DB on
  load, in three shapes: `value`, `trend` (▲/▼ with the percentage change) and
  `partition` (a bar per segment). A card whose `compute` throws is logged and
  renders as an error card rather than taking the dashboard down. `trendPercent`
  returns `null` against a zero baseline — a percentage against zero is
  undefined, not infinite.

- **admin**: **lenses** — saved list-view presets. `adminLens({ name, filters,
  orderBy })` entries passed to `AdminModel({ lenses })` render as tabs above
  the table and apply through `?lens=<slug>`. A lens's filters are ANDed with
  whatever the operator typed, its ordering holds until a column header is
  clicked, and the active lens travels through the pagination, sorting and
  export links.

### Changed

- **admin**: the detail view moves `createdAt` / `updatedAt` / `createdBy` /
  `updatedBy` out of the field list and into the new audit panel, where "who and
  when" reads better next to the change history than scattered among the domain
  fields. `AdminModel.detailFieldNames()` no longer returns them; the new
  `auditFieldNames()` does.

## [0.25.0] — 2026-09-05

### Added

- **admin**: **bulk actions** on the list view. Every row gets a checkbox plus a
  select-all, and the action bar applies **Activate** / **Deactivate** (gated on
  `canEdit` and an `isActive` column) or **Delete** (gated on `canDelete`) to the
  checked rows, reporting how many changed. Every submission carries the
  session's CSRF token.

- **admin**: **custom actions** via `adminAction({ label }, handler)`, passed to
  `AdminModel({ actions: [...] })`. Each joins the bulk dropdown namespaced as
  `custom:<name>`, so a custom action can never collide with a built-in one. The
  handler receives the checked `ids`, a repository on the request's session, the
  DB session, the request, the admin session and the acting principal, and
  returns `{ message, category }` to flash a banner (or `null` for none). A
  handler that throws is logged and comes back as an error banner rather than a
  `500`.

  Where the Python SDK uses an `@admin_action` decorator, `adminAction` returns
  the descriptor instead: the handler stays an ordinary function the consumer can
  call and unit-test (`action.handler(ctx)`), with no decorator syntax to enable
  in their build.

- **admin**: **CSV / JSON export** at `GET {prefix}/m/{slug}/export.csv|json`,
  honouring the request's search, filters, ordering and `listDisplay` columns —
  the list view and the export now resolve the query through one shared code
  path, because an export that quietly disagrees with the page it was taken from
  is worse than no export. CSV follows RFC 4180; `Date` becomes ISO, `bigint` a
  decimal string, binary base64. `makeAdminRouter({ exportMaxRows })` caps the
  row count (default `5000`) so a click on a large table cannot become an outage.

- **admin**: **foreign-key selects**. A FK column whose target model is
  registered on the same site renders as a `<select>` of related rows in both the
  create/edit form and the list filter, labelled by the referenced admin's first
  `searchFields` (falling back to `name`/`title`/`email`/`label`/`reference`,
  then the identity). A FK to an unregistered table stays a text input — an empty
  dropdown would be worse than the raw field. Options are capped at 1000 rows.
  New helpers `foreignKeyFields`, `foreignKeyLabel` and `foreignKeyTable` are
  exported for projects that build their own screens.

## [0.24.0] — 2026-09-05

### Added

- **admin**: a **server-rendered admin panel** — the Django-style operator UI
  the FastAPI SDK ships, now in this SDK. `AdminSite` holds the registry,
  `AdminModel` configures one model, and `makeAdminRouter(site, { engine,
  authBackend, secretKey })` mounts login, dashboard, list views (search,
  per-column-type filters, sortable columns, pagination) and auto-derived
  create/edit/delete forms under `/admin`.

  Widgets, filters and validation are derived from `tempest-db-js` column
  metadata (`columnsOf`), not from a second schema the project has to keep in
  sync: an `enum` column becomes a `<select>` of its members, a `datetime`
  column a `datetime-local` input and a from/to filter pair, a `varchar(>255)`
  a textarea. `AdminModel.automap` registers a whole models barrel at once and
  skips the abstract bases.

  Nothing new is installed: the HTML and the ~32 KB stylesheet (ported verbatim
  from `tempest-fastapi-sdk`) are strings in this package, the session is signed
  with `node:crypto`, and passwords go through the existing `PasswordUtils`.
  There is no template engine and no framework JavaScript — the responsive
  off-canvas sidebar is pure CSS.

- **admin**: `UserModelAuthBackend` authenticates against a `BaseUserModel`
  subclass, admitting only rows that are `isActive` **and** `isAdmin`. Pass an
  `AdminMfaVerifier` and a principal who enrolled TOTP is sent through
  `/admin/mfa` after the password, so the panel can never be the weaker door
  into an MFA-protected account.

- **admin**: `AdminSessionStore` issues stateless signed-cookie sessions
  (HMAC-SHA256, `HttpOnly`, `SameSite=Lax`, `Secure` by default) carrying the
  CSRF token every write form echoes back. A secret shorter than 32 characters
  is refused at construction. `AdminTheme` restyles the panel through typed
  fields injected as CSS custom properties, rejecting values that would break
  out of the injected `<style>` block.

### Changed

- **BREAKING — admin**: the JSON admin was renamed so the HTML panel could take
  the names it has in `tempest-fastapi-sdk`. `AdminSite` → `AdminJsonSite`,
  `makeAdminRouter` → `makeAdminJsonRouter`, and the types took the same infix
  (`AdminResource` → `AdminJsonResource`, `AdminField` → `AdminJsonField`,
  `AdminListQuery`/`AdminListResult` → `AdminJsonListQuery`/`AdminJsonListResult`,
  `AdminRouterOptions` → `AdminJsonRouterOptions`).

  No deprecated alias is possible here: the old and new meanings collide on the
  same identifier. Update the import and the constructor call — the behaviour,
  the routes and the default `/admin` prefix are unchanged. Mounting the panel
  and the JSON admin in one app now means giving one of them a different
  `prefix`.

- **deps**: the `tempest-db-js` peer floor moves to `>=0.8.0` (dev dependency
  and CLI scaffold to `^0.8.0`), keeping consumers on the current DB foundation.

### Fixed

- **admin**: a blank create form now pre-fills each column's literal default, so
  submitting it untouched writes what the database would have written. Without
  it a `default(true)` flag arrived as `false` — the panel silently deactivated
  every row it created. Caught in a real browser, not by the type-checker.

- **admin**: the detail view renders **every** column, no longer narrowed by
  `listDisplay`. The list view is a scannable summary; trimming the detail view
  the same way hid data with nowhere else to read it.

## [0.23.0] — 2026-08-30

### Added

- **api**: `mountSwaggerUi` and `mountRedoc` now emit a `<link rel="icon">`,
  defaulting to `DEFAULT_DOCS_FAVICON` — a small inline SVG `data:` URI. Without
  one the browser requests `/favicon.ico` at the **origin root**, which on an
  API-only service is a 404, a 401 behind the auth middleware, or an SPA
  catch-all: a red console error on every visit to `/docs`. `SwaggerOptions` and
  `RedocOptions` take `favicon?: string | false`; `false` omits the tag. Closes #7.

- **api**: `mountRedoc` serves the renderer **from the service** when the new
  optional peer `redoc` is installed, so the reference page works on a closed
  network. New `RedocOptions.bundle`: `"auto"` (default — local when available,
  CDN otherwise), `"local"` (throws at mount time when `redoc` is missing, so an
  air-gapped deploy cannot silently degrade into a CDN request) and `"cdn"`.
  `RedocOptions.bundlePath` serves a vendored copy; `scriptUrl` still wins over
  both.

  `redoc` is an **optional peer**, not a dependency: the package pulls 22
  dependencies and peers on `react`, `react-dom`, `styled-components`, `mobx`
  and `core-js` — bounds no backend service should inherit just to render a
  reference page. Consumers who want offline Redoc opt in with
  `npm install redoc`; everyone else pays nothing.

- **api**: `SwaggerOptions.ui` — a passthrough merged into the `SwaggerUIBundle`
  constructor, so any Swagger UI option JSON can carry is reachable without the
  SDK modelling each one. Three defaults now differ from Swagger UI's own:
  `layout` is `"BaseLayout"` instead of `"StandaloneLayout"` (the standalone
  layout renders the **Explore** topbar, an editable URL field that loads any
  spec from any origin — the point of the Swagger editor, the wrong surface for
  a page documenting one service), and `deepLinking` and `persistAuthorization`
  are `true` (a linkable operation, and credentials that survive a reload).
  `ui: { layout: "StandaloneLayout" }` restores the old page, standalone preset
  script included. `supportedSubmitMethods` keeps Swagger UI's default, so
  **Try it out** still executes every verb until a caller narrows it — which is
  now possible for an API whose calls are irreversible. A function passed in
  `ui` throws at mount time instead of being dropped silently by the JSON
  serialization. Closes #8.

- **api**: new exports `DEFAULT_DOCS_FAVICON`, `REDOC_CDN_URL`,
  `resolveRedocBundle` and the `RedocBundleSource` type.

### Fixed

- **api**: the Redoc page no longer renders **blank** when the bundle fails to
  load. A blocked CDN, a restrictive CSP or a wrong `scriptUrl` meant
  `Redoc.init` never ran and the page came up empty, which reads as a broken
  service. It now names the URL that failed, confirms the OpenAPI document is
  still served, and says how to fix it.

- **api**: page titles and favicon URLs are HTML-escaped, and values inlined
  into `<script>` escape `<`. A title read from configuration could previously
  close the `<title>` element and inject markup.

### Docs

- The API recipe gains **Favicon**, **Configuring Swagger UI** and **Offline
  Redoc** sections (bilingual),
  with the `bundle` table, the air-gapped warning and an honest note that Redoc
  still fetches its own `cdn.redoc.ly` watermark from inside its bundle.

## [0.22.0] — 2026-08-30

### Fixed

- **BREAKING (behaviour) — schemas**: `?ascending=false` now actually sorts
  descending. `paginationFilterSchema.ascending`,
  `cursorPaginationFilterSchema.ascending` and `syncFilterSchema.includeDeleted`
  were built on `z.coerce.boolean()`, which is `Boolean(input)` — every non-empty
  string is `true`, `"false"` and `"0"` included — so there was **no way to send
  `false` over the wire**. They now use the new `looseBoolean`. Closes #4.

- **BREAKING (behaviour) — settings**: `DEBUG=false` now disables debug. The
  `DEBUG` field of `serverSettingsShape` had the same `z.coerce.boolean()`
  defect, so any non-empty value — `"false"` included — turned debug on.

### Added

- **schemas**: `looseBoolean(defaultValue)` — the boolean field for values that
  arrive as text (query strings, environment variables). Reads
  `true`/`1`/`yes`/`on`/`y`/`enabled` and `false`/`0`/`no`/`off`/`n`/`disabled`,
  case-insensitively and trimmed; treats an empty or whitespace-only value as
  absent (so an unset `.env` entry falls back to the default); passes real
  booleans through; and **rejects** anything else, so a typo surfaces as a
  validation error instead of silently becoming `false`. Built on zod 4's
  `z.stringbool()`. Its OpenAPI metadata is pinned to `type: boolean` with the
  default, so the document describes what the client sends rather than the union
  used to parse it.

### Changed

- **BREAKING (behaviour) — settings**: `envBoolean` is now `looseBoolean` under
  the settings-facing name — one implementation shared with the query filters,
  instead of two token lists that drift. Same signature, and every previously
  accepted token still parses the same way. Two behaviours change: an
  **unrecognised token is now a `ZodError`** rather than a silent `false`, and an
  **empty variable** (`SMTP_USE_TLS=`) now falls back to the field default
  instead of being read as `false`. Both make wrong environment config fail at
  boot rather than degrade quietly. Affects every boolean settings field:
  `LOG_JSON`, `SMTP_USE_TLS`, `SMTP_USE_SSL`, `MINIO_SECURE`, `SESSION_*`,
  `AUTH_*`.

### Docs

- New section **`looseBoolean` — the boolean that arrives as text** in the
  validated-fields recipe (bilingual), with the token table and the OpenAPI note.
- The settings recipe's `envBoolean` section documents the rejection of unknown
  tokens and the empty-variable rule, and links to `looseBoolean`.

## [0.21.0] — 2026-08-30

### Changed

- **BREAKING — deps**: `zod` moved from a direct **dependency** to a required
  **peer dependency** at `^4.0.0`, and `@asteasolutions/zod-to-openapi` was
  bumped `^7.3.0` → `^9.1.0`. Install `zod@^4` alongside the SDK
  (`npm install zod@^4`) — step by step in
  [Migrating to zod 4](migration/zod-4.md).

  Why: as a direct dependency the SDK shipped its own copy of zod. A project on
  zod 4 ended up with **two instances** in `node_modules`, and since
  `zod-to-openapi` works by patching the `ZodType` prototype, it patched the
  SDK's zod 3 — not the project's zod 4. Registering a project schema then failed
  with `TypeError: zodSchema.openapi is not a function`, and patching the project
  instance by hand only moved the failure to
  `UnknownZodTypeError: Unknown zod object type`. As a peer dependency there is
  exactly one instance, shared, so `instanceof ZodType` and the prototype patch
  both cross the package boundary. Closes #2.

- **schemas**: internal schemas migrated to zod 4 idioms — `z.uuid()`,
  `z.email()`, `z.url()` (the `z.string().uuid()` chain is deprecated in zod 4),
  `z.record(z.string(), z.unknown())` (the key type is now required) and
  `.loose()` in place of the deprecated `.passthrough()`. `z.ZodTypeAny` in the
  public signatures of `paginationSchema`, `cursorPaginationSchema`,
  `syncPaginationSchema`, `loadSettings` and `AdminResource` is now `z.ZodType`.
  The zod 3 spellings still parse, so consumer schemas keep working.

- **cli**: the scaffold template now pins `zod@^4.0.0`.

### Added

- **tests**: `tests/zod-instance.test.ts` — a regression guard proving the SDK's
  `z` **is** the consumer's `zod` instance, that `.openapi()` is present on it,
  and that a document generates from schemas built with a bare
  `import { z } from "zod"`.

### Docs

- New page **Migrating to zod 4** (bilingual) — the breaking change, the
  before/after install, the API renames and the "two instances" diagnostic.

## [0.20.1] — 2026-07-09

### Changed

- **deps**: bump `tempest-db-js` to `>=0.4.0` (peer), `^0.4.0` (dev) and the CLI
  scaffold template. No API changes; build and full suite green on 0.4.0.

### Fixed

- **api**: Swagger UI now loads its assets when visited at `/docs` (no trailing
  slash), not only `/docs/`. The bootstrap HTML referenced assets with a
  relative path (`./assets/…`), which the browser resolved against `/docs` to
  `/assets/…` — a 404 that left the UI blank/unstyled. Asset URLs are now
  **absolute** (`/docs/assets/…`) and resolve at both paths.

### Docs

- New recipe **[Schemas (base, response and pagination)](recipes/schemas.md)** —
  `toDict`, `baseResponseSchema`, the Create/Update/Response pattern, and offset
  vs. cursor pagination.
- New recipe **[API: `createApp`, OpenAPI, Swagger and Redoc](recipes/api.md)** —
  full `createApp` option reference, the `configure` hook, and the 3-step OpenAPI
  wiring.

## [0.20.0] — 2026-07-06

### Added

- **db**: `wrapWithSlowQueryLog` (slow-query logging via a driver wrap) and
  `backupDatabase` (dialect-aware: `pg_dump` / SQLite copy). **auth**:
  `renderAuthResultPage` / `renderPasswordResetFormPage` (optional HTML pages).

## [0.19.0] — 2026-07-06

### Added

- **storage**: `S3UploadStorage` (same `UploadStorage` interface over MinIO/S3,
  optional `minio` peer). **cli**: `lint`, `config` and `user`.

## [0.18.0] — 2026-07-06

### Added

- **utils**: `sendFileDownload` (Range/206), `sendBytesDownload`,
  `resolveDownloadPath` (traversal-safe) and `configureFileLogging` (per-level
  files + `500.log`); **core** `addLogSink`; **api** `makeLogsRouter`.

## [0.17.0] — 2026-07-06

### Added

- **schemas**: validated field types (`centsField`, `priceField`, `slugField`,
  `hexColorField`, `percentField`, `latitudeField`, …), delta-sync pagination
  (`syncFilterSchema` / `syncPaginationSchema`), `buildPaginationLinkHeader`
  (RFC-5988) and `logEntrySchema`.

## [0.16.0] — 2026-07-06

### Added

- **api**: OAuth2/OIDC clients (`GoogleOAuthClient`, `GitHubOAuthClient`,
  `OIDCProvider`) + `generateOAuthState`, `WebhookSignatureVerifier`
  (constant-time HMAC over the raw body) and `makeToolSpecRouter` (a `/tool-spec`
  manifest endpoint).

## [0.15.0] — 2026-07-06

### Added

- **db**: advanced layer — `TenantScopedRepository` (multi-tenant isolation),
  `BaseOutboxModel` + `OutboxRelay` (transactional outbox), `BaseAuditLogModel` +
  `snapshot`/`diffSnapshots` (audit trail) and opt-in base models `BaseUserModel`
  / `BaseUserTokenModel` / `BaseUserRefreshTokenModel`.

## [0.14.0] — 2026-07-06

### Added

- **testing**: framework-agnostic in-memory test-database helpers —
  `createTestDatabase(models)` stands up a `tempest-db-js` engine over in-memory
  SQLite with tables reflected from the models; `withTestDatabase(models, fn)`
  scopes it to a block and always disposes.

## [0.13.0] — 2026-07-06

### Added

- **api/middlewares**: HTTP hardening middlewares — `rateLimitMiddleware`
  (sliding window; memory + Redis stores; key by IP/header/JWT),
  `bodySizeLimitMiddleware` (413), `csrfMiddleware` + `generateCsrfToken`,
  `idempotencyMiddleware` (memory + Redis stores), `GracefulShutdown`,
  `requestTracingMiddleware` and `prometheusMiddleware` / `HttpMetrics`.

### Changed

- **api**: `requestIdMiddleware` validates the inbound `X-Request-ID` against an
  ASCII whitelist before reusing it (prevents CRLF/log injection).

## [0.12.0] — 2026-07-06

### Added

- **settings**: composable domain settings fragments mirroring the
  `tempest-fastapi-sdk` mixins — `authSettingsShape`, `jwtSettingsShape`,
  `emailSettingsShape`, `redisSettingsShape`, `rabbitmqSettingsShape`,
  `sessionSettingsShape`, `uploadSettingsShape`, `minioSettingsShape`,
  `webPushSettingsShape`, `webSocketSettingsShape`, `logSettingsShape`,
  `tokenSettingsShape` (same env var names + defaults). Plus `envBoolean`
  (parses `"false"` as `false`) and `envList` (CSV → `string[]`) helpers.

### Docs

- **recipes/settings**: new bilingual guide for typed settings.
- **recipes/database**: new bilingual guide (models + repositories).

## [0.1.0] — 2026-06-29

### Added

- **Foundation**: strict TypeScript tooling, `@` alias (no `.js`), dual
  ESM + CJS + `.d.ts` build (tsup), Biome and Vitest.
- **core**: `JSONLogger`, request-id context (`AsyncLocalStorage`), `defineEnum`.
- **exceptions**: `AppException` + HTTP subclasses (`Conflict`, `NotFound`,
  `Unauthorized`, `Forbidden`, `Validation`, `TooManyRequests`, `InvalidToken`,
  `ExpiredToken`), `MessageCatalog` (i18n) and `registerExceptionHandlers`.
- **schemas**: OpenAPI-augmented `z`, `baseResponseSchema`, offset + cursor pagination.
- **settings**: `loadSettings`, `baseAppSettingsShape`.
- **db**: re-exports `tempest-db-js`, `BaseModel` and column helpers.
- **services / controllers**: `BaseService`, `BaseController`.
- **utils**: CPF/CNPJ/CEP/phone/UF + cities, datetime, dict, opaque tokens,
  `AttemptThrottle`, `PasswordUtils` (bcrypt), `JWTUtils`.
- **auth**: schemas, `UserAuthService`, JWT middleware, role guards,
  `makeAuthRouter`.
- **api**: `createApp`, `runServer`, native Swagger UI + Redoc, health.
- **CLI**: `new`, `generate`, `secret`, `docker-compose`, `db`.

### Pending

Not yet ported from `tempest-fastapi-sdk`: sessions, cache (Redis),
queue (RabbitMQ), tasks, webpush, websockets, feature flags, storage, metrics,
admin, SSE, and the MFA / email / password-reset flows.
