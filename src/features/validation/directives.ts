import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { getLineRange } from './utils';
import { parseFormat } from '../../parser/ast';

/**
 * Checks on the syntax of `commodity` directives.
 *
 * Both rules were verified against hledger 1.52.1; see the tests for the exact
 * inputs on either side of each boundary.
 */

/** Strip a trailing `;` comment from a directive line. */
function withoutComment(line: string): string {
    return line.split(';')[0];
}

/**
 * The symbol a `format` subdirective names, or '' when it names none.
 * `format A 1.00` and `format 1.00 A` both name A.
 */
function formatSymbol(body: string): string {
    return parseFormat(body)?.format?.symbol ?? '';
}

export function validateCommodityDirectives(lines: string[]): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (let i = 0; i < lines.length; i++) {
        const body = withoutComment(lines[i]).trimEnd();
        const match = body.match(/^commodity\s+(\S.*)$/);
        if (!match) continue;

        const declaration = match[1].trim();

        // A directive that shows an amount must show where the decimal mark goes, so
        // that hledger can tell it from a digit group separator: `commodity 1000 EUR`
        // and `commodity 1 000 USD` are rejected, `commodity 1,000 EUR` accepted, and
        // a symbol on its own (`commodity EUR`) needs no mark at all.
        if (/\d/.test(declaration) && !/[.,]/.test(declaration)) {
            diagnostics.push({
                severity: DiagnosticSeverity.Error,
                range: getLineRange(i, lines),
                message: 'Commodity directive needs a decimal point or decimal comma, '
                    + 'so the decimal mark can be told from a digit group separator',
                source: 'hledger'
            });
        }

        const commoditySymbol = parseFormat(declaration)?.name ?? declaration;

        // An indented `format` subdirective belongs to this directive, and must name
        // the same commodity it does.
        for (let j = i + 1; j < lines.length; j++) {
            if (!lines[j].trim()) continue;
            if (!/^\s/.test(lines[j])) break;

            const subMatch = withoutComment(lines[j]).trim().match(/^format\s+(\S.*)$/);
            if (!subMatch) continue;

            const declared = formatSymbol(subMatch[1].trim());
            if (declared !== commoditySymbol) {
                diagnostics.push({
                    severity: DiagnosticSeverity.Error,
                    range: getLineRange(j, lines),
                    message: `Commodity directive symbol "${commoditySymbol}" and `
                        + `format directive symbol "${declared}" should be the same`,
                    source: 'hledger'
                });
            }
        }
    }

    return diagnostics;
}
