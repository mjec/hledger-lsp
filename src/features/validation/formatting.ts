import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Transaction } from '../../types';
import { getFormatUnsafeReason } from '../formattingValidation';
import { ValidationOptions, SeverityOptions, FormattingOptions, defaultSettings } from '../../server/settings';

export function validateFormatMismatch(
    transaction: Transaction,
    document: TextDocument,
    parsedDoc: ParsedDocument,
    settings?: { validation?: Partial<ValidationOptions>; severity?: Partial<SeverityOptions>; formatting?: Partial<FormattingOptions> }
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (transaction.line === undefined) {
        return diagnostics; // Can't create diagnostics without line numbers
    }

    const text = document.getText();
    const lines = text.split('\n');

    // Check each posting's amount for format mismatches
    let postingLineOffset = 1;
    for (const posting of transaction.postings) {
        // Skip inferred amounts - they're safe by design
        if (posting.amount?.inferred) {
            postingLineOffset++;
            continue;
        }

        // Skip postings without amounts
        if (!posting.amount) {
            postingLineOffset++;
            continue;
        }

        // Get formatting settings (fall back to defaults)
        const formattingSettings = settings?.formatting ? settings.formatting : defaultSettings.formatting;

        // Check if this amount has format issues
        const unsafeReason = getFormatUnsafeReason(posting.amount, parsedDoc, formattingSettings);

        if (unsafeReason) {
            const postingLine = transaction.line + postingLineOffset;
            if (postingLine < lines.length) {
                const line = lines[postingLine];

                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: {
                        start: { line: postingLine, character: 0 },
                        end: { line: postingLine, character: line.length }
                    },
                    message: unsafeReason.message,
                    source: 'hledger-formatter',
                    code: unsafeReason.code
                });
            }
        }

        postingLineOffset++;
    }

    return diagnostics;
}
