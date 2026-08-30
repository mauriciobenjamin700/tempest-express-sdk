# Migrating to zod 4

As of **v0.21.0** the SDK requires **zod 4** and declares `zod` as a **peer
dependency**. This page shows what changes in your project, why the change had
to happen, and how to diagnose the error it fixes.

!!! danger "Breaking change"
    Projects on `zod@^3` do **not** run on v0.21.0. Either move up to `zod@^4`,
    or stay on `tempest-express-sdk@0.20.1`.

---

## 1. What to do (short version)

```bash
npm install tempest-express-sdk@^0.21.0 zod@^4
```

After that, `npm ls zod` must show a **single** instance:

```
├─┬ tempest-express-sdk@0.21.0
│ └── zod@4.5.4 deduped
└── zod@4.5.4
```

If you see more than one `zod@…` line without `deduped`, delete `node_modules`
and `package-lock.json` and install again.

---

## 2. The symptom this fixes

Before v0.21.0 `zod` was a **direct dependency** of the SDK. In a zod 4 project
npm installed both versions side by side:

```
├─┬ tempest-express-sdk@0.20.1
│ ├─┬ @asteasolutions/zod-to-openapi@7.3.4
│ │ └── zod@3.25.76 deduped
│ └── zod@3.25.76      ← the SDK's copy
└── zod@4.5.4          ← yours
```

And registering one of your schemas on the SDK's registry failed:

```ts
import { OpenAPIRegistry } from "tempest-express-sdk";
import { z } from "zod";

const registry = new OpenAPIRegistry();
registry.register("SendText", z.object({ to: z.string(), text: z.string() }));
```

```
TypeError: zodSchema.openapi is not a function
```

!!! info "Why that happened"
    `zod-to-openapi` adds `.openapi()` **by patching the prototype**
    (`extendZodWithOpenApi`). With two instances it patched the SDK's zod 3
    `ZodType` — your schema, built by zod 4, never saw the method. Patching your
    instance by hand got past that error and died on the next step, at
    `UnknownZodTypeError: Unknown zod object type`, because the v7 generator
    cannot read zod 4's internals.

**A peer dependency resolves at the root:** there is exactly one instance, yours,
and both the prototype patch and `instanceof ZodType` cross the boundary between
the SDK and your code.

---

## 3. You can now import `z` from either place

Before, importing straight from `"zod"` broke `.openapi()`. Now both forms point
at the **same object**:

=== "From the SDK (recommended)"

    ```ts
    import { z } from "tempest-express-sdk";

    export const itemSchema = z.object({
      name: z.string().openapi({ description: "The item name." }),
    });
    ```

=== "From zod (also works)"

    ```ts
    import "tempest-express-sdk";
    import { z } from "zod";

    export const itemSchema = z.object({
      name: z.string().openapi({ description: "The item name." }),
    });
    ```

!!! tip "Keep importing from the SDK"
    The SDK form guarantees the patch already ran — it happens when
    `tempest-express-sdk` is loaded. Importing from `"zod"` directly makes you
    depend on some SDK import having happened first, which is easy to break
    without noticing.

---

## 4. API renames in zod 4

zod 4 moved the string formats to the top level and tightened `z.record`'s
signature. The old forms still **parse** (they are deprecated), so nothing breaks
immediately — but migrate, because they go away in zod 5:

| zod 3 | zod 4 |
| --- | --- |
| `z.string().uuid()` | `z.uuid()` |
| `z.string().email()` | `z.email()` |
| `z.string().url()` | `z.url()` |
| `z.string().datetime()` | `z.iso.datetime()` |
| `z.record(z.unknown())` | `z.record(z.string(), z.unknown())` |
| `.passthrough()` | `.loose()` |
| `z.ZodTypeAny` | `z.ZodType` |

!!! warning "`z.record` is the only one that breaks type-checking"
    Single-argument `z.record` merely loses its type overload — `tsc` reports
    `Expected 2-3 arguments, but got 1`. The other rows pass with a deprecation
    notice.

!!! warning "Emails with a one-letter TLD are now invalid"
    zod 4's email regex is stricter: `a@b.c` was accepted in zod 3 and is
    rejected now. If a test of yours uses a toy address, swap it for something
    like `user@example.com`.

---

## 5. What changed inside the SDK

Public signatures that mentioned `z.ZodTypeAny` now say `z.ZodType` —
`paginationSchema`, `cursorPaginationSchema`, `syncPaginationSchema`,
`loadSettings` and `AdminResource`'s `createSchema`/`updateSchema`. `ZodTypeAny`
is just a deprecated alias of `ZodType` in zod 4, so code passing a schema keeps
compiling unchanged.

The built-in schemas (`baseResponseSchema`, `webPushSubscriptionSchema`,
`logEntrySchema`, the auth schemas) were rewritten in zod 4 idioms. The OpenAPI
shape they emit is the same.

---

## 6. If you can't move to zod 4 yet

Stay on `0.20.1` with an explicit pin:

```json
{
  "dependencies": {
    "tempest-express-sdk": "0.20.1",
    "zod": "^3.24.1"
  }
}
```

0.20.x gets no new features. zod 4 is the supported path.

---

## Recap

- `npm install tempest-express-sdk@^0.21.0 zod@^4` — `zod` is a **peer** now, and
  you are the one who installs it. ✅
- `npm ls zod` must show **one** instance; two was exactly the bug.
- `zodSchema.openapi is not a function` and `UnknownZodTypeError` were the two
  symptoms of the duplicate instance.
- `z.uuid()` / `z.email()` / `z.url()` / `z.record(k, v)` / `.loose()` are the new
  idioms; only single-argument `z.record` breaks `tsc`.
- Keep importing `z` from `tempest-express-sdk` — that import is what guarantees
  the `.openapi()` patch.
