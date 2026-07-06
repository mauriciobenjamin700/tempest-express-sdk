# JavaScript and TypeScript essentials

Just installed Node.js and never written JavaScript before? Perfect. 🚀

This page teaches you **just enough** to read and understand the
`tempest-express-sdk` examples. It's not a full JavaScript course — it's an
on-ramp. Every section has a tiny example you can actually run.

Let's go!

## 1. Running a file

Everything in JavaScript starts with a file and the `node` command.

Create a file named `hello.js` with this content:

```js
console.log("Hello!");
```

Now run it in your terminal:

```bash
node hello.js
```

Output:

```text
Hello!
```

That's it! `console.log(...)` prints something to the screen. You'll use it all
the time to inspect values.

!!! tip "Tip"
    `console.log` is your best friend while learning. Whenever you're unsure
    what a value is, print it.

## 2. Variables: `const` and `let`

A variable is a name that holds a value. There are two ways to create one:

```js
const name = "Maria"; // can't be reassigned
let age = 30;         // can change later

age = 31; // ✅ ok, it's a let
// name = "John"; // ❌ error! const can't be reassigned

console.log(name, age); // → Maria 31
```

**Always prefer `const`.** Use `let` only when you genuinely need to change the
value later. This keeps your code predictable.

## 3. Basic value types

These are the most common values you'll come across:

```js
const text = "this is a string"; // string (text)
const integer = 42;               // number
const decimal = 3.14;             // number (no separate type)
const on = true;                  // boolean (true or false)
const off = false;                // boolean

const empty = null;         // "no value" (on purpose)
const notSet = undefined;   // "no value yet"

console.log(typeof text, typeof integer, typeof on);
// → string number boolean
```

!!! note "Note"
    `null` is something you set on purpose ("there's nothing here").
    `undefined` usually shows up on its own (a variable that hasn't received a
    value yet).

## 4. Objects

An object groups values under names (keys). It's the most common structure in
the SDK:

```js
const user = {
  id: "abc-123",
  name: "Maria",
  active: true,
};

console.log(user.name);   // → Maria
console.log(user.active); // → true
```

You access each value with `object.key`. Simple as that.

## 5. Arrays (lists)

An array is an ordered list of values:

```js
const numbers = [1, 2, 3];

console.log(numbers.length); // → 3
console.log(numbers[0]);     // → 1 (the first item)

const doubled = numbers.map((n) => n * 2);
console.log(doubled); // → [ 2, 4, 6 ]
```

`.map(...)` creates a **new** array by transforming each item. You'll see this a
lot when turning lists of database rows into API responses.

## 6. Functions

A function is a reusable block of code. There are two ways to write one:

```js
// Classic form
function add(a, b) {
  return a + b;
}

// Arrow function — does exactly the same thing
const addArrow = (a, b) => a + b;

console.log(add(1, 2));      // → 3
console.log(addArrow(1, 2)); // → 3
```

Both do the same thing. **The SDK examples use arrow functions a lot**, mainly
as route *handlers* (the code that responds to a request):

```js
app.get("/ping", (req, res) => {
  res.json({ message: "pong" });
});
```

That `(req, res) => { ... }` is an arrow function passed straight to the route.

## 7. Promises and `async` / `await`

This is the most important part. Read it slowly. 💡

A **Promise** is "a value that arrives later". When you query a database or make
an HTTP request, the answer doesn't come instantly — it arrives a few
milliseconds later. The Promise represents that future value.

- `await` **waits** for the Promise to finish and hands you the value.
- `async` marks a function that **can use** `await` inside it.

Here's an example with a fake delay:

```js
// A function that "takes" 1 second and then delivers a value
function waitOneSecond() {
  return new Promise((resolve) => {
    setTimeout(() => resolve("done!"), 1000);
  });
}

async function main() {
  console.log("starting...");
  const result = await waitOneSecond(); // waits 1s here
  console.log(result); // → done! (after 1 second)
}

main();
```

Output:

```text
starting...
done!          (appears 1 second later)
```

Notice: without `await`, `console.log(result)` would run before the value even
exists. `await` makes the code wait politely.

!!! info "Why does the SDK use `async` everywhere?"
    Almost everything an API does is **I/O**: reading from the database, calling
    another service over the network, reading a file. These operations are
    **asynchronous** — they take time and arrive later. Using `async`/`await`
    frees the server to handle other requests while it waits, instead of
    blocking. That's why you'll see `async` and `await` all over the examples.

In practice, inside the SDK, it looks like this:

```js
app.get("/users", async (req, res) => {
  const users = await userService.list(); // wait for the database
  res.json(users);
});
```

??? note "Optional detail: what if it fails?"
    You can wrap the `await` in `try`/`catch` to handle failures:

    ```js
    try {
      const users = await userService.list();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "something went wrong" });
    }
    ```

    Don't worry about memorizing this now — the SDK already handles much of the
    error handling for you.

## 8. Modules: `import` and `export`

Real programs are split across several files. Modules connect them:

- `export` **exposes** something from a file to others.
- `import` **brings** that something into the current file.

```js
// file: math.js
export function add(a, b) {
  return a + b;
}
```

```js
// file: app.js
import { add } from "./math.js";

console.log(add(2, 3)); // → 5
```

The SDK uses **ES modules** — the `import` style. For Node to understand this
style, your `package.json` needs:

```json
{
  "type": "module"
}
```

This is exactly how you'll bring the SDK into your project:

```js
import { createApp } from "tempest-express-sdk";
```

The curly braces `{ }` mean "import this specific item" that the package
exports.

## 9. What TypeScript adds

The SDK is written in **TypeScript** (TS). TypeScript is JavaScript **with
types**.

You annotate the type of each value, and TS checks that everything matches
**before** it runs. Then the types are "erased" and it becomes plain JavaScript.

```ts
const n: number = 1;      // n is a number
const name: string = "Ana"; // name is a string

// n = "text"; // ❌ TypeScript complains before it even runs
```

You can also describe the shape of an object with an `interface`:

```ts
interface User {
  id: string;
  name: string;
}

const user: User = { id: "1", name: "Ana" }; // ✅ matches the shape
```

!!! tip "You don't need to master TypeScript to start"
    The biggest benefit of TS for you right now is indirect: **autocomplete** in
    your editor and **safety** (it warns you about errors before running). You
    can read the SDK examples just fine knowing only the basics here, and learn
    TS gradually.

!!! note "You'll see `class` too"
    In a few places you'll see something like `class X extends BaseModel` — it's
    just a way to define a data "shape". No need to understand it now; we'll come
    back to it later.

## Recap

With these pieces you can already read the SDK examples: ✅

- Run a file with `node file.js`.
- `const` (default) and `let` (when you need to change it).
- Basic types: string, number, boolean, `null`/`undefined`.
- Objects `{ key: value }` and arrays `[1, 2, 3]` with `.map(...)`.
- Regular functions and **arrow functions** `(x) => x + 1`.
- **Promises + `async`/`await`** — the key to understanding I/O (database and
  network).
- Modules `import` / `export` with ES modules.
- TypeScript adds types, autocomplete and safety — learn it gradually.

Ready to get your hands dirty?

👉 Next: [Your first app](first-app.md)
