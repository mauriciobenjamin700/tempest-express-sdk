# Painel admin

Um painel de gerenciamento **server-rendered** montado sob `/admin`, no estilo
do Django admin. O operador entra com uma linha do seu próprio banco — não há
store de senha separado —, e cada model registrado passa a ser navegável pelo
navegador: dashboard, listagem com busca/filtro/ordenação, e formulários de
criar/editar/excluir derivados das colunas.

**O que você ganha:**

- 🔐 Login por sessão em cookie assinado, com CSRF em toda escrita.
- 📊 Dashboard com contagem de linhas por model e painel de CPU/memória.
- 🔎 List view com busca, filtros por tipo de coluna e colunas ordenáveis.
- ✍️ CRUD com widget derivado do tipo da coluna e erro por campo.
- 📱 Responsivo, sem JavaScript de framework e sem asset externo.
- 🎨 Tema tipado (`AdminTheme`) — cor, logo, favicon, fonte, dark mode.

!!! info "Sem dependência nova"
    O painel roda sobre o que o SDK já tem: `tempest-db-js` para os models,
    `PasswordUtils` para a senha, `node:crypto` para assinar a sessão. O HTML e
    o CSS são strings deste pacote, então não há template engine para instalar
    nem arquivo estático para servir.

Precisa da API headless em vez das telas prontas? Veja
[Admin headless (API JSON)](admin-json.md).

## 1. O model de usuário

Estenda `BaseUserModel` para ganhar as colunas que o backend de auth do painel
espera (`email`, `hashedPassword`, `isAdmin`, `lastLoginAt`) por cima do
`BaseModel`:

```ts
import { BaseUserModel, column, tableNameFor } from "tempest-express-sdk";

export class UserModel extends BaseUserModel {
  static override tablename = tableNameFor("UserModel"); // "user"
  name = column.varchar(120).notNull();
}
```

Só linhas com `isActive === true` **e** `isAdmin === true` entram. O primeiro
admin vem de um script de seed — o mesmo ciclo de sessão que seus repositories
já usam:

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

## 2. Registre seus models

`AdminModel` é uma instância de configuração tipada — o objeto de opções é o
contrato, sem mágica de metaclasse. Os defaults já funcionam; passe os campos
que quiser para enriquecer a listagem:

```ts
import { AdminModel, AdminSite } from "tempest-express-sdk";

import { OrderModel, UserModel } from "./db/models";

export const site = new AdminSite({
  title: "MyApp Admin",
  brand: "myapp-admin",          // texto centralizado no topo (default: title)
  indexSubtitle: "Site administration",
  siteUrl: "https://myapp.com",  // link "View site" opcional no header
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

O slug sai do `tablename` do model, então URL e tabela ficam em sincronia.
`register` também aceita as opções direto (`site.register({ model: OrderModel })`)
e lança se dois models disputarem o mesmo slug.

!!! tip "Filtros automáticos por tipo de coluna"
    Cada campo em `listFilter` vira o widget certo conforme o tipo da coluna:
    **boolean** → dropdown Sim/Não; **enum** → dropdown com os membros;
    **date/datetime** → dois inputs de data (de/até); qualquer outra coluna →
    input de texto (igualdade). Tudo preserva busca, ordenação e paginação
    na URL.

### Atalho: registrar tudo de uma vez (`automap`)

Aponte o `automap` para o barrel dos models e todo model concreto é registrado
com os defaults. Bases abstratas (`BaseModel`, `BaseUserModel` — sem
`tablename`) são puladas sozinhas:

```ts
import * as models from "./db/models";

