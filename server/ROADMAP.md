# hledger Language Server - Feature Roadmap

This document tracks potential features and enhancements for future development.

**Current Version:** 0.1.5
**Last Updated:** 2025-11-26

## Currently Planned

These features are prioritized for near-term implementation:

### Code Lens
**Status:** Next Priority
**Complexity:** Medium
**Description:** Display inline information in the editor using LSP code lens feature:
- Show running balances for accounts after transactions
- Display transaction counts per account
- Show commodity totals
- Display balance assertions status
- Clickable actions (e.g., "Show account history")

**Implementation Notes:**
- Requires LSP `codeLensProvider` capability
- Balance calculation logic already exists (used in inlay hints)
- Should be configurable (enable/disable, what to show)
- May need caching for performance with large files
- Test coverage needed for various scenarios

### Enhanced Hover Information
**Status:** High Priority
**Complexity:** Low-Medium
**Description:** Improve hover information to show more useful context:
- Account balances when hovering over account names (with commodity breakdown)
- Commodity format information when hovering over commodities
- Declaration locations (which file/line an item was declared) with clickable links
- Transaction totals when hovering over transaction headers
- Tag value statistics when hovering over tags (frequency, common values)
- First/last usage dates for accounts and payees

**Implementation Notes:**
- Extend existing hover provider in `src/features/hover.ts`
- Leverage balance tracking from validator and inlay hints
- Add DocumentLink-style links to declaration locations
- Format hover content using Markdown for better readability

### Auto-Balancing Code Action
**Status:** High Priority
**Complexity:** Low
**Description:** Code action to automatically add balancing posting to unbalanced transactions:
- Detect unbalanced transactions (leverage existing validation)
- Offer quick fix to insert balancing posting
- Handle multi-commodity transactions (create posting per commodity)
- Smart account suggestion based on transaction patterns (most common balancing account for the payee)
- Insert at appropriate location (end of transaction)

**Implementation Notes:**
- Extend `src/features/codeActions.ts`
- Reuse transaction balance calculation from validator
- Use transactionAnalyzer to suggest likely balancing account
- Handle edge cases (multiple missing postings, already balanced)
- Add configuration option for default balancing account

### Integration with hledger CLI
**Status:** Planned (Medium Priority)
**Complexity:** Medium-High
**Description:** Integrate with the actual hledger CLI tool for validation instead of relying solely on LSP parsing. This would provide:
- More accurate validation matching hledger's behavior
- Access to hledger's built-in checks and reports
- Ability to validate complex hledger features we haven't implemented yet
- Optional/fallback mode (graceful degradation when hledger unavailable)

**Implementation Notes:**
- Need to spawn hledger process and parse its output
- Handle different hledger versions and installations
- Provide fallback when hledger is not available
- Setting for hledger executable path already exists (`hledgerPath`)
- Consider async execution to avoid blocking
- Parse hledger error messages into LSP diagnostics

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

## Quality of Life Improvements

Small, high-impact features that improve daily workflow:

### Date Helpers
**Status:** Proposed
**Complexity:** Low
**Description:** Commands and shortcuts for date manipulation:
- Command to insert today's date at cursor
- Increment/decrement date (day, week, month) via keyboard shortcut
- Convert between date formats (YYYY-MM-DD ↔ YYYY/MM/DD)
- Quick date picker integration (if client supports)
- Relative date insertion (e.g., "last Monday", "next Friday")

**Implementation Notes:**
- Implement as LSP commands (registered in server.ts)
- Add keyboard shortcuts (client-specific configuration)
- Handle effective dates correctly (date after transaction date)
- Support different date formats configured in settings
- Code actions for date format conversion

### Batch Code Actions
**Status:** Proposed
**Complexity:** Low
**Description:** Bulk operations for common tasks:
- "Add all missing declarations" - fix all undeclared items at once
- "Fix all balance errors" - add balancing postings to all unbalanced transactions
- "Sort transactions by date" - reorder entire file chronologically
- Configurable to work on selection or entire document

