/**
 * Type definitions for hledger language structures
 */

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
  sourceUri?: string; // Which file this transaction came from
  line?: number; // 0-based line number where transaction starts
}

export interface Posting {
  account: string;
  amount?: Amount;
  cost?: Cost;
  assertion?: Amount;
  comment?: string;
  tags?: Record<string, string>;
}

export interface Amount {
  quantity: number;
  commodity: string;
}

export interface Cost {
  type: 'unit' | 'total';  // @ (unit price) or @@ (total price)
  amount: Amount;
}

export interface Account {
  name: string;
  declared: boolean; // true if from 'account' directive
  type?: 'asset' | 'liability' | 'expense' | 'income' | 'equity';
  parent?: string;
  children?: string[];
  sourceUri?: string; // Which file this account was declared/first used in
  line?: number; // 0-based line number where this account was declared/first seen
}

export interface Payee {
  name: string;
  declared: boolean; // true if from 'payee' directive
  sourceUri?: string; // Which file this payee was declared/first used in
  line?: number; // 0-based line number where declared/first seen
}

export interface Commodity {
  name: string;
  declared: boolean; // true if from 'commodity' directive
  sourceUri?: string; // Which file this commodity was declared/first used in

  // Optional display/format info parsed from a commodity directive sample/format
  // See commodity directive documentation: we capture symbol placement, separators, precision and grouping.
  format?: {
    // symbol as declared (empty string for no-symbol commodities)
    symbol?: string;

    // true if symbol appears on the left of the number (e.g. $100)
    symbolOnLeft?: boolean;

    // whether there is a space between symbol and number (e.g. "$ 1000" vs "$1000")
    spaceBetween?: boolean;

    // decimal mark used ('.' or ',')
    decimalMark?: '.' | ',';

    // thousands / grouping separator character ('.', ',', ' ' etc.), or null when none
    thousandsSeparator?: string | null;

    // number of decimal digits to display; 0 if decimal mark at end, null if unknown/unspecified
    precision?: number | null;
  };
  line?: number; // 0-based line number where declared/first seen
}

export interface Tag {
  name: string;
  declared: boolean; // true if from 'tag' directive
  sourceUri?: string; // Which file this tag was declared/first used in
  line?: number; // 0-based line number where declared/first seen
}

export interface Directive {
  type: 'account' | 'commodity' | 'payee' | 'tag' | 'include' | 'alias';
  value: string;
  comment?: string;
  sourceUri?: string; // Which file this directive came from
  line?: number; // 0-based line number of the directive
}

export interface ParsedDocument {
  transactions: Transaction[];
  accounts: Account[];
  directives: Directive[];
  commodities: Commodity[];
  payees: Payee[];
  tags: Tag[];
}
