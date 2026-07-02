# Admin (JSON API)

The `admin` module exposes a **JSON admin** with auto-derived CRUD per resource
and field introspection — a frontend (React, etc.) consumes and renders it.
Unlike the FastAPI SDK's server-rendered admin, the UI stays decoupled here.

## Register resources

An `AdminResource` is callback-based — wire it to a `BaseService`, a
`tempest-db-js` repository, or any store.

```ts
import { AdminSite, createApp, makeAdminRouter, z } from "tempest-express-sdk";

const site = new AdminSite("Dashboard");

site.register({
  name: "users",
  fields: [
    { name: "id", type: "string", readOnly: true },
    { name: "email", type: "string", required: true },
  ],
  createSchema: z.object({ email: z.string().email() }),
  updateSchema: z.object({ email: z.string().email() }),
  async list({ page, pageSize, filters }) {
    const data = await userService.paginate({ page, pageSize, filters });
    return data; // { items, total, page, pageSize, pages }
  },
  async get(id) {
    return userService.getByIdOrNull(id);
  },
  async create(data) {
    return userService.create(data as { email: string });
  },
  async update(id, data) {
    return userService.updateById(id, data);
  },
  async remove(id) {
    await userService.deleteById(id);
  },
});
```

## Mount the router (protected)

Pass a `guard` — reuse the JWT middleware + `requireRoles("admin")`.

```ts
import { makeJwtAuthMiddleware, requireRoles } from "tempest-express-sdk";

const app = await createApp({
  configure: (a) => {
    a.use(
      makeAdminRouter(site, {
        prefix: "/admin",
        guard: [makeJwtAuthMiddleware(jwt), requireRoles("admin")] as never,
      }),
    );
  },
});
```

!!! tip "Single guard"
    `guard` accepts one middleware. To chain auth + role, compose them into a
    middleware that runs one after the other, or use an `express.Router()` with
    both `use()` calls before mounting the admin.

## Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/admin` | Brand + resource list |
| `GET` | `/admin/:resource/_meta` | Fields + supported operations |
| `GET` | `/admin/:resource` | Paginated list (`?page=&pageSize=` + filters) |
| `GET` | `/admin/:resource/:id` | Detail (404 when absent) |
| `POST` | `/admin/:resource` | Create (validates `createSchema`) |
| `PATCH` | `/admin/:resource/:id` | Update (validates `updateSchema`) |
| `DELETE` | `/admin/:resource/:id` | Delete (204) |

A missing write op on the resource → **405**; unknown resource → **404**;
invalid payload → **422**.

## Recap

Register resources (callbacks over your services), mount a guarded router, and
any frontend renders the admin from the `_meta` introspection.
