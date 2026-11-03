import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dataDirectory, isLocalPath, localFolder } from './paths.mjs';
import { initData, saveJSON } from './store.mjs';
import { collectRelay } from './collectors.mjs';
import { createApp } from './server.mjs';

test('the data folder is QUOTA_DESK_DATA, then an existing legacy data/, then ~/.quota-desk', t => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-desk-paths-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const legacy = join(directory, 'data'), home = join(directory, 'home');
  assert.equal(dataDirectory({ env: {}, home, legacy }), join(home, '.quota-desk'));
  mkdirSync(legacy); assert.equal(dataDirectory({ env: {}, home, legacy }), join(home, '.quota-desk'), 'an empty data/ is not a legacy install');
  writeFileSync(join(legacy, 'config.json'), '{}'); assert.equal(dataDirectory({ env: {}, home, legacy }), legacy);
  assert.equal(dataDirectory({ env: { QUOTA_DESK_DATA: join(directory, 'custom') }, home, legacy }), join(directory, 'custom'));
});

test('network and device paths are never local project folders', () => {
  for (const path of ['\\\\server\\share\\repo', '//server/share/repo', '\\\\?\\C:\\repo', '\\\\.\\pipe\\x']) {
    assert.equal(isLocalPath(path, 'win32'), false, path); assert.equal(isLocalPath(path, 'linux'), false, path);
  }
  assert.equal(isLocalPath('C:\\code\\repo', 'win32'), true);
  assert.equal(isLocalPath('/home/me/repo', 'linux'), true);
  assert.equal(isLocalPath('relative/repo', 'linux'), false);
  assert.equal(isLocalPath('/no-drive', 'win32'), false);
});

test('a local-looking folder that resolves to a network share is refused', t => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-desk-real-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.ok(localFolder(directory));
  assert.equal(localFolder(join(directory, 'missing')), null);
  // A mapped drive (Z:) or a junction to a share resolves to its UNC target.
  assert.equal(localFolder('Z:\\repo', { platform: 'win32', realpath: () => '\\\\server\\share\\repo' }), null);
  assert.equal(localFolder('C:\\repo', { platform: 'win32', realpath: () => 'C:\\repo' }), 'C:\\repo');
});

test('relay collection skips projects on network paths', () => {
  const result = collectRelay([{ name: 'share', path: '\\\\server\\share\\repo' }, { name: 'share2', path: '//server/share/repo' }]);
  assert.equal(result.records.length, 0); assert.equal(result.warnings.length, 1);
});

test('adding a project refuses network paths and accepts an existing local folder', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-desk-project-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dataDir = join(directory, 'data'); initData(dataDir);
  saveJSON(join(dataDir, 'config.json'), { projects: [], nativeSessions: false });
  const app = createApp({ dataDir, port: 49184 });
  await new Promise(resolve => app.server.listen(49184, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { app.server.close(resolve); app.server.closeAllConnections(); }));
  const data = await (await fetch('http://127.0.0.1:49184/api/data')).json(); assert.equal(data.readOnly, false);
  const add = path => fetch('http://127.0.0.1:49184/api/project', { method: 'POST', headers: { Origin: app.origin, 'X-Quota-Desk-Token': data.csrf }, body: JSON.stringify({ name: 'p', path }) });
  assert.equal((await add('\\\\attacker.example\\share')).status, 400);
  assert.equal((await add('//attacker.example/share')).status, 400);
  assert.equal((await add(directory)).status, 200);
  assert.equal((await (await fetch('http://127.0.0.1:49184/api/data')).json()).projects.length, 1);
});

test('the CLI prints its version and the data folder without starting a server', t => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-desk-cli-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('./bin/quota-desk.mjs', import.meta.url));
  const run = (...args) => execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, QUOTA_DESK_DATA: directory } }).trim();
  assert.match(run('--version'), /^\d+\.\d+\.\d+$/);
  assert.equal(run('data'), directory);
  const file = join(directory, 'record.json');
  writeFileSync(file, JSON.stringify({ agent: 'codex', project: 'my-app', task: 'ABC-1', status: 'review', tokens: null }));
  assert.match(run('record', file), /Recorded: ABC-1/);
});
