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

Use the dedicated plugin: [ptimoney/hledger-nvim](https://github.com/ptimoney/hledger-nvim)

The plugin provides:
- Automatic LSP configuration
- Filetype detection for `.journal` and `.hledger` files
- Workspace graph visualization (`:HledgerGraph`)
- Easy configuration of all server settings

See the plugin repository for installation and configuration instructions.

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

Most validation settings default to `true` and can be individually disabled:

- `validation.balance` (default: true): Verify transactions balance to zero per commodity
- `validation.missingAmounts` (default: true): Ensure at most one posting per transaction omits an amount
- `validation.undeclaredAccounts` (default: true): Warn about accounts used but not declared
- `validation.undeclaredPayees` (default: **false**): Warn about payees used but not declared
- `validation.undeclaredCommodities` (default: true): Warn about commodities used but not declared
- `validation.undeclaredTags` (default: true): Warn about tags used but not declared
- `validation.dateOrdering` (default: true): Detect transactions with dates out of chronological order
- `validation.balanceAssertions` (default: true): Verify balance assertions match calculated balances
- `validation.emptyTransactions` (default: true): Require at least 2 postings per transaction
- `validation.invalidDates` (default: true): Check for invalid dates (e.g., February 30, month 13)
- `validation.futureDates` (default: true): Warn about future-dated transactions
- `validation.emptyDescriptions` (default: true): Warn about transactions with no description
- `validation.includeFiles` (default: true): Detect missing include files
- `validation.circularIncludes` (default: true): Detect circular include dependencies
- `validation.markAllUndeclaredInstances` (default: **true**): Mark all instances of undeclared resources with diagnostics, not just the first occurrence

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

- `workspace.enabled` (boolean, default: true): Enable workspace-aware parsing. When enabled, the server discovers all journal files in your workspace, builds an include graph, and identifies a single root file. This allows features to access workspace-wide state even when working with "leaf" files that don't include other files.
- `workspace.eagerParsing` (boolean, default: true): Parse all discovered files eagerly on startup. If disabled, files are parsed on-demand.
- `workspace.autoDetectRoot` (boolean, default: true): Automatically detect the root file using heuristics (prefers files with no parents that include many others, with names like "main", "all", or "index"). If disabled, only an explicitly configured root file is used (see Configuration File Support below).

**Configuration File Support:**

You can create a `.hledger-lsp.json` file in your workspace to explicitly configure workspace behavior:

```json
{
  "rootFile": "main.journal",
  "include": ["**/*.journal", "**/*.hledger"],
  "exclude": ["**/archive/**", "**/temp/**"],
  "workspace": {
    "enabled": true,
    "eagerParsing": true,
    "autoDetectRoot": false
  }
}
```

Settings:
- `rootFile` (string): Explicit root file path (relative to config file location)
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

Configure which code lenses to display (disabled by default):

- `codeLens.showTransactionCounts` (boolean, default: false): Show transaction counts for each account on transaction headers

**Note:** Running balances are now exclusively shown via inlay hints (`inlayHints.showRunningBalances`), which is a more natural place for position-sensitive information that appears inline with postings.

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

Test files mirror the `src/` directory structure (515 test cases total)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Resources

- [hledger Documentation](https://hledger.org/)
- [LSP Specification](https://microsoft.github.io/language-server-protocol/)
- [vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node)
