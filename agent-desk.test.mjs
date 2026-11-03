import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { codexQuota, agyQuota, validateRecord, normalizeQuota, saveJSON, initData } from './store.mjs';
import { parseNative, rpcRead, relayTaskStatus, trustedGit, collectRelay, collectQwen, taskTitle, nativeTitles, requestDescription, requestTitle } from './collectors.mjs';

test('local descriptions skip system wrappers and code, hide credentials and remain short', () => {
  assert.equal(requestDescription('# AGENTS.md instructions\nInternal guidance'), '');
  assert.equal(requestDescription('<environment_context>private environment</environment_context>\n## My request:\nCorrige el inicio de sesión'), 'Corrige el inicio de sesión');
  assert.equal(requestDescription('Corrige el formulario\n```js\nprivate code\n```'), 'Corrige el formulario');
  assert.equal(requestDescription('Arregla acceso token=secret123').includes('secret123'), false);
  assert.ok(requestDescription('texto '.repeat(100)).length <= 240);
  assert.ok(requestTitle('texto '.repeat(100)).length <= 100);
});

test('session descriptions use actual titles and redact credentials', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-titles-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.jsonl');
  writeFileSync(file, [
    { type: 'user', sessionId: 's1', cwd: directory, message: { content: 'Corregir formulario de registro' } },
    { type: 'custom-title', customTitle: 'Validar registro de clientes' },
  ].map(x => JSON.stringify(x)).join('\n'));
  const record = await parseNative(file, 'claude', []);
  assert.equal(record.task, 'Validar registro de clientes');
  assert.equal(record.titleSource, 'Session title');
  const index = join(directory, 'index.jsonl');
  writeFileSync(index, JSON.stringify({ id: 's1', thread_name: 'Revisar envíos' }) + '\ninvalid\n' + JSON.stringify({ id: 's1', thread_name: 'Corregir envíos' }));
  assert.equal((await nativeTitles(index)).get('s1'), 'Corregir envíos');
  assert.equal(taskTitle('Tarea password=secret123').includes('secret123'), false);
  assert.equal(taskTitle('x'.repeat(400)).length, 180);
});
import { createApp } from './server.mjs';

test('unknown quota stays unknown, while an actual exhausted quota is zero', () => {
  const quota = codexQuota({ rateLimits: { primary: { usedPercent: null }, secondary: { usedPercent: 100 } } });
  assert.equal(quota.buckets[0].remaining, null);
  assert.equal(quota.buckets[1].remaining, 0);
  assert.equal(codexQuota({}).buckets.length, 0);
  assert.equal(normalizeQuota('claude', 'test', [{ remaining: 120 }]).buckets[0].remaining, 100);
});
test('Codex uses separate account buckets and converts seconds without exposing account identifiers', () => {
  const quota = codexQuota({ accountId: 'private', rateLimitsByLimitId: { codex: { limitId: 'codex', primary: { usedPercent: 67, windowDurationMins: 300, resetsAt: 1791194418 }, secondary: { usedPercent: 10, windowDurationMins: 10080 } } } });
  assert.equal(quota.buckets[0].remaining, 33); assert.equal(quota.buckets[1].remaining, 90);
  assert.equal(quota.buckets[0].resetsAt, new Date(1791194418000).toISOString());
  assert.equal(JSON.stringify(quota).includes('private'), false);
});
test('Antigravity shared groups stay separate rather than becoming model-specific credit balances', () => {
  const quota = agyQuota({ command: { data: { groups: [{ name: 'Gemini Models', buckets: [{ window: '5h', remaining_fraction: .73 }] }, { name: 'Claude and GPT models', buckets: [{ window: 'weekly', remaining_fraction: .24 }] }] } } });
  assert.equal(quota.buckets[0].remaining, 73); assert.equal(quota.buckets[1].remaining, 24);
  assert.match(quota.buckets[1].label, /Claude and GPT/);
});
test('manual records reject unknown agents and statuses and do not invent token counts', () => {
  const input = { agent: 'claude', project: 'my-app', task: 'ABC-123', status: 'review', summary: 'api_key=sk-secret1234567890' };
  const record = validateRecord(input); assert.equal(record.tokens, null); assert.equal(record.summary.includes('secret123'), false);
  assert.throws(() => validateRecord({ ...input, agent: 'other' }));
  assert.throws(() => validateRecord({ ...input, agent: 'constructor' }));
  assert.throws(() => validateRecord({ ...input, status: 'approved' }));
});
test('ChatGPT is a manual-only agent: records and observed quota, never invented tokens', () => {
  const record = validateRecord({ agent: 'chatgpt', project: 'my-app', task: 'Product review', status: 'done' });
  assert.equal(record.agent, 'chatgpt'); assert.equal(record.tokens, null); assert.equal(record.source, 'Manual record');
  assert.equal(normalizeQuota('chatgpt', 'ChatGPT web · manual reading', [{ label: 'Messages', remaining: 40 }]).buckets[0].remaining, 40);
  assert.throws(() => validateRecord({ agent: 'gemini', project: 'my-app', task: 'x', status: 'done' }));
});