site.automap(models);
```

Misture os dois estilos: registre à mão o que precisa de config própria, depois
deixe o `automap` preencher o resto — por padrão ele pula slugs já registrados:

```ts
site.register(new AdminModel({ model: UserModel, searchFields: ["email"] }));
site.automap(models, { exclude: ["audit_log"], pageSize: 50 });
```

`automap` aceita um array de classes (`site.automap([UserModel, OrderModel])`),
`exclude` (classe ou nome de tabela), `skipRegistered: false` para transformar
colisão em erro, e qualquer opção de `AdminModel` aplicada uniformemente.

## 3. Monte o router

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
        secretKey: settings.JWT_SECRET,   // pelo menos 32 caracteres
        prefix: "/admin",
        cookieSecure: !settings.DEBUG,    // true em produção HTTPS
      }),
    );
  },
});
```

`makeAdminRouter` monta:

| Rota | O que faz |
|---|---|
| `GET /admin/login` · `POST /admin/login` | Fluxo de entrada |
| `GET /admin/mfa` · `POST /admin/mfa` | Desafio TOTP (backends com MFA) |
| `POST /admin/logout` | Encerra a sessão |
| `GET /admin/` | Dashboard: contagem por model + CPU/memória |
| `GET /admin/m/{slug}` | List view: busca, filtros, ordenação, paginação |
| `POST /admin/m/{slug}/bulk` | Ações em massa nas linhas marcadas |
| `GET /admin/m/{slug}/export.csv` · `.json` | Export do resultado atual |
| `GET/POST /admin/m/{slug}/new` | Criar (quando `canCreate`) |
| `GET /admin/m/{slug}/{id}` | Detalhe, com Edit/Delete |
| `GET/POST /admin/m/{slug}/{id}/edit` | Editar (quando `canEdit`) |
| `POST /admin/m/{slug}/{id}/delete` | Excluir (quando `canDelete`) |
| `GET /admin/static/admin.css` | A folha de estilo embutida |

!!! danger "`secretKey` é o que separa um operador de um invasor"
    A sessão é **stateless**: id do principal, nome, token CSRF e expiração
    viajam no cookie, assinados com HMAC-SHA256 sobre essa chave. Ela precisa
    ter no mínimo 32 caracteres (o construtor recusa menos), vir do ambiente e
    nunca ir para o repositório. Trocar a chave desloga todo mundo — que é
    exatamente o que você quer se ela vazar.

!!! info "Escrita (CRUD) e permissões"
    Create/edit/delete são controlados por `canCreate` / `canEdit` /
    `canDelete` no `AdminModel` (todas `true` por default; uma view desligada
    responde `404` e some da UI). Todo POST carrega o token CSRF da sessão,
    validado no servidor (`403` em mismatch). Os **widgets** são derivados do
    tipo da coluna — texto / textarea (string longa) / number / checkbox /
    `datetime-local` / date / time / `select` para enum / textarea JSON — com
    validação de obrigatórios e erro por campo re-renderizado no formulário.
    Escrita que o **banco** recusa (unique, FK, `NOT NULL`) volta pelo mesmo
    caminho: `400` com a mensagem no topo do form, nunca `500`.

## 4. Segundo fator (opcional)

Um principal que habilitou TOTP passa por `/admin/mfa` depois da senha — o
painel nunca vira a porta mais fraca de uma conta protegida por MFA. Ligue
passando um verificador ao backend:

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

Sem `mfa`, o backend declara que não tem segundo fator e toda senha correta
completa o login.

## 5. Tema

Todo knob é um campo tipado, injetado como custom property CSS:

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

Para o que os campos não cobrem, aponte `customCssUrl` para a sua folha — ela é
linkada por último e sobrescreve tudo.

!!! warning "Valor de tema é validado"
    `<`, `>`, `{`, `}` e `"` são recusados na construção: eles quebrariam o
    bloco `<style>` injetado. É defeito de configuração, então falha alto em
    vez de gerar markup corrompido.

!!! tip "Navegação por sidebar + burger"
    Toda página autenticada tem uma sidebar: Dashboard e um link por model
    registrado, com o item atual destacado. No desktop ela fica sempre visível;
    no mobile (≤768px) vira off-canvas, aberta pelo ícone burger e fechada
    tocando no scrim — CSS puro, sem JS.

