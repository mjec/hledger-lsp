/**
 * Type definitions for hledger language structures
 *
 * DESIGN PATTERN:
 * - **Entity types** (Account, Commodity, Payee, Tag) are stored in ParsedDocument Maps
 *   and referenced by string. This avoids circular references, mirrors the text format,
 *   and provides a single source of truth for each entity.
 *
 * - **Value types** (Amount, Cost, Format) are embedded directly as they don't have
 *   independent identity - they're always owned by their parent structure.
 *
 * Example: Posting.account is a string that references an Account in the accounts Map,
 *          but Posting.amount is an embedded Amount object that belongs to the posting.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";

export interface Transaction {
  date: string;
  effectiveDate?: string;
  status?: 'cleared' | 'pending' | 'unmarked';
  code?: string;
  description: string;
  payee: string;  // Payee name (left of | or full description if no |)
  note: string;   // Note (right of | or full description if no |)
  comment?: string;
  postings: Posting[];
  tags?: Record<string, string>;
  sourceUri?: URI; // Which file this transaction came from
  line?: number; // 0-based line number where transaction starts
  postingColumnsWidths?: PostingColumnWidths; // Cached column widths for formatting postings
}

export interface Posting {
  account: string;
  amount?: Amount;
  cost?: Cost;
  assertion?: Amount;
  comment?: string;
  tags?: Record<string, string>;
  line?: number; // 0-based line number where this posting appears
}

export interface Amount {
  quantity: number;
  commodity: string;
  format?: Format;
  inferred?: boolean;  // true if this amount was inferred during parsing
}

export interface Cost {
  type: 'unit' | 'total';  // @ (unit price) or @@ (total price)
  amount: Amount;
  inferred?: boolean;  // true if this cost was inferred during parsing
}

export interface Account {
  name: string;
  declared: boolean; // true if from 'account' directive
  type?: 'asset' | 'liability' | 'expense' | 'income' | 'equity';
  parent?: string;
  children?: string[];
  sourceUri?: URI; // Which file this account was declared/first used in
  line?: number; // 0-based line number where this account was declared/first seen
}

export interface Payee {
  name: string;
  declared: boolean; // true if from 'payee' directive
  sourceUri?: URI; // Which file this payee was declared/first used in
  line?: number; // 0-based line number where declared/first seen
}

export interface Commodity {
  name: string;
  declared: boolean; // true if from 'commodity' directive
  sourceUri?: URI; // Which file this commodity was declared/first used in

  // Optional display/format info parsed from a commodity directive sample/format
  // See commodity directive documentation: we capture symbol placement, separators, precision and grouping.
  format?: Format;
  line?: number; // 0-based line number where declared/first seen
}

export type DecimalMark = '.' | ',' | null;
export type ThousandsSeparator = '.' | ',' | ' ' | null;

export interface Format {
  // symbol as declared (empty string for no-symbol commodities)
  symbol?: string;

  // true if symbol appears on the left of the number (e.g. $100)
  symbolOnLeft?: boolean;

  // whether there is a space between symbol and number (e.g. "$ 1000" vs "$1000")
  spaceBetween?: boolean;

  // decimal mark used ('.' or ',')
  decimalMark?: DecimalMark;

  // thousands / grouping separator character ('.', ',', ' ' etc.), or null when none
  thousandsSeparator?: ThousandsSeparator;

  // number of decimal digits to display; 0 if decimal mark at end, null if unknown/unspecified
  precision?: number | null;
};

export interface Tag {
  name: string;
  declared: boolean; // true if from 'tag' directive
  sourceUri?: URI; // Which file this tag was declared/first used in
  line?: number; // 0-based line number where declared/first seen
}

export interface Directive {
  type: 'account' | 'commodity' | 'payee' | 'tag' | 'include' | 'alias';
  value: string;
  comment?: string;
  sourceUri?: URI; // Which file this directive came from
  line?: number; // 0-based line number of the directive
}

export interface ParsedDocument {
  transactions: Transaction[];
  accounts: Map<string, Account>;
  directives: Directive[];
  commodities: Map<string, Commodity>;
  payees: Map<string, Payee>;
  tags: Map<string, Tag>;
}

export type FileReader = (uri: URI) => TextDocument | null;

export type PostingColumnWidths = {
  indentColumnWidth: number;
  accountColumnWidth: number;
  commodityBeforeColumnWidth: number;
  spaceBetweenCommodityBeforeAndAmount: number;
  negativeSignColumnWidth: number;
  amountIntegerColumnWidth: number;
  amountDecimalMarkColumnWidth: number;
  amountDecimalColumnWidth: number;
  spaceBetweenAmountAndCommodityAfterColumnWidth: number;
  commodityAfterColumnWidth: number;
  costColumnWidth: number;
  costCommodityBeforeColumnWidth: number;
  spaceBetweenCostCommodityBeforeAndAmount: number;
  costNegativeSignColumnWidth: number;
  costAmountIntegerColumnWidth: number;
  costAmountDecimalMarkColumnWidth: number;
  costAmountDecimalColumnWidth: number;
  spaceBetweenCostAmountAndCommodityAfterColumnWidth: number;
  costCommodityAfterColumnWidth: number;
  assertionColumnWidth: number;
  assertionCommodityBeforeColumnWidth: number;
  spaceBetweenAssertionCommodityBeforeAndAmount: number;
  assertionNegativeSignColumnWidth: number;
  assertionAmountIntegerColumnWidth: number;
  assertionAmountDecimalMarkColumnWidth: number;
  assertionAmountDecimalColumnWidth: number;
  spaceBetweenAssertionAmountAndCommodityAfterColumnWidth: number;
  assertionCommodityAfterColumnWidth: number;
}