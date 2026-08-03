/**
 * `hledger-lsp --format` must produce exactly what the editor's
 * textDocument/formatting produces for the same file in the same workspace.
 *
 * The CLI used to parse the target file in isolation, so commodity styles
 * declared in the workspace root were invisible and every amount was rendered at
 * whatever precision happened to appear in that one file — running the CLI over
 * an editor-formatted journal rewrote it. See issue #17.
 *
 * Requires a build (`npm run build`): the CLI half runs the compiled server.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { formattingProvider } from '../../src/features/formatter';
import { HledgerParser } from '../../src/parser';
import { defaultSettings } from '../../src/server/settings';
import { WorkspaceManager } from '../../src/server/workspace';
import { defaultFileReader } from '../../src/utils/uri';

const serverPath = path.join(__dirname, '../../out/server.js');

const INLAY_HINTS_OFF = { showInferredAmounts: false, showRunningBalances: false, showCostConversions: false };

/** Format `file` the way the editor does: workspace parse, then formatDocument. */
async function formatViaLsp(
  workspaceDir: string,
  file: string,
  formatting: Partial<typeof defaultSettings.formatting> = {}
): Promise<string> {
  const target = path.resolve(workspaceDir, file);
  const manager = new WorkspaceManager();
  await manager.initialize([URI.file(workspaceDir)], new HledgerParser(), defaultFileReader);
  const parsed = manager.parseWorkspace(true);
  if (!parsed) throw new Error('workspace parse produced no document');

  const doc = TextDocument.create(URI.file(target).toString(), 'hledger', 1, fs.readFileSync(target, 'utf-8'));
  const edits = formattingProvider.formatDocument(
    doc,
    parsed,
    { tabSize: 4, insertSpaces: true },
    { ...defaultSettings.formatting, ...formatting },
    INLAY_HINTS_OFF
  );
  return edits.length > 0 ? edits[0].newText : doc.getText();
}

function formatViaCli(cwd: string, ...args: string[]): string {
  return execFileSync('node', [serverPath, '--format', ...args], { encoding: 'utf-8', cwd });
}

describe('CLI --format / LSP formatting parity', () => {
  let workspaceDir: string;
  const targetFile = 'week.journal';

  const week = `2026-01-01 groceries
    expenses:food  £10.35
    assets:bank  £-10.35

2026-01-02 split
    expenses:food  £5.175
    expenses:food  £5.175
    assets:bank  £-10.35

2026-01-03 other
    expenses:x  £4.30
    assets:bank  £-4.30
`;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hledger-lsp-parity-'));
    fs.writeFileSync(path.join(workspaceDir, '.hledger-lsp.json'), JSON.stringify({ rootFile: 'main.journal' }));
    fs.writeFileSync(path.join(workspaceDir, 'main.journal'), 'commodity £1,000.00\n\ninclude week.journal\n');
    fs.writeFileSync(path.join(workspaceDir, targetFile), week);
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('produces byte-identical output to the LSP formatter', async () => {
    const viaLsp = await formatViaLsp(workspaceDir, targetFile);
    expect(formatViaCli(workspaceDir, targetFile)).toBe(viaLsp);
  });

  it('honours the commodity style declared in the workspace root', () => {
    const out = formatViaCli(workspaceDir, targetFile);
    // Declared precision is 2, so 2dp amounts stay 2dp instead of being widened
    // to the 3dp of the split postings elsewhere in the file.
    expect(out).toContain('£ 10.35\n');
    expect(out).toContain('£-4.30\n');
    expect(out).not.toContain('10.350');
    expect(out).not.toContain('4.300');
    // Higher-precision amounts keep their own precision.
    expect(out).toContain('£  5.175\n');
  });

  it('is a no-op on an already-formatted file', () => {
    const once = formatViaCli(workspaceDir, targetFile);
    fs.writeFileSync(path.join(workspaceDir, targetFile), once);
    expect(formatViaCli(workspaceDir, targetFile)).toBe(once);
  });

  it('finds the workspace when run from another directory', () => {
    const fromWorkspace = formatViaCli(workspaceDir, targetFile);
    const fromElsewhere = formatViaCli(os.tmpdir(), path.join(workspaceDir, targetFile));
    expect(fromElsewhere).toBe(fromWorkspace);
  });

  it('treats a file the root does not include as standalone, like the server does', () => {
    // Sitting in the workspace folder is not enough: the server only applies the
    // merged workspace parse to files the root actually pulls in, and formats the
    // rest from their own includes.
    const orphan = 'orphan.journal';
    fs.writeFileSync(path.join(workspaceDir, orphan), week);

    const viaCli = formatViaCli(workspaceDir, orphan);
    const doc = TextDocument.create(
      URI.file(path.join(workspaceDir, orphan)).toString(),
      'hledger',
      1,
      week
    );
    const standalone = formattingProvider.formatDocument(
      doc,
      new HledgerParser().parse(doc),
      { tabSize: 4, insertSpaces: true },
      defaultSettings.formatting,
      INLAY_HINTS_OFF
    )[0].newText;

    expect(viaCli).toBe(standalone);
  });

  it('falls back to a single-file parse with --no-workspace', () => {
    const out = execFileSync('node', [serverPath, '--format', targetFile, '--no-workspace'], {
      encoding: 'utf-8',
      cwd: workspaceDir,
    });
    // Without workspace context the commodity is undeclared, so its style is
    // inferred from the file: max precision 3 applies to every amount.
    expect(out).toContain('10.350');
  });

  it('applies formatting options given on the command line', async () => {
    const viaCli = execFileSync('node', [serverPath, '--format', targetFile, '--decimal-align-column', '30'], {
      encoding: 'utf-8',
      cwd: workspaceDir,
    });
    const viaLsp = await formatViaLsp(workspaceDir, targetFile, { decimalAlignColumn: 30 });

    expect(viaCli).toBe(viaLsp);
    expect(viaCli).not.toBe(await formatViaLsp(workspaceDir, targetFile));
  });
});