## 6. Ações em massa

A list view mostra um checkbox por linha, um "selecionar tudo" e uma barra de
ação que opera nas linhas marcadas. Três ações já vêm prontas — **Activate**,
**Deactivate** (quando `canEdit` e o model tem a coluna `isActive`) e
**Delete** (quando `canDelete`) — e cada uma volta com um banner dizendo quantas
linhas mudaram.

### Ações customizadas

Qualquer coisa específica do domínio — "enviar boas-vindas", "marcar como
enviado", "recalcular totais" — é uma **ação customizada**: um handler criado
com `adminAction` e passado em `AdminModel({ actions: [...] })`.

```ts
import { AdminModel, adminAction } from "tempest-express-sdk";

import { site } from "./site";
import { OrderModel } from "../db/models";
import { mailer } from "../core/email";

const markPaid = adminAction({ label: "Marcar como pago" }, async (ctx) => {
  const changed = await ctx.repository.update(
    { id: { in: ctx.ids } },
    { status: "paid" },
  );
  return { message: `${changed} pedido(s) marcado(s) como pago.` };
});

const notifyCustomers = adminAction(
  { label: "Avisar clientes", dangerous: false },
  async (ctx) => {
    const orders = await ctx.repository.list({ id: { in: ctx.ids } });
    for (const order of orders) await mailer.send(order.email, "Seu pedido");
    return { message: `${orders.length} e-mails enviados.` };
  },
);

site.register(
  new AdminModel({ model: OrderModel, actions: [markPaid, notifyCustomers] }),
);
```

O handler recebe um contexto com:

| Campo | O que é |
| --- | --- |
| `ids` | Identidades das linhas marcadas. |
| `repository` | `BaseRepository` do model, na sessão do request. |
| `dbSession` | A sessão de banco, para trabalho além do repository. |
| `request` | O request inbound. |
| `session` | A sessão do admin autenticado. |
| `principal` | A linha do operador que disparou a ação. |

Retorne `{ message, category }` para exibir um banner (`category` aceita
`"success"` — o default —, `"error"` e `"warning"`), ou `null` para não mostrar
nada. `dangerous: true` marca a ação como destrutiva no dropdown.

!!! tip "O handler continua uma função comum"
    O SDK Python usa um decorator `@admin_action`; aqui `adminAction` **devolve**
    o descritor. O handler fica direto chamável e testável
    (`markPaid.handler(ctx)`), sem sintaxe de decorator para ligar no build de
    quem consome.

!!! info "O nome sai do label"
    O identificador submetido é o slug do label (`"Marcar como pago"` →
    `marcar-como-pago`), namespaced como `custom:<nome>` para nunca colidir com
    uma ação embutida. Passe `name` para fixá-lo — o valor vai no HTML, então
    mudá-lo é mudar a superfície. Dois nomes iguais no mesmo model levantam erro
    na construção.

!!! warning "Exceção no handler vira banner, não 500"
    Uma ação que levanta é registrada no log e volta como banner de erro na list
    view, com a mensagem da exceção. O operador vê o que falhou em vez de uma
    página de erro genérica — mas a mensagem chega ao navegador, então não
    coloque segredo no texto da exceção.

## 7. Export CSV / JSON

Os botões **Export CSV** e **Export JSON** baixam o resultado **atual** —
mesma busca, mesmos filtros, mesma ordenação, mesmas colunas do `listDisplay`:

```text
GET {prefix}/m/{slug}/export.csv?q=...&filter_status=paid&sort=createdAt&dir=desc
GET {prefix}/m/{slug}/export.json?...
```

O CSV segue RFC 4180 (aspas duplicadas, campo entre aspas quando tem vírgula,
aspas ou quebra de linha) e o JSON é um array de objetos coluna→valor. `Date`
vira ISO, `bigint` vira string decimal, binário vira base64.

