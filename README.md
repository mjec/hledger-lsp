# hledger-lsp

Language Server Protocol (LSP) implementation for [hledger](https://hledger.org/) plain text accounting.

## Installation

```bash
npm install -g hledger-lsp
```

## IDE Extensions

### VS Code

**Extension**: [hledger-tools on VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patrickt.hledger-tools)

Install from the VS Code Marketplace or Extensions view. The extension provides all LSP features with zero configuration.

- **Repository**: [ptimoney/hledger-vscode](https://github.com/ptimoney/hledger-vscode)
- **Issues**: [Report extension issues](https://github.com/ptimoney/hledger-vscode/issues)

### Neovim

**Plugin**: [ptimoney/hledger-nvim](https://github.com/ptimoney/hledger-nvim)

Provides automatic LSP configuration, filetype detection, and workspace visualization.

### Other Editors

The server can be used with any LSP-compatible editor. Example configuration:

```json
{
  "command": "hledger-lsp",
  "args": ["--stdio"],
  "filetypes": ["hledger", "journal"],
  "rootPatterns": [".hledger-lsp.json", ".git"]
}
```

## Features

See [server/README.md](server/README.md) for complete feature documentation including:

- Intelligent completion for accounts, payees, commodities, tags
- Validation with configurable rules
- Formatting with decimal-point alignment
- Navigation (go to definition, find references, symbols)
- Code actions (add declarations, rename refactoring)
- Inlay hints for inferred amounts, running balances, cost conversions
- Multi-file support via include directives

## Development

```bash
git clone https://github.com/ptimoney/hledger-lsp.git
cd hledger-lsp/server
npm install
npm run build
npm test
```

See [server/README.md](server/README.md) for detailed development documentation.

## Links

- **Server Documentation**: [server/README.md](server/README.md)
- **VS Code Extension**: [hledger-vscode](https://github.com/ptimoney/hledger-vscode)
- **Neovim Plugin**: [hledger-nvim](https://github.com/ptimoney/hledger-nvim)
- **Report Issues**: [GitHub Issues](https://github.com/ptimoney/hledger-lsp/issues)
- **hledger**: [Official Documentation](https://hledger.org/)

## License

MIT
