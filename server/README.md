# hledger Language Server

A Language Server Protocol (LSP) implementation for
[hledger](https://hledger.org/), a plain text accounting tool.

## Features

This language server provides comprehensive IDE support for hledger journal
files:

### Code Completion

- **Account names** - Auto-complete from accounts (configurable: declared only
or all)
- **Payees** - Complete transaction descriptions from payees (configurable:
declared only or all)
- **Commodities** - Auto-complete currency symbols (configurable: declared only
or all)
- **Tags** - Complete tag names in comments (configurable: declared only or all)
- **Directives** - Complete hledger directives (account, commodity, payee, tag,
include, alias)
- **Include paths** - File path completion for include directives
- **Smart completions** - Context-aware account suggestions based on payee
history (learns from your transaction patterns)
- **Smart filtering** - By default, only declared items appear in completions
(can be configured to include all items)

### Hover

- **Hover information** - Lightweight hover support for accounts, payees and
dates. Hover text is provided by the language server and can be extended to show
declarations, balances and commodity formats.

### Validation

- **Transaction balance** - Verify transactions balance to zero per commodity
- **Missing amounts** - Ensure at most one posting omits an amount
- **Undeclared items** - Warn about undeclared accounts, payees, commodities,
and tags
- **Date ordering** - Detect out-of-order transactions
- **Balance assertions** - Verify balance assertions match calculated balances
- **Empty transactions** - Require at least 2 postings per transaction
- **Date validation** - Check for invalid dates (e.g., Feb 30, month 13)
- **Future dates** - Warn about future-dated transactions
- **Empty descriptions** - Warn about transactions with no description
- **Include files** - Detect missing include files
- **Circular includes** - Detect circular include dependencies

### Include Directive Support

- **Multi-file journals** - Parse and merge multiple journal files via include
directives
- **Relative and absolute paths** - Support both path styles, including `../`
parent directory references
- **Tilde expansion** - Support for `~/` home directory paths
- **Paths with spaces** - Properly handles file paths containing spaces and
special characters (e.g., "Cloud Storage", "My Documents (2025)")
- **Circular detection** - Prevent infinite loops from circular includes
- **Caching** - Efficient parsing with include file caching
- **Dependency tracking** - Auto-revalidate files when included files change
- **Source tracking** - Track which file each entity originates from

### Navigation

- **Document symbols** - Outline view showing directives and transactions with
postings
- **Workspace symbols** - Project-wide search across all accounts, payees,
commodities, tags, and transactions
- **Go to definition** - Jump to declarations for accounts, payees, commodities,
and tags
- **Find references** - Show all usages of accounts, payees, commodities, or
tags across the document

### Code Actions & Quick Fixes

- **Add declarations** - Automatically add account, payee, commodity, or tag
declarations for undeclared items
- **Smart insertion** - Directives are inserted in appropriate locations,
grouped with similar directive types
- **Rename refactoring** - Rename accounts, payees, commodities, or tags across
all their references in the document
- **Context-aware actions** - Actions appear when cursor is positioned on
renameable items

### Formatting

- **Document formatting** - Format entire journal files with consistent
indentation and spacing
- **Range formatting** - Format selected portions of your journal
- **On-type formatting** - Auto-indent postings when pressing Enter after
transaction headers
- **Decimal-point alignment** - Automatically align amounts by their decimal
point (or implied decimal position for whole numbers) within transactions,
making it easy to visually compare amounts
- **Negative amount support** - Properly aligns negative amounts regardless of
minus sign position (e.g., `-$100.00` or `$-100.00`)
- **Commodity format support** - Reformats amounts according to declared
commodity formats (symbol placement, decimal separators, thousands separators,
precision)
- **Precision preservation** - Maintains decimal precision even when commodity
format specifies fewer decimal places
- **Configurable** - Customize indentation width, alignment column, minimum
spacing, trailing whitespace handling, and more

### Semantic Highlighting

- **Context-aware syntax highlighting** - Rich semantic highlighting based on
token type and meaning
- **Token types** - Distinct highlighting for dates, accounts, payees,
commodities, tags, directives, amounts, comments, and status indicators
- **Token modifiers** - Additional styling for declarations (directive
definitions) and readonly items (dates, amounts)
- **Hierarchical accounts** - Account names highlighted as namespaces to reflect
their hierarchical nature
- **Tag detection** - Automatic highlighting of tags within comments (key:value
pairs)

### Inlay Hints

- **Inferred amounts** - Show calculated amounts for postings without explicit
amounts
- **Running balances** - Display running balances per account and commodity
after each posting
- **Cost conversions** - Show total cost in target commodity for postings with
cost notation (@ or @@)
- **Configurable** - Enable/disable each hint type independently
- **Range-aware** - Only show hints for visible portions of the document for
better performance

### Code Lens

- **Balance assertions** - Show running balances on each posting line in balance
assertion format (`= $50.00`)
- **Clickable** - Click a balance assertion code lens to insert it into the posting
- **Transaction counts** - Display how many transactions each account has been
involved in on transaction headers
- **Configurable** - Enable/disable each lens type independently

### Editor Integration

- **Folding ranges** - Collapse/expand transactions to hide postings, fold
multi-line comment blocks
- **Document links** - Clickable include paths that open the referenced file
(supports relative and absolute paths)
- **Selection range** - Smart text selection expansion: Word → Account → Posting
→ Transaction (requires editor keybinding setup, see configuration below)

### User Configuration

All validations and completion behaviors can be individually configured per
workspace or document:

- **Validation settings** - Enable/disable individual validation rules and
customize severity levels
- **Completion filtering** - Control whether completions show only declared
items or all items (declared + undeclared)

## Installation

### Prerequisites

- Node.js >= 16.0.0

### Install from npm

```bash
npm install -g hledger-lsp
```

This provides the `hledger-lsp` command globally. After installation, the
language server can be used with any LSP-compatible editor.

## Editor Configuration

### Neovim

See [../docs/neovim-setup.md](../docs/neovim-setup.md) for complete setup instructions including LazyVim configuration, standard nvim-lspconfig setup, root directory detection, and troubleshooting.

**Quick start for LazyVim users:**

1. Add filetype detection in `~/.config/nvim/lua/config/options.lua`:

```lua
vim.filetype.add({
  extension = {
    journal = "hledger",
    hledger = "hledger",
  },
})
```

2. Create `~/.config/nvim/lua/plugins/hledger.lua`:

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
              showRunningBalances = true,
              showTransactionCounts = true,
            },
            -- See settings documentation below for all options
          },
        },
      },
    },
    setup = {
      hledger_lsp = function(_, opts)
        local lspconfig = require("lspconfig")
        local util = require("lspconfig.util")
        local configs = require("lspconfig.configs")

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

        -- Attach to already-open buffers (fixes first file open issue)
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

        return true
      end,
    },
  },
}
```

**Optional:** Enable code lens auto-refresh by adding an `on_attach` handler to the `hledger_lsp` server settings:

```lua
on_attach = function(client, bufnr)
  if client.server_capabilities.codeLensProvider then
    vim.lsp.codelens.refresh()
    vim.api.nvim_create_autocmd({ "BufEnter", "CursorHold", "InsertLeave" }, {
      buffer = bufnr,
      callback = vim.lsp.codelens.refresh,
    })
  end