!!! danger "O teto existe por um motivo"
    Export é varredura de tabela inteira transmitida para um navegador.
    `makeAdminRouter(site, { exportMaxRows: 5000 })` limita quantas linhas saem
    (default `5000`) — é o que impede um clique curioso numa tabela grande de
    virar incidente. Suba o teto conscientemente.

## 8. Select de chave estrangeira

Uma coluna FK cujo model de destino está **registrado no mesmo site** vira um
`<select>` das linhas relacionadas, no formulário e no filtro da listagem, em
vez de um campo de UUID cru. O label da opção sai do primeiro `searchFields` do
admin referenciado; sem ele, de `name` / `title` / `email` / `label` /
`reference`; e por último da identidade.

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

FK para tabela **não registrada** continua input de texto — um dropdown vazio
seria pior que o campo cru. As opções são limitadas a 1000 linhas; acima disso
a tabela de destino pede um campo de busca, não uma lista.

## 9. Controle de acesso por papel

Por padrão todo operador que entra (`isAdmin`) faz tudo que as flags do
`AdminModel` permitem. Para restringir um principal a um subconjunto de models
ou de ações, passe uma `accessPolicy`:

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

A política **compõe** com `canCreate` / `canEdit` / `canDelete`: as duas
precisam permitir. E o painel não mostra porta que responde erro — model sem
`VIEW` some da sidebar e do dashboard, ação sem permissão some do dropdown de
massa, e os botões **+ New**, **Edit** e **Delete** só aparecem quando a
política deixa.

!!! info "404 e 403 querem dizer coisas diferentes"
    Flag desligada responde **404** — aquela view não existe neste painel.
    Política recusando responde **403** — a view existe e este operador não
    pode usá-la. Misturar os dois esconderia configuração errada atrás de um
    "sem permissão".

## 10. Trilha de auditoria

Modelo com as colunas `createdBy` / `updatedBy` (via `createdByColumn()` /
`updatedByColumn()`) é carimbado automaticamente com o id do operador — na
criação e na edição pelo painel. O detail ganha um painel **Audit** com
timestamps e os atores já resolvidos para nome pelo auth backend.

Para ver **o quê** mudou, e não só quem e quando, passe um `auditModel` — a
mesma tabela `BaseAuditLogModel` que seus services já escrevem:

```ts
import { BaseAuditLogModel } from "tempest-express-sdk";

class AuditLogModel extends BaseAuditLogModel {
  static override tablename = "audit_log";
}

site.register(new AdminModel({ model: OrderModel, auditModel: AuditLogModel }));
```

O detail passa a mostrar uma timeline por registro (as 50 entradas mais
recentes): ação, ator, quando, a tabela de diff campo a campo e o `context`
que o escritor gravou. Cada entrada é um `<details>` recolhido, então
histórico longo continua escaneável — e sem JavaScript.

!!! warning "O painel lê a trilha, não escreve"
    `auditModel` só alimenta a tela. Quem grava as linhas é o seu service, com
    `snapshot` / `diffSnapshots`. Registrar o model sem gravar nada deixa a
    timeline vazia — o painel não inventa histórico.

## 11. Cards de métrica no dashboard

Além do painel de CPU/memória, o dashboard aceita **cards de negócio**
calculados do seu próprio banco no carregamento:

```ts
import { metricCard } from "tempest-express-sdk";

const site = new AdminSite({
  title: "Shop",
  dashboardCards: [
    metricCard(
      "Pedidos hoje",
      async (session) => ({
        kind: "value",
        value: await new BaseRepository(OrderModel, session).count({ ... }),
        unit: "pedidos",
      }),
      "Desde a meia-noite",
    ),
    metricCard("Semana vs anterior", async (session) => ({
      kind: "trend",
      value: 18,
      previous: 12,
    })),
    metricCard("Por status", async (session) => ({
      kind: "partition",
      segments: [
        { label: "Pagos", value: 8 },
        { label: "Pendentes", value: 6 },
      ],
    })),
  ],
});
```

Três formatos: `value` (número em destaque), `trend` (▲/▼ com a variação
percentual contra o período anterior) e `partition` (barras por segmento).
`trendPercent` devolve `null` quando o período anterior é zero — porcentagem
contra zero é indefinida, não infinita.

!!! check "Card quebrado não derruba o dashboard"
    Card cujo `compute` levanta é registrado no log e renderiza como
    "Could not compute this metric." — uma query ruim não custa ao operador
    todos os outros números da página.

## 12. Lenses (presets salvos de listagem)

Uma lens junta filtros e ordenação sob um rótulo, e vira aba acima da tabela:

```ts
import { adminLens } from "tempest-express-sdk";

site.register(
  new AdminModel({
    model: TicketModel,
    lenses: [
      adminLens({
        name: "Triage aberta",
        filters: { status: "open", priority: { gte: 3 } },
        orderBy: "-createdAt",
      }),
      adminLens({ name: "Fechados", filters: { status: "closed" } }),
    ],
  }),
);
```

Clicar numa aba aplica `?lens=<slug>`. Os filtros da lens são **ANDados** com o
que o operador digitou, então busca e filtros continuam funcionando por cima
dela; a ordenação da lens vale até o operador clicar num cabeçalho de coluna. A
aba **All** volta para a listagem sem preset, e o `lens` viaja nos links de
paginação, ordenação e export.

## 13. Upload de arquivo e imagem

Uma coluna String que guarda o caminho/chave de um arquivo pode virar **input de
upload**. Liste-a em `uploadFields` e passe um `uploadStorage` — os backends que
o SDK já tem servem:

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

- O formulário vira `multipart/form-data` sozinho quando há campo de upload.
- **Create**: arquivo obrigatório só quando a coluna é `NOT NULL` e sem default.
- **Edit**: sem arquivo novo, mantém o atual (o form mostra `Current: …`); com
  arquivo, substitui.
- A coluna guarda a **chave** do storage (`<slug>/<campo>/<uuid>.<ext>`); use o
  `uploadStorage` depois para servir ou baixar.

!!! info "`busboy` é peer opcional"
    Multipart não vem no Express. O painel usa `busboy` — peer **opcional**, só
    exigido por quem configura `uploadFields` ou `canImport`, e o erro diz o
    comando de instalação. `npm install busboy`. Parser de formato de fio tem
    cauda longa de correção (boundary, transfer encoding, escape de filename):
    é o caso em que se depende em vez de reimplementar.

!!! danger "Teto de upload"
    `makeAdminRouter(site, { maxUploadBytes })` limita o tamanho aceito (default
    10 MB). Arquivo acima do teto volta como erro no formulário, sem escrever
    nada. O arquivo é bufferizado em memória — é o que um painel precisa (um
    operador anexando um documento), não um caminho de ingestão em streaming.

!!! warning "`uploadFields` exige `uploadStorage`"
    Registrar um sem o outro levanta erro na construção do `AdminModel`: sem
    storage não há onde gravar, e falhar no boot é melhor que falhar no primeiro
    upload de produção.

## 14. Import CSV

`canImport: true` (junto de `canCreate`) expõe uma página de import que cria
linhas em massa a partir de um arquivo enviado:

```ts
site.register(new AdminModel({ model: OrderModel, canImport: true }));
```

O arquivo é UTF-8 com header; colunas desconhecidas são ignoradas e as
reconhecidas são as mesmas que o formulário edita. Cada linha passa pela mesma
coerção e validação do formulário, e as que falham voltam numa tabela com o
**número da linha da planilha** (começa em 2, porque a linha 1 é o header) e o
motivo. As que passam são criadas — import parcial é resultado normal, não erro.

