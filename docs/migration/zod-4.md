# Migração para zod 4

A partir da **v0.21.0** o SDK exige **zod 4** e passa a declarar o `zod` como
**peer dependency**. Esta página mostra o que muda no seu projeto, por que a
mudança precisou acontecer e como diagnosticar o erro que ela conserta.

!!! danger "Breaking change"
    Projetos em `zod@^3` **não** rodam na v0.21.0. Ou você sobe para `zod@^4`,
    ou fica na `tempest-express-sdk@0.20.1`.

---

## 1. O que fazer (versão curta)

```bash
npm install tempest-express-sdk@^0.21.0 zod@^4
```

Depois disso, `npm ls zod` precisa mostrar **uma única** instância:

```
├─┬ tempest-express-sdk@0.21.0
│ └── zod@4.5.4 deduped
└── zod@4.5.4
```

Se aparecer mais de uma linha `zod@…` sem o `deduped`, apague `node_modules` e
o `package-lock.json` e instale de novo.

---

## 2. O sintoma que isso conserta

Antes da v0.21.0 o `zod` era uma **dependency direta** do SDK. Num projeto em
zod 4 o npm instalava as duas versões lado a lado:

```
├─┬ tempest-express-sdk@0.20.1
│ ├─┬ @asteasolutions/zod-to-openapi@7.3.4
│ │ └── zod@3.25.76 deduped
│ └── zod@3.25.76      ← a cópia do SDK
└── zod@4.5.4          ← a sua
```

E aí registrar um schema seu no registry do SDK falhava:

```ts
import { OpenAPIRegistry } from "tempest-express-sdk";
import { z } from "zod";

const registry = new OpenAPIRegistry();
registry.register("SendText", z.object({ to: z.string(), text: z.string() }));
```

```
TypeError: zodSchema.openapi is not a function
```

!!! info "Por que dava isso"
    O `zod-to-openapi` adiciona o `.openapi()` **por patch de protótipo**
    (`extendZodWithOpenApi`). Com duas instâncias, ele patcheava o `ZodType` do
    zod 3 do SDK — o seu schema, criado pelo zod 4, nunca via o método. Patchear
    a instância do projeto à mão passava desse erro e morria no passo seguinte,
    em `UnknownZodTypeError: Unknown zod object type`, porque o generator do v7
    não sabe ler o interno do zod 4.

**Peer dependency resolve na raiz:** existe uma instância só, sua, e tanto o
patch de protótipo quanto o `instanceof ZodType` atravessam a fronteira entre o
SDK e o seu código.

---

## 3. Agora você pode importar `z` dos dois lugares

Antes, importar de `"zod"` direto quebrava o `.openapi()`. Agora as duas formas
apontam para o **mesmo objeto**:

=== "Do SDK (recomendado)"

    ```ts
    import { z } from "tempest-express-sdk";

    export const itemSchema = z.object({
      name: z.string().openapi({ description: "O nome do item." }),
    });
    ```

=== "Do zod (também funciona)"

    ```ts
    import "tempest-express-sdk";
    import { z } from "zod";

    export const itemSchema = z.object({
      name: z.string().openapi({ description: "O nome do item." }),
    });
    ```

!!! tip "Continue importando do SDK"
    A forma do SDK garante que o patch já rodou — ele acontece quando
    `tempest-express-sdk` é carregado. Importando de `"zod"` direto, você depende
    de algum import do SDK ter acontecido antes, o que é fácil de quebrar sem
    perceber.

---

## 4. Renomes de API no zod 4

O zod 4 moveu os formatos de string para o topo e apertou a assinatura de
`z.record`. As formas antigas ainda **parseiam** (ficaram deprecated), então
nada quebra de imediato — mas migre, porque elas somem no zod 5:

| zod 3 | zod 4 |
| --- | --- |
| `z.string().uuid()` | `z.uuid()` |
| `z.string().email()` | `z.email()` |
| `z.string().url()` | `z.url()` |
| `z.string().datetime()` | `z.iso.datetime()` |
| `z.record(z.unknown())` | `z.record(z.string(), z.unknown())` |
| `.passthrough()` | `.loose()` |
| `z.ZodTypeAny` | `z.ZodType` |

!!! warning "`z.record` é a única que quebra o type-check"
    O `z.record` de um argumento só perde a sobrecarga de tipo — o
    `tsc` acusa `Expected 2-3 arguments, but got 1`. As outras linhas da tabela
    passam com aviso de deprecation.

!!! warning "E-mail com TLD de uma letra passou a ser inválido"
    O regex de e-mail do zod 4 é mais estrito: `a@b.c` era aceito no zod 3 e é
    rejeitado agora. Se algum teste seu usa endereço de brinquedo, troque por
    algo como `user@example.com`.

---

## 5. O que mudou dentro do SDK

Assinaturas públicas que citavam `z.ZodTypeAny` agora citam `z.ZodType` —
`paginationSchema`, `cursorPaginationSchema`, `syncPaginationSchema`,
`loadSettings` e o `createSchema`/`updateSchema` do `AdminResource`. `ZodTypeAny`
é apenas um alias deprecated de `ZodType` no zod 4, então código que passa um
schema continua compilando sem mudança.

Os schemas embutidos (`baseResponseSchema`, `webPushSubscriptionSchema`,
`logEntrySchema`, os schemas de auth) foram reescritos nos idiomas do zod 4. O
formato que eles emitem no OpenAPI é o mesmo.

---

## 6. Se você não pode subir para zod 4 agora

Fique na `0.20.1` e pin explícito:

```json
{
  "dependencies": {
    "tempest-express-sdk": "0.20.1",
    "zod": "^3.24.1"
  }
}
```

A 0.20.x não recebe feature nova. O caminho suportado é o zod 4.

---

## Recapitulando

- `npm install tempest-express-sdk@^0.21.0 zod@^4` — o `zod` agora é **peer**, e
  quem instala é você. ✅
- `npm ls zod` tem que mostrar **uma** instância; duas era exatamente o bug.
- `zodSchema.openapi is not a function` e `UnknownZodTypeError` eram os dois
  sintomas da instância dupla.
- `z.uuid()` / `z.email()` / `z.url()` / `z.record(k, v)` / `.loose()` são os
  idiomas novos; só o `z.record` de um argumento quebra o `tsc`.
- Continue importando `z` de `tempest-express-sdk` — é o import que garante o
  patch do `.openapi()`.
