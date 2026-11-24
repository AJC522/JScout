/**
 * node:sqlite prints an ExperimentalWarning on first use in Node 22. It is the
 * storage engine for this app and works fine; hide just that one warning.
 * Import this module before anything that loads node:sqlite.
 */
const original = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature/i.test(text)) return;
  (original as (w: string | Error, ...r: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