end,
```

### VS Code

The VS Code extension is published separately. Install it from the VS Code
marketplace or see the `vscode-client/` directory in the repository for
development instructions.

### General Settings

- `maxNumberOfProblems` (number, default: 1000): Maximum number of diagnostic
problems to report per file
- `hledgerPath` (string, default: "hledger"): Path to the hledger executable
(reserved for future CLI integration)

### Validation Settings

All validation settings default to `true` and can be individually disabled:

- `validation.balance`: Verify transactions balance to zero per commodity
- `validation.missingAmounts`: Ensure at most one posting per transaction omits
an amount
- `validation.undeclaredAccounts`: Warn about accounts used but not declared
- `validation.undeclaredPayees`: Warn about payees used but not declared
- `validation.undeclaredCommodities`: Warn about commodities used but not
declared
- `validation.undeclaredTags`: Warn about tags used but not declared
- `validation.dateOrdering`: Detect transactions with dates out of chronological
order
- `validation.balanceAssertions`: Verify balance assertions match calculated
balances
- `validation.emptyTransactions`: Require at least 2 postings per transaction
- `validation.invalidDates`: Check for invalid dates (e.g., February 30, month 13)
- `validation.futureDates`: Warn about future-dated transactions
- `validation.emptyDescriptions`: Warn about transactions with no description
- `validation.includeFiles`: Detect missing include files
- `validation.circularIncludes`: Detect circular include dependencies
- `validation.markAllUndeclaredInstances`: Mark all instances of undeclared
resources with diagnostics, not just the first occurrence

### Severity Settings

Customize the severity level for undeclared item warnings. Options: `"error"`,
`"warning"`, `"information"`, `"hint"`

- `severity.undeclaredAccounts` (default: "warning")
- `severity.undeclaredPayees` (default: "warning")
- `severity.undeclaredCommodities` (default: "warning")
- `severity.undeclaredTags` (default: "information")

### Include Settings

- `include.followIncludes` (boolean, default: true): Parse and merge included
journal files
- `include.maxDepth` (number, default: 10): Maximum include depth to prevent
infinite recursion

### Workspace Settings

Enable workspace-aware parsing for features that need global context (running balances, completion, validation):

- `workspace.enabled` (boolean, default: true): Enable workspace-aware parsing. When enabled, the server discovers all journal files in your workspace, builds an include graph, and identifies root files. This allows features to access workspace-wide state even when working with "leaf" files that don't include other files.
- `workspace.eagerParsing` (boolean, default: true): Parse all discovered files eagerly on startup. If disabled, files are parsed on-demand.
- `workspace.autoDetectRoots` (boolean, default: true): Automatically detect root files using heuristics (files with no parents, files that include many others). If disabled, only explicitly configured root files are used (see Configuration File Support below).

**Configuration File Support:**

You can create a `.hledger-lsp.json` file in your workspace to explicitly configure workspace behavior:

```json
{
  "rootFiles": ["main.journal", "budget.journal"],
  "include": ["**/*.journal", "**/*.hledger"],
  "exclude": ["**/archive/**", "**/temp/**"],
  "workspace": {
    "enabled": true,
    "eagerParsing": true,
    "autoDetectRoots": false
  }
}
```

Settings:
- `rootFiles` (array of strings): Explicit root files (paths relative to config file)
- `include` (array of glob patterns): File discovery patterns (default: `["**/*.journal", "**/*.hledger"]`)
- `exclude` (array of glob patterns): Files to exclude (default: `["**/node_modules/**", "**/.git/**", "**/.*"]`)
- `workspace` (object): Same workspace settings as above

**Important**: The `.hledger-lsp.json` file is ONLY for workspace structure configuration (which files to discover, which are roots, etc.). LSP feature settings like inlay hints, code lens, validation rules, and formatting preferences should be configured in your editor/IDE settings (VS Code `settings.json`, Neovim LSP config, etc.).

The configuration file will be automatically discovered by walking up the directory tree from your journal files. Settings from VS Code/editor configuration override settings from the config file.

**Performance Tips:**
- For large workspaces (>100 files), use `exclude` patterns to skip unnecessary files
- Disable `eagerParsing` if initialization is slow
- Check LSP server logs for performance warnings and metrics

### Completion Settings

Control which items appear in auto-completion suggestions. All settings default
to `true` (only show declared items):

- `completion.onlyDeclaredAccounts` (boolean, default: true): Only show accounts
declared with `account` directive in completions
- `completion.onlyDeclaredPayees` (boolean, default: true): Only show payees
declared with `payee` directive in completions
- `completion.onlyDeclaredCommodities` (boolean, default: true): Only show
commodities declared with `commodity` directive in completions
- `completion.onlyDeclaredTags` (boolean, default: true): Only show tags
declared with `tag` directive in completions

Set to `false` to include items that are used but not explicitly declared in
completions.

### Formatting Settings

Configure document formatting behavior:

- `formatting.indentation` (number, default: 4): Number of spaces for posting
indentation
- `formatting.maxAccountWidth` (number, default: 42): Maximum width allocated
for account names before wrapping/truncation
- `formatting.maxCommodityWidth` (number, default: 4): Maximum width allocated
for commodity symbols
- `formatting.maxAmountWidth` (number, default: 12): Maximum width allocated for
amount numbers
- `formatting.minSpacing` (number, default: 2): Minimum number of spaces between
account names and amounts
- `formatting.decimalAlignColumn` (number, default: 52): Target column position
for aligning decimal points in amounts
- `formatting.assertionDecimalAlignColumn` (number, default: 70): Target column
position for aligning decimal points in balance assertions

### Inlay Hints Settings

Configure which inline hints to display (all disabled by default):

- `inlayHints.showInferredAmounts` (boolean, default: false): Show calculated
amounts for postings that omit explicit amounts
- `inlayHints.showRunningBalances` (boolean, default: false): Display running
balance after each posting
- `inlayHints.showCostConversions` (boolean, default: false): Show total cost in
target commodity for postings with @ or @@ notation

### Code Lens Settings

Configure which code lenses to display (all disabled by default):

- `codeLens.showRunningBalances` (boolean, default: false): Show running
balances after each transaction as code lenses
- `codeLens.showTransactionCounts` (boolean, default: false): Show transaction
counts for each account on transaction headers

**Note:** Code lens and inlay hints can both show running balances. Choose one
or the other based on your preference. Code lenses are more prominent and
appear on separate lines, while inlay hints are subtle and inline.

## Development

### Building from Source

If you want to contribute or modify the language server:

```bash
# Clone the repository
git clone https://github.com/ptimoney/hledger-lsp.git
cd hledger-lsp

