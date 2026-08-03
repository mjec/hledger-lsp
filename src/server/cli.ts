import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../parser/index';
import { formattingProvider } from '../features/formatter';
import { FormattingOptions, defaultSettings } from './settings';
import { WorkspaceManager } from './workspace';
import { discoverConfigFile } from './configFile';
import { parseWithWorkspace } from './documentParse';
import { defaultFileReader } from '../utils/uri';
import { FileReader, ParsedDocument } from '../types';
import * as path from 'path';
import * as fs from 'fs';

const HELP_TEXT = `hledger-lsp - Language Server Protocol implementation for hledger

Usage:
  hledger-lsp --stdio                       Start LSP server (default)
  hledger-lsp --format [FILE]               Format a journal file to stdout
  hledger-lsp --format [FILE] -o [OUTPUT]   Format and write to output file
  hledger-lsp --version                     Show version
  hledger-lsp --help                        Show this help

Options:
  --format [FILE]       Format FILE (or stdin if FILE is "-" or omitted)
  -o, --output [FILE]   Write output to FILE instead of stdout
  --no-workspace        Format FILE on its own, ignoring the workspace it belongs
                        to (commodity styles declared in other files of the
                        workspace will not be applied). Journals read from stdin
                        are always formatted on their own.

Formatting options (defaults match the editor's):
  --indentation N                     Posting indent (default ${defaultSettings.formatting.indentation})
  --decimal-align-column N            Column of the amount's decimal point (default ${defaultSettings.formatting.decimalAlignColumn})
  --assertion-decimal-align-column N  Same, for balance assertions (default ${defaultSettings.formatting.assertionDecimalAlignColumn})
  --min-spacing N                     Minimum spaces after an account (default ${defaultSettings.formatting.minSpacing})
  --max-commodity-width N             Commodity column cap (default ${defaultSettings.formatting.maxCommodityWidth})
  --max-amount-integer-width N        Integer column cap (default ${defaultSettings.formatting.maxAmountIntegerWidth})
  --max-amount-decimal-width N        Decimal column cap (default ${defaultSettings.formatting.maxAmountDecimalWidth})
  --sign-position POS                 "before-symbol" or "after-symbol" (default ${defaultSettings.formatting.signPosition})
  --show-positives-sign               Write an explicit "+" on positive amounts

Examples:
  hledger-lsp --format myfile.journal
  hledger-lsp --format myfile.journal -o formatted.journal
  hledger-lsp --format myfile.journal --output formatted.journal
  cat myfile.journal | hledger-lsp --format - -o formatted.journal
`;

/**
 * Formatting runs with inlay hints off: hints are an editor overlay, and the
 * columns they would reserve must not be baked into a file written to disk.
 */
const INLAY_HINTS_OFF = { showInferredAmounts: false, showRunningBalances: false, showCostConversions: false };

const NUMERIC_FORMATTING_FLAGS: Record<string, keyof FormattingOptions> = {
  '--indentation': 'indentation',
  '--decimal-align-column': 'decimalAlignColumn',
  '--assertion-decimal-align-column': 'assertionDecimalAlignColumn',
  '--min-spacing': 'minSpacing',
  '--max-commodity-width': 'maxCommodityWidth',
  '--max-amount-integer-width': 'maxAmountIntegerWidth',
  '--max-amount-decimal-width': 'maxAmountDecimalWidth',
};

/**
 * Formatting options for CLI mode.
 *
 * The editor's own settings are unreachable from here — there is no client to ask
 * — so CLI mode starts from the same defaults the editor starts from and lets
 * flags override them. A journal formatted by an editor on default settings
 * therefore round-trips through the CLI unchanged.
 */
