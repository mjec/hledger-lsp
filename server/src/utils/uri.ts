import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fg from 'fast-glob';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Convert a file:// URI to a filesystem path
 * Properly decodes URI-encoded characters (e.g., %20 → space)
 */
export function toFilePath(uri: string): string {
  if (uri.startsWith('file://')) {
    const encodedPath = uri.substring(7);
    // Decode each path component separately to handle encoded characters
    const parts = encodedPath.split('/');
    const decoded = parts.map(part => {
      try {
        return decodeURIComponent(part);
      } catch {
        // If decoding fails, return the part as-is
        return part;
      }
    }).join('/');
    return decoded;
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
 */
export function toFileUri(path: string): string {
  if (path.startsWith('file://')) return path;

  // Encode each path component separately to preserve slashes
  const parts = path.split('/');
  const encoded = parts.map(part => encodePathComponent(part)).join('/');
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
 * - If includePath starts with '/': treat as absolute filesystem path
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
  // If includePath starts with '/', treat it as an absolute filesystem path
  // (matching hledger behaviour: leading slash means system-root absolute path)
  if (includePath.startsWith('/')) {
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

  if (includePath.startsWith('/')) {
    // absolute pattern: remove leading slash and search from filesystem root
    cwd = '/';
    pattern = includePath.slice(1);
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
  const includingFile = toFilePath(baseUri);
  const filtered = entries.filter(p => p !== includingFile).map(p => toFileUri(p));

  filtered.sort();
  return filtered;
}
