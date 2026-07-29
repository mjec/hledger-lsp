#!/usr/bin/env node
/**
 * Extract journal snippets from hledger's shelltest suite into
 * tests/integration/hledger-conformance/corpus/.
 *
 * Usage: node scripts/vendor-hledger-corpus.mjs /path/to/hledger-src
 *
 * Reads hledger/test/journal/*.test (shelltest format: `<` starts an input
 * block that runs until the `$ command` line) plus the standalone .j fixtures
 * in hledger/test/journal/ and hledger/test/errors/. Each unique journal
 * becomes a corpus file named <source>-<n>.j with a provenance header.
 *
 * Journals are filtered out when they clearly aren't self-contained journal
 * content (include directives, CSV rules, timeclock/timedot formats).
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const hledgerRoot = process.argv[2];
if (!hledgerRoot) {
  console.error('usage: vendor-hledger-corpus.mjs /path/to/hledger-src');
  process.exit(1);
}

const testDir = path.join(hledgerRoot, 'hledger', 'test');
const outDir = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '..', 'tests', 'integration', 'hledger-conformance', 'corpus'
);
fs.mkdirSync(outDir, { recursive: true });

// Remove previously generated corpus files so deletions upstream propagate
for (const f of fs.readdirSync(outDir)) {
  if (f.endsWith('.j')) fs.unlinkSync(path.join(outDir, f));
}

/** Parse a shelltest file into input blocks. */
function extractInputs(text) {
  const lines = text.split('\n');
  const inputs = [];
  let current = null;
  for (const line of lines) {
    if (current !== null) {
      if (line.startsWith('$ ')) {
        inputs.push(current.join('\n'));
        current = null;
      } else {
        current.push(line);
      }
    } else if (line === '<') {
      current = [];
    }
  }
  return inputs;
}

function isUsableJournal(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Skip non-journal formats and non-self-contained inputs
  if (/^\s*include\s/m.test(text)) return false;          // external files
  if (/^(fields|skip|date-format|amount) /m.test(text)) return false; // CSV rules
  if (/^[io] \d{4}[-/]\d{2}[-/]\d{2}/m.test(text)) return false;      // timeclock
  // Must contain at least one transaction or directive
  if (!/^[0-9~=]|^(account|commodity|payee|tag|D|P|Y|decimal-mark|apply|alias|comment) /m.test(trimmed)) return false;
  return true;
}

const seen = new Set();
const manifest = [];
let total = 0;

function addJournal(content, sourceLabel, index) {
  if (!isUsableJournal(content)) return;
  const hash = createHash('sha256').update(content.trim()).digest('hex').slice(0, 12);
  if (seen.has(hash)) return;
  seen.add(hash);
  const name = index === null ? `${sourceLabel}.j` : `${sourceLabel}-${String(index).padStart(2, '0')}.j`;
  const body = content.endsWith('\n') ? content : content + '\n';
  fs.writeFileSync(path.join(outDir, name), body);
  manifest.push({ file: name, source: sourceLabel, hash });
  total++;
}

// 1. Shelltest input blocks from hledger/test/journal/*.test
const journalTestDir = path.join(testDir, 'journal');
for (const f of fs.readdirSync(journalTestDir).sort()) {
  if (!f.endsWith('.test')) continue;
  const text = fs.readFileSync(path.join(journalTestDir, f), 'utf-8');
  const label = f.replace(/\.test$/, '');
  extractInputs(text).forEach((input, i) => addJournal(input, label, i + 1));
}

// 2. Standalone journal fixtures from hledger/test/journal/ and hledger/test/errors/
for (const dir of ['journal', 'errors']) {
  const d = path.join(testDir, dir);
  for (const f of fs.readdirSync(d).sort()) {
    if (!/\.(j|journal)$/.test(f)) continue;
    const content = fs.readFileSync(path.join(d, f), 'utf-8')
      .replace(/^#!.*\n/, ''); // strip shebang lines like "#!/usr/bin/env -S hledger check -f"
    addJournal(content, `${dir}-${f.replace(/\.(j|journal)$/, '')}`, null);
  }
}

fs.writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify({ source: 'hledger test suite', version: '1.52.1', count: total, files: manifest }, null, 2) + '\n'
);
console.log(`Extracted ${total} unique journals to ${path.relative(process.cwd(), outDir)}`);