# Install dependencies (from repository root)
npm install

# Build the server
npm run build:server

# Run the server directly
node server/out/server.js --stdio
```

### Project Structure

hledger_lsp/
├── server/
│   ├── src/
│   │   ├── server.ts       # Main LSP server implementation
│   │   ├── types.ts        # Type definitions for hledger structures
│   │   ├── parser/         # Journal file parser
│   │   ├── features/       # LSP feature implementations
│   │   └── utils/          # Utility functions
│   ├── out/                # Compiled JavaScript output
│   └── package.json
└── vscode-client/          # VS Code extension

### Development Commands

From the `server/` directory:

```bash
# Build once
npm run build

# Watch mode (rebuild on changes)
npm run watch
```

### Linting

```bash
npm run lint
```

### Testing

The project includes comprehensive test coverage using Jest:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage

# Run tests with verbose output
npm run test:verbose

# Run specific test file
npx jest tests/parser/index.test.ts

# Run tests matching a pattern
npx jest --testNamePattern="balance"
```

Test files mirror the `src/` directory structure (515 test cases total):

- `tests/utils/index.test.ts` - Utility function tests
- `tests/utils/uri.test.ts` - URI encoding/decoding tests for paths with spaces
- `tests/parser/index.test.ts` - Parser tests
- `tests/parser/parentInclude.test.ts` - Parent directory include tests
- `tests/parser/includeGlob.test.ts` - Glob pattern include tests
- `tests/features/completion.test.ts` - Completion provider tests
- `tests/features/validator.test.ts` - Validation tests
- `tests/features/validator-includes.test.ts` - Include directive validation
tests
- `tests/features/formatter.test.ts` - Formatting tests (30 test cases including
decimal alignment)
- `tests/features/symbols.test.ts` - Symbol provider tests
- `tests/features/codeActions.test.ts` - Code action tests (including rename
refactoring)
- `tests/features/hover.test.ts` - Hover provider tests
- `tests/features/definition.test.ts` - Definition provider tests
- `tests/features/findReferences.test.ts` - Find references tests
- `tests/features/inlayHints.test.ts` - Inlay hints tests
- `tests/features/semanticTokens.test.ts` - Semantic highlighting tests (20 test
cases)
- `tests/features/foldingRanges.test.ts` - Folding ranges tests (9 test cases)
- `tests/features/documentLinks.test.ts` - Document links tests (9 test cases)
- `tests/features/selectionRange.test.ts` - Selection range tests (11 test
cases)
- `tests/features/transactionAnalyzer.test.ts` - Transaction pattern analysis
tests
- `tests/features/smartCompletion.integration.test.ts` - Smart completion
integration tests
- `tests/integration/spaces-in-path.test.ts` - Integration tests for file paths
with spaces

