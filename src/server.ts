#!/usr/bin/env node

/**
 * Executable entry point.
 *
 * CLI modes (--help, --version, --format) are handled first and never start an
 * LSP connection; the language server proper lives in ./lspMain and is only
 * loaded when no CLI mode claimed the invocation. The import is deferred because
 * loading lspMain immediately creates a connection, which fails outside an
 * editor.
 */

import { handleCliArguments } from './server/cli';

async function main(): Promise<void> {
  const handledByCli = await handleCliArguments();
  if (handledByCli) {
    return;
  }

  await import('./lspMain');
}

void main();
