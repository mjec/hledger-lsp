import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fg from 'fast-glob';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Convert a file:// URI to a filesystem path
 * Properly decodes URI-encoded characters (e.g., %20 → space)
 * Handles both Unix (file:///home/...) and Windows (file:///C:/...) formats
 */
export function toFilePath(uri: string): string {
  if (uri.startsWith('file://')) {
    let encodedPath = uri.substring(7);

    // Decode each path component separately to handle encoded characters
    const parts = encodedPath.split('/');
    const decodedParts = parts.map(part => {
      try {
        return decodeURIComponent(part);
      } catch {
        // If decoding fails, return the part as-is
        return part;
      }
    });

    // On Windows, check if this is a Windows path (has drive letter)
    // If so, convert to backslashes. Otherwise, keep forward slashes (for Unix-style test paths)
    if (process.platform === 'win32') {
      // Check if second part (after leading empty string) is a drive letter
      const hasDriveLetter = decodedParts.length > 1 && /^[A-Za-z]:$/.test(decodedParts[1]);

      if (hasDriveLetter) {
        // Windows path with drive letter: file:///C:/Users/... -> C:\Users\...
        const decoded = decodedParts.join(path.sep);
        return decoded.substring(1); // Remove leading separator
      } else {
        // Unix-style path on Windows (e.g., from tests): keep forward slashes
        return decodedParts.join('/');
      }
    }

    // Unix: always use forward slashes
    return decodedParts.join('/');
  }
  return uri;
}

/**
 * Encode a path component for use in a file:// URI
 * Encodes characters that are not allowed in URI paths according to RFC 3986
 * Allowed unencoded: unreserved (A-Za-z0-9-._~) + sub-delims (!$&'()*+,;=) + : @
 */
function encodePathComponent(component: string): string {
  // Characters that should NOT be encoded in file URI paths (per RFC 3986)
  // unreserved: A-Z a-z 0-9 - . _ ~
  // sub-delims: ! $ & ' ( ) * + , ; =
  // also allowed in paths: : @
  const allowedChars = /[A-Za-z0-9\-._~!$&'()*+,;=:@]/;

  let result = '';
  for (let i = 0; i < component.length; i++) {
    const char = component[i];
    if (allowedChars.test(char)) {
      result += char;
    } else {
      // Encode this character
      result += '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return result;
}

/**
 * Ensure a path is represented as a file:// URI
 * Properly encodes special characters (e.g., space → %20)
 * Handles both Unix and Windows filesystem paths
 */
export function toFileUri(fsPath: string): string {
  if (fsPath.startsWith('file://')) return fsPath;

  // Normalize path separators to forward slashes for URI
  // This handles Windows paths that may use backslashes
  const normalized = fsPath.split(path.sep).join('/');

  // Encode each path component separately to preserve slashes
  const parts = normalized.split('/');
  const encoded = parts.map(part => encodePathComponent(part)).join('/');

  // Ensure proper format:
  // Windows: file:///C:/Users/... (3 slashes total)
  // Unix: file:///home/... (3 slashes total)
  // The encoded path should already have leading slash for Unix or drive letter for Windows
  if (encoded.startsWith('/') || /^[A-Za-z]:/.test(encoded)) {
    // Remove any leading slashes and add exactly 3
    return `file:///${encoded.replace(/^\/+/, '')}`;
  }

  // Relative path - prepend with two slashes
  return `file://${encoded}`;
}

/**
 * Default fileReader implementation used by parser/server
 */
export function defaultFileReader(uri: string): TextDocument | null {
  try {
    const filePath = toFilePath(uri);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return TextDocument.create(uri, 'hledger', 1, content);
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
export function resolveIncludePath(includePath: string, baseUri: string): string {
  // Handle file:// URI (e.g. file:///home/user/main.journal)
  if (includePath.startsWith('file://')) {
    // Already a file URI, return as-is
    return includePath;
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
    return toFileUri(resolved);
  }

  // Check if it's an absolute path (works for both Unix and Windows)
  // Unix: /home/... Windows: C:\... or C:/...
  if (path.isAbsolute(includePath)) {
    const resolved = path.resolve(includePath);
    return toFileUri(resolved);
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
export function resolveIncludePaths(includePath: string, baseUri: string): string[] {
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
