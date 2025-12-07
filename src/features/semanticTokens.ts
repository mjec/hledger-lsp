import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticTokensBuilder } from 'vscode-languageserver/node';
import { ParsedDocument } from '../types';

/**
 * Semantic token types for hledger syntax.
 * These map to standard LSP semantic token types where possible.
 */
export enum TokenType {
  namespace = 0,    // Account names (hierarchical)
  type = 1,         // Dates
  class = 2,        // Payees
  enum = 3,         // Commodities/currencies
  property = 4,     // Tags
  keyword = 5,      // Directives (account, commodity, payee, etc.)
  number = 6,       // Amounts
  string = 7,       // Transaction codes
  comment = 8,      // Comments
  operator = 9,     // Status indicators (*, !)
}

/**
 * Semantic token modifiers for hledger syntax.
 */
export enum TokenModifier {
  declaration = 0,  // Item is being declared (directive)
  readonly = 1,     // Item is immutable (dates, amounts)
  deprecated = 2,   // Not used currently
}

/**
 * Token type names in the order they appear in the enum.
 * This array is sent to the client during initialization.
 */
export const tokenTypes: string[] = [
  'namespace',  // 0
  'type',       // 1
  'class',      // 2
  'enum',       // 3
  'property',   // 4
  'keyword',    // 5
  'number',     // 6
  'string',     // 7
  'comment',    // 8
  'operator',   // 9
];

/**
 * Token modifier names in the order they appear in the enum.
 * This array is sent to the client during initialization.
 */
export const tokenModifiers: string[] = [
  'declaration',  // 0
  'readonly',     // 1
  'deprecated',   // 2
];

/**
 * Convert modifier enums to bitmask
 */
function encodeModifiers(modifiers: TokenModifier[]): number {
  let result = 0;
  for (const modifier of modifiers) {
    result |= (1 << modifier);
  }
  return result;
}

/**
 * Provides semantic tokens for hledger journal files.
 */
export class SemanticTokensProvider {
  /**
   * Provide semantic tokens for the entire document.
   */
  provideSemanticTokens(
    document: TextDocument,
    parsedDoc: ParsedDocument
  ): number[] {
    const builder = new SemanticTokensBuilder();
    const lines = document.getText().split('\n');

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      this.tokenizeLine(line, lineIndex, builder, parsedDoc);
    }

