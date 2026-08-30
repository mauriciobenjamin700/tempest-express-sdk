# CLAUDE.md — tempest-express-sdk

Regras deste repositório. As regras globais de `~/.claude/CLAUDE.md` continuam
valendo; o que está aqui é o que é **específico deste pacote** ou o que
contradiz o default global.

> **Este repo é um pacote publicado no npm, não um serviço.** As regras de
> layout de serviço FastAPI (`~/.claude/rules/service-layout.md`) **não se
> aplicam** — não existe `main.py`, `server.py`, router/controller/service como
> estrutura do repo. Elas descrevem o que o SDK *ajuda a construir*, não o que o
> SDK *é*.

## Não existe CI

O único workflow é `.github/workflows/docs.yml`, e ele só builda o site no push
para `main`. **Nada roda teste, type-check, lint ou build automaticamente.**
Nenhum PR é barrado por estar quebrado.

Logo: **o gate é você.** Rodar os comandos abaixo não é zelo extra, é a única
verificação que existe. "Parece certo" não substitui — as duas issues corrigidas
neste pacote (#2 e #4) passavam no `tsc` e respondiam 200.

## Gate obrigatório

Antes de reportar qualquer tarefa como concluída:

```bash
npm run check    # lint → type-check → testes → build. Tudo tem que sair verde.
```

Mexeu em `docs/` ou `mkdocs.yml` — **também**:

```bash
npm run docs:check    # mkdocs build --strict + auditoria de âncora
```

O `docs:check-anchors` existe porque o `mkdocs --strict` **não pega link com
âncora quebrada**: página inexistente é warning, mas âncora inexistente numa
página que existe é reportada só como `INFO`, e o build passa verde. O script
varre o `site/` buildado e resolve todo `href` com fragmento contra os `id` reais
da página de destino. Já pegou dois links mortos que o `--strict` deixou passar.

### O que os comandos não cobrem

- **Comportamento em runtime.** `tsc` verde não diz nada sobre o que o endpoint
  responde. Mudança em schema, parsing, coerção ou middleware é verificada com
  requisição HTTP de verdade (veja "Verificação de consumidor" abaixo).
- **A experiência de quem instala.** Nenhum teste do repo instala o pacote.

## Verificação de consumidor

Mudança que afeta **superfície pública, dependência, formato de saída ou o que
vai no tarball** é verificada instalando o pacote num projeto limpo — não só
rodando a suíte:

```bash
npm pack --pack-destination /tmp
mkdir /tmp/consumer && cd /tmp/consumer && npm init -y
npm install zod@^4 express@^5 /tmp/tempest-express-sdk-<versão>.tgz
npm ls zod                 # tem que sair UMA instância, marcada `deduped`
node -e '...'              # o repro/uso real, em ESM e em CJS
```

Isso não é ritual. A issue #2 era invisível de dentro do repo: a suíte passava
porque o repo tem uma instância só de `zod`; o bug só existia no `node_modules`
de quem instalava.

Para mudança de comportamento HTTP, suba o `createApp` no projeto de teste e
bata na rota com `fetch`, conferindo status **e** corpo — inclusive o caminho de
erro (422, 404).

## Invariantes que não podem regredir

### `zod` é peer dependency, nunca dependency

```jsonc
"peerDependencies": { "zod": "^4.0.0" }   // ✅
"dependencies":     { "zod": "..." }      // ❌ nunca
```

`zod-to-openapi` adiciona o `.openapi()` **por patch de protótipo**. Com duas
instâncias de `zod` no `node_modules` — que é o que acontece quando o SDK traz a
própria cópia — ele patcheia a instância errada, e o registry OpenAPI rejeita
todo schema do consumidor (`TypeError: zodSchema.openapi is not a function`).
Uma instância compartilhada é requisito, não preferência. Guardado por
`tests/zod-instance.test.ts`. Histórico completo em `docs/migration/zod-4.md`.

O mesmo raciocínio vale para qualquer lib que dependa de identidade de
instância ou de patch de protótipo: vai como peer.

### Nunca `z.coerce.boolean()`

É `Boolean(input)`: toda string não-vazia vira `true`, `"false"` e `"0"`
incluídos. Em query string e variável de ambiente — onde tudo chega como
string — isso torna `false` **impossível de mandar**.

```ts
z.coerce.boolean().default(true)   // ❌ ?flag=false vira true
looseBoolean(true)                 // ✅
```

`looseBoolean` (em `src/schemas/fields.ts`, exportado como `envBoolean` pelos
settings) lê os tokens dos dois lados, trata vazio como ausente e **recusa** o
que não reconhece, para um typo virar erro em vez de `false` silencioso. É uma
implementação só de propósito: duas listas de token divergem, e foi exatamente
essa divergência que deixou o defeito da issue #4 existir nos filtros e não nos
settings.

`coerceFlag` (`src/flags/backends.ts`) é a exceção deliberada: resolve valor de
backend remoto de feature flag, onde levantar exceção em vez de cair para
"desligado" seria a decisão errada.

### O alias `@` mora em três arquivos

`@/x` → `src/x` está configurado em **`tsconfig.json`** (`paths`),
**`tsup.config.ts`** (`esbuildOptions.alias`, porque o esbuild não lê o
`tsconfig`) e **`vitest.config.ts`** (`resolve.alias`). Import quebrado só no
build, ou só no teste, quase sempre é um dos três desatualizado.

### Coleção vazia é `[]`, e o barrel re-exporta com `as`

Regras globais que este pacote leva a sério porque é publicado: `__init__`-like
barrels (`src/*/index.ts`) re-exportam **tudo** que é público e ficam em dia; sem
o `export { X as X }` / lista explícita, o consumidor em strict mode acusa
"private import usage". Símbolo novo em `src/schemas/foo.ts` só é público depois
de entrar em `src/schemas/index.ts`.

## Documentação

Site MkDocs bilíngue em `docs/`, PT-BR default + EN-US, publicado no Pages.

- **Toda página tem os dois arquivos**: `<page>.md` e `<page>.en.md`. Só um dos
  dois é doc pela metade.
- **`mkdocs.yml` tem dois lugares para mexer**: o bloco `nav:` (caminho PT) e
  `nav_translations:` dentro do locale `en`. Página nova sem entrada nos dois
  aparece sem título traduzido.
- **Link entre páginas usa o nome base** (`fields.md#ancora`), nunca
  `fields.en.md` — o plugin i18n reescreve sozinho.
- **Âncora de heading**: confira no HTML **buildado**, não no markdown. Rode
  `npm run docs:check`.
- Estilo: padrão FastAPI (tiangolo) — tutorial progressivo, exemplo completo e
  executável, admonition, recap. Detalhe em `~/.claude/rules/docs-standard.md`.

Mudança **docs-only** (`docs/`, `README.md`, redação de docstring sem delta de
assinatura) não bumpa versão, não entra no `CHANGELOG.md` e não ganha tag —
commit `docs:` direto na `main`.

## Autorização permanente: trabalho de issue vai até o npm

**Trabalho que fecha issue deste repo está autorizado a seguir até o fim sem
perguntar** — merge do PR e `npm publish` incluídos. Não pare no "abri o PR,
mergeio?"; termine e reporte o que foi publicado.

"Ao finalizar" é a checklist de release abaixo cumprida, não "o código parece
pronto". Concretamente: `npm run check` e `npm run docs:check` verdes,
verificação de consumidor com o tarball passando, changelog nos três arquivos,
versão nos dois. Gate vermelho significa que a tarefa não acabou — aí para e
conta o que quebrou, porque publicar é irreversível e `npm unpublish` só existe
por 72h e só sem dependente.

Fora dessa autorização, e continua valendo perguntar: apagar versão publicada,
`--force` em push, mexer em configuração do repositório, ou qualquer coisa que
o trabalho da issue não implicava.

## Release

Qualquer coisa que toque código entregue segue o fluxo inteiro. Ordem:

1. **Versão em dois arquivos, sempre juntos**: `package.json` e
   `src/version.ts` (`VERSION`). Depois `npm install --package-lock-only` para o
   lock acompanhar. O pin do scaffold do CLI é **derivado** do `VERSION` — não
   existe terceiro lugar para atualizar, e não pode voltar a existir.
2. **Changelog em três arquivos**: `CHANGELOG.md` (EN),
   `docs/changelog.en.md` (EN) e `docs/changelog.md` (PT-BR). Entrada
   `## [X.Y.Z] — YYYY-MM-DD`, com o **porquê** da mudança, não só o quê.
3. `npm run check` e `npm run docs:check` verdes.
4. Verificação de consumidor com o tarball (seção acima).
5. PR no template global (`~/.claude/rules/git-pr.md`), em PT-BR, com
   `Closes #N` **em inglês** e em linha própria.
6. Merge, depois `git tag -a vX.Y.Z` e `git push origin vX.Y.Z`.
7. `npm publish --access public`.

### Versionamento

O pacote está em `0.x`: **breaking change vai em minor** (`0.21.0` trocou o
`zod` para peer; `0.22.0` mudou o parse de booleano). Breaking de comportamento
— resposta que muda sem a assinatura mudar — conta como breaking e vai na
**NOTA** do PR e no CHANGELOG com o rótulo explícito.

### Depois do `npm publish`

O registry leva **alguns minutos** para servir a versão nova; `npm view` logo
depois ainda mostra a anterior, e isso não é erro. Confirme direto na origem,
com um loop, antes de dizer que publicou:

```bash
until curl -s https://registry.npmjs.org/tempest-express-sdk | grep -q '"X.Y.Z"'; do sleep 10; done
```

Depois instale do registry (não do tarball) e rode o uso real uma última vez.

## Layout

Pacote flat, sem wrapper `src/` de serviço — `src/` **é** o pacote.

| Diretório | O que tem |
| --- | --- |
| `src/schemas` | `z` aumentado, `baseResponseSchema`, `toDict`, paginação (offset/cursor/delta-sync), campos validados, `looseBoolean` |
| `src/settings` | `loadSettings`, fragmentos por domínio (`jwtSettingsShape`, …), `envBoolean`/`envList` |
| `src/api` | `createApp`, `runServer`, handlers de erro, registry OpenAPI, Swagger + Redoc, middlewares |
| `src/db` | re-export do `tempest-db-js` + `BaseModel`, outbox, audit, tenant, backup |
| `src/auth` | `UserAuthService`, middleware JWT, MFA, ativação, reset de senha |
| `src/exceptions` | `AppException` + subclasses, i18n de mensagem |
| `src/cli` | `tempest-express new/generate/config/user` e o template do scaffold |
| `src/{cache,queue,tasks,sse,websockets,flags,storage,webpush,integrations,admin,testing,utils,core}` | resto da superfície |
| `tests/` | 27 arquivos, vitest, SQLite in-memory; serviço externo mockado |
| `scripts/` | ferramenta de gate (não vai no tarball — `files: ["dist"]`) |

Peer dependencies **obrigatórias**: `tempest-db-js`, `zod`. As demais
(`amqplib`, `bcryptjs`, `jsonwebtoken`, `minio`, `nodemailer`, `web-push`, `ws`)
são opcionais e carregadas sob demanda — `import "tempest-express-sdk"` não pode
exigir nenhuma delas.
