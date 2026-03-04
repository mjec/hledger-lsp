import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { HledgerParser } from '../parser/index';
import { formattingProvider } from '../features/formatter';
import { defaultSettings } from './settings';
import * as path from 'path';
import * as fs from 'fs';

export function handleCliArguments(): void {
    // Check for help flag
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(`hledger-lsp - Language Server Protocol implementation for hledger

Usage:
  hledger-lsp --stdio                       Start LSP server (default)
  hledger-lsp --format [FILE]               Format a journal file to stdout
  hledger-lsp --format [FILE] -o [OUTPUT]   Format and write to output file
  hledger-lsp --version                     Show version
  hledger-lsp --help                        Show this help

Options:
  --format [FILE]       Format FILE (or stdin if FILE is "-" or omitted)
  -o, --output [FILE]   Write output to FILE instead of stdout

Examples:
  hledger-lsp --format myfile.journal
  hledger-lsp --format myfile.journal -o formatted.journal
  hledger-lsp --format myfile.journal --output formatted.journal
  cat myfile.journal | hledger-lsp --format - -o formatted.journal
`);
        process.exit(0);
    }

    // Check for version flag
    if (process.argv.includes('--version') || process.argv.includes('-v')) {
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

    // Check for format flag - handle CLI formatting mode
    if (process.argv.includes('--format')) {
        const formatIndex = process.argv.indexOf('--format');
        let filePath: string | undefined = process.argv[formatIndex + 1];

        // Check if the argument after --format is another flag (starts with -)
        // If so, treat it as stdin mode
        if (filePath && filePath.startsWith('-') && filePath !== '-') {
            filePath = undefined;
        }

        // Parse --output / -o option
        let outputPath: string | undefined;
        const outputIndex = process.argv.indexOf('--output');
        const shortOutputIndex = process.argv.indexOf('-o');
        if (outputIndex !== -1 && process.argv[outputIndex + 1]) {
            outputPath = process.argv[outputIndex + 1];
        } else if (shortOutputIndex !== -1 && process.argv[shortOutputIndex + 1]) {
            outputPath = process.argv[shortOutputIndex + 1];
        }

        try {
            let content: string;
            let documentUri: string;

            if (!filePath || filePath === '-') {
                // Read from stdin synchronously
                // On Unix-like systems, we can read from fd 0 (stdin)
                // On Windows, use a different approach
                const BUFSIZE = 256;
                const buf = Buffer.alloc(BUFSIZE);
                const chunks: Buffer[] = [];
                let bytesRead: number;

                // Read stdin until EOF
                while (true) {
                    try {
                        bytesRead = fs.readSync(0, buf, 0, BUFSIZE, null);
                        if (bytesRead === 0) break;
                        chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
                    } catch {
                        break;
                    }
                }
                content = Buffer.concat(chunks).toString('utf-8');
                documentUri = 'file:///stdin.journal';
            } else {
                // Read from file
                const absolutePath = path.resolve(filePath);
                if (!fs.existsSync(absolutePath)) {
                    console.error(`Error: File not found: ${absolutePath}`);
                    process.exit(1);
                }
                content = fs.readFileSync(absolutePath, 'utf-8');
                documentUri = URI.file(absolutePath).toString();
            }

            // Create a TextDocument
            const document = TextDocument.create(documentUri, 'hledger', 1, content);

            // Parse the document
            const parsed = new HledgerParser().parse(document);

            // Format the document
            const edits = formattingProvider.formatDocument(
                document,
                parsed,
                { tabSize: 4, insertSpaces: true },
                defaultSettings.formatting,
                { showInferredAmounts: false, showRunningBalances: false, showCostConversions: false }
            );

            // Get formatted content
            const formattedContent = edits.length > 0 ? edits[0].newText : content;

            // Write output
            if (outputPath) {
                const absoluteOutputPath = path.resolve(outputPath);
                fs.writeFileSync(absoluteOutputPath, formattedContent);
            } else {
                process.stdout.write(formattedContent);
            }

            process.exit(0);
        } catch (error) {
            console.error(`Error formatting: ${error instanceof Error ? error.message : error}`);
            process.exit(1);
        }
    }
}
