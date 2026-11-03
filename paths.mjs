import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const toolDirectory = dirname(fileURLToPath(import.meta.url));

/**
 * Where sessions, quotas, labels and config.json live, in this order:
 * QUOTA_DESK_DATA, then a `data/` folder next to the code that already holds a
 * config.json (a checkout used before 0.1.0), then ~/.quota-desk.
 */
export function dataDirectory({ env = process.env, home = homedir(), legacy = join(toolDirectory, 'data') } = {}) {
  if (env.QUOTA_DESK_DATA) return resolve(env.QUOTA_DESK_DATA);
  if (existsSync(join(legacy, 'config.json'))) return legacy;
  return join(home, '.quota-desk');
}

/** An absolute path on a local disk. UNC and device paths (\\server\share, //server/share, \\?\) are refused. */
export function isLocalPath(path, platform = process.platform) {
  const value = String(path || '');
  if (/^[\\/]{2}/.test(value)) return false;
  return platform === 'win32' ? /^[a-zA-Z]:[\\/]/.test(value) : isAbsolute(value);
}

/**
 * The real path of an existing local folder, or null. Resolving it also refuses
 * a mapped network drive or a link whose target is a network share, which the
 * spelling alone cannot reveal.
 */
export function localFolder(path, { platform = process.platform, realpath = realpathSync.native } = {}) {
  if (!isLocalPath(path, platform)) return null;
  let real;
  try { real = realpath(path); } catch { return null; }
  return isLocalPath(real, platform) ? real : null;
}
