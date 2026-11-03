import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, networkInterfaces } from 'node:os';
import { isPrivateIPv4, hostAllowed, isLoopback, newAccessCode, codeMatches, createSessions, createLimiter } from './lan.mjs';
import { initData, saveJSON } from './store.mjs';
import { createApp } from './server.mjs';

test('only private IPv4 literals are LAN hosts, and only in LAN mode', () => {
  for (const ip of ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.122']) assert.equal(isPrivateIPv4(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.1.1', '300.1.1.1', 'evil.example', '']) assert.equal(isPrivateIPv4(ip), false, ip);
  assert.equal(hostAllowed('127.0.0.1:4318', 4318, false), true);
  assert.equal(hostAllowed('localhost:4318', 4318, false), true);
  assert.equal(hostAllowed('192.168.1.122:4318', 4318, false), false);
  assert.equal(hostAllowed('192.168.1.122:4318', 4318, true), true);
  assert.equal(hostAllowed('192.168.1.122:9999', 4318, true), false);
  assert.equal(hostAllowed('attacker.example:4318', 4318, true), false);
  assert.equal(hostAllowed('8.8.8.8:4318', 4318, true), false);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('192.168.1.5'), false);
});

test('access codes are readable, compared loosely and never empty', () => {
  const code = newAccessCode();
  assert.match(code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  assert.equal(codeMatches(code.toLowerCase().replace('-', ' '), code), true);
  assert.equal(codeMatches('AAAA-AAAA', code), false);
  assert.equal(codeMatches('', ''), false);
});

test('sessions accept only issued tokens and the limiter locks after repeated failures', () => {
  const sessions = createSessions(), token = sessions.issue();
  assert.equal(sessions.valid(`other=1; ad_session=${token}`), true);
  assert.equal(sessions.valid(`ad_session=${'0'.repeat(64)}`), false);
  assert.equal(sessions.valid(''), false);
  let time = 0; const limiter = createLimiter({ limit: 3, windowMs: 1000, now: () => time });
  for (let index = 0; index < 3; index++) limiter.fail('a');
  assert.equal(limiter.blocked('a'), true); assert.equal(limiter.blocked('b'), false);
  time = 1001; assert.equal(limiter.blocked('a'), false);
});

const lanAddress = Object.values(networkInterfaces()).flat().find(item => item && item.family === 'IPv4' && !item.internal && isPrivateIPv4(item.address))?.address;

test('LAN mode asks a non-loopback client for the code and then lets it in', { skip: !lanAddress && 'no private network interface' }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-lan-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  initData(join(directory, 'data'));
  // Missing executables: a refresh in this test must never query a real account.
  saveJSON(join(directory, 'data/config.json'), { projects: [], nativeSessions: false, codexExe: join(directory, 'missing-codex'), agyExe: join(directory, 'missing-agy') });
  const app = createApp({ dataDir: join(directory, 'data'), port: 49182, lan: true });
  await new Promise(resolve => app.server.listen(49182, '0.0.0.0', resolve));
  t.after(() => new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); }));
  const base = `http://${lanAddress}:49182`;
  assert.ok(app.accessCode); assert.ok(statSync(join(directory, 'data/lan-code')).isFile());

  assert.equal((await fetch(`${base}/api/data`)).status, 401);
  const page = await fetch(base); assert.equal(page.status, 401); assert.match(await page.text(), /access code/);
  assert.equal((await fetch('http://127.0.0.1:49182/api/data')).status, 200, 'loopback needs no code');

  const post = code => fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { Origin: base, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `code=${code}` });
  assert.equal((await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { Origin: 'http://evil.example' }, body: 'code=x' })).status, 403);
  assert.equal((await post('WRONG-CODE')).status, 401);
  const ok = await post(app.accessCode); assert.equal(ok.status, 303);
  const cookie = ok.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/);
  const session = cookie.split(';')[0];
  const data = await (await fetch(`${base}/api/data`, { headers: { Cookie: session } })).json(); assert.ok(data.csrf); assert.equal(data.readOnly, true);
  // Signed in over the network the panel is still read-only: no records, labels, projects or quotas.
  const write = (path, body) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { Cookie: session, Origin: base, 'X-Agent-Desk-Token': data.csrf }, body: JSON.stringify(body) });
  for (const [path, body] of [['record', { agent: 'claude', project: 'p', task: 't', status: 'done' }], ['project', { name: 'p', path: directory }], ['quota', { agent: 'claude', remaining: 5 }], ['label', { id: 'x', task: 't' }]]) assert.equal((await write(path, body)).status, 403, path);
  assert.equal((await write('refresh', {})).status, 200, 'refresh stays available');
  const local = await (await fetch('http://127.0.0.1:49182/api/data')).json(); assert.equal(local.readOnly, false);
});

test('without LAN mode a private-IP Host is refused', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-desk-nolan-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  initData(join(directory, 'data'));
  saveJSON(join(directory, 'data/config.json'), { projects: [], nativeSessions: false });
  const app = createApp({ dataDir: join(directory, 'data'), port: 49183 });
  assert.equal(app.lan, false); assert.equal(app.accessCode, null);
});
