# hledger-lsp

Language Server Protocol (LSP) implementation for
[hledger](https://hledger.org/) plain text accounting.

## Installation

```bash
npm install -g hledger-lsp
```

## Quick Start

### Neovim (lazy.nvim)

Add to your lazy.nvim configuration:

```lua
return {
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
  },
}
```

And add this to your `init.lua`:

```lua
vim.filetype.add({
  extension = {
    journal = "hledger",
    hledger = "hledger",
  },
})
```

See [server/README.md](server/README.md) for full documentation, features, and
configuration options.

### VS Code

A VS Code extension is also available. See
[vscode-client/README.md](vscode-client/README.md) for details.

## Development

This is a monorepo containing:

- `server/` – LSP server implementation (published to npm)
- `vscode-client/` – VS Code extension

### Building

```bash
# Install dependencies
npm install

# Build both packages
npm run build

# Run tests
npm test
```

See individual package READMEs for more details:

- [server/README.md](server/README.md) - Language server documentation
- [vscode-client/README.md](vscode-client/README.md) - VS Code extension documentation
