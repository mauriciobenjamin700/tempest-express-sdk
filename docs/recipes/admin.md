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

## Recapitulando

1. `BaseUserModel` + uma linha `isAdmin` semeada dá o login.
2. `AdminSite` + `AdminModel` (ou `automap`) diz o que é gerenciável.
3. `makeAdminRouter(site, { engine, authBackend, secretKey })` monta o painel.
4. Widget, filtro e validação saem das **colunas do model** — não há schema
   duplicado para manter em sincronia.