## Roadmap

### Completed Features

- [x] Basic LSP server setup
- [x] Project scaffolding
- [x] Journal file parser with full hledger syntax support
- [x] Comprehensive validation (11+ validation rules)
- [x] Account name completion
- [x] Payee completion
- [x] Commodity completion
- [x] Tag completion
- [x] Directive completion
- [x] Include path completion
- [x] Configurable completion filtering (declared items only vs. all items)
- [x] Transaction balance validation
- [x] Balance assertions validation
- [x] Date validation and ordering
- [x] Undeclared items detection
- [x] Include directive support with circular detection
- [x] Multi-file journal support with dependency tracking
- [x] User-configurable validation and severity levels
- [x] Hover information
- [x] Source location tracking
- [x] Go to definition (accounts, payees, commodities, tags)
- [x] Document symbols (outline view showing directives and transactions)
- [x] Workspace symbols (project-wide search for accounts, payees, commodities,
tags, transactions)
- [x] Code actions and quick fixes (add declarations for undeclared items)
- [x] Rename refactoring (rename accounts, payees, commodities, tags across all
references)
- [x] Formatting support (document, range, and on-type formatting)
- [x] Enhanced formatting (amount alignment, commodity format support, precision
preservation)
- [x] Semantic highlighting (context-aware token highlighting with types and
modifiers)

### Recently Added

- [x] Folding ranges (collapse transactions and comment blocks)
- [x] Document links (clickable include paths)
- [x] Selection range (smart text selection expansion)
- [x] URI encoding/decoding support for file paths with spaces and special
characters
- [x] Find references (show all usages of accounts, payees, commodities, tags)
- [x] Inlay hints (inferred amounts, running balances, cost conversions)
- [x] Transaction pattern analysis for smart completions
- [x] Comprehensive test coverage (515 tests)

### Planned Features

- [ ] Integration with hledger CLI for validation
- [ ] Code lens (show account balances, transaction counts)
- [ ] More sophisticated hover information (balances, commodity info)

See [ROADMAP.md](ROADMAP.md) for a comprehensive list of proposed features and
future development ideas.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Resources

- [hledger Documentation](https://hledger.org/)
- [LSP Specification](https://microsoft.github.io/language-server-protocol/)
- [vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node)
