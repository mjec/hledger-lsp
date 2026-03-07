/**
 * Get the token at a specific character position
 */
export function getTokenAtPosition(line: string, character: number, boundaryRegex: RegExp): string | null {
  const col = Math.min(character, line.length);

  // Find token boundaries
  let start = col - 1;
  while (start >= 0) {
    const ch = line[start];
    if (boundaryRegex.test(ch)) break;
    start--;
  }
  start++;

  let end = col;
  while (end < line.length) {
    const ch = line[end];
    if (boundaryRegex.test(ch)) break;
    end++;
  }

  const token = line.substring(start, end).trim();
  return token || null;
}

