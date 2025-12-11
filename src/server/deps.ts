// Centralize include dependency tracking for the language server
// Exports functions to update and clear dependencies and to query dependents.

import { URI } from "vscode-uri";

const includeDependencies: Map<URI, Set<URI>> = new Map();
const fileIncludes: Map<URI, Set<URI>> = new Map();

/**
 * Update dependency tracking for a file
 * fileUri: the file that includes the files in includedFiles
 */
export function updateDependencies(fileUri: URI, includedFiles: Set<URI>): void {
  // Clear old dependencies for this file
  const oldIncludes = fileIncludes.get(fileUri);
  if (oldIncludes) {
    for (const includedFile of oldIncludes) {
      const dependents = includeDependencies.get(includedFile);
      if (dependents) {
        dependents.delete(fileUri);
        if (dependents.size === 0) {
          includeDependencies.delete(includedFile);
        }
      }
    }
  }

  // Set new dependencies
  fileIncludes.set(fileUri, includedFiles);

  // Update reverse dependencies
  for (const includedFile of includedFiles) {
    let dependents = includeDependencies.get(includedFile);
    if (!dependents) {
      dependents = new Set();
      includeDependencies.set(includedFile, dependents);
    }
    dependents.add(fileUri);
  }
}

/**
 * Clear all dependencies for a file
 */
export function clearDependencies(fileUri: URI): void {
  const oldIncludes = fileIncludes.get(fileUri);
  if (oldIncludes) {
    for (const includedFile of oldIncludes) {
      const dependents = includeDependencies.get(includedFile);
      if (dependents) {
        dependents.delete(fileUri);
        if (dependents.size === 0) {
          includeDependencies.delete(includedFile);
        }
      }
    }
  }
  fileIncludes.delete(fileUri);
}

/**
 * Return the set of files that depend on the given URI (files that include it).
 */
export function getDependents(uri: URI): Set<URI> | undefined {
  return includeDependencies.get(uri);
}

/**
 * (Optional) Return which files a file includes
 */
export function getIncludes(fileUri: URI): Set<URI> | undefined {
  return fileIncludes.get(fileUri);
}

// Test helper: reset internal maps (only used by tests)
export function __test_reset(): void {
  includeDependencies.clear();
  fileIncludes.clear();
}