function parseFormattingFlags(argv: string[]): Partial<FormattingOptions> {
  const options: Partial<FormattingOptions> = {};

  for (const [flag, key] of Object.entries(NUMERIC_FORMATTING_FLAGS)) {
    const index = argv.indexOf(flag);
    if (index === -1) continue;

    const raw = argv[index + 1];
    const value = raw === undefined ? NaN : Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${flag} expects a non-negative integer, got "${raw ?? ''}"`);
    }
    (options as Record<string, unknown>)[key] = value;
  }

  const signIndex = argv.indexOf('--sign-position');
  if (signIndex !== -1) {
    const value = argv[signIndex + 1];
    if (value !== 'before-symbol' && value !== 'after-symbol') {
      throw new Error(`--sign-position expects "before-symbol" or "after-symbol", got "${value ?? ''}"`);
    }
    options.signPosition = value;
  }

  if (argv.includes('--show-positives-sign')) {
    options.showPositivesSign = true;
  }

  return options;
}

/**
 * Parse `document` the way the editor does: resolve the workspace it belongs to
 * (honouring `.hledger-lsp.json`) and use that workspace's merged parse, so
 * commodity styles and declarations from other files apply.
 *
 * Returns null when no workspace context applies, so the caller falls back to a
 * single-file parse. Any failure while setting up the workspace is treated the
 * same way — formatting must not depend on workspace discovery succeeding.
 */
async function parseInWorkspace(document: TextDocument, targetUri: URI): Promise<ParsedDocument | null> {
  try {
    const targetDir = URI.file(path.dirname(targetUri.fsPath));
    const configPath = discoverConfigFile(targetDir);
    const workspaceFolder = configPath ? URI.file(path.dirname(configPath.fsPath)) : targetDir;

    // Read the target from memory so the content we format is the content parsed,
    // even where it differs from what is on disk.
    const fileReader: FileReader = (uri) =>
      uri.fsPath === targetUri.fsPath ? document : defaultFileReader(uri);

    const parser = new HledgerParser();
    const workspaceManager = new WorkspaceManager();
    await workspaceManager.initialize([workspaceFolder], parser, fileReader);

    if (!workspaceManager.isKnownFile(targetUri)) {
      return null;
    }

    return parseWithWorkspace(document, workspaceManager, parser);
  } catch {
    return null;
  }
}

function readStdin(): string {
  const BUFSIZE = 256;
  const buf = Buffer.alloc(BUFSIZE);
  const chunks: Buffer[] = [];

  // Read stdin until EOF
  while (true) {
    try {
      const bytesRead = fs.readSync(0, buf, 0, BUFSIZE, null);
      if (bytesRead === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
    } catch {
      break;
    }
  }

  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Handle CLI-only invocations (--help, --version, --format).
 *
 * @returns true when the invocation was a CLI mode, in which case the process has
 *          already exited and no language server must be started.
 */
export async function handleCliArguments(): Promise<boolean> {
  const argv = process.argv;

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const packageJson = require('../../package.json');
      console.log(`hledger-lsp v${packageJson.version}`);
      process.exit(0);
    } catch (error) {
      console.error('Failed to read version information');
      process.exit(1);
    }
  }

  if (!argv.includes('--format')) {
    return false;
  }

  const formatIndex = argv.indexOf('--format');
  let filePath: string | undefined = argv[formatIndex + 1];

  // An argument that is itself a flag means "no file given", i.e. stdin mode
  if (filePath && filePath.startsWith('-') && filePath !== '-') {
    filePath = undefined;
  }

  // Parse --output / -o option
  let outputPath: string | undefined;
  const outputIndex = argv.indexOf('--output');
  const shortOutputIndex = argv.indexOf('-o');
  if (outputIndex !== -1 && argv[outputIndex + 1]) {
    outputPath = argv[outputIndex + 1];
  } else if (shortOutputIndex !== -1 && argv[shortOutputIndex + 1]) {
    outputPath = argv[shortOutputIndex + 1];
  }

  try {
    const formattingOptions = { ...defaultSettings.formatting, ...parseFormattingFlags(argv) };
    const useWorkspace = !argv.includes('--no-workspace');

    let content: string;
    let documentUri: string;
    let targetUri: URI | null = null;

    if (!filePath || filePath === '-') {
      content = readStdin();
      documentUri = 'file:///stdin.journal';
    } else {
      const absolutePath = path.resolve(filePath);
      if (!fs.existsSync(absolutePath)) {
        console.error(`Error: File not found: ${absolutePath}`);
        process.exit(1);
      }
      content = fs.readFileSync(absolutePath, 'utf-8');
      targetUri = URI.file(absolutePath);
      documentUri = targetUri.toString();
    }

    const document = TextDocument.create(documentUri, 'hledger', 1, content);

    // Prefer the workspace view of the document, exactly as the editor does.
    // Stdin has no location on disk, so it can only be parsed on its own.
    const workspaceParse = targetUri && useWorkspace ? await parseInWorkspace(document, targetUri) : null;
    const parsed = workspaceParse ?? new HledgerParser().parse(document);

    const edits = formattingProvider.formatDocument(
      document,
      parsed,
      { tabSize: formattingOptions.indentation, insertSpaces: true },
      formattingOptions,
      INLAY_HINTS_OFF
    );

    const formattedContent = edits.length > 0 ? edits[0].newText : content;

    if (outputPath) {
      fs.writeFileSync(path.resolve(outputPath), formattedContent);
    } else {
      process.stdout.write(formattedContent);
    }

    process.exit(0);
  } catch (error) {
    console.error(`Error formatting: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
