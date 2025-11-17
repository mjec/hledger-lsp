# hledger Language Server - Feature Roadmap

This document tracks potential features and enhancements for future development.

## Currently Planned

These features are prioritized for near-term implementation:

### Integration with hledger CLI
**Status:** Planned
**Complexity:** Medium-High
**Description:** Integrate with the actual hledger CLI tool for validation instead of relying solely on LSP parsing. This would provide:
- More accurate validation matching hledger's behavior
- Access to hledger's built-in checks and reports
- Ability to validate complex hledger features we haven't implemented yet

**Implementation Notes:**
- Need to spawn hledger process and parse its output
- Handle different hledger versions and installations
- Provide fallback when hledger is not available
- Add setting for hledger executable path (already in settings as `hledgerPath`)

### Code Lens
**Status:** Planned
**Complexity:** Medium
**Description:** Display inline information in the editor using LSP code lens feature:
- Show running balances for accounts after transactions
- Display transaction counts per account
- Show commodity totals
- Display balance assertions status

**Implementation Notes:**
- Requires LSP `codeLensProvider` capability
- Need to calculate running balances efficiently
- Should be configurable (enable/disable, what to show)
- May need caching for performance

### Enhanced Hover Information
**Status:** Planned
**Complexity:** Low-Medium
**Description:** Improve hover information to show more useful context:
- Account balances when hovering over account names
- Commodity format information when hovering over commodities
- Declaration locations (which file/line an item was declared)
- Transaction totals when hovering over transaction headers
- Tag value statistics when hovering over tags

**Implementation Notes:**
- Extend existing hover provider
- Need to track balances and statistics
- Add links to declaration locations

## Editor Integration Features

Standard LSP features that enhance the editing experience:

### Folding Ranges
**Status:** ✅ Completed
**Complexity:** Low
**Description:** Enable code folding for:
- Individual transactions (collapse postings)
- Multi-line comment blocks
- Transaction-level comments included in folds

**Implementation:**
- Implemented LSP `foldingRangeProvider` in `src/features/foldingRanges.ts`
- Transactions with postings can be folded (Region kind)
- Multi-line comment blocks can be folded (Comment kind)
- 9 comprehensive tests covering all edge cases
- Works automatically in any LSP-compatible editor

### Document Links
**Status:** ✅ Completed
**Complexity:** Low
**Description:** Make include paths clickable:
- Click on `include path.journal` to open the file
- Support relative paths (`../shared/accounts.journal`)
- Support absolute paths
- Handle paths with comments on the same line

**Implementation:**
- Implemented LSP `documentLinkProvider` in `src/features/documentLinks.ts`
- Resolves paths using existing path resolution logic
- Returns proper file:// URIs
- 9 comprehensive tests with various path formats
- Works automatically in editors that support document links

### Selection Range
**Status:** ✅ Completed
**Complexity:** Low-Medium
**Description:** Smart selection expansion when user triggers "expand selection":
- Word → Account name → Posting → Transaction
- Word → Transaction header → Transaction
- Works for transactions, postings, comments, and directives

**Implementation:**
- Implemented LSP `selectionRangeProvider` in `src/features/selectionRange.ts`
- Hierarchical selection boundaries for semantic expansion
- 11 comprehensive tests covering all selection scenarios
- Requires editor keybinding setup (see README for Neovim configuration)
- Recommended plugin: `nvim-lsp-selection-range` for Neovim users

## Hledger-Specific Features

Features that leverage hledger domain knowledge:

### Auto-Balancing
**Status:** Proposed
**Complexity:** Low
**Description:** Code action to automatically add balancing posting:
- Detect unbalanced transactions
- Offer quick fix to insert balancing posting
- Handle multi-commodity transactions
- Suggest account name (most common balancing account, or prompt user)

**Implementation Notes:**
- Extend code actions provider
- Calculate required balancing amount(s)
- Smart account suggestion based on transaction patterns
- Handle edge cases (multiple missing postings)

### Duplicate Transaction Detection
**Status:** Proposed
**Complexity:** Medium
**Description:** Warn about potentially duplicate transactions:
- Detect transactions with same date, payee, and amounts
- Configurable fuzzy matching (similar amounts, dates within X days)
- Provide quick fix to remove/mark duplicates
- Exclude marked duplicates from reports

**Implementation Notes:**
- Add new validation rule
- Implement efficient duplicate detection algorithm
- Add settings for sensitivity/matching criteria
- Consider performance impact on large files

### Date Helpers
**Status:** Proposed
**Complexity:** Low
**Description:** Commands and shortcuts for date manipulation:
- Command to insert today's date
- Increment/decrement date (day, week, month)
- Convert between date formats (YYYY-MM-DD ↔ YYYY/MM/DD)
- Quick date picker integration (if client supports)

**Implementation Notes:**
- Implement as LSP commands
- Add keyboard shortcuts (client-specific configuration)
- Handle effective dates correctly
- Support different date formats

### Account Hierarchy View
**Status:** Proposed
**Complexity:** High (requires client support)
**Description:** Tree view of account hierarchy:
- Collapsible account tree (Assets → Assets:Cash → Assets:Cash:Checking)
- Show account types (asset, liability, expense, income, equity)
- Display current balances in tree
- Click to navigate to account declaration

**Implementation Notes:**
- May require custom client implementation (not standard LSP)
- Could use workspace symbols as alternative
- Consider providing data structure that clients can render
- VS Code would need custom tree view provider

