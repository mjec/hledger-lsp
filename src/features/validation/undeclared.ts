import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, Posting } from '../../types';
import { ValidationOptions, SeverityOptions, defaultSettings } from '../../server/settings';

export function validateUndeclaredItems(
    document: TextDocument,
    parsedDoc: ParsedDocument,
    settings: { validation?: Partial<ValidationOptions>; severity?: Partial<SeverityOptions> } | undefined,
    checkAccounts: boolean = true,
    checkPayees: boolean = true,
    checkCommodities: boolean = true,
    checkTags: boolean = true
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Normalize document URI to ensure proper encoding
    const documentUri = URI.parse(document.uri).toString();

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

    // Check undeclared accounts (if enabled)
    if (checkAccounts) {
        const undeclaredAccounts = new Set(
            Array.from(parsedDoc.accounts.values()).filter(a => !a.declared).map(a => a.name)
        );

        if (undeclaredAccounts.size > 0) {
            const text = document.getText();
            const lines = text.split('\n');
            const processedAccounts = new Set<string>();

            // Helper to check postings for undeclared accounts
            const checkPostingsForUndeclaredAccounts = (postings: Posting[]) => {
                for (const posting of postings) {
                    const accountName = posting.account;
                    if (undeclaredAccounts.has(accountName)) {
                        if (!markAllInstances && processedAccounts.has(accountName)) continue;
                        const postingLine = posting.line;
                        if (postingLine !== undefined && postingLine < lines.length) {
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
            };

            // Iterate through transactions to find account usage locations
            for (const transaction of parsedDoc.transactions) {
                // Only process transactions from the current document
                if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
                    continue;
                }

                if (transaction.line !== undefined) {
                    let postingLineOffset = 1;
                    for (const posting of transaction.postings) {
                        const accountName = posting.account;
                        if (undeclaredAccounts.has(accountName)) {
                            if (!markAllInstances && processedAccounts.has(accountName)) {
                                postingLineOffset++;
                                continue;
                            }

                            // Find the posting line
                            const postingLine = transaction.line + postingLineOffset;
                            if (postingLine < lines.length) {
                                const line = lines[postingLine];
                                // Account name is after indentation, before amount/comment
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
                        postingLineOffset++;
                    }
                }
            }

            // Also check periodic transactions
            for (const periodicTx of parsedDoc.periodicTransactions) {
                if (periodicTx.sourceUri && periodicTx.sourceUri.toString() !== documentUri) continue;
                checkPostingsForUndeclaredAccounts(periodicTx.postings);
            }

            // Also check auto postings
            for (const autoPost of parsedDoc.autoPostings) {
                if (autoPost.sourceUri && autoPost.sourceUri.toString() !== documentUri) continue;
                for (const entry of autoPost.postings) {
                    const accountName = entry.account;
                    if (undeclaredAccounts.has(accountName)) {
                        if (!markAllInstances && processedAccounts.has(accountName)) continue;
                        const entryLine = entry.line;
                        if (entryLine !== undefined && entryLine < lines.length) {
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
            }
        }
    }

    // Check undeclared payees (if enabled)
    if (checkPayees) {
        const undeclaredPayees = new Set(
            Array.from(parsedDoc.payees.values()).filter(p => !p.declared).map(p => p.name)
        );

        if (undeclaredPayees.size > 0) {
            const text = document.getText();
            const lines = text.split('\n');
            const processedPayees = new Set<string>();

            // Iterate through transactions to find payee usage locations
            for (const transaction of parsedDoc.transactions) {
                // Only process transactions from the current document
                if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
                    continue;
                }

                const payeeName = transaction.payee;
                if (undeclaredPayees.has(payeeName) && transaction.line !== undefined) {
                    if (!markAllInstances && processedPayees.has(payeeName)) {
                        continue;
                    }

                    const line = lines[transaction.line];
                    // Payee is in the transaction header after date, status, and code
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
    }

    // Check undeclared commodities (if enabled)
    if (checkCommodities) {
        const undeclaredCommodities = new Set(
            Array.from(parsedDoc.commodities.values()).filter(c => !c.declared).map(c => c.name)
        );

        if (undeclaredCommodities.size > 0) {
            const text = document.getText();
            const lines = text.split('\n');
            const processedCommodities = new Set<string>();

            // Iterate through transactions to find commodity usage locations
            for (const transaction of parsedDoc.transactions) {
                // Only process transactions from the current document
                if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
                    continue;
                }

                if (transaction.line !== undefined) {
                    let postingLineOffset = 1;
                    for (const posting of transaction.postings) {
                        const postingLine = transaction.line + postingLineOffset;
                        if (postingLine < lines.length) {
                            const line = lines[postingLine];

                            // Check commodity in posting amount
                            if (posting.amount?.commodity && undeclaredCommodities.has(posting.amount.commodity)) {
                                const commodityName = posting.amount.commodity;
                                if (!markAllInstances && processedCommodities.has(commodityName)) {
                                    postingLineOffset++;
                                    continue;
                                }

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
                            if (posting.cost?.amount?.commodity && undeclaredCommodities.has(posting.cost.amount.commodity)) {
                                const commodityName = posting.cost.amount.commodity;
                                if (!markAllInstances && processedCommodities.has(commodityName)) {
                                    postingLineOffset++;
                                    continue;
                                }

                                // Cost appears after @ or @@
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
                            if (posting.assertion?.commodity && undeclaredCommodities.has(posting.assertion.commodity)) {
                                const commodityName = posting.assertion.commodity;
                                if (!markAllInstances && processedCommodities.has(commodityName)) {
                                    postingLineOffset++;
                                    continue;
                                }

                                // Assertion appears after =
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
                        }
                        postingLineOffset++;
                    }
                }
            }

            // Helper to check a posting for undeclared commodities
            const checkPostingForUndeclaredCommodity = (posting: Posting, lines: string[]) => {
                const postingLine = posting.line;
                if (postingLine === undefined || postingLine >= lines.length) return;
                const line = lines[postingLine];

                if (posting.amount?.commodity && undeclaredCommodities.has(posting.amount.commodity)) {
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
            };

            // Also check periodic transactions for undeclared commodities
            for (const periodicTx of parsedDoc.periodicTransactions) {
                if (periodicTx.sourceUri && periodicTx.sourceUri.toString() !== documentUri) continue;
                for (const posting of periodicTx.postings) {
                    checkPostingForUndeclaredCommodity(posting, lines);
                }
            }

            // Also check price directives for undeclared commodities
            for (const priceDir of parsedDoc.priceDirectives) {
                if (priceDir.sourceUri && priceDir.sourceUri.toString() !== documentUri) continue;
                if (priceDir.line === undefined || priceDir.line >= lines.length) continue;
                const priceLine = lines[priceDir.line];

                // Check base commodity
                if (undeclaredCommodities.has(priceDir.commodity)) {
                    const commodityName = priceDir.commodity;
                    if (!markAllInstances && processedCommodities.has(commodityName)) continue;
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

                // Check price commodity
                if (priceDir.amount.commodity && undeclaredCommodities.has(priceDir.amount.commodity)) {
                    const commodityName = priceDir.amount.commodity;
                    if (!markAllInstances && processedCommodities.has(commodityName)) continue;
                    // Find after base commodity to avoid matching the wrong one
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

            // Also check auto postings for undeclared commodities
            for (const autoPost of parsedDoc.autoPostings) {
                if (autoPost.sourceUri && autoPost.sourceUri.toString() !== documentUri) continue;
                for (const entry of autoPost.postings) {
                    const entryLine = entry.line;
                    if (entryLine === undefined || entryLine >= lines.length) continue;
                    const line = lines[entryLine];

                    // Check commodity in regular amount
                    if (entry.amount?.commodity && undeclaredCommodities.has(entry.amount.commodity)) {
                        const commodityName = entry.amount.commodity;
                        if (!markAllInstances && processedCommodities.has(commodityName)) continue;
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

                    // Check commodity in multiplier amount
                    if (entry.multiplier?.commodity && undeclaredCommodities.has(entry.multiplier.commodity)) {
                        const commodityName = entry.multiplier.commodity;
                        if (!markAllInstances && processedCommodities.has(commodityName)) continue;
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

    // Check undeclared tags (if enabled)
    if (checkTags) {
        const undeclaredTags = new Set(
            Array.from(parsedDoc.tags.values()).filter(t => !t.declared).map(t => t.name)
        );

        if (undeclaredTags.size > 0) {
            const text = document.getText();
            const lines = text.split('\n');
            const processedTags = new Set<string>();

            // Iterate through transactions to find tag usage locations
            for (const transaction of parsedDoc.transactions) {
                // Only process transactions from the current document
                if (transaction.sourceUri && transaction.sourceUri.toString() !== documentUri) {
                    continue;
                }

                // Check transaction-level tags
                if (transaction.tags) {
                    for (const tagName of Object.keys(transaction.tags)) {
                        if (undeclaredTags.has(tagName) && transaction.line !== undefined) {
                            if (!markAllInstances && processedTags.has(tagName)) {
                                continue; // Skip if we already reported this tag
                            }

                            const line = lines[transaction.line];
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

                // Check posting-level tags
                if (transaction.line !== undefined) {
                    let postingLineOffset = 1;
                    for (const posting of transaction.postings) {
                        if (posting.tags) {
                            for (const tagName of Object.keys(posting.tags)) {
                                if (undeclaredTags.has(tagName)) {
                                    if (!markAllInstances && processedTags.has(tagName)) {
                                        continue;
                                    }

                                    // Find the posting line
                                    const postingLine = transaction.line + postingLineOffset;
                                    if (postingLine < lines.length) {
                                        const line = lines[postingLine];
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
                            }
                        }
                        postingLineOffset++;
                    }
                }
            }
        }
    }

    return diagnostics;
}
