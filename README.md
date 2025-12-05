# hledger-lsp

Language Server Protocol (LSP) implementation for
[hledger](https://hledger.org/) plain text accounting.

## Installation

```bash
npm install -g hledger-lsp
```

## IDE Integration

### Neovim

Use the dedicated plugin: **[ptimoney/hledger-nvim](https://github.com/ptimoney/hledger-nvim)**

The plugin provides automatic LSP configuration, filetype detection, and workspace visualization.

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
