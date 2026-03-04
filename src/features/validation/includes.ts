import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ParsedDocument, FileReader } from '../../types';
import { resolveIncludePath, resolveIncludePaths } from '../../utils/uri';
import { ValidatorOptions } from './types';
import { findFirstOccurrence } from './utils';

export function checkCircularInclude(targetUri: URI, document: TextDocument, fileReader: FileReader, visited: Set<string>): boolean {
    const text = document.getText();
    const documentUri = URI.parse(document.uri);
    const lines = text.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('include ')) {
            const includePath = trimmedLine.substring(8).trim();
            const resolvedPath = resolveIncludePath(includePath, documentUri);

            // Check if this include points back to the target
            if (resolvedPath.toString() === targetUri.toString()) {
                return true;
            }

            // Avoid infinite recursion
            if (visited.has(resolvedPath.toString())) {
                continue;
            }

            visited.add(resolvedPath.toString());

            // Recursively check this file
            const includeDoc = fileReader(resolvedPath);
            if (includeDoc) {
                if (checkCircularInclude(targetUri, includeDoc, fileReader, visited)) {
                    return true;
                }
            }
        }
    }

    return false;
}

export function validateIncludeDirectives(
    document: TextDocument,
    parsedDoc: ParsedDocument,
    options: ValidatorOptions,
    checkMissingFiles: boolean = true,
    checkCircularIncludes: boolean = true
): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const visited = new Set<string>();
    const baseUri = options.baseUri || URI.parse(document.uri);
    const fileReader = options.fileReader!;
    const documentUri = URI.parse(document.uri);

    // Find all include directives in the document
    const includeDirectives = parsedDoc.directives.filter(d => d.type === 'include');

    for (const directive of includeDirectives) {
        const includePath = directive.value;

        // Check if this is a glob pattern
        const isGlob = /[*?\[\]{}]/.test(includePath);

        if (isGlob) {
            // For glob patterns, expand to all matching files
            const resolvedPaths = resolveIncludePaths(includePath, baseUri);

            // Check if glob matched any files (if enabled)
            if (resolvedPaths.length === 0 && checkMissingFiles) {
                const range = findFirstOccurrence(document, includePath);
                if (range) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range,
                        message: `Include glob pattern matches no files: ${includePath}`,
                        source: 'hledger'
                    });
                }
            }

            // Check for circular includes for each matched file
            if (checkCircularIncludes) {
                for (const resolvedPath of resolvedPaths) {
                    const includeDoc = fileReader(resolvedPath);
                    if (includeDoc) {
                        const circularCheck = checkCircularInclude(documentUri, includeDoc, fileReader, new Set([baseUri.toString(), resolvedPath.toString()]));
                        if (circularCheck) {
                            const range = findFirstOccurrence(document, includePath);
                            if (range) {
                                diagnostics.push({
                                    severity: DiagnosticSeverity.Error,
                                    range,
                                    message: `Circular include detected in glob: ${includePath} (via ${resolvedPath})`,
                                    source: 'hledger'
                                });
                                break; // Only report once per glob pattern
                            }
                        }
                    }
                }
            }
        } else {
            // Single file include (existing logic)
            const resolvedPath = resolveIncludePath(includePath, baseUri);

            // Check for duplicate includes in the same document
            if (visited.has(resolvedPath.toString())) {
                const range = findFirstOccurrence(document, includePath);
                if (range) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Warning,
                        range,
                        message: `Duplicate include: ${includePath}`,
                        source: 'hledger'
                    });
                }
                continue;
            }

            visited.add(resolvedPath.toString());

            // Check if file exists (if enabled)
            const includeDoc = fileReader(resolvedPath);

            if (!includeDoc && checkMissingFiles) {
                // File doesn't exist
                const range = findFirstOccurrence(document, includePath);
                if (range) {
                    diagnostics.push({
                        severity: DiagnosticSeverity.Error,
                        range,
                        message: `Include file not found: ${includePath}`,
                        source: 'hledger'
                    });
                }
            }

            // Check for circular includes (if enabled and file exists)
            if (includeDoc && checkCircularIncludes) {
                const circularCheck = checkCircularInclude(documentUri, includeDoc, fileReader, new Set([baseUri.toString(), resolvedPath.toString()]));
                if (circularCheck) {
                    const range = findFirstOccurrence(document, includePath);
                    if (range) {
                        diagnostics.push({
                            severity: DiagnosticSeverity.Error,
                            range,
                            message: `Circular include detected: ${includePath}`,
                            source: 'hledger'
                        });
                    }
                }
            }
        }
    }

    return diagnostics;
}
