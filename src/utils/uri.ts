import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fg from 'fast-glob';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';

/**
 * Convert a file:// URI to a filesystem path
 * Properly decodes URI-encoded characters (e.g., %20 → space)
 * Handles both Unix (file:///home/...) and Windows (file:///C:/...) formats
 */
export function toFilePath(uri: URI): string {
  return uri.fsPath;
}


/**
 * Ensure a path is represented as a file:// URI
 * Properly encodes special characters (e.g., space → %20)
 * Handles both Unix and Windows filesystem paths
 */
export function toFileUri(fsPath: string): URI {
  return URI.file(fsPath);
}


/**
 * Default fileReader implementation used by parser/server
 */
export function defaultFileReader(uri: URI): TextDocument | null {
  try {
    const filePath = toFilePath(uri);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return TextDocument.create(uri.toString(), 'hledger', 1, content);
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Resolve include paths relative to a base URI.
 * Behavior:
 * - If includePath starts with 'file://': treat as absolute URI
 * - If includePath is an absolute path (Unix: /..., Windows: C:\...): treat as absolute filesystem path
 * - If includePath starts with '~': expand tilde to home directory
 * - Otherwise, treat as relative to the directory of baseUri
 */
export function resolveIncludePath(includePath: string, baseUri: URI): URI {
  // Handle file:// URI (e.g. file:///home/user/main.journal)
  if (includePath.startsWith('file://')) {
    // Already a file URI, return as-is
    return URI.parse(includePath);
  }

  // Expand tilde to home directory (e.g. ~/main.journal)
  if (includePath.startsWith('~')) {
    const home = os.homedir();
    // support both '~' and '~/...'
    let rest = '';
    if (includePath === '~') {
      rest = '';
    } else if (includePath.startsWith('~/')) {
      // remove the leading '~/'
      rest = includePath.slice(2);
    } else {
      // something like '~user/foo' - leave as-is for now (resolve will handle)
      rest = includePath.slice(1);
    }
    const resolved = path.resolve(home, rest);
    return URI.file(resolved);
  }

  // Check if it's an absolute path (works for both Unix and Windows)
  // Unix: /home/... Windows: C:\... or C:/...
  if (path.isAbsolute(includePath)) {
    const resolved = path.resolve(includePath);
    return URI.file(resolved);
  }

  // Relative to the including file
  const basePath = toFilePath(baseUri);
  const baseDir = path.dirname(basePath);
  const resolved = path.join(baseDir, includePath);
  return toFileUri(resolved);
}

/**
 * Resolve include paths into one or more file:// URIs using fast-glob.
 * This delegates glob expansion to fast-glob, configured to exclude dotfiles
 * and to return absolute file paths. The pattern is interpreted relative to
 * the including file's directory when not absolute.
 */
export function resolveIncludePaths(includePath: string, baseUri: URI): URI[] {
  // If not a glob, reuse resolveIncludePath for single-path cases
  if (!/[*?\[\]{}]/.test(includePath)) {
    return [resolveIncludePath(includePath, baseUri)];
  }

  // Determine cwd and pattern for fast-glob
  let cwd: string;
  let pattern = includePath;

  // Check for absolute paths (Unix: /..., Windows: C:\... or C:/...)
  if (path.isAbsolute(includePath)) {
    // For absolute paths with glob patterns, use the directory part as cwd
    // and the basename as the pattern (fast-glob works better this way)
    const normalizedPath = path.normalize(includePath);
    const dir = path.dirname(normalizedPath);
    const base = path.basename(normalizedPath);

    // If the basename has glob characters, use it as pattern
    // Otherwise, the whole path should be treated as a single file (already handled by non-glob case above)
    if (/[*?\[\]{}]/.test(base)) {
      cwd = dir;
      pattern = base;
    } else {
      // Full path with glob in directory parts - keep the full pattern
      if (process.platform === 'win32') {
        const driveMatch = includePath.match(/^([A-Za-z]:)/);
        if (driveMatch) {
          cwd = driveMatch[1] + path.sep;
          pattern = includePath.slice(driveMatch[1].length).replace(/^[\\\/]+/, '');
        } else {
          cwd = path.parse(process.cwd()).root;
          pattern = includePath.replace(/^[\\\/]+/, '');
        }
      } else {
        cwd = '/';
        pattern = includePath.replace(/^\/+/, '');
      }
    }
  } else if (includePath.startsWith('~')) {
    const home = os.homedir();
    if (includePath === '~') {
      cwd = home;
      pattern = '';
    } else if (includePath.startsWith('~/')) {
      cwd = home;
      pattern = includePath.slice(2);
    } else {
      cwd = os.homedir();
      pattern = includePath.slice(1);
    }
  } else {
    const basePath = toFilePath(baseUri);
    cwd = path.dirname(basePath);
    pattern = includePath;
  }

  // fast-glob options: only files, absolute paths, ignore dotfiles/directories
  const entries = fg.sync(pattern, { cwd, onlyFiles: true, absolute: true, dot: false });

  // Exclude the including file itself if present
  // Normalize paths for comparison (handle case sensitivity and separators on Windows)
  const includingFile = path.normalize(toFilePath(baseUri));
  const filtered = entries
    .filter(p => path.normalize(p) !== includingFile)
    .map(p => toFileUri(p));

  filtered.sort();
  return filtered;
}
