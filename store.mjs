import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export const agents = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity', jules: 'Jules', chatgpt: 'ChatGPT · manual', qwen: 'Qwen (local)' };
export const readJSON = (path, fallback = null) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } };
export function saveJSON(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(temporary, path);
}
export function initData(directory) {
  for (const name of ['', 'quotas', 'sessions', 'records', 'labels']) mkdirSync(join(directory, name), { recursive: true });
}
export function filesJSON(directory) {
  try { return readdirSync(directory).filter(x => x.endsWith('.json')).map(x => readJSON(join(directory, x))).filter(Boolean); } catch { return []; }
}
export const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export const clean = value => String(value || '').slice(0, 3000).replace(/(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{16,}|AKIA[A-Z0-9]{16}|xox[bp]-[a-zA-Z0-9-]+|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|Bearer\s+\S+|(?:api[_-]?key|password|access_token|token)\s*[:=]\s*\S+)/gi, '[redacted]');
export function validateRecord(input) {
  if (!Object.hasOwn(agents, input.agent) || !String(input.task || '').trim() || !String(input.project || '').trim()) throw new Error('Choose an agent, a project and a task.');
  if (!['registered', 'running', 'review', 'done', 'blocked'].includes(input.status)) throw new Error('Invalid status.');
  return { id: randomUUID(), agent: input.agent, project: clean(input.project), task: clean(input.task),
    model: clean(input.model), status: input.status, summary: clean(input.summary), evidence: clean(input.evidence),
    next: clean(input.next), branch: clean(input.branch), timestamp: new Date().toISOString(),
    tokens: input.tokens == null || input.tokens === '' ? null : finite(Number(input.tokens)), source: 'Manual record', kind: 'intervention' };
}
export function normalizeQuota(agent, source, buckets, checkedAt = new Date().toISOString()) {
  if (!Object.hasOwn(agents, agent)) throw new Error('Invalid agent.');
  return { agent, source, checkedAt, buckets: buckets.map(bucket => {
    const remaining = finite(bucket.remaining);
    return { label: clean(bucket.label), remaining: remaining === null ? null : Math.min(100, remaining),
      resetsAt: bucket.resetsAt && Number.isFinite(Date.parse(bucket.resetsAt)) ? new Date(bucket.resetsAt).toISOString() : null };
  }) };
}
export function codexQuota(input) {
  const limits = input.rateLimitsByLimitId ? Object.values(input.rateLimitsByLimitId) : input.rateLimits ? [input.rateLimits] : [];
  const buckets = limits.flatMap(limit => ['primary', 'secondary'].flatMap(key => {
    const window = limit[key];
    if (!window) return [];
    const used = finite(window.usedPercent);
    return [{ label: `${limit.limitName || limit.limitId || 'Codex'} · ${window.windowDurationMins === 300 ? '5 hours' : window.windowDurationMins === 10080 ? '7 days' : `${window.windowDurationMins ?? '?'} min`}`,
      remaining: used === null ? null : Math.max(0, 100 - used), resetsAt: finite(window.resetsAt) === null ? null : new Date(window.resetsAt * 1000).toISOString() }];
  }));
  return { ...normalizeQuota('codex', 'Codex · official app server', buckets), extraResets: finite(input.rateLimitResetCredits?.availableCount) };
}
export function agyQuota(input) {
  return normalizeQuota('agy', 'Antigravity · /usage', (input.command?.data?.groups || []).flatMap(group => (group.buckets || []).map(bucket => ({
    label: `${group.name} · ${bucket.window === '5h' ? '5 hours' : bucket.window === 'weekly' ? '7 days' : bucket.name}`,
    remaining: finite(bucket.remaining_fraction) === null ? null : bucket.remaining_fraction * 100, resetsAt: bucket.reset_time,
  }))));
}
