# Downloads e logs em arquivo

Dois utilitários operacionais: servir arquivos com suporte a `Range` (downloads
resumíveis) e rotear os logs para arquivos por nível + `500.log`, com um endpoint
de leitura. Porte de `utils.download` / `utils.log` / `api.routers.logs`.

---

## 1. Servir downloads (com Range)

`sendFileDownload` transmite um arquivo do disco respeitando o header `Range`
(responde `206 Partial Content` para pedidos parciais — vídeo, retomar
download), e `sendBytesDownload` envia bytes em memória. `resolveDownloadPath`
resolve o caminho de forma segura contra traversal.

```ts
import {
  resolveDownloadPath,
  sendBytesDownload,
  sendFileDownload,
} from "tempest-express-sdk";

// arquivo do disco, confinado a uma raiz
app.get("/files/:name", async (req, res, next) => {
  try {
    const path = resolveDownloadPath("/srv/uploads", req.params.name);
    await sendFileDownload(req, res, path, { inline: false }); // 200 ou 206
  } catch (err) {
    next(err);
  }
});

// bytes em memória (ex.: um PDF gerado)
app.get("/report", (_req, res) => {
  sendBytesDownload(res, pdfBytes, { filename: "relatorio.pdf", contentType: "application/pdf" });
});
```

`inline: true` mostra no navegador (`Content-Disposition: inline`); o padrão
força o download (`attachment`). O nome cai para o basename do arquivo.

!!! danger "Sempre resolva caminhos vindos do cliente com `resolveDownloadPath`"
    Concatenar `req.params` num caminho abre porta para `../../etc/passwd`.
    `resolveDownloadPath(root, rel)` normaliza e lança se o resultado escapar da
    raiz.

---

## 2. Logs em arquivo por nível + `500.log`

Por padrão o `JSONLogger` escreve JSON no stdout/stderr. `configureFileLogging`
instala um sink que, além disso, **anexa** cada registro a `<dir>/<nível>.log`
(`info.log`, `error.log`, …) e roteia os registros marcados como HTTP 500
(`http_500`) para um `500.log` dedicado — triagem de erro isolada.

```ts
import { configureFileLogging } from "tempest-express-sdk";

const logs = configureFileLogging({ dir: "logs" });
// ... a partir daqui, todo JSONLogger.* também vai para os arquivos

// no shutdown gracioso:
logs.close(); // remove o sink e fecha os streams
```

Os handlers de erro do SDK já marcam respostas 500 com `http_500`, então elas
caem no `500.log` automaticamente.

---

## 3. Endpoint de leitura dos logs

`makeLogsRouter` serve os arquivos paginados (mais novos primeiro). **Proteja-o**
— expõe dados operacionais:

```ts
import { makeLogsRouter } from "tempest-express-sdk";

app.use(
  makeLogsRouter({
    dir: "logs",
    guards: [adminOnly], // seu middleware de auth
  }),
);
```

`GET /logs?source=all&page=1&pageSize=50`. `source` ∈ `all` / `debug` / `info` /
`warning` / `error` / `500`. Devolve `{ items, total, page, pageSize, pages }`;
combine com `logEntrySchema` para tipar cada item.

---

## Recapitulando

- `sendFileDownload` (Range/206) e `sendBytesDownload`; `resolveDownloadPath`
  contra traversal.
- `configureFileLogging({ dir })` → per-nível + `500.log`; `close()` no shutdown.
- `makeLogsRouter({ dir, guards })` → leitura paginada. ✅
