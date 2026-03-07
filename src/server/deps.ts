// Centralize include dependency tracking for the language server
// Exports functions to update and clear dependencies and to query dependents.

import { URI } from "vscode-uri";

const includeDependencies: Map<string, Set<string>> = new Map();
const fileIncludes: Map<string, Set<string>> = new Map();

/**
 * Update dependency tracking for a file
 * fileUri: the file that includes the files in includedFiles
 */
export function updateDependencies(fileUri: URI, includedFiles: Set<URI>): void {
  const fileKey = fileUri.toString();
  const includedKeys = new Set<string>();
  for (const f of includedFiles) {
    includedKeys.add(f.toString());
  }

  // Clear old dependencies for this file
  const oldIncludes = fileIncludes.get(fileKey);
  if (oldIncludes) {
    for (const includedKey of oldIncludes) {
      const dependents = includeDependencies.get(includedKey);
      if (dependents) {
        dependents.delete(fileKey);
        if (dependents.size === 0) {
          includeDependencies.delete(includedKey);
        }
      }
    }
  }

  // Set new dependencies
  fileIncludes.set(fileKey, includedKeys);

  // Update reverse dependencies
  for (const includedKey of includedKeys) {
    let dependents = includeDependencies.get(includedKey);
    if (!dependents) {
      dependents = new Set();
      includeDependencies.set(includedKey, dependents);
    }
    dependents.add(fileKey);
  }
}

/**
 * Clear all dependencies for a file
 */
export function clearDependencies(fileUri: URI): void {
  const fileKey = fileUri.toString();
  const oldIncludes = fileIncludes.get(fileKey);
  if (oldIncludes) {
    for (const includedKey of oldIncludes) {
      const dependents = includeDependencies.get(includedKey);
      if (dependents) {
        dependents.delete(fileKey);
        if (dependents.size === 0) {
          includeDependencies.delete(includedKey);
        }
      }
    }
  }
  fileIncludes.delete(fileKey);
}

/**
 * Return the set of files that depend on the given URI (files that include it).
 */
export function getDependents(uri: URI): Set<string> | undefined {
  return includeDependencies.get(uri.toString());
}

/**
 * (Optional) Return which files a file includes
 */
export function getIncludes(fileUri: URI): Set<string> | undefined {
  return fileIncludes.get(fileUri.toString());
}

// Test helper: reset internal maps (only used by tests)
export function __test_reset(): void {
  includeDependencies.clear();
  fileIncludes.clear();
}