test('Git discovery never chooses an executable from the project directory', () => {
  const path = trustedGit(); if (path) assert.equal(isAbsolute(path), true);
});
test('agent-reported done cannot override controller review or blockage', t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-relay-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const folder = join(directory, '.ai/runs/test'); initData(folder);
  saveJSON(join(folder, 'task.json'), { id: 'test' });
  saveJSON(join(folder, 'turn-0-1.json'), { status: 'done', summary: 'Agent says done' });
  saveJSON(join(folder, 'state.json'), { status: 'running', phase: 'review' });
  let row = collectRelay([{ path: directory, name: 'Test' }]).records[0]; assert.equal(row.status, 'review'); assert.equal(row.reportedStatus, 'done');
  saveJSON(join(folder, 'state.json'), { status: 'blocked' }); row = collectRelay([{ path: directory, name: 'Test' }]).records[0]; assert.equal(row.status, 'blocked');
  assert.equal(relayTaskStatus({ status: 'done' }), 'done');
});
test('Qwen reads only local-model token metadata, not cloud usage or content', t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-qwen-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'fixture.db'), database = new DatabaseSync(path);
  database.exec('CREATE TABLE session (id TEXT, directory TEXT); CREATE TABLE message (session_id TEXT, time_updated INTEGER, data TEXT)');
  database.prepare('INSERT INTO session VALUES (?, ?)').run('local-session', directory);
  const insert = database.prepare('INSERT INTO message VALUES (?, ?, ?)');
  insert.run('local-session', Date.now(), JSON.stringify({ role: 'assistant', providerID: 'local', modelID: 'qwen-test', content: 'PRIVATE CONTENT', tokens: { total: 20, input: 5, output: 3, cache: { read: 12 } } }));
  insert.run('local-session', Date.now(), JSON.stringify({ role: 'assistant', providerID: 'paid-cloud', modelID: 'qwen-cloud', tokens: { total: 100000 } }));
  database.close();
  const records = collectQwen({ projects: [] }, path); assert.equal(records.length, 1); assert.equal(records[0].tokens, 20); assert.equal(records[0].tokenDetails.cached, 12); assert.equal(JSON.stringify(records).includes('PRIVATE CONTENT'), false);
});
test('read-only Codex client cannot call login, consume credits or start agent work', async () => {
  for (const method of ['thread/start', 'account/login/start', 'account/rateLimitResetCredit/consume']) await assert.rejects(rpcRead('codex', method), /not allowed/);
});
test('Claude partial messages are deduplicated and only a bounded initial request is retained', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-native-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.jsonl');
  const meta = { sessionId: 'session-id', cwd: directory, timestamp: '2026-10-05T10:00:00Z', gitBranch: 'fix/abc-213-secret-text' };
  const rows = [
    { ...meta, type: 'user', message: { content: 'Corrige los códigos promocionales. token=secret123\n```js\nPRIVATE CODE CONTENT\n```' } },
    { ...meta, type: 'assistant', message: { id: 'one', model: 'test', usage: { input_tokens: 5, output_tokens: 1 } } },
    { ...meta, type: 'assistant', message: { id: 'one', model: 'test', usage: { input_tokens: 5, output_tokens: 3 } } },
    { ...meta, type: 'assistant', message: { id: 'two', model: 'test', usage: { input_tokens: 2, output_tokens: 2, cache_read_input_tokens: 10 } } },
  ]; writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n'));
  const record = await parseNative(file, 'claude', []); assert.equal(record.tokens, 22);
  assert.match(record.task, /Corrige los códigos/); assert.equal(record.status, 'registered');
  assert.equal(JSON.stringify(record).includes('PRIVATE CODE'), false);
  assert.equal(JSON.stringify(record).includes('secret123'), false);
});
test('Codex cumulative token reports are not added together', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-codex-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.jsonl'); writeFileSync(file, [
    { type: 'session_meta', payload: { id: 'test', cwd: directory } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 100 } } } },
    { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 180 } } } },
  ].map(row => JSON.stringify(row)).join('\n'));
  assert.equal((await parseNative(file, 'codex', [])).tokens, 180);
});
test('HTTP refuses foreign origins and hosts and serves no arbitrary local files', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-http-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  initData(join(directory, 'data'));
  saveJSON(join(directory, 'data/config.json'), { projects: [], nativeSessions: false });
  // Re-create after writing the config so this isolated test reads no native logs.
  const isolated = createApp({ dataDir: join(directory, 'data'), port: 49181 });
  await new Promise(resolve => isolated.server.listen(49181, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { isolated.server.close(resolve); isolated.server.closeAllConnections(); }));
  const response = await fetch('http://127.0.0.1:49181/api/data'); const data = await response.json(); assert.equal(response.status, 200);
  const foreign = await fetch('http://127.0.0.1:49181/api/record', { method: 'POST', headers: { Origin: 'http://evil.example', 'X-Agent-Desk-Token': data.csrf }, body: '{}' }); assert.equal(foreign.status, 403);
  const hostStatus = await new Promise(resolve => request('http://127.0.0.1:49181/api/data', { headers: { Host: 'evil.example:49181' } }, response => { response.resume(); resolve(response.statusCode); }).end()); assert.equal(hostStatus, 403);
  assert.equal((await fetch('http://127.0.0.1:49181/store.mjs')).status, 404);
  const valid = await fetch('http://127.0.0.1:49181/api/record', { method: 'POST', headers: { Origin: isolated.origin, 'X-Agent-Desk-Token': data.csrf }, body: JSON.stringify({ agent: 'qwen', project: 'Test', task: '<img src=x onerror=alert(1)>', status: 'review' }) });
  assert.equal(valid.status, 200); const updated = await (await fetch('http://127.0.0.1:49181/api/data')).json(); assert.equal(updated.records.length, 1);
  const exported = await (await fetch('http://127.0.0.1:49181/api/export')).json(); assert.equal('csrf' in exported, false);
});
