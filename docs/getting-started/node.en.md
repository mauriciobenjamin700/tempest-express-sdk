# Installing Node.js

Welcome! 🚀 This is your very first stop. Here you'll get your computer ready from
scratch — with no assumption that you already know how to program, use the
terminal, or what Node.js is. We'll take it slow, one step at a time.

By the end of this page, you'll have Node.js installed and you'll understand the
basic vocabulary that shows up in every tutorial. 💡

## What is the terminal?

The **terminal** (also called the "command line" or "prompt") is a program where
you type text commands and the computer runs them. Instead of clicking buttons,
you write what you want to happen and press **Enter**. It looks scary at first,
but you'll only need to copy and paste a few commands. 😊

Here's how to open the terminal on your system:

=== "Windows"

    1. Press the **Windows** key on your keyboard.
    2. Type `PowerShell` or `Terminal`.
    3. Click **Windows PowerShell** (or **Terminal**) in the list.

    A dark (or blue) window will open. That's where you type commands.

=== "macOS"

    1. Press **Command (⌘) + Space** to open Spotlight.
    2. Type `Terminal`.
    3. Press **Enter**.

    A **Terminal** window will open. That's where you type commands.

=== "Linux"

    1. Look for **Terminal** in your applications menu, or
    2. Press **Ctrl + Alt + T** (works on most distributions).

    A terminal window will open. That's where you type commands.

!!! tip "Copy and paste in the terminal"
    You can copy the commands from this page and paste them into the terminal. On
    Windows, paste with **Ctrl + V**. On macOS, use **Command (⌘) + V**. On Linux,
    it's usually **Ctrl + Shift + V**. After pasting, press **Enter** to run it.

## What are Node.js and npm?

**Node.js** is a program that runs **JavaScript** code outside the browser — that
is, right on your computer. This lets you build servers, tools, and applications
using JavaScript.

Bundled with Node.js comes **npm** (Node Package Manager). It's used to **install
packages** — ready-made pieces of code, written by other people, that you reuse
in your project. When you install Node.js, you get both at once. ✅

## Installing Node.js (the LTS version)

Let's install the **LTS** version of Node.js. "LTS" means *Long Term Support*:
it's the most stable version and the one recommended for most people.

!!! warning "You need Node **20 or newer**"
    This SDK requires **Node.js version 20 or newer**. The current LTS release
    meets that requirement with room to spare, so follow the steps below without
    worry. Only pay attention if you already have an older version installed.

Follow the instructions for your system:

=== "Windows"

    **Option A — Installer (simplest):**

    1. Go to [https://nodejs.org](https://nodejs.org).
    2. Click the button showing the **LTS** version.
    3. Open the downloaded file and click **Next** until it finishes.

    **Option B — From the terminal (with winget):**

    ```powershell
    winget install OpenJS.NodeJS.LTS
    ```

    After installing, **close and reopen the terminal** for the changes to take
    effect.

=== "macOS"

    **Option A — nvm (recommended):**

    ```bash
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    ```

    Close and reopen the terminal, then install the LTS version:

    ```bash
    nvm install --lts
    ```

    **Option B — Homebrew:**

    ```bash
    brew install node
    ```

    **Option C — Installer:** download the LTS package from
    [https://nodejs.org](https://nodejs.org) and follow the wizard.

=== "Linux"

    **Recommended — nvm:**

    ```bash
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    ```

    Close and reopen the terminal, then install the LTS version:

    ```bash
    nvm install --lts
    ```

    !!! note "Avoid your distribution's packages"
        Installing Node.js via `apt`, `dnf`, or `pacman` often brings an **old**
        version, which may be lower than the required 20. That's why **nvm** is
        the safest path on Linux.

!!! tip "Why do we recommend nvm?"
    **nvm** is the friendliest way to install and switch between Node.js versions
    without headaches. If you ever need a different version, it's just one
    command away.

??? note "What is nvm?"
    **nvm** stands for *Node Version Manager*. It's a small tool that installs
    Node.js for your user and lets you keep several versions installed at once,
    switching between them whenever you want. That way you're never stuck on an
    old system version, and you don't need administrator permissions to install
    Node. Handy commands:

    - `nvm install --lts` → installs the latest LTS version.
    - `nvm use --lts` → switches to the LTS version.
    - `nvm ls` → lists the versions you have installed.

## Verifying the install

Now let's confirm everything worked. In the terminal, type:

```bash
node -v
```

You should see something like:

```text
v22.11.0
```

Then check npm:

```bash
npm -v
```

The output will be something like:

```text
10.9.0
```

!!! check "Did it work?"
    If you saw two version numbers, **congratulations** — Node.js and npm are
    installed! ✅ Just make sure the `node -v` number starts with **20 or higher**
    (for example `v20.x`, `v22.x`). If it shows something lower, go back to the
    install step and use **nvm** to install the LTS version.

!!! note "Command not found?"
    If the terminal replies with something like `command not found` or
    `is not recognized`, it's usually enough to **close and reopen the terminal**
    so it picks up the newly installed Node.js.

## Basic vocabulary: package, package.json, and node_modules

As you learn, three words will show up all the time. Let's understand them
concretely:

- **Package:** a reusable piece of code, written by someone else, that you install
  with npm so you don't have to write everything from scratch.
- **`package.json`:** your project's **manifest**. It's a file that lists the
  project's name and its **dependencies** (the packages it uses). Think of it as
  your project's shopping list.
- **`node_modules`:** the folder where npm **stores the installed packages**. It
  can get quite large. You **never edit** this folder by hand and **never commit**
  it to version control (Git) — it's re-created from `package.json` when needed.

!!! info "You don't need to create any of this yet"
    You'll see these files appear naturally later on, when you create a project.
    For now, it's enough to know what each name means. 💡

## Recap

On this page you:

- Learned what the **terminal** is and how to open it on your system. ✅
- Understood that **Node.js** runs JavaScript on your computer and that **npm**
  installs packages. ✅
- Installed the **LTS** version of Node.js (>= 20). ✅
- Confirmed the install with `node -v` and `npm -v`. ✅
- Learned the vocabulary: **package**, **`package.json`**, and **`node_modules`**. ✅

With Node.js working, the next step is getting to know a bit of the language.

➡️ Continue to: [JavaScript and TypeScript essentials](javascript.md)
