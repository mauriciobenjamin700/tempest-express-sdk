# File downloads and logs

Two operational utilities: serving files with `Range` support (resumable
downloads) and routing logs to per-level files + `500.log`, with a read endpoint.
A port of `utils.download` / `utils.log` / `api.routers.logs`.

---

## 1. Serving downloads (with Range)

`sendFileDownload` streams a file from disk honoring the `Range` header (responds
`206 Partial Content` for partial requests — video, resumable downloads), and
`sendBytesDownload` sends in-memory bytes. `resolveDownloadPath` resolves the
path traversal-safely.

```ts
import {
  resolveDownloadPath,
  sendBytesDownload,
  sendFileDownload,
} from "tempest-express-sdk";

// a file from disk, confined to a root
app.get("/files/:name", async (req, res, next) => {
  try {
    const path = resolveDownloadPath("/srv/uploads", req.params.name);
    await sendFileDownload(req, res, path, { inline: false }); // 200 or 206
  } catch (err) {
    next(err);
  }
});

// in-memory bytes (e.g. a generated PDF)
app.get("/report", (_req, res) => {
  sendBytesDownload(res, pdfBytes, { filename: "report.pdf", contentType: "application/pdf" });
});
```

`inline: true` shows it in the browser (`Content-Disposition: inline`); the
default forces a download (`attachment`). The filename falls back to the file's
basename.

!!! danger "Always resolve client paths with `resolveDownloadPath`"
    Concatenating `req.params` into a path opens the door to `../../etc/passwd`.
    `resolveDownloadPath(root, rel)` normalizes and throws if the result escapes
    the root.

---

## 2. Per-level file logs + `500.log`

By default `JSONLogger` writes JSON to stdout/stderr. `configureFileLogging`
installs a sink that additionally **appends** each record to `<dir>/<level>.log`
(`info.log`, `error.log`, …) and routes records flagged as HTTP 500 (`http_500`)
to a dedicated `500.log` — isolated error triage.

```ts
import { configureFileLogging } from "tempest-express-sdk";

const logs = configureFileLogging({ dir: "logs" });
// ... from here, every JSONLogger.* also goes to the files

// on graceful shutdown:
logs.close(); // removes the sink and closes the streams
```

The SDK error handlers already mark 500 responses with `http_500`, so they land
in `500.log` automatically.

---

## 3. Logs read endpoint

`makeLogsRouter` serves the files paginated (newest first). **Guard it** — it
exposes operational data:

```ts
import { makeLogsRouter } from "tempest-express-sdk";

app.use(
  makeLogsRouter({
    dir: "logs",
    guards: [adminOnly], // your auth middleware
  }),
);
```

`GET /logs?source=all&page=1&pageSize=50`. `source` ∈ `all` / `debug` / `info` /
`warning` / `error` / `500`. Returns `{ items, total, page, pageSize, pages }`;
pair with `logEntrySchema` to type each item.

---

## Recap

- `sendFileDownload` (Range/206) and `sendBytesDownload`; `resolveDownloadPath`
  against traversal.
- `configureFileLogging({ dir })` → per-level + `500.log`; `close()` on shutdown.
- `makeLogsRouter({ dir, guards })` → paginated read. ✅