### Inline Balance Reports
**Status:** Proposed
**Complexity:** Medium-High
**Description:** Display calculated balances as virtual text or code lens:
- Running balance after each transaction
- Account totals at end of file or date ranges
- Period summaries (monthly/quarterly totals)
- Budget vs. actual comparisons

**Implementation Notes:**
- Use code lens or inlay hints
- Efficient balance calculation and caching
- Configurable display options
- Handle multi-commodity balances

### Transaction Templates
**Status:** Proposed
**Complexity:** Medium
**Description:** Quick insertion of common transaction patterns:
- User-defined transaction templates
- Snippet-based insertion with placeholders
- Learn from transaction history (suggest based on patterns)
- Template variables (date, month, year, etc.)

**Implementation Notes:**
- Could use LSP snippets/completion
- Store templates in config or separate file
- Integrate with smart completions
- Template expansion with variables

### Split Transaction Helper
**Status:** Proposed
**Complexity:** Low-Medium
**Description:** Tool to split a posting into multiple postings:
- Select a posting and trigger "split" action
- Prompt for number of splits or amounts
- Distribute amount across new postings
- Preserve balance (ensure splits sum to original)

**Implementation Notes:**
- Implement as code action
- UI for gathering split information (might be client-specific)
- Handle different split strategies (equal, percentage, explicit amounts)
- Maintain transaction balance

### Commodity Conversion Display
**Status:** Proposed
**Complexity:** High
**Description:** Show equivalent values in different commodities:
- Display USD equivalent for foreign currency amounts
- Show cost basis for investments
- Require price database or market prices
- Real-time or cached conversion rates

**Implementation Notes:**
- Need price database (from hledger or external source)
- Parse commodity prices from journal files
- Display as inlay hints or hover information
- Handle price lookups and caching
- Consider integration with external price APIs

## Performance & Infrastructure

Features focused on performance and developer experience:

### Incremental Parsing
**Status:** Proposed
**Complexity:** High
**Description:** Only reparse changed portions of documents:
- Parse only modified transactions
- Update affected balances incrementally
- Reduce latency for large files

**Implementation Notes:**
- Significant parser refactoring required
- Track document change ranges
- Invalidate dependent calculations
- Benchmark performance gains

### WebAssembly Version
**Status:** Proposed
**Complexity:** High
**Description:** Compile LSP server to WebAssembly for browser-based editors:
- Enable use in VS Code web, GitHub Codespaces
- No Node.js dependency
- Portable across platforms

**Implementation Notes:**
- Investigate TypeScript → WASM compilation
- Handle file system access differently
- Test in browser environments
- Consider bundle size

### Language Server Protocol Extensions
**Status:** Proposed
**Complexity:** Varies
**Description:** Explore newer LSP features:
- Inline values (show variable values inline while debugging)
- Call hierarchy (show transaction flow between accounts)
- Type hierarchy (account type inheritance)
- Linked editing ranges (rename in multiple locations simultaneously)

**Implementation Notes:**
- Evaluate which extensions make sense for hledger
- Implement based on priority and usefulness
- Ensure backward compatibility

## Testing & Quality

Improvements to testing and code quality:

### End-to-End Tests
**Status:** Proposed
**Complexity:** Medium
**Description:** Full integration tests with real LSP clients:
- Test with actual Neovim/VS Code
- Automated UI interaction tests
- Performance benchmarks on large files

**Implementation Notes:**
- Set up CI/CD pipeline
- Configure test clients
- Create realistic test journals
- Measure and track performance metrics

### Property-Based Testing
**Status:** Proposed
**Complexity:** Medium
**Description:** Use property-based testing for parser and validator:
- Generate random valid/invalid journal files
- Test parser robustness
- Ensure validators don't crash on malformed input

**Implementation Notes:**
- Add fast-check or similar library
- Define journal file grammar for generation
- Create properties to test (parse → format → parse = identity)

## Community & Documentation

Features to improve adoption and contributor experience:

### VS Code Extension
**Status:** Proposed
**Complexity:** Medium
**Description:** Official VS Code extension that bundles the LSP:
- Auto-install and configure language server
- VS Code marketplace publication
- Extension-specific settings UI
- Syntax highlighting grammar

**Implementation Notes:**
- Create separate extension repository
- Package language server with extension
- Write extension activation code
- Submit to marketplace

### Interactive Tutorial
**Status:** Proposed
**Complexity:** Low-Medium
**Description:** In-editor tutorial for learning hledger:
- Step-by-step guided exercises
- Inline hints and feedback
- Sample journal files with exercises
- Progressive difficulty

**Implementation Notes:**
- Create tutorial content
- Use LSP diagnostics for feedback
- Provide sample files
- Consider interactive commands/walkthroughs

### Documentation Generator
**Status:** Proposed
**Complexity:** Low
**Description:** Generate documentation from journal files:
- Account reference documentation
- Payee/vendor lists
- Tag documentation
- Commodity lists with formats

**Implementation Notes:**
- Add command to export docs
- Support multiple output formats (Markdown, HTML)
- Extract comments as descriptions
- Generate account hierarchy diagrams

## Priority Guidelines

When selecting features to implement, consider:

1. **User Impact**: Features that improve daily workflows for most users
2. **Complexity**: Balance quick wins (low complexity) with high-value features
3. **LSP Standards**: Prefer standard LSP features over custom extensions
4. **Stability**: Ensure new features don't regress existing functionality
5. **Testing**: All new features should have comprehensive tests

## Contributing

Interested in implementing any of these features? Please:

1. Open an issue to discuss the feature and approach
2. Reference this roadmap document
3. Follow the existing code patterns and testing practices
4. Update this document when features move from "Proposed" to "Planned" or "Completed"
