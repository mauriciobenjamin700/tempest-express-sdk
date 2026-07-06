# Instalando o Node.js

Bem-vindo! 🚀 Esta é a sua primeira parada. Aqui você vai preparar o seu
computador do zero — sem pressupor que você já sabe programar, usar o terminal
ou o que é o Node.js. Vamos com calma, um passo de cada vez.

Ao final desta página, você terá o Node.js instalado e vai entender o
vocabulário básico que aparece em todo tutorial. 💡

## O que é o terminal?

O **terminal** (também chamado de "linha de comando" ou "prompt") é um programa
onde você digita comandos em texto e o computador executa. Em vez de clicar em
botões, você escreve o que quer que aconteça e aperta **Enter**. Parece assustador
no começo, mas você só vai precisar copiar e colar alguns comandos. 😊

Veja como abrir o terminal no seu sistema:

=== "Windows"

    1. Aperte a tecla **Windows** no teclado.
    2. Digite `PowerShell` ou `Terminal`.
    3. Clique em **Windows PowerShell** (ou **Terminal**) na lista.

    Uma janela escura (ou azul) vai abrir. É ali que você digita os comandos.

=== "macOS"

    1. Aperte **Command (⌘) + Barra de espaço** para abrir o Spotlight.
    2. Digite `Terminal`.
    3. Aperte **Enter**.

    Uma janela do **Terminal** vai abrir. É ali que você digita os comandos.

=== "Linux"

    1. Procure por **Terminal** no menu de aplicativos, ou
    2. Aperte **Ctrl + Alt + T** (funciona na maioria das distribuições).

    Uma janela do terminal vai abrir. É ali que você digita os comandos.

!!! tip "Copiar e colar no terminal"
    Você pode copiar os comandos desta página e colá-los no terminal. No Windows,
    cole com **Ctrl + V**. No macOS, use **Command (⌘) + V**. No Linux, geralmente
    é **Ctrl + Shift + V**. Depois de colar, aperte **Enter** para executar.

## O que são Node.js e npm?

O **Node.js** é um programa que executa código **JavaScript** fora do navegador
— ou seja, direto no seu computador. Isso permite criar servidores, ferramentas
e aplicações usando JavaScript.

Junto com o Node.js vem o **npm** (Node Package Manager). Ele serve para
**instalar pacotes** — pedaços de código prontos, feitos por outras pessoas, que
você reaproveita no seu projeto. Ao instalar o Node.js, você ganha os dois de uma
vez. ✅

## Instalando o Node.js (versão LTS)

Vamos instalar a versão **LTS** do Node.js. "LTS" significa *Long Term Support*
(Suporte de Longo Prazo): é a versão mais estável e recomendada para a maioria
das pessoas.

!!! warning "Você precisa do Node **20 ou superior**"
    Este SDK exige **Node.js versão 20 ou mais nova**. A versão LTS atual já
    atende a esse requisito com folga, então siga os passos abaixo sem
    preocupação. Só fique atento se você já tiver uma versão antiga instalada.

Siga as instruções do seu sistema:

=== "Windows"

    **Opção A — Instalador (mais simples):**

    1. Acesse [https://nodejs.org](https://nodejs.org).
    2. Clique no botão que mostra a versão **LTS**.
    3. Abra o arquivo baixado e clique em **Next** até concluir.

    **Opção B — Pelo terminal (com winget):**

    ```powershell
    winget install OpenJS.NodeJS.LTS
    ```

    Depois de instalar, **feche e abra o terminal de novo** para as mudanças
    valerem.

=== "macOS"

    **Opção A — nvm (recomendado):**

    ```bash
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    ```

    Feche e reabra o terminal, depois instale a versão LTS:

    ```bash
    nvm install --lts
    ```

    **Opção B — Homebrew:**

    ```bash
    brew install node
    ```

    **Opção C — Instalador:** baixe o pacote LTS em
    [https://nodejs.org](https://nodejs.org) e siga o assistente.

=== "Linux"

    **Recomendado — nvm:**

    ```bash
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    ```

    Feche e reabra o terminal, depois instale a versão LTS:

    ```bash
    nvm install --lts
    ```

    !!! note "Evite os pacotes da sua distribuição"
        Instalar o Node.js pelo `apt`, `dnf` ou `pacman` costuma trazer uma
        versão **antiga**, que pode ser menor que a 20 exigida. Por isso o
        **nvm** é o caminho mais seguro no Linux.

!!! tip "Por que recomendamos o nvm?"
    O **nvm** é a forma mais amigável de instalar e trocar de versões do Node.js
    sem dor de cabeça. Se um dia você precisar de outra versão, é só um comando.

??? note "O que é o nvm?"
    **nvm** significa *Node Version Manager* (Gerenciador de Versões do Node).
    É uma ferramentinha que instala o Node.js para o seu usuário e permite ter
    várias versões instaladas ao mesmo tempo, alternando entre elas quando
    quiser. Assim você nunca fica preso a uma versão antiga do sistema, e não
    precisa de permissões de administrador para instalar o Node. Comandos úteis:

    - `nvm install --lts` → instala a versão LTS mais recente.
    - `nvm use --lts` → passa a usar a versão LTS.
    - `nvm ls` → lista as versões que você tem instaladas.

## Verificando a instalação

Agora vamos confirmar que deu tudo certo. No terminal, digite:

```bash
node -v
```

Você deve ver algo parecido com:

```text
v22.11.0
```

Depois, verifique o npm:

```bash
npm -v
```

A saída será algo como:

```text
10.9.0
```

!!! check "Deu certo?"
    Se você viu dois números de versão, **parabéns** — o Node.js e o npm estão
    instalados! ✅ Só confirme que o número do `node -v` começa com **20 ou
    mais** (por exemplo `v20.x`, `v22.x`). Se aparecer algo menor, volte ao passo
    de instalação e use o **nvm** para instalar a versão LTS.

!!! note "Comando não encontrado?"
    Se o terminal responder algo como `command not found` ou
    `não é reconhecido`, geralmente basta **fechar e abrir o terminal** de novo
    para ele reconhecer o Node.js recém-instalado.

## Vocabulário básico: pacote, package.json e node_modules

Enquanto você aprende, três palavras vão aparecer o tempo todo. Vamos entendê-las
de forma concreta:

- **Pacote (package):** um pedaço de código reutilizável, feito por outra pessoa,
  que você instala com o npm para não precisar escrever tudo do zero.
- **`package.json`:** o **manifesto** do seu projeto. É um arquivo que lista o
  nome do projeto e as **dependências** (os pacotes que ele usa). É como uma
  lista de compras do seu projeto.
- **`node_modules`:** a pasta onde o npm **guarda os pacotes instalados**. Ela
  pode ficar bem grande. Você **nunca edita** essa pasta na mão e **nunca a
  envia** para o controle de versão (Git) — ela é recriada a partir do
  `package.json` quando necessário.

!!! info "Ainda não precisa criar nada disso"
    Você vai ver esses arquivos aparecerem naturalmente mais para frente, quando
    criar um projeto. Por enquanto, basta saber o que cada nome significa. 💡

## Recapitulando

Nesta página você:

- Aprendeu o que é o **terminal** e como abri-lo no seu sistema. ✅
- Entendeu que o **Node.js** roda JavaScript no seu computador e que o **npm**
  instala pacotes. ✅
- Instalou a versão **LTS** do Node.js (>= 20). ✅
- Confirmou a instalação com `node -v` e `npm -v`. ✅
- Aprendeu o vocabulário: **pacote**, **`package.json`** e **`node_modules`**. ✅

Com o Node.js funcionando, o próximo passo é conhecer um pouquinho da linguagem.

➡️ Continue em: [Essenciais de JavaScript e TypeScript](javascript.md)