!!! tip "O parser respeita a RFC 4180"
    Campo entre aspas pode conter vírgula, quebra de linha e aspas duplicadas, e
    o BOM que o Excel escreve é removido — sem isso o primeiro nome de coluna
    nunca casaria. Import que estraga justamente as linhas que alguém teve o
    trabalho de escapar é pior que import nenhum.

## 15. Autocomplete de chave estrangeira

FK para tabela grande demais para caber num `<select>` vira caixa de busca:

```ts
site.register(
  new AdminModel({
    model: OrderModel,
    autocompleteFields: ["userId"],
  }),
);
```

O campo passa a buscar em `GET {prefix}/m/{slug}/autocomplete/{campo}?q=`, que
consulta os `searchFields` do admin **referenciado** e devolve até 20 opções. Ao
editar, a caixa abre já com o rótulo da linha atual, não com o UUID.

!!! info "Sem CDN"
    O SDK Python usa HTMX de CDN aqui. Este painel usa ~30 linhas de DOM puro,
    porque script de terceiro num console de operador é uma requisição externa
    que deploy fechado não faz e CSP estrita precisa liberar — e o que se
    precisa é um fetch e uma lista.

## 16. Inlines (filhos na tela do pai)

Um `Inline` mostra na tela do pai as linhas filhas que apontam para ele — os
itens de um pedido, as chaves de API de um usuário — sem viagem para outra tela:

```ts
import { AdminModel, adminInline } from "tempest-express-sdk";

site.register(
  new AdminModel({
    model: OrderModel,
    inlines: [
      adminInline({
        model: OrderItemModel,
        fkField: "orderId",
        label: "Itens do pedido",
        editable: true,
        canDelete: true,
      }),
      adminInline({ model: OrderNoteModel, fkField: "orderId" }),
    ],
  }),
);
```

Sem `editable`, o bloco é uma **tabela somente leitura** com link para o admin
do filho e um botão **Add**. Com `editable`, vira um **formset in-place**: uma
linha de inputs por filho, mais uma linha em branco para adicionar outro, tudo
salvo num submit só que faz criação, edição e exclusão de uma vez.

- Formset editável exige o model filho **registrado no mesmo site** e com
  `canEdit`; `canDelete` (no inline **e** no admin do filho) adiciona o checkbox
  de exclusão por linha.
- A linha em branco com todos os campos vazios é ignorada — submeter o formset
  sem preencher o extra não cria filho vazio.
- Linha que falha na validação volta com o que o operador digitou e o erro por
  campo; as outras linhas do mesmo submit são gravadas.

!!! danger "A FK do pai fica fora do formset"
    A coluna que aponta para o pai não é oferecida como campo: o pai daquela
    linha é a página em que ela está. Oferecê-la deixaria o operador mover um
    filho para outro pai digitando um UUID numa célula.

    Mais forte que isso: **toda linha submetida é checada como pertencente
    a este pai** antes de ser editada ou excluída. A chave de linha vem do
    navegador, então uma submissão forjada poderia nomear o filho de outro pai —
    a checagem de posse é o que impede a página de virar superfície de edição da
    tabela inteira.

!!! info "Limite de linhas"
    O bloco renderiza no máximo 50 filhos e diz quantos existem no total. Pai
    com mais filhos que isso quer a listagem do próprio filho com filtro, não
    um formset gigante na página do pai.

## Recapitulando

1. `BaseUserModel` + uma linha `isAdmin` semeada dá o login.
2. `AdminSite` + `AdminModel` (ou `automap`) diz o que é gerenciável.
3. `makeAdminRouter(site, { engine, authBackend, secretKey })` monta o painel.
4. Widget, filtro e validação saem das **colunas do model** — não há schema
   duplicado para manter em sincronia.
5. `actions: [...]` leva a operação do dia a dia para dentro do painel; export e
   FK-select saem de graça do que o model já declara.
6. `accessPolicy` estreita quem faz o quê; `auditModel` responde quem mudou o
   quê; `dashboardCards` e `lenses` levam para o painel os números e as
   consultas que o time repete todo dia.
