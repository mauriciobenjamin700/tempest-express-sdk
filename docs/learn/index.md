# Projeto guiado: Lista de Tarefas

Chega de exemplos soltos. 🚀 Aqui você vai **construir uma API de verdade**, do zero, junto com a gente — um capítulo de cada vez.

O projeto é uma **Lista de Tarefas** (um CRUD pequeno e completo): criar tarefas, listar tarefas e marcar como concluídas. Nada de mágica: você começa numa pasta vazia e, passo a passo, conecta as **camadas do SDK** — `model` → `repository` → `service` → `controller` → `router`.

No fim, você não vai só ter uma API funcionando. Você vai **entender como um serviço Tempest de verdade se encaixa**. 💡

## O que você vai construir

- Uma tarefa (`Task`) com um `title` (título) e um `done` (concluída ou não).
- Endpoints para **criar**, **listar** e **concluir** tarefas.
- Documentação interativa no **Swagger** — testável direto no navegador.
- Os dados salvos num arquivo **SQLite** local, no seu próprio disco.

!!! info "Pré-requisitos"
    Você só precisa de duas coisas:

    - **Node ≥ 20** instalado. Ainda não tem? Siga o guia de [instalação do Node](../getting-started/node.md).
    - Ter feito o [Seu primeiro app](../getting-started/first-app.md), para já conhecer o básico.

    Apareceu um termo novo pelo caminho? Consulte o [Glossário](../getting-started/glossary.md). 📖

## Os capítulos

O projeto é dividido em três capítulos curtos. Cada um começa de onde o anterior parou:

- **Capítulo 1 — [Setup e o primeiro modelo](01-setup.md)**: criar a pasta, instalar tudo, definir a tabela `task` e subir o servidor pela primeira vez.
- **Capítulo 2 — [CRUD completo](02-crud.md)**: adicionar os endpoints para criar e concluir tarefas.
- **Capítulo 3 — [Polimento: erros e filtros](03-polish.md)**: tratar erros com elegância e filtrar as tarefas.

!!! note "Um arquivo só, de propósito"
    Para manter o foco no aprendizado, o app inteiro vive num único arquivo `app.ts`. É ótimo para aprender, mas **não é como um projeto real é organizado**. Num serviço de verdade, você separa cada camada em seus próprios arquivos — veja a receita de [Banco de dados](../recipes/database.md) quando quiser dar esse passo.

## Recapitulando

Você já sabe o que vai construir (uma API de Lista de Tarefas), o que precisa ter instalado e como o projeto está dividido em capítulos. Hora de colocar a mão na massa! ✅

👉 Comece pelo **[Capítulo 1 — Setup e o primeiro modelo](01-setup.md)**.