**Implementation Notes:**
- Extend code actions to support workspace edits affecting multiple ranges
- Provide progress indication for large operations
- Make reversible (support undo)
- Add confirmation prompt for destructive operations

### Posting Comments Preservation
**Status:** Proposed
**Complexity:** Low
**Description:** Ensure inline comments on postings are preserved during formatting:
- Maintain comments at end of posting lines
- Preserve vertical spacing of comment blocks within transactions
- Align inline comments consistently

**Implementation Notes:**
- Enhance formatter to track and preserve posting-level comments
- Add tests for various comment placements
- Consider adding setting for comment alignment column

## Hledger-Specific Features

Features that leverage hledger domain knowledge:

### Duplicate Transaction Detection
**Status:** Proposed
**Complexity:** Medium
**Description:** Warn about potentially duplicate transactions:
- Detect transactions with same date, payee, and amounts
- Configurable fuzzy matching (similar amounts, dates within X days)
- Provide quick fix to remove/mark duplicates
- Whitelist certain patterns (e.g., recurring subscriptions)

**Implementation Notes:**
- Add new validation rule in `src/features/validator.ts`
- Implement efficient duplicate detection algorithm (hash-based comparison)
- Add settings for sensitivity/matching criteria
- Consider performance impact on large files (batch processing)
- Code action to mark as "not duplicate" or remove

### Tag Value Completion
**Status:** Proposed
**Complexity:** Low-Medium
**Description:** Auto-complete tag values based on historical usage:
- Complete tag values when typing after `tagname:`
- Learn from existing tags in the journal
- Show most frequently used values first
- Support multi-value tags

**Implementation Notes:**
- Extend completion provider to detect tag value context
- Track tag values during parsing (add to ParsedDocument)
- Rank by frequency of use
- Handle both inline and transaction-level tags

### Posting Auto-completion Within Transactions
**Status:** Proposed
**Complexity:** Medium
**Description:** Suggest complete posting patterns based on first posting:
- After entering first posting, suggest likely second posting
- Based on transaction analyzer patterns (account pairs)
- Include suggested amounts (negative of first posting for 2-posting transactions)
- Learn from historical transaction patterns

**Implementation Notes:**
- Extend transaction analyzer to track posting pairs
- Trigger completion when entering new posting line
- Calculate inverse amount automatically
- Integrate with smart completions

### Account Hierarchy View
**Status:** Proposed (Low Priority)
**Complexity:** High (requires client support)
**Description:** Tree view of account hierarchy:
- Collapsible account tree (Assets → Assets:Cash → Assets:Cash:Checking)
- Show account types (asset, liability, expense, income, equity)
- Display current balances in tree
- Click to navigate to account declaration

**Implementation Notes:**
- May require custom client implementation (not standard LSP)
- Current workspace symbols already provide hierarchical view
- Consider providing data structure that clients can render
- VS Code would need custom tree view provider
- **Note:** Workspace symbols may be sufficient for most use cases

### Inline Balance Reports
**Status:** Proposed (Partially Implemented)
**Complexity:** Medium
**Description:** Display calculated balances as virtual text or code lens:
- Running balance after each transaction (via code lens - planned)
- Account totals at end of file or date ranges
- Period summaries (monthly/quarterly totals)
- Budget vs. actual comparisons

**Implementation Notes:**
- Running balances already available via inlay hints
- Code lens would provide more visible/clickable interface
- Efficient balance calculation and caching already implemented
- Configurable display options needed
- Handle multi-commodity balances (already supported)

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
**Status:** Proposed (Low Priority)
**Complexity:** High
**Description:** Compile LSP server to WebAssembly for browser-based editors:
- Enable use in VS Code web, GitHub Codespaces
- No Node.js dependency
- Portable across platforms

