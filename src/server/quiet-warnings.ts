/**
 * Node 22 prints ExperimentalWarnings for two features JScout relies on: node:sqlite
 * (the storage engine) and the proxy support enabled by NODE_USE_ENV_PROXY. Both work
 * fine; hide just those warnings. Import this module before anything else.
 */
const original = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (/SQLite is an experimental feature|EnvHttpProxyAgent is experimental/i.test(text)) return;
  (original as (w: string | Error, ...r: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
