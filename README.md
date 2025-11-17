# hledger Language Server (LSP) Monorepo

This repository contains a Language Server Protocol implementation for [hledger](https://hledger.org/) and a VS Code client extension.

- `server/` – hledger LSP server implementation (Node.js)
- `vscode-client/` – VS Code extension that bundles and runs the server

## Getting started

### Install dependencies

From the repository root:

```bash
npm install
```

### Build server and client

```bash
npm run build
```

This will:

- Compile the server TypeScript (`server/`) to `server/out/`.
- Compile the VS Code client (`vscode-client/`) to `vscode-client/out/` and copy the server bundle under `vscode-client/out/server/`.

## Using the language server

### Recommended: install from npm

The language server is published as an npm package with a CLI entrypoint.

Global install (recommended for most editor users):

```bash
npm install -g hledger-lsp
```

After that, your LSP client can run the server via:

```bash
hledger-lsp --stdio
```

#### Neovim with nvim-lspconfig (global install)

Minimal setup:

```lua
local lspconfig = require("lspconfig")

lspconfig.hledger_lsp.setup({
  cmd = { "hledger-lsp", "--stdio" },
  filetypes = { "hledger", "journal" },
})
```

For LazyVim / lazy.nvim users, you can add:

```lua
{
  "neovim/nvim-lspconfig",
  opts = {
    servers = {
      hledger_lsp = {
        cmd = { "hledger-lsp", "--stdio" },
        filetypes = { "hledger", "journal" },
      },
    },
  },
}
```

#### Local (per-project) install

If you prefer to version the server with a project:

```bash
npm install --save-dev hledger-lsp
```

Then configure Neovim to use the local binary (inside the project root):

```lua
local lspconfig = require("lspconfig")
local util = lspconfig.util

lspconfig.hledger_lsp.setup({
  cmd = { util.path.join(vim.loop.cwd(), "node_modules", ".bin", "hledger-lsp"), "--stdio" },
  filetypes = { "hledger", "journal" },
})
```

### From source (development setup)

You can still run the server directly from a clone of this repository. After building:

```bash
node server/out/server.js --stdio
```

and point your LSP client at that command.

### VS Code

The `vscode-client/` directory contains a dedicated VS Code extension that:

- Registers the `hledger` language for `.journal` and `.hledger` files.
- Launches the hledger language server from the bundled `out/server/server.js`.
- Exposes all `hledgerLanguageServer.*` settings in the VS Code Settings UI.
- Provides commands for reloading the server, showing logs, and toggling inlay hints / validation.
- Shows a status bar item with basic server state.

For details, see `vscode-client/README.md`.

To run the extension in development:

1. Open this folder in VS Code.
2. Run `npm install` and `npm run build` from the repo root (if you haven’t already).
3. Press **F5** to launch an Extension Development Host.
4. Open a `*.journal` or `*.hledger` file in the dev host.

## Development

Each package has its own scripts; common ones from the repo root:

- `npm run build` – build server + client.
- `npm test` – run test suites.
- `npm run build:server` / `npm run build:client` – build individual packages (if defined in root scripts).

See `server/README.md` and `vscode-client/README.md` for package-specific details.