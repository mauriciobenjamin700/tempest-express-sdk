# Essenciais de JavaScript e TypeScript

Você acabou de instalar o Node.js e nunca escreveu JavaScript? Perfeito. 🚀

Esta página ensina **só o suficiente** para você ler e entender os exemplos do
`tempest-express-sdk`. Não é um curso completo de JavaScript — é uma rampa de
acesso. Cada seção tem um exemplo curtinho que você pode rodar de verdade.

Bora começar!

## 1. Rodando um arquivo

Tudo em JavaScript começa com um arquivo e o comando `node`.

Crie um arquivo chamado `hello.js` com este conteúdo:

```js
console.log("Olá!");
```

Agora rode no terminal:

```bash
node hello.js
```

Saída:

```text
Olá!
```

Foi isso! `console.log(...)` imprime algo na tela. Você vai usar isso o tempo
todo para inspecionar valores.

!!! tip "Dica"
    `console.log` é seu melhor amigo enquanto aprende. Quando estiver na dúvida
    sobre o valor de algo, imprima ele.

## 2. Variáveis: `const` e `let`

Uma variável é um nome que guarda um valor. Existem duas formas de criar:

```js
const nome = "Maria"; // não pode ser reatribuído
let idade = 30;       // pode mudar depois

idade = 31; // ✅ ok, é let
// nome = "João"; // ❌ erro! const não pode ser reatribuído

console.log(nome, idade); // → Maria 31
```

**Prefira sempre `const`.** Use `let` só quando você realmente precisa mudar o
valor depois. Isso deixa seu código mais previsível.

## 3. Tipos básicos de valores

Estes são os valores mais comuns que você vai encontrar:

```js
const texto = "isso é uma string"; // string (texto)
const inteiro = 42;                 // number
const decimal = 3.14;               // number (não há tipo separado)
const ligado = true;                // boolean (true ou false)
const desligado = false;            // boolean

const vazio = null;         // "sem valor" (intencional)
const naoDefinido = undefined; // "ainda não tem valor"

console.log(typeof texto, typeof inteiro, typeof ligado);
// → string number boolean
```

!!! note "Nota"
    `null` você define de propósito ("aqui não tem nada").
    `undefined` normalmente aparece sozinho (uma variável que ainda não recebeu
    valor).

## 4. Objetos

Um objeto agrupa valores com nomes (chaves). É a estrutura mais comum no SDK:

```js
const usuario = {
  id: "abc-123",
  nome: "Maria",
  ativo: true,
};

console.log(usuario.nome);   // → Maria
console.log(usuario.ativo);  // → true
```

Você acessa cada valor com `objeto.chave`. Simples assim.

## 5. Arrays (listas)

Um array é uma lista ordenada de valores:

```js
const numeros = [1, 2, 3];

console.log(numeros.length); // → 3
console.log(numeros[0]);     // → 1 (o primeiro item)

const dobrados = numeros.map((n) => n * 2);
console.log(dobrados); // → [ 2, 4, 6 ]
```

O `.map(...)` cria um **novo** array transformando cada item. Você verá muito
isso ao converter listas de dados do banco em respostas da API.

## 6. Funções

Uma função é um bloco de código reutilizável. Existem duas formas de escrever:

```js
// Forma clássica
function soma(a, b) {
  return a + b;
}

// Arrow function (função de seta) — faz exatamente o mesmo
const somaArrow = (a, b) => a + b;

console.log(soma(1, 2));      // → 3
console.log(somaArrow(1, 2)); // → 3
```

As duas fazem a mesma coisa. **Os exemplos do SDK usam muito arrow functions**,
principalmente como *handlers* de rota (o código que responde a uma requisição):

```js
app.get("/ping", (req, res) => {
  res.json({ message: "pong" });
});
```

Aquele `(req, res) => { ... }` é uma arrow function passada direto para a rota.

## 7. Promises e `async` / `await`

Esta é a parte mais importante. Leia com calma. 💡

Uma **Promise** é "um valor que chega depois". Quando você consulta um banco de
dados ou faz uma requisição HTTP, a resposta não vem na hora — ela chega daqui a
alguns milissegundos. A Promise representa esse valor futuro.

- `await` **espera** a Promise terminar e te entrega o valor.
- `async` marca uma função que **pode usar** `await` lá dentro.

Veja um exemplo com um atraso falso:

```js
// Uma função que "demora" 1 segundo e depois entrega um valor
function esperarUmSegundo() {
  return new Promise((resolve) => {
    setTimeout(() => resolve("pronto!"), 1000);
  });
}

async function principal() {
  console.log("começando...");
  const resultado = await esperarUmSegundo(); // espera 1s aqui
  console.log(resultado); // → pronto! (depois de 1 segundo)
}

principal();
```

Saída:

```text
começando...
pronto!        (aparece 1 segundo depois)
```

Repare: sem `await`, o `console.log(resultado)` rodaria antes do valor existir.
O `await` faz o código esperar educadamente.

!!! info "Por que o SDK usa `async` em todo lugar?"
    Quase tudo que uma API faz é **I/O**: ler do banco de dados, chamar outro
    serviço pela rede, ler um arquivo. Essas operações são **assíncronas** —
    levam tempo e chegam depois. Usar `async`/`await` deixa o servidor livre para
    atender outras requisições enquanto espera, em vez de travar. Por isso você
    verá `async` e `await` espalhados pelos exemplos.

Na prática, dentro do SDK, isso aparece assim:

```js
app.get("/users", async (req, res) => {
  const users = await userService.list(); // espera o banco responder
  res.json(users);
});
```

??? note "Detalhe opcional: e se der erro?"
    Você pode envolver o `await` em `try`/`catch` para tratar falhas:

    ```js
    try {
      const users = await userService.list();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "algo deu errado" });
    }
    ```

    Não se preocupe em decorar isso agora — o SDK já cuida de boa parte do
    tratamento de erros para você.

## 8. Módulos: `import` e `export`

Programas reais são divididos em vários arquivos. Os módulos conectam eles:

- `export` **expõe** algo de um arquivo para os outros.
- `import` **traz** esse algo para o arquivo atual.

```js
// arquivo: matematica.js
export function soma(a, b) {
  return a + b;
}
```

```js
// arquivo: app.js
import { soma } from "./matematica.js";

console.log(soma(2, 3)); // → 5
```

O SDK usa **ES modules** — o estilo com `import`. Para o Node entender esse
estilo, seu `package.json` precisa ter:

```json
{
  "type": "module"
}
```

É exatamente assim que você vai trazer o SDK para o seu projeto:

```js
import { createApp } from "tempest-express-sdk";
```

As chaves `{ }` significam "importe esse item específico" que o pacote exporta.

## 9. O que o TypeScript acrescenta

O SDK é escrito em **TypeScript** (TS). O TypeScript é JavaScript **com tipos**.

Você anota o tipo de cada valor, e o TS verifica se tudo bate **antes** de rodar.
Depois, os tipos são "apagados" e viram JavaScript normal.

```ts
const n: number = 1;        // n é um number
const nome: string = "Ana"; // nome é uma string

// n = "texto"; // ❌ o TypeScript reclama antes mesmo de rodar
```

Você também pode descrever o formato de um objeto com uma `interface`:

```ts
interface User {
  id: string;
  name: string;
}

const user: User = { id: "1", name: "Ana" }; // ✅ bate com o formato
```

!!! tip "Você não precisa dominar TypeScript para começar"
    O maior benefício do TS para você agora é indireto: **autocomplete** no
    editor e **segurança** (ele avisa erros antes de rodar). Você pode ler os
    exemplos do SDK tranquilamente sabendo só o básico daqui, e aprender TS aos
    poucos.

!!! note "Você vai ver `class` também"
    Em alguns pontos aparece algo como `class X extends BaseModel` — é só uma
    forma de definir um "molde" de dados. Não precisa entender agora; a gente
    volta nisso mais pra frente.

## Recapitulando

Com estas peças você já consegue ler os exemplos do SDK: ✅

- Rodar um arquivo com `node arquivo.js`.
- `const` (padrão) e `let` (quando precisa mudar).
- Tipos básicos: string, number, boolean, `null`/`undefined`.
- Objetos `{ chave: valor }` e arrays `[1, 2, 3]` com `.map(...)`.
- Funções normais e **arrow functions** `(x) => x + 1`.
- **Promises + `async`/`await`** — a chave para entender I/O (banco e rede).
- Módulos `import` / `export` com ES modules.
- TypeScript adiciona tipos, autocomplete e segurança — aprenda aos poucos.

Pronto para colocar a mão na massa?

👉 Próximo: [Seu primeiro app](first-app.md)