**Implementation Notes:**
- Investigate TypeScript → WASM compilation
- Handle file system access differently (WASI or browser APIs)
- Test in browser environments
- Consider bundle size (current server is relatively small)
- **Note:** Consider prioritizing feature completeness before platform expansion

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
**Status:** ✅ Completed
**Complexity:** Medium
**Description:** Official VS Code extension that bundles the LSP:
- ✅ Auto-install and configure language server
- ✅ Bundled using esbuild for fast loading
- ✅ Extension-specific settings UI
- ✅ File type detection for .journal and .hledger files
- ✅ Commands for server control (reload, logs, toggle features)

**Implementation:**
- Located in `vscode-client/` directory
- Packages language server with extension
- Extension activation code in `extension.ts`
- VSIX package built and ready for distribution
- Settings mapped from LSP server configuration

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

## Recent Additions (v0.1.5)

Recently completed features:
- ✅ Inlay hints (inferred amounts, running balances, cost conversions)
- ✅ Transaction pattern analysis for smart completions
- ✅ Comprehensive test coverage (515+ tests)
- ✅ VS Code extension with esbuild bundling
- ✅ Improved decimal alignment in formatter
- ✅ Refactored data structures for better performance

## Priority Guidelines

When selecting features to implement, consider:

1. **User Impact**: Features that improve daily workflows for most users
2. **Complexity**: Balance quick wins (low complexity) with high-value features
3. **LSP Standards**: Prefer standard LSP features over custom extensions
4. **Stability**: Ensure new features don't regress existing functionality
5. **Testing**: All new features must have comprehensive tests (follow existing patterns)
6. **Performance**: Consider impact on large journal files (1000+ transactions)

## Recommended Next Steps

Based on current state and user needs, recommended implementation order:

### Phase 1: High-Impact, Low-Effort (Next 2-3 releases)
1. **Code Lens** - Visible running balances (reuses existing logic)
2. **Enhanced Hover** - Better contextual information (extends existing feature)
3. **Auto-Balancing** - Quick fix for unbalanced transactions (high utility)
4. **Date Helpers** - Quality of life improvement (fast to implement)

### Phase 2: Powerful Features (Medium-term)
5. **Tag Value Completion** - Extends completion system
6. **Duplicate Detection** - New validation rule
7. **Batch Code Actions** - Bulk operations
8. **Posting Auto-completion** - Smart posting suggestions

### Phase 3: Advanced Integration (Long-term)
9. **hledger CLI Integration** - External validation and reports
10. **Transaction Templates** - Advanced productivity features
11. **Commodity Conversion Display** - Price database integration

## Additional Feature Ideas

Features under consideration (not yet prioritized):

### Account Name Normalization
- Code action to standardize account naming conventions
- Fix capitalization inconsistencies
- Standardize separators (colons vs periods)
- Apply organization-wide account naming rules

### Transaction Sorting
- Command to sort transactions by date
- Maintain transaction groups and comments
- Sort within date ranges (preserve file structure)
- Handle effective dates correctly

### Balance Sheet Report View
- Virtual document showing balance sheet
- Requires hledger CLI integration
- Read-only view updated on save
- Multiple report types (balance, register, etc.)

### Quick Transaction Entry
- Command palette command for rapid entry
- Step-through prompts for date, payee, accounts, amounts
- Uses smart completions and patterns
- Inserts transaction at appropriate location

### Multi-cursor Amount Editing
- Bulk update amounts across multiple postings
- Percentage-based adjustments
- Currency conversion
- Preserve transaction balance

### Payee Aliasing
- Code action to normalize payee names
- Learn common aliases (e.g., "Amazon.com" → "Amazon")
- Suggest payee declarations with aliases
- Apply consistently across journal

## Contributing

Interested in implementing any of these features? Please:

1. Open an issue to discuss the feature and approach
2. Reference this roadmap document
3. Follow the existing code patterns and testing practices
4. Ensure comprehensive test coverage (see existing test files for patterns)
5. Update this document when features move from "Proposed" to "Planned" or "Completed"
6. Update CLAUDE.md if the feature introduces new architectural patterns
