/**
 * Centralised logger for hledger-lsp.
 *
 * Usage:
 *   // In server.ts, once the LSP connection exists:
 *   logger.init(connection.console);
 *
 *   // Anywhere else:
 *   import { logger } from '../utils/logger';
 *   logger.info('something happened');
 *   logger.error('boom', err);          // appends err.message + stack
 *
 *   // With a fixed context prefix:
 *   const log = logger.withContext('Validator');
 *   log.warn('bad thing');              // emits "[Validator] bad thing"
 *
 * Before init() is called (e.g. during CLI mode or early startup) every method
 * is a no-op so callers don't need to guard against uninitialized state.
 */

import { RemoteConsole } from 'vscode-languageserver/node';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatError(err: unknown): string {
  if (err instanceof Error) {
    // Prefer the full stack trace; fall back to just the message.
    return err.stack ?? err.message;
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// ContextLogger – a prefixed view over the root Logger
// ---------------------------------------------------------------------------

export class ContextLogger {
  constructor(
    private readonly root: Logger,
    private readonly prefix: string
  ) {}

  log(msg: string): void  { this.root.log(`[${this.prefix}] ${msg}`); }
  info(msg: string): void  { this.root.info(`[${this.prefix}] ${msg}`); }
  debug(msg: string): void { this.root.debug(`[${this.prefix}] ${msg}`); }

  warn(msg: string, err?: unknown): void {
    this.root.warn(`[${this.prefix}] ${msg}`, err);
  }

  error(msg: string, err?: unknown): void {
    this.root.error(`[${this.prefix}] ${msg}`, err);
  }

  /** Nest a sub-context: withContext('Foo').withContext('Bar') → '[Foo:Bar] …' */
  withContext(sub: string): ContextLogger {
    return this.root.withContext(`${this.prefix}:${sub}`);
  }
}

// ---------------------------------------------------------------------------
// Logger – singleton, initialised once at server startup
// ---------------------------------------------------------------------------

class Logger {
  private remote: RemoteConsole | null = null;

  /**
   * Wire up the LSP connection's console.  Call this exactly once in
   * server.ts immediately after createConnection().
   */
  init(remote: RemoteConsole): void {
    this.remote = remote;
  }

  /** True once init() has been called. */
  get isInitialized(): boolean {
    return this.remote !== null;
  }

  /** Return a ContextLogger that prepends `[ctx]` to every message. */
  withContext(ctx: string): ContextLogger {
    return new ContextLogger(this, ctx);
  }

  log(msg: string): void {
    this.remote?.log(msg);
  }

  info(msg: string): void {
    this.remote?.info(msg);
  }

  /**
   * Log a warning.  If `err` is provided its message and stack are appended.
   */
  warn(msg: string, err?: unknown): void {
    const full = err !== undefined ? `${msg}: ${formatError(err)}` : msg;
    this.remote?.warn(full);
  }

  /**
   * Log an error.  If `err` is provided its message and stack trace are
   * appended automatically so callers never need to stringify manually.
   */
  error(msg: string, err?: unknown): void {
    const full = err !== undefined ? `${msg}: ${formatError(err)}` : msg;
    this.remote?.error(full);
  }

  debug(msg: string): void {
    this.remote?.debug(msg);
  }
}

/** The process-wide logger singleton. */
export const logger = new Logger();
