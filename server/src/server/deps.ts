// Centralize include dependency tracking for the language server
// Exports functions to update and clear dependencies and to query dependents.

const includeDependencies: Map<string, Set<string>> = new Map();
const fileIncludes: Map<string, Set<string>> = new Map();

/**
 * Update dependency tracking for a file
 * fileUri: the file that includes the files in includedFiles
 */
export function updateDependencies(fileUri: string, includedFiles: Set<string>): void {
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
export function clearDependencies(fileUri: string): void {
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
export function getDependents(uri: string): Set<string> | undefined {
  return includeDependencies.get(uri);
}

/**
 * (Optional) Return which files a file includes
 */
export function getIncludes(fileUri: string): Set<string> | undefined {
  return fileIncludes.get(fileUri);
}

// Test helper: reset internal maps (only used by tests)
export function __test_reset(): void {
  includeDependencies.clear();
  fileIncludes.clear();
}
