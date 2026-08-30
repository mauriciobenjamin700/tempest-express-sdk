# Instalação

## Requisitos

- **Node.js >= 20**
- **TypeScript >= 5.7** (recomendado)
- **zod >= 4** — peer dependency obrigatória (veja abaixo)

## Instalar

```bash
npm install tempest-express-sdk tempest-db-js express zod@^4
```

!!! warning "`zod` precisa ser o **seu** zod, na versão 4"
    Desde a v0.21.0 o `zod` é peer dependency (`^4.0.0`), não dependency do
    SDK — assim existe **uma instância só**, compartilhada por você e por ele.
    É o que faz o `.openapi()` e o `instanceof ZodType` funcionarem através da
    fronteira do pacote. Confira com `npm ls zod`: tem que sair uma linha só,
    marcada `deduped`.

    Vindo da 0.20.x em zod 3? Leia a
    [Migração para zod 4](migration/zod-4.md).

!!! info "Peer dependencies"
    `tempest-db-js` é uma peer dependency **obrigatória** (camada de banco).
    Para autenticação, instale também as peers **opcionais**:

    ```bash
    npm install bcryptjs jsonwebtoken
    ```

    Sem elas o SDK importa normalmente — o erro só aparece quando você
    instancia `PasswordUtils` / `JWTUtils`.

## Criar um projeto do zero

O CLI gera um serviço Express completo, em camadas, já com Swagger + Redoc:

```bash
npx tempest-express new meu-servico
cd meu-servico
npm install
cp .env.example .env
npm run dev
```

## Comandos do CLI

| Comando | O que faz |
| --- | --- |
| `tempest-express new <nome>` | Cria um serviço completo |
| `tempest-express generate <Nome>` | Gera um recurso CRUD (model→router) |
| `tempest-express secret [--bytes 32]` | Gera um segredo aleatório (JWT/token) |
| `tempest-express docker-compose` | Escreve um `docker-compose.yml` (Postgres + Redis) |
| `tempest-express db` | Orientação sobre migrations (via `tempest-db-js`) |
| `tempest-express lint [--dir .]` | Roda o Biome check no projeto |
| `tempest-express config [--dir .]` | Imprime os settings base resolvidos (lê `.env`) |
| `tempest-express user --email <e> --password <p> [--admin]` | Imprime um registro de usuário pronto pra inserir (hash bcrypt) |

## tsconfig recomendado

O SDK e o template usam alias `@` apontando para `src` e **sem** sufixo `.js`:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```
