import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { ParsedDocument, Posting } from '../../types';
import { ValidationOptions, SeverityOptions, defaultSettings } from '../../server/settings';

type UndeclaredType = 'Account' | 'Payee' | 'Commodity' | 'Tag';

function getSeverity(severityStr?: string): DiagnosticSeverity {
    switch (severityStr) {
        case 'error': return DiagnosticSeverity.Error;
        case 'warning': return DiagnosticSeverity.Warning;
        case 'information': return DiagnosticSeverity.Information;
        case 'hint': return DiagnosticSeverity.Hint;
        default: return DiagnosticSeverity.Warning;
    }
}

function createUndeclaredDiagnostic(
    severity: DiagnosticSeverity,
    line: number, start: number, length: number,
    name: string, type: UndeclaredType
): Diagnostic {
    const typeLower = type.toLowerCase();
    return {
        severity,
        range: {
            start: { line, character: start },
            end: { line, character: start + length }
        },
        message: `${type} "${name}" is used but not declared with '${typeLower}' directive`,
        source: 'hledger',
        code: `undeclared-${typeLower}`,
        data: { [`${typeLower}Name`]: name }
    };
}

export function validateUndeclaredItems(
    lines: string[],
    parsedDoc: ParsedDocument,
    settings: { validation?: Partial<ValidationOptions>; severity?: Partial<SeverityOptions> } | undefined,
    documentUri: string,
    checkAccounts: boolean = true,
    checkPayees: boolean = true,
    checkCommodities: boolean = true,
    checkTags: boolean = true
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const markAllInstances = settings?.validation?.markAllUndeclaredInstances ?? defaultSettings.validation.markAllUndeclaredInstances;

    // Build undeclared sets upfront (only for enabled checks)
    const undeclaredAccounts = checkAccounts
        ? new Set(Array.from(parsedDoc.accounts.values()).filter(a => !a.declared).map(a => a.name))
        : null;
    const undeclaredPayees = checkPayees
        ? new Set(Array.from(parsedDoc.payees.values()).filter(p => !p.declared).map(p => p.name))
        : null;
    const undeclaredCommodities = checkCommodities
        ? new Set(Array.from(parsedDoc.commodities.values()).filter(c => !c.declared).map(c => c.name))
        : null;
    const undeclaredTags = checkTags
        ? new Set(Array.from(parsedDoc.tags.values()).filter(t => !t.declared).map(t => t.name))
        : null;

    // Early exit if nothing to check
    const hasUndeclaredAccounts = undeclaredAccounts && undeclaredAccounts.size > 0;
    const hasUndeclaredPayees = undeclaredPayees && undeclaredPayees.size > 0;
    const hasUndeclaredCommodities = undeclaredCommodities && undeclaredCommodities.size > 0;
    const hasUndeclaredTags = undeclaredTags && undeclaredTags.size > 0;

    if (!hasUndeclaredAccounts && !hasUndeclaredPayees && !hasUndeclaredCommodities && !hasUndeclaredTags) {
        return diagnostics;
    }

    // Track which items we've already reported (for markAllInstances=false)
    const processedAccounts = new Set<string>();
    const processedPayees = new Set<string>();
    const processedCommodities = new Set<string>();
    const processedTags = new Set<string>();

    const commoditySeverity = getSeverity(settings?.severity?.undeclaredCommodities);
    const accountSeverity = getSeverity(settings?.severity?.undeclaredAccounts);
    const tagSeverity = getSeverity(settings?.severity?.undeclaredTags || 'information');
    const payeeSeverity = getSeverity(settings?.severity?.undeclaredPayees);

    // Helper: try to report an undeclared item, respecting markAllInstances.
    // For tags, searches for "name:" but reports just "name" in the diagnostic message/data,
    // with range covering "name:" (length = name.length + 1).
    function tryReport(
        name: string, processed: Set<string>, severity: DiagnosticSeverity,
        lineNum: number, lineText: string, type: UndeclaredType,
        searchFrom?: number
    ): void {
        if (!markAllInstances && processed.has(name)) return;
        const searchStr = type === 'Tag' ? name + ':' : name;
        const idx = lineText.indexOf(searchStr, searchFrom);
        if (idx !== -1) {
            const rangeLength = type === 'Tag' ? name.length + 1 : name.length;
            diagnostics.push(createUndeclaredDiagnostic(severity, lineNum, idx, rangeLength, name, type));
            processed.add(name);
        }
    }

    // Helper: check a posting for undeclared commodities (amount, cost, assertion)
    function checkPostingCommodities(postingLine: number, posting: Posting): void {
        if (!hasUndeclaredCommodities) return;
        if (postingLine >= lines.length) return;
        const line = lines[postingLine];

        if (posting.amount?.commodity && undeclaredCommodities!.has(posting.amount.commodity)) {
            tryReport(posting.amount.commodity, processedCommodities, commoditySeverity, postingLine, line, 'Commodity');
        }

        if (posting.cost?.amount?.commodity && undeclaredCommodities!.has(posting.cost.amount.commodity)) {
            const atIndex = line.indexOf('@');
            if (atIndex !== -1) {
                tryReport(posting.cost.amount.commodity, processedCommodities, commoditySeverity, postingLine, line, 'Commodity', atIndex);
            }
        }

        if (posting.assertion?.commodity && undeclaredCommodities!.has(posting.assertion.commodity)) {
            const equalsIndex = line.indexOf('=');
            if (equalsIndex !== -1) {
                tryReport(posting.assertion.commodity, processedCommodities, commoditySeverity, postingLine, line, 'Commodity', equalsIndex);
            }
        }
    }

    // Helper: check a posting for undeclared tags
    function checkPostingTags(postingLine: number, posting: Posting): void {
        if (!hasUndeclaredTags || !posting.tags) return;
        if (postingLine >= lines.length) return;
        const line = lines[postingLine];
        const commentIndex = line.indexOf(';');
        if (commentIndex === -1) return;

        for (const tagName of Object.keys(posting.tags)) {
            if (undeclaredTags!.has(tagName)) {
                tryReport(tagName, processedTags, tagSeverity, postingLine, line, 'Tag', commentIndex);
            }
        }
    }

    // Helper: check undeclared account on a posting line
    function checkPostingAccount(postingLine: number, accountName: string): void {
        if (!hasUndeclaredAccounts) return;
        if (!undeclaredAccounts!.has(accountName)) return;
        if (postingLine >= lines.length) return;
        tryReport(accountName, processedAccounts, accountSeverity, postingLine, lines[postingLine], 'Account');
    }

    // Single pass over transactions
    for (const transaction of parsedDoc.transactions) {
        const txSourceUri = transaction.sourceUri?.toString();
        if (txSourceUri && txSourceUri !== documentUri) continue;

        // Check undeclared payee
        if (hasUndeclaredPayees && transaction.line !== undefined && undeclaredPayees!.has(transaction.payee)) {
            tryReport(transaction.payee, processedPayees, payeeSeverity, transaction.line, lines[transaction.line], 'Payee');
        }

        // Check transaction-level tags
        if (hasUndeclaredTags && transaction.tags && transaction.line !== undefined) {
            const line = lines[transaction.line];
            const commentIndex = line.indexOf(';');
            if (commentIndex !== -1) {
                for (const tagName of Object.keys(transaction.tags)) {
                    if (undeclaredTags!.has(tagName)) {
                        tryReport(tagName, processedTags, tagSeverity, transaction.line, line, 'Tag', commentIndex);
                    }
                }
            }
        }

        // Check postings for undeclared accounts, commodities, and tags
        if (transaction.line !== undefined) {
            let postingLineOffset = 1;
            for (const posting of transaction.postings) {
                const postingLine = transaction.line + postingLineOffset;
                checkPostingAccount(postingLine, posting.account);
                checkPostingCommodities(postingLine, posting);
                checkPostingTags(postingLine, posting);
                postingLineOffset++;
            }
        }
    }

    // Single pass over periodic transactions
    for (const periodicTx of parsedDoc.periodicTransactions) {
        if (periodicTx.sourceUri && periodicTx.sourceUri.toString() !== documentUri) continue;

        for (const posting of periodicTx.postings) {
            if (posting.line === undefined) continue;
            checkPostingAccount(posting.line, posting.account);
            checkPostingCommodities(posting.line, posting);
        }
    }

    // Single pass over auto postings
    for (const autoPost of parsedDoc.autoPostings) {
        if (autoPost.sourceUri && autoPost.sourceUri.toString() !== documentUri) continue;

        for (const entry of autoPost.postings) {
            if (entry.line === undefined) continue;
            checkPostingAccount(entry.line, entry.account);

            // Check undeclared commodities (regular amount and multiplier)
            if (hasUndeclaredCommodities && entry.line < lines.length) {
                const line = lines[entry.line];

                if (entry.amount?.commodity && undeclaredCommodities!.has(entry.amount.commodity)) {
                    tryReport(entry.amount.commodity, processedCommodities, commoditySeverity, entry.line, line, 'Commodity');
                }
                if (entry.multiplier?.commodity && undeclaredCommodities!.has(entry.multiplier.commodity)) {
                    tryReport(entry.multiplier.commodity, processedCommodities, commoditySeverity, entry.line, line, 'Commodity');
                }
            }
        }
    }

    // Single pass over price directives (commodities only)
    if (hasUndeclaredCommodities) {
        for (const priceDir of parsedDoc.priceDirectives) {
            if (priceDir.sourceUri && priceDir.sourceUri.toString() !== documentUri) continue;
            if (priceDir.line === undefined || priceDir.line >= lines.length) continue;
            const priceLine = lines[priceDir.line];

            if (undeclaredCommodities!.has(priceDir.commodity)) {
                tryReport(priceDir.commodity, processedCommodities, commoditySeverity, priceDir.line, priceLine, 'Commodity');
            }

            if (priceDir.amount.commodity && undeclaredCommodities!.has(priceDir.amount.commodity)) {
                const baseStart = priceLine.indexOf(priceDir.commodity);
                const searchStart = baseStart !== -1 ? baseStart + priceDir.commodity.length : 0;
                tryReport(priceDir.amount.commodity, processedCommodities, commoditySeverity, priceDir.line, priceLine, 'Commodity', searchStart);
            }
        }
    }

    return diagnostics;
}
