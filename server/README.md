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
- npm or yarn

### Install from npm (recommended)

Global install:

```bash
npm install -g hledger-lsp
```

This provides an `hledger-lsp` CLI on your `$PATH`:

```bash
hledger-lsp --stdio
```

You can also install it per project:

```bash
npm install --save-dev hledger-lsp
```

### From source (development)

```bash
# Clone the repository
git clone <repository-url>
cd hledger_lsp

# Install dependencies
npm install

# Build the project
npm run build

# Run the server directly
node server/out/server.js --stdio
```

## Usage

### Neovim configuration examples

#### Global npm install

```lua
local lspconfig = require("lspconfig")

lspconfig.hledger_lsp.setup({
  cmd = { "hledger-lsp", "--stdio" },
  filetypes = { "hledger", "journal" },
})
```

#### Local (per-project) install

```lua
local lspconfig = require("lspconfig")
local util = lspconfig.util

lspconfig.hledger_lsp.setup({
  cmd = { util.path.join(vim.loop.cwd(), "node_modules", ".bin", "hledger-lsp"), "--stdio" },
  filetypes = { "hledger", "journal" },
})
```

### Neovim Configuration

#### Minimal Configuration (Recommended for Most Users)

This minimal configuration uses all default settings. Add this to your Neovim
configuration (e.g., in `~/.config/nvim/lua/plugins/hledger.lua` if using
lazy.nvim):

```lua
return {
  {
    "neovim/nvim-lspconfig",
    opts = function(_, opts)
      opts.servers = opts.servers or {}
      opts.servers.hledger = {}

      opts.setup = opts.setup or {}
      opts.setup.hledger = function()
        vim.lsp.config("hledger", {
          cmd = { "node", vim.fn.expand("~/Development/hledger_lsp/out/server.js"), "--stdio" },
          filetypes = { "hledger" },
          root_markers = { ".hledger.journal", "main.journal", ".git" },
          settings = {},
        })
        vim.lsp.enable("hledger")
        return true
      end
    end,
  },
}
```

**Note:** Update the path in
`vim.fn.expand("~/Development/hledger_lsp/out/server.js")` to match where you
cloned this repository.

#### Full Configuration (For Customization)

If you want to customize specific settings, here's the complete configuration
with all options explicitly set to their defaults. Modify only the settings you
want to change:

```lua
return {
  {
    "neovim/nvim-lspconfig",
    opts = function(_, opts)
      opts.servers = opts.servers or {}
      opts.servers.hledger = {}

      opts.setup = opts.setup or {}
      opts.setup.hledger = function()
        vim.lsp.config("hledger", {
          cmd = { "node", vim.fn.expand("~/Development/hledger_lsp/out/server.js"), "--stdio" },
          filetypes = { "hledger" },
          root_markers = { ".hledger.journal", "main.journal", ".git" },
          settings = {
            hledgerLanguageServer = {
              -- Maximum number of diagnostic problems to report
              maxNumberOfProblems = 1000,

              -- Path to hledger executable (reserved for future CLI integration)
              hledgerPath = "hledger",

              -- Validation settings (all default to true)
              -- Set any to false to disable that validation
              validation = {
                balance = true,                -- Verify transactions balance to zero
                missingAmounts = true,         -- Ensure at most one posting omits amount
                undeclaredAccounts = true,     -- Warn about undeclared accounts
                undeclaredPayees = false,       -- Warn about undeclared payees
                undeclaredCommodities = true,  -- Warn about undeclared commodities
                undeclaredTags = true,         -- Warn about undeclared tags
                dateOrdering = true,           -- Detect out-of-order transactions
                balanceAssertions = true,      -- Verify balance assertions
                emptyTransactions = true,      -- Require at least 2 postings
                invalidDates = true,           -- Check for invalid dates (Feb 30, etc.)
                futureDates = true,            -- Warn about future-dated transactions
                emptyDescriptions = true,      -- Warn about transactions with no description
                includeFiles = true,           -- Detect missing include files
                circularIncludes = true,       -- Detect circular include dependencies
              },

              -- Severity levels for undeclared items (error | warning | information | hint)
              severity = {
                undeclaredAccounts = "warning",
                undeclaredPayees = "warning",
                undeclaredCommodities = "warning",
                undeclaredTags = "information",
              },

              -- Include directive settings
              include = {
                followIncludes = true,  -- Parse and merge included journal files
                maxDepth = 10,          -- Maximum include depth
              },

              -- Completion settings (all default to true - only show declared items)
              -- Set to false to include undeclared items in completions
              completion = {
                onlyDeclaredAccounts = true,
                onlyDeclaredPayees = true,
                onlyDeclaredCommodities = true,
                onlyDeclaredTags = true,
              },

              -- Formatting settings
              formatting = {
                indentation = 4,                    -- Number of spaces for posting indentation
                maxAccountWidth = 42,               -- Maximum width for account names
                maxCommodityWidth = 4,              -- Maximum width for commodity symbols
                maxAmountWidth = 12,                -- Maximum width for amount numbers
                minSpacing = 2,                     -- Minimum spaces between account and amount
                decimalAlignColumn = 52,            -- Target column for decimal alignment
                assertionDecimalAlignColumn = 70,   -- Target column for assertion decimal alignment
              },

              -- Inlay hints settings
              inlayHints = {
                showInferredAmounts = true,      -- Show calculated amounts for postings without amounts
                showRunningBalances = false,     -- Show running balances after each posting
                showCostConversions = true,      -- Show total cost for @ and @@ notations
              }
            }
          },
        })
        vim.lsp.enable("hledger")
        return true
      end
    end,
  },
}
```

**Note:** Update the path in
`vim.fn.expand("~/Development/hledger_lsp/out/server.js")` to match where you
cloned this repository.

#### File Type Detection

You may also want to set up file type detection for hledger files:

```lua
-- In your init.lua or ftdetect configuration
vim.filetype.add({
  extension = {
    journal = 'hledger',
    hledger = 'hledger',
  },
  pattern = {
    ['.*%.journal'] = 'hledger',
  }
})
```

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

Configure which inline hints to display:

- `inlayHints.showInferredAmounts` (boolean, default: true): Show calculated
amounts for postings that omit explicit amounts
- `inlayHints.showRunningBalances` (boolean, default: false): Display running
balance after each posting (can be noisy for large files)
- `inlayHints.showCostConversions` (boolean, default: true): Show total cost in
target commodity for postings with @ or @@ notation

## Development

### Project Structure

```
hledger_lsp/
├── src/
│   ├── server.ts           # Main LSP server implementation
│   ├── types.ts            # Type definitions for hledger structures
│   ├── parser/             # Journal file parser
│   │   └── index.ts
│   ├── features/           # LSP feature implementations
│   └── utils/              # Utility functions
│       └── index.ts
├── out/                    # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

### Building

```bash
# Build once
npm run build

# Watch mode for development
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
