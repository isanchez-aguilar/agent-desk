import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { initData, saveJSON, normalizeQuota, clean } from './store.mjs';
import { dataDirectory } from './paths.mjs';
const directory = dataDirectory();
// Official status-line input only. No prompts, transcript contents, credentials
// or context tokens are stored by this collector.
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const agent = process.argv[2] === 'agy' ? 'agy' : 'claude';
  initData(directory);
  const buckets = agent === 'claude' ? ['five_hour', 'seven_day'].flatMap(key => {
    const quota = input.rate_limits?.[key];
    if (!quota || typeof quota.used_percentage !== 'number') return [];
    return [{ label: key === 'five_hour' ? '5 hours' : '7 days', remaining: Math.max(0, 100 - quota.used_percentage),
      resetsAt: typeof quota.resets_at === 'number' ? new Date(quota.resets_at * 1000).toISOString() : null }];
  }) : Object.entries(input.quota || {}).map(([label, quota]) => ({ label, remaining: typeof quota.remaining_fraction === 'number' ? quota.remaining_fraction * 100 : null, resetsAt: quota.reset_time }));
  if (buckets.length) saveJSON(join(directory, 'quotas', `${agent}.json`), normalizeQuota(agent, `${agent === 'claude' ? 'Claude Code' : 'Antigravity'} · official status line`, buckets));
  const id = input.session_id || input.conversation_id;
  if (id) {
    const file = createHash('sha256').update(`${agent}:${id}`).digest('hex');
    saveJSON(join(directory, 'sessions', `${file}.json`), {
      id: `${agent}:${id}`, agent, cwd: clean(input.workspace?.project_dir || input.cwd),
      task: `Session ${String(id).slice(0, 8)}`, model: clean(input.model?.display_name || input.model?.id),
      status: 'registered', tokens: null, timestamp: new Date().toISOString(), source: 'Official status line', kind: 'session',
      summary: 'Observed session; a finished session does not mean the task is done.', evidence: '', next: '', branch: clean(input.vcs?.branch),
    });
  }
  const parts = buckets.map(bucket => `${bucket.label}: ${bucket.remaining == null ? '?' : Math.round(bucket.remaining)}%`);
  process.stdout.write(`${input.model?.display_name || agent} · ${parts.join(' · ') || 'no quota data'} · Agent Desk`);
} catch { process.stdout.write('Agent Desk · no quota data'); }
