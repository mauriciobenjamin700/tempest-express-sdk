# Guided project: a Task list API

No more scattered examples. 🚀 Here you'll **build a real API**, from scratch, together with us — one chapter at a time.

The project is a **Task list** (a small, complete CRUD): create tasks, list tasks, and mark them as done. No magic: you start from an empty folder and, step by step, wire up the **SDK's layers** — `model` → `repository` → `service` → `controller` → `router`.

By the end, you won't just have a working API. You'll **understand how a real Tempest service fits together**. 💡

## What you'll build

- A task (`Task`) with a `title` and a `done` flag (completed or not).
- Endpoints to **create**, **list**, and **complete** tasks.
- Interactive **Swagger** documentation — testable right in the browser.
- Data stored in a local **SQLite** file, right on your own disk.

!!! info "Prerequisites"
    You only need two things:

    - **Node ≥ 20** installed. Don't have it yet? Follow the [Node installation](../getting-started/node.md) guide.
    - To have done [Your first app](../getting-started/first-app.md), so you already know the basics.

    Ran into a new term along the way? Check the [Glossary](../getting-started/glossary.md). 📖

## The chapters

The project is split into three short chapters. Each one picks up where the previous one left off:

- **Chapter 1 — [Setup and the first model](01-setup.md)**: create the folder, install everything, define the `task` table, and boot the server for the first time.
- **Chapter 2 — [Full CRUD](02-crud.md)**: add the endpoints to create and complete tasks.
- **Chapter 3 — [Polish: errors and filters](03-polish.md)**: handle errors gracefully and filter your tasks.

!!! note "A single file, on purpose"
    To keep the focus on learning, the whole app lives in a single `app.ts` file. That's great for learning, but **it's not how a real project is organized**. In a real service, you split each layer into its own files — see the [Database](../recipes/database.md) recipe when you're ready for that step.

## Recap

You now know what you'll build (a Task list API), what you need installed, and how the project is split into chapters. Time to get your hands dirty! ✅

👉 Start with **[Chapter 1 — Setup and the first model](01-setup.md)**.