    return builder.build().data;
  }

  /**
   * Tokenize a single line.
   */
  private tokenizeLine(
    line: string,
    lineIndex: number,
    builder: SemanticTokensBuilder,
    parsedDoc: ParsedDocument
  ): void {
    // Skip empty lines
    if (line.trim().length === 0) {
      return;
    }

    // Handle comments
    if (line.match(/^\s*[;#]/)) {
      this.tokenizeComment(line, lineIndex, builder);
      return;
    }

    // Handle directives
    if (this.tokenizeDirective(line, lineIndex, builder, parsedDoc)) {
      return;
    }

    // Handle transaction headers
    if (this.tokenizeTransactionHeader(line, lineIndex, builder)) {
      return;
    }

    // Handle postings
    if (this.tokenizePosting(line, lineIndex, builder)) {
      return;
    }
  }

  /**
   * Tokenize a comment line.
   * @param line The line or substring containing the comment
   * @param lineIndex The line number in the document
   * @param builder The semantic tokens builder
   * @param offset The character offset to add to all positions (used when line is a substring)
   */
  private tokenizeComment(
    line: string,
    lineIndex: number,
    builder: SemanticTokensBuilder,
    offset: number = 0
  ): void {
    // Find the start of the comment
    const commentMatch = line.match(/^\s*[;#]/);
    if (!commentMatch) return;

    const commentStart = line.indexOf(commentMatch[0].trim());

    // Check for tags in the comment
    const tagRegex = /\b(\w+):/g;
    let match;
    let lastIndex = 0;

    while ((match = tagRegex.exec(line)) !== null) {
      const tagName = match[1];
      const tagStart = match.index;

      // Add comment token for text before tag
      if (tagStart > lastIndex) {
        const beforeTag = line.substring(lastIndex, tagStart);
        if (beforeTag.trim().length > 0 || lastIndex === 0) {
          builder.push(
            lineIndex,
            offset + (lastIndex === 0 ? commentStart : lastIndex),
            tagStart - lastIndex,
            TokenType.comment,
            0
          );
        }
      }

      // Add tag token
      builder.push(
        lineIndex,
        offset + tagStart,
        tagName.length,
        TokenType.property,
        0
      );

      lastIndex = tagStart + tagName.length;
    }

    // Add remaining comment text
    if (lastIndex < line.length) {
      const remaining = line.substring(lastIndex);
      if (remaining.trim().length > 0 || lastIndex === commentStart) {
        builder.push(
          lineIndex,
          offset + (lastIndex === 0 ? commentStart : lastIndex),
          remaining.length,
          TokenType.comment,
          0
        );
      }
    }
  }

  /**
   * Tokenize a directive line.
   * Returns true if the line was a directive.
   */
  private tokenizeDirective(
    line: string,
    lineIndex: number,
    builder: SemanticTokensBuilder,
    parsedDoc: ParsedDocument
  ): boolean {
    const directiveKeywords = [
      'account', 'commodity', 'payee', 'tag',
      'include', 'alias', 'end', 'apply', 'Y', 'P', 'D'
    ];

    for (const keyword of directiveKeywords) {
      const pattern = new RegExp(`^(${keyword})\\b`);
      const match = line.match(pattern);

      if (match) {
        // Add keyword token
        builder.push(
          lineIndex,
          0,
          keyword.length,
          TokenType.keyword,
          0
        );

        // Add declaration token for the declared item
        const restOfLine = line.substring(keyword.length).trim();
        if (restOfLine.length > 0) {
          const declStart = line.indexOf(restOfLine);

          // Split by comment or end of line
          const declText = restOfLine.split(/[;#]/)[0].trim();

          if (declText.length > 0) {
            // Determine token type based on directive
            let tokenType: TokenType;
            switch (keyword) {
              case 'account':
                tokenType = TokenType.namespace;
                break;
              case 'payee':
                tokenType = TokenType.class;
                break;
              case 'commodity':
                tokenType = TokenType.enum;
                break;
              case 'tag':
                tokenType = TokenType.property;
                break;
              default:
                tokenType = TokenType.string;
            }

            builder.push(
              lineIndex,
              declStart,
              declText.length,
              tokenType,
              encodeModifiers([TokenModifier.declaration])
            );
          }
        }

        // Handle comment at end of directive
        const commentMatch = line.match(/[;#](.*)$/);
        if (commentMatch) {
          const commentStart = line.indexOf(commentMatch[0]);
          builder.push(
            lineIndex,
            commentStart,
            commentMatch[0].length,
            TokenType.comment,
            0
          );
        }

        return true;
      }
    }

    return false;
  }

  /**
   * Tokenize a transaction header line.
   * Returns true if the line was a transaction header.
   */
  private tokenizeTransactionHeader(
    line: string,
    lineIndex: number,
    builder: SemanticTokensBuilder
  ): boolean {
    // Match transaction header: DATE [STATUS] [(CODE)] DESCRIPTION [; COMMENT]
    const headerMatch = line.match(
      /^(\d{4}[-/]\d{2}[-/]\d{2})(?:\s+([*!]))?(?:\s+\(([^)]+)\))?\s+([^;#]*?)(?:\s*([;#].*))?$/
    );

    if (!headerMatch) {
      return false;
    }

    const [, date, status, code, description, comment] = headerMatch;

    // Date token
    builder.push(
      lineIndex,
      0,
      date.length,
      TokenType.type,
      encodeModifiers([TokenModifier.readonly])
    );

    // Status token
    if (status) {
      const statusStart = line.indexOf(status, date.length);
      builder.push(
        lineIndex,
        statusStart,
        1,
        TokenType.operator,
        0
      );
    }

    // Code token
    if (code) {
      const codeStart = line.indexOf(`(${code})`, date.length);
      builder.push(
        lineIndex,
        codeStart,
        code.length + 2, // Include parentheses
        TokenType.string,
        0
      );
    }

    // Payee/description token
    if (description && description.trim().length > 0) {
      const descStart = line.indexOf(description.trim(), date.length);
      builder.push(
        lineIndex,
        descStart,
        description.trim().length,
        TokenType.class,
        0
      );
    }

    // Comment token (with tag handling)
    if (comment) {
      const commentStart = line.indexOf(comment);
      this.tokenizeComment(
        line.substring(commentStart),
        lineIndex,
        builder,
        commentStart  // Pass the offset so positions are relative to the original line
      );
    }

    return true;
  }

  /**
   * Tokenize a posting line.
   * Returns true if the line was a posting.
   */
  private tokenizePosting(
    line: string,
    lineIndex: number,
    builder: SemanticTokensBuilder
  ): boolean {
    // Postings must be indented
    if (!line.match(/^\s+\S/)) {
      return false;
    }

    // Extract account, amount, and comment
    const postingMatch = line.match(
      /^\s+([^;\s]+(?:\s+[^;\s]+)*?)(?:\s{2,}(.*?))?(?:\s*([;#].*))?$/
    );

    if (!postingMatch) {
      return false;
    }

    const [, account, amountPart, comment] = postingMatch;

    // Account token
    const accountStart = line.indexOf(account);
    builder.push(
      lineIndex,
      accountStart,
      account.length,
      TokenType.namespace,
      0
    );

    // Amount and commodity tokens
    if (amountPart && amountPart.trim().length > 0) {
      this.tokenizeAmount(amountPart, lineIndex, line.indexOf(amountPart), builder);
    }

    // Comment token
    if (comment) {
      const commentStart = line.indexOf(comment);
      this.tokenizeComment(
        line.substring(commentStart),
        lineIndex,
        builder
      );
    }

    return true;
  }

  /**
   * Tokenize an amount (number + commodity), potentially with cost and assertion.
   * Format: [COMMODITY] NUMBER [COMMODITY] [@ COST | @@ COST] [= ASSERTION]
   */
  private tokenizeAmount(
    amountPart: string,
    lineIndex: number,
    startOffset: number,
    builder: SemanticTokensBuilder
  ): void {
    // Split by balance assertion first (=)
    const assertionMatch = amountPart.match(/^(.*?)\s*=\s*(.+)$/);
    let mainPart = amountPart;
    let assertionPart: string | null = null;

    if (assertionMatch) {
      mainPart = assertionMatch[1].trim();
      assertionPart = assertionMatch[2].trim();
    }

    // Split by cost notation (@@ or @)
    const totalCostMatch = mainPart.match(/^(.*?)\s*@@\s*(.+)$/);
    const unitCostMatch = !totalCostMatch ? mainPart.match(/^(.*?)\s*@\s*(.+)$/) : null;

    let basePart = mainPart;
    let costOperator: string | null = null;
    let costPart: string | null = null;

    if (totalCostMatch) {
      basePart = totalCostMatch[1].trim();
      costOperator = '@@';
      costPart = totalCostMatch[2].trim();
    } else if (unitCostMatch) {
      basePart = unitCostMatch[1].trim();
      costOperator = '@';
      costPart = unitCostMatch[2].trim();
    }

    // Tokenize base amount
    this.tokenizeSingleAmount(basePart, lineIndex, startOffset + amountPart.indexOf(basePart), builder);

    // Tokenize cost operator and cost amount if present
    if (costOperator && costPart) {
      const operatorIndex = amountPart.indexOf(costOperator, basePart.length);
      const operatorStart = startOffset + operatorIndex;
      builder.push(lineIndex, operatorStart, costOperator.length, TokenType.operator, 0);

      const costIndex = amountPart.indexOf(costPart, operatorIndex + costOperator.length);
      const costStart = startOffset + costIndex;
      this.tokenizeSingleAmount(costPart, lineIndex, costStart, builder);
    }

    // Tokenize assertion operator and assertion amount if present
    if (assertionPart) {
      const equalIndex = amountPart.indexOf('=');
      const equalStart = startOffset + equalIndex;
      builder.push(lineIndex, equalStart, 1, TokenType.operator, 0);

      const assertionStart = startOffset + amountPart.indexOf(assertionPart, equalIndex + 1);
      this.tokenizeSingleAmount(assertionPart, lineIndex, assertionStart, builder);
    }
  }

  /**
   * Tokenize a single amount (number + commodity) without cost or assertion.
   */
  private tokenizeSingleAmount(
    amountStr: string,
    lineIndex: number,
    startOffset: number,
    builder: SemanticTokensBuilder
  ): void {
    // Match sign before commodity with space: - $ 100.00 or + EUR 1000
    let match = amountStr.match(/^([-+])\s*([^\d\s;+-]+)\s+(\d[\d,.'\s]*(?:[.,]\d+)?)/);
    if (match) {
      const [, sign, commodity, number] = match;
      const commodityStart = startOffset + amountStr.indexOf(commodity);
      const numberStart = startOffset + amountStr.indexOf(number);

      builder.push(lineIndex, commodityStart, commodity.length, TokenType.enum, 0);
      builder.push(lineIndex, numberStart, number.trim().length, TokenType.number, encodeModifiers([TokenModifier.readonly]));
      return;
    }

    // Match sign before commodity without space: -$100.00 or +€50.50
    match = amountStr.match(/^([-+])([^\d\s;+-]+)(\d[\d,.'\s]*(?:[.,]\d+)?)/);
    if (match) {
      const [, sign, commodity, number] = match;
      const signStart = startOffset;
      const commodityStart = signStart + sign.length;
      const numberStart = commodityStart + commodity.length;

      builder.push(lineIndex, commodityStart, commodity.length, TokenType.enum, 0);
      builder.push(lineIndex, numberStart, number.trim().length, TokenType.number, encodeModifiers([TokenModifier.readonly]));
      return;
    }

    // Match commodity-first with space: $ 100.00 or EUR 1 000 000,00
    // Number pattern allows digits, commas, dots, apostrophes, and spaces within the number
    match = amountStr.match(/^([^\d\s;+-]+)\s+([-+]?\d[\d,.'\s]*(?:[.,]\d+)?)/);
    if (match) {
      const [, commodity, number] = match;
      const commodityStart = startOffset + amountStr.indexOf(commodity);
      const numberStart = startOffset + amountStr.indexOf(number);

      builder.push(lineIndex, commodityStart, commodity.length, TokenType.enum, 0);
      builder.push(lineIndex, numberStart, number.trim().length, TokenType.number, encodeModifiers([TokenModifier.readonly]));
      return;
    }

    // Match commodity-first without space: $100.00
    match = amountStr.match(/^([^\d\s;+-]+)([-+]?\d[\d,.'\s]*(?:[.,]\d+)?)/);
    if (match) {
      const [, commodity, number] = match;
      const commodityStart = startOffset + amountStr.indexOf(commodity);
      const numberStart = commodityStart + commodity.length;

      builder.push(lineIndex, commodityStart, commodity.length, TokenType.enum, 0);
      builder.push(lineIndex, numberStart, number.trim().length, TokenType.number, encodeModifiers([TokenModifier.readonly]));
      return;
    }

    // Match commodity-after with space: 100.00 USD or 1 000 000,00 EUR
    match = amountStr.match(/([-+]?\d[\d,.'\s]*(?:[.,]\d+)?)\s+([^\d\s;+-]+)/);
    if (match) {
      const [, number, commodity] = match;
      const numberStart = startOffset + amountStr.indexOf(number);
      const commodityStart = startOffset + amountStr.indexOf(commodity, number.length);

      builder.push(lineIndex, numberStart, number.trim().length, TokenType.number, encodeModifiers([TokenModifier.readonly]));
      builder.push(lineIndex, commodityStart, commodity.length, TokenType.enum, 0);
      return;
    }

    // Match commodity-after without space: 100.00USD
    match = amountStr.match(/([-+]?\d[\d,.'\s]*(?:[.,]\d+)?)([^\d\s;+-]+)/);
    if (match) {
      const [, number, commodity] = match;
      const numberStart = startOffset + amountStr.indexOf(number);
      const commodityStart = numberStart + number.length;

      builder.push(lineIndex, numberStart, number.trim().length, TokenType.number, encodeModifiers([TokenModifier.readonly]));
      builder.push(lineIndex, commodityStart, commodity.length, TokenType.enum, 0);
      return;
    }

    // Match number only (no commodity)
    match = amountStr.match(/([-+]?\d[\d,.'\s]*(?:[.,]\d+)?)/);
    if (match) {
      const number = match[1];
      const numberStart = startOffset + amountStr.indexOf(number);
      builder.push(lineIndex, numberStart, number.trim().length, TokenType.number, encodeModifiers([TokenModifier.readonly]));
    }
  }
}

// Export singleton instance
export const semanticTokensProvider = new SemanticTokensProvider();
