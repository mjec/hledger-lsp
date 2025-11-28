# hledger-lsp

Language Server Protocol (LSP) implementation for
[hledger](https://hledger.org/) plain text accounting.

## Installation

```bash
npm install -g hledger-lsp
```

## Quick Start

### Neovim

### Neovim

#### LazyVim Setup

1. **Add filetype detection** in `~/.config/nvim/lua/config/options.lua`:

```lua
vim.filetype.add({
  extension = {
    journal = "hledger",
    hledger = "hledger",
  },
})
```

2. **Add LSP configuration** in `~/.config/nvim/lua/plugins/hledger.lua`:

```lua
return {
  "neovim/nvim-lspconfig",
  ft = { "hledger", "journal" },
  opts = {
    servers = {
      hledger_lsp = {
        settings = {
          hledgerLanguageServer = {
            inlayHints = {
              showInferredAmounts = true,
              showRunningBalances = true,
              showCostConversions = true,
            },
            codeLens = {
              showRunningBalances = false,
              showTransactionCounts = false,
            },
          },
        },
      },
    },
    setup = {
      hledger_lsp = function(_, opts)
        local lspconfig = require("lspconfig")
        local util = require("lspconfig.util")
        local configs = require("lspconfig.configs")

        -- Define hledger_lsp as a custom server if not already defined
        if not configs.hledger_lsp then
          configs.hledger_lsp = {
            default_config = {
              cmd = { "hledger-lsp", "--stdio" },
              filetypes = { "hledger", "journal" },
              root_dir = function(fname)
                return util.root_pattern(".hledger-lsp.json", "main.journal", "all.journal", ".git")(fname)
                  or vim.fs.dirname(fname)
              end,
              single_file_support = true,
            },
          }
        end

        lspconfig.hledger_lsp.setup(opts)

        -- Attach to any already-open buffers (for first file open)
        vim.schedule(function()
          for _, buf in ipairs(vim.api.nvim_list_bufs()) do
            if vim.api.nvim_buf_is_loaded(buf) then
              local ft = vim.api.nvim_get_option_value("filetype", { buf = buf })
              if ft == "hledger" or ft == "journal" then
                local clients = vim.lsp.get_clients({ bufnr = buf, name = "hledger_lsp" })
                if #clients == 0 then
                  lspconfig.hledger_lsp.manager:try_add_wrapper(buf)
                end
              end
            end
          end
        end)

        -- Force refresh inlay hints when entering a buffer
        -- This ensures that if a background buffer was updated by a cascade but not refreshed by the client,
        -- it gets refreshed when the user switches to it.
        vim.api.nvim_create_autocmd("BufEnter", {
          pattern = { "*.journal", "*.hledger" },
          callback = function(args)
            -- Only if inlay hints are enabled
            if vim.lsp.inlay_hint and vim.lsp.inlay_hint.is_enabled({ bufnr = args.buf }) then
               -- There isn't a direct "refresh" method exposed easily in Lua API for just one buffer
               -- But toggling it off and on forces a refresh
               vim.lsp.inlay_hint.enable(false, { bufnr = args.buf })
               vim.lsp.inlay_hint.enable(true, { bufnr = args.buf })
            end
          end,
        })

        return true
      end,
    },
  },
}
```

#### Standard nvim-lspconfig Setup

```lua
-- Filetype detection
vim.filetype.add({
  extension = {
    journal = "hledger",
    hledger = "hledger",
  },
})

-- LSP setup
local lspconfig = require("lspconfig")
local configs = require("lspconfig.configs")
local util = require("lspconfig.util")

-- Register hledger_lsp as a custom server
if not configs.hledger_lsp then
  configs.hledger_lsp = {
    default_config = {
      cmd = { "hledger-lsp", "--stdio" },
      filetypes = { "hledger", "journal" },
      root_dir = function(fname)
        return util.root_pattern(".hledger-lsp.json", "main.journal", "all.journal", ".git")(fname)
          or vim.fs.dirname(fname)
      end,
      single_file_support = true,
    },
  }
end

-- Setup the server
lspconfig.hledger_lsp.setup({
  settings = {
    hledgerLanguageServer = {
      inlayHints = {
        showInferredAmounts = true,
        showRunningBalances = true,
        showCostConversions = true,
      },
      codeLens = {
        showRunningBalances = false,
        showTransactionCounts = false,
      },
    },
  },
})

-- Force refresh inlay hints when entering a buffer
vim.api.nvim_create_autocmd("BufEnter", {
  pattern = { "*.journal", "*.hledger" },
  callback = function(args)
    if vim.lsp.inlay_hint and vim.lsp.inlay_hint.is_enabled({ bufnr = args.buf }) then
       vim.lsp.inlay_hint.enable(false, { bufnr = args.buf })
       vim.lsp.inlay_hint.enable(true, { bufnr = args.buf })
    end
  end,
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
