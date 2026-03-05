import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { ParsedDocument, Posting } from '../../types';
import { ValidationOptions, SeverityOptions, defaultSettings } from '../../server/settings';

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

    // Helper to convert severity string to DiagnosticSeverity
    const getSeverity = (severityStr?: string): DiagnosticSeverity => {
        switch (severityStr) {
            case 'error': return DiagnosticSeverity.Error;
            case 'warning': return DiagnosticSeverity.Warning;
            case 'information': return DiagnosticSeverity.Information;
            case 'hint': return DiagnosticSeverity.Hint;
            default: return DiagnosticSeverity.Warning; // default
        }
    };

    // Check if we should mark all instances or just the first one
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

    // Helper: check a posting for undeclared commodities (amount, cost, assertion)
    const checkPostingCommodities = (postingLine: number, posting: Posting) => {
        if (!hasUndeclaredCommodities) return;
        if (postingLine >= lines.length) return;
        const line = lines[postingLine];

        // Check commodity in posting amount
        if (posting.amount?.commodity && undeclaredCommodities!.has(posting.amount.commodity)) {
            const commodityName = posting.amount.commodity;
            if (!markAllInstances && processedCommodities.has(commodityName)) return;
            const commodityIndex = line.indexOf(commodityName);
            if (commodityIndex !== -1) {
                diagnostics.push({
                    severity: getSeverity(settings?.severity?.undeclaredCommodities),
                    range: {
                        start: { line: postingLine, character: commodityIndex },
                        end: { line: postingLine, character: commodityIndex + commodityName.length }
                    },
                    message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                    source: 'hledger',
                    code: 'undeclared-commodity',
                    data: { commodityName }
                });
                processedCommodities.add(commodityName);
            }
        }

        // Check commodity in cost notation
        if (posting.cost?.amount?.commodity && undeclaredCommodities!.has(posting.cost.amount.commodity)) {
            const commodityName = posting.cost.amount.commodity;
            if (!markAllInstances && processedCommodities.has(commodityName)) return;
            const atIndex = line.indexOf('@');
            if (atIndex !== -1) {
                const afterAt = line.substring(atIndex);
                const commodityIndex = afterAt.indexOf(commodityName);
                if (commodityIndex !== -1) {
                    const absoluteIndex = atIndex + commodityIndex;
                    diagnostics.push({
                        severity: getSeverity(settings?.severity?.undeclaredCommodities),
                        range: {
                            start: { line: postingLine, character: absoluteIndex },
                            end: { line: postingLine, character: absoluteIndex + commodityName.length }
                        },
                        message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                        source: 'hledger',
                        code: 'undeclared-commodity',
                        data: { commodityName }
                    });
                    processedCommodities.add(commodityName);
                }
            }
        }

        // Check commodity in balance assertion
        if (posting.assertion?.commodity && undeclaredCommodities!.has(posting.assertion.commodity)) {
            const commodityName = posting.assertion.commodity;
            if (!markAllInstances && processedCommodities.has(commodityName)) return;
            const equalsIndex = line.indexOf('=');
            if (equalsIndex !== -1) {
                const afterEquals = line.substring(equalsIndex);
                const commodityIndex = afterEquals.indexOf(commodityName);
                if (commodityIndex !== -1) {
                    const absoluteIndex = equalsIndex + commodityIndex;
                    diagnostics.push({
                        severity: getSeverity(settings?.severity?.undeclaredCommodities),
                        range: {
                            start: { line: postingLine, character: absoluteIndex },
                            end: { line: postingLine, character: absoluteIndex + commodityName.length }
                        },
                        message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                        source: 'hledger',
                        code: 'undeclared-commodity',
                        data: { commodityName }
                    });
                    processedCommodities.add(commodityName);
                }
            }
        }
    };

    // Helper: check a posting for undeclared tags
    const checkPostingTags = (postingLine: number, posting: Posting) => {
        if (!hasUndeclaredTags || !posting.tags) return;
        if (postingLine >= lines.length) return;
        const line = lines[postingLine];

        for (const tagName of Object.keys(posting.tags)) {
            if (undeclaredTags!.has(tagName)) {
                if (!markAllInstances && processedTags.has(tagName)) continue;
                const commentIndex = line.indexOf(';');
                if (commentIndex !== -1) {
                    const tagIndex = line.indexOf(tagName + ':', commentIndex);
                    if (tagIndex !== -1) {
                        diagnostics.push({
                            severity: getSeverity(settings?.severity?.undeclaredTags || 'information'),
                            range: {
                                start: { line: postingLine, character: tagIndex },
                                end: { line: postingLine, character: tagIndex + tagName.length + 1 }
                            },
                            message: `Tag "${tagName}" is used but not declared with 'tag' directive`,
                            source: 'hledger',
                            code: 'undeclared-tag',
                            data: { tagName }
                        });
                        processedTags.add(tagName);
                    }
                }
            }
        }
    };

    // Single pass over transactions
    for (const transaction of parsedDoc.transactions) {
        const txSourceUri = transaction.sourceUri?.toString();
        if (txSourceUri && txSourceUri !== documentUri) continue;

        // Check undeclared payee
        if (hasUndeclaredPayees && transaction.line !== undefined) {
            const payeeName = transaction.payee;
            if (undeclaredPayees!.has(payeeName)) {
                if (markAllInstances || !processedPayees.has(payeeName)) {
                    const line = lines[transaction.line];
                    const payeeIndex = line.indexOf(payeeName);
                    if (payeeIndex !== -1) {
                        diagnostics.push({
                            severity: getSeverity(settings?.severity?.undeclaredPayees),
                            range: {
                                start: { line: transaction.line, character: payeeIndex },
                                end: { line: transaction.line, character: payeeIndex + payeeName.length }
                            },
                            message: `Payee "${payeeName}" is used but not declared with 'payee' directive`,
                            source: 'hledger',
                            code: 'undeclared-payee',
                            data: { payeeName }
                        });
                        processedPayees.add(payeeName);
                    }
                }
            }
        }

        // Check transaction-level tags
        if (hasUndeclaredTags && transaction.tags && transaction.line !== undefined) {
            const line = lines[transaction.line];
            for (const tagName of Object.keys(transaction.tags)) {
                if (undeclaredTags!.has(tagName)) {
                    if (!markAllInstances && processedTags.has(tagName)) continue;
                    const commentIndex = line.indexOf(';');
                    if (commentIndex !== -1) {
                        const tagIndex = line.indexOf(tagName + ':', commentIndex);
                        if (tagIndex !== -1) {
                            diagnostics.push({
                                severity: getSeverity(settings?.severity?.undeclaredTags || 'information'),
                                range: {
                                    start: { line: transaction.line, character: tagIndex },
                                    end: { line: transaction.line, character: tagIndex + tagName.length + 1 }
                                },
                                message: `Tag "${tagName}" is used but not declared with 'tag' directive`,
                                source: 'hledger',
                                code: 'undeclared-tag',
                                data: { tagName }
                            });
                            processedTags.add(tagName);
                        }
                    }
                }
            }
        }

        // Check postings for undeclared accounts, commodities, and tags
        if (transaction.line !== undefined) {
            let postingLineOffset = 1;
            for (const posting of transaction.postings) {
                const postingLine = transaction.line + postingLineOffset;

                // Check undeclared account
                if (hasUndeclaredAccounts) {
                    const accountName = posting.account;
                    if (undeclaredAccounts!.has(accountName)) {
                        if (markAllInstances || !processedAccounts.has(accountName)) {
                            if (postingLine < lines.length) {
                                const line = lines[postingLine];
                                const accountIndex = line.indexOf(accountName);
                                if (accountIndex !== -1) {
                                    diagnostics.push({
                                        severity: getSeverity(settings?.severity?.undeclaredAccounts),
                                        range: {
                                            start: { line: postingLine, character: accountIndex },
                                            end: { line: postingLine, character: accountIndex + accountName.length }
                                        },
                                        message: `Account "${accountName}" is used but not declared with 'account' directive`,
                                        source: 'hledger',
                                        code: 'undeclared-account',
                                        data: { accountName }
                                    });
                                    processedAccounts.add(accountName);
                                }
                            }
                        }
                    }
                }

                // Check undeclared commodities
                checkPostingCommodities(postingLine, posting);

                // Check undeclared tags on posting
                checkPostingTags(postingLine, posting);

                postingLineOffset++;
            }
        }
    }

    // Single pass over periodic transactions
    for (const periodicTx of parsedDoc.periodicTransactions) {
        if (periodicTx.sourceUri && periodicTx.sourceUri.toString() !== documentUri) continue;

        for (const posting of periodicTx.postings) {
            const postingLine = posting.line;

            // Check undeclared account
            if (hasUndeclaredAccounts && postingLine !== undefined && postingLine < lines.length) {
                const accountName = posting.account;
                if (undeclaredAccounts!.has(accountName)) {
                    if (markAllInstances || !processedAccounts.has(accountName)) {
                        const line = lines[postingLine];
                        const accountIndex = line.indexOf(accountName);
                        if (accountIndex !== -1) {
                            diagnostics.push({
                                severity: getSeverity(settings?.severity?.undeclaredAccounts),
                                range: {
                                    start: { line: postingLine, character: accountIndex },
                                    end: { line: postingLine, character: accountIndex + accountName.length }
                                },
                                message: `Account "${accountName}" is used but not declared with 'account' directive`,
                                source: 'hledger',
                                code: 'undeclared-account',
                                data: { accountName }
                            });
                            processedAccounts.add(accountName);
                        }
                    }
                }
            }

            // Check undeclared commodities
            if (postingLine !== undefined) {
                checkPostingCommodities(postingLine, posting);
            }
        }
    }

    // Single pass over auto postings
    for (const autoPost of parsedDoc.autoPostings) {
        if (autoPost.sourceUri && autoPost.sourceUri.toString() !== documentUri) continue;

        for (const entry of autoPost.postings) {
            const entryLine = entry.line;

            // Check undeclared account
            if (hasUndeclaredAccounts && entryLine !== undefined && entryLine < lines.length) {
                const accountName = entry.account;
                if (undeclaredAccounts!.has(accountName)) {
                    if (markAllInstances || !processedAccounts.has(accountName)) {
                        const line = lines[entryLine];
                        const accountIndex = line.indexOf(accountName);
                        if (accountIndex !== -1) {
                            diagnostics.push({
                                severity: getSeverity(settings?.severity?.undeclaredAccounts),
                                range: {
                                    start: { line: entryLine, character: accountIndex },
                                    end: { line: entryLine, character: accountIndex + accountName.length }
                                },
                                message: `Account "${accountName}" is used but not declared with 'account' directive`,
                                source: 'hledger',
                                code: 'undeclared-account',
                                data: { accountName }
                            });
                            processedAccounts.add(accountName);
                        }
                    }
                }
            }

            // Check undeclared commodities (regular amount and multiplier)
            if (hasUndeclaredCommodities && entryLine !== undefined && entryLine < lines.length) {
                const line = lines[entryLine];

                if (entry.amount?.commodity && undeclaredCommodities!.has(entry.amount.commodity)) {
                    const commodityName = entry.amount.commodity;
                    if (markAllInstances || !processedCommodities.has(commodityName)) {
                        const commodityIndex = line.indexOf(commodityName);
                        if (commodityIndex !== -1) {
                            diagnostics.push({
                                severity: getSeverity(settings?.severity?.undeclaredCommodities),
                                range: {
                                    start: { line: entryLine, character: commodityIndex },
                                    end: { line: entryLine, character: commodityIndex + commodityName.length }
                                },
                                message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                                source: 'hledger',
                                code: 'undeclared-commodity',
                                data: { commodityName }
                            });
                            processedCommodities.add(commodityName);
                        }
                    }
                }

                if (entry.multiplier?.commodity && undeclaredCommodities!.has(entry.multiplier.commodity)) {
                    const commodityName = entry.multiplier.commodity;
                    if (markAllInstances || !processedCommodities.has(commodityName)) {
                        const commodityIndex = line.indexOf(commodityName);
                        if (commodityIndex !== -1) {
                            diagnostics.push({
                                severity: getSeverity(settings?.severity?.undeclaredCommodities),
                                range: {
                                    start: { line: entryLine, character: commodityIndex },
                                    end: { line: entryLine, character: commodityIndex + commodityName.length }
                                },
                                message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                                source: 'hledger',
                                code: 'undeclared-commodity',
                                data: { commodityName }
                            });
                            processedCommodities.add(commodityName);
                        }
                    }
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

            // Check base commodity
            if (undeclaredCommodities!.has(priceDir.commodity)) {
                const commodityName = priceDir.commodity;
                if (markAllInstances || !processedCommodities.has(commodityName)) {
                    const commodityIndex = priceLine.indexOf(commodityName);
                    if (commodityIndex !== -1) {
                        diagnostics.push({
                            severity: getSeverity(settings?.severity?.undeclaredCommodities),
                            range: {
                                start: { line: priceDir.line, character: commodityIndex },
                                end: { line: priceDir.line, character: commodityIndex + commodityName.length }
                            },
                            message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                            source: 'hledger',
                            code: 'undeclared-commodity',
                            data: { commodityName }
                        });
                        processedCommodities.add(commodityName);
                    }
                }
            }

            // Check price commodity
            if (priceDir.amount.commodity && undeclaredCommodities!.has(priceDir.amount.commodity)) {
                const commodityName = priceDir.amount.commodity;
                if (markAllInstances || !processedCommodities.has(commodityName)) {
                    const baseStart = priceLine.indexOf(priceDir.commodity);
                    const searchStart = baseStart !== -1 ? baseStart + priceDir.commodity.length : 0;
                    const commodityIndex = priceLine.indexOf(commodityName, searchStart);
                    if (commodityIndex !== -1) {
                        diagnostics.push({
                            severity: getSeverity(settings?.severity?.undeclaredCommodities),
                            range: {
                                start: { line: priceDir.line, character: commodityIndex },
                                end: { line: priceDir.line, character: commodityIndex + commodityName.length }
                            },
                            message: `Commodity "${commodityName}" is used but not declared with 'commodity' directive`,
                            source: 'hledger',
                            code: 'undeclared-commodity',
                            data: { commodityName }
                        });
                        processedCommodities.add(commodityName);
                    }
                }
            }
        }
    }

    return diagnostics;
}
