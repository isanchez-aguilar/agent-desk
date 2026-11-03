import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { readJSON, clean, finite, codexQuota, agyQuota } from './store.mjs';
import { localFolder } from './paths.mjs';

export function rpcRead(exe, method, params = {}) {
  const allowed = ['account/rateLimits/read', 'account/usage/read'];
  if (!allowed.includes(method)) return Promise.reject(new Error('Method not allowed.'));
  return new Promise((resolveResult, reject) => {
    const child = spawn(exe, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); child.stdin.destroy(); child.kill();
      if (error) reject(error); else resolveResult(value);
    };
    const timer = setTimeout(() => finish(new Error('The Codex query timed out.')), 25000);
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    child.on('error', error => finish(error));
    child.stdin.on('error', error => finish(error));
    child.stderr.on('data', () => {}); // Never persist diagnostics or authentication details.
    child.on('exit', () => finish(new Error('Codex closed the query without returning data.')));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 4 * 1024 * 1024) return finish(new Error('Respuesta demasiado grande.'));
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 0) {
          if (message.error) return finish(new Error('Could not start the official query.'));
          send({ method: 'initialized', params: {} });
          send({ id: 1, method, params });
        }
        if (message.id === 1) finish(message.error ? new Error('The account did not return this information.') : null, message.result);
      }
    });
    send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'quota_desk', title: 'Quota Desk', version: '0.1.0' } } });
  });
}
export async function fetchQuotas(config) {
  const outcomes = await Promise.allSettled([
    rpcRead(config.codexExe, 'account/rateLimits/read').then(codexQuota),
    new Promise((resolveResult, reject) => {
      const child = spawn(config.agyExe, ['-p', '/usage', '--sandbox', '--mode', 'plan', '--output-format', 'json', '--print-timeout', '20s'], { windowsHide: true });
      let output = '', overflow = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error('Antigravity timed out.')); }, 25000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 1024 * 1024) { overflow = true; child.kill(); } });
      child.stderr.on('data', () => {});
      child.on('exit', code => {
        clearTimeout(timer);
        try { if (code || overflow) throw new Error('Antigravity returned no quotas.');
          const input = JSON.parse(output); if (input.status !== 'SUCCESS' || input.command?.name !== 'usage' || input.num_turns !== 0 || input.usage?.total_tokens !== 0) throw new Error('The response is not an inference-free quota query.');
          const quota = agyQuota(input); if (!quota.buckets.length) throw new Error('No Antigravity quotas found.'); resolveResult(quota);
        } catch (error) { reject(error); }
      });
    }),
  ]);
  return outcomes.map((result, i) => result.status === 'fulfilled' ? { quota: result.value } : { agent: i === 0 ? 'codex' : 'agy', error: clean(result.reason.message) });
}

export function projectName(cwd, projects) {
  const path = resolve(cwd || '.').toLowerCase();
  const project = projects.find(item => path === resolve(item.path).toLowerCase() || path.startsWith(resolve(item.path).toLowerCase() + '\\') || path.startsWith(resolve(item.path).toLowerCase() + '/'));
  return project?.name || basename(cwd || 'No project');
}
export function trustedGit() {
  const candidates = process.platform === 'win32' ? [join(process.env.ProgramFiles || 'C:/Program Files', 'Git/cmd/git.exe')] : ['/usr/bin/git', '/opt/homebrew/bin/git'];
  return candidates.find(path => existsSync(path)) || null;
}
export function relayTaskStatus(state) {
  if (!state) return 'registered';
  return state.status === 'running' && state.phase === 'review' ? 'review' : state.status || 'registered';
}
export function collectRelay(allProjects) {
  const records = [], warnings = [];
  // Never run git in, or read from, a network share: config.json can be edited by hand or by other tools.
  const projects = allProjects.map(project => ({ ...project, path: localFolder(project.path) })).filter(project => project.path);
  if (projects.length < allProjects.length) warnings.push('Projects on network paths, or missing, are skipped.');
  const roots = new Map(projects.map(project => [project.path, project.name]));
  const git = trustedGit();
  for (const project of projects) {
    try {
      if (!git) continue;
      const output = execFileSync(git, ['worktree', 'list', '--porcelain'], { cwd: project.path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 5000 });
      // Worktrees can live anywhere, a network share included: check each one as well.
      for (const line of output.split('\n')) if (line.startsWith('worktree ')) { const root = localFolder(line.slice(9).trim()); if (root) roots.set(root, project.name); }
    } catch { /* Non-Git projects remain supported. */ }
  }
  for (const [root, project] of roots) {
    const runs = join(root, '.ai/runs'); if (!existsSync(runs)) continue;
    for (const dir of readdirSync(runs, { withFileTypes: true }).filter(item => item.isDirectory()).slice(0, 200)) {
      const folder = join(runs, dir.name), task = readJSON(join(folder, 'task.json'));
      if (!task) continue;
      const state = readJSON(join(folder, 'state.json')), cloud = readJSON(join(folder, 'jules.json'));
      const turns = readdirSync(folder).filter(file => /^turn-\d+-\d+\.json$/.test(file));
      // Older runner files do not identify the provider per turn. Keep it unknown.
      for (const file of turns) {
        const report = readJSON(join(folder, file)); if (!report) continue;
        const metadata = readJSON(join(folder, file.replace('.json', '.meta.json')), {});
        records.push({ id: `relay:${folder}:${file}`, agent: metadata.provider || 'unknown', project, task: taskTitle(task.objective) || clean(task.id), taskId: clean(task.id), description: clean(task.id),
          summary: clean(report.summary), evidence: clean(report.evidence), next: clean(report.next), status: relayTaskStatus(state), reportedStatus: report.status,
          tokens: finite(metadata.tokens), model: clean(metadata.model), timestamp: metadata.finishedAt || statSync(join(folder, file)).mtime.toISOString(),
          source: 'Local relay', kind: 'relay', branch: '', taskStatus: state?.status || 'registered' });
      }
      if (!turns.length && state) records.push({ id: `relay:${folder}`, agent: state.implementer || 'unknown', project, task: taskTitle(task.objective) || clean(task.id), taskId: clean(task.id), description: clean(task.id),
        summary: clean(state.handoff?.summary || state.reason), evidence: clean(state.handoff?.evidence), next: clean(state.handoff?.next),
        status: state.status, tokens: null, timestamp: statSync(join(folder, 'state.json')).mtime.toISOString(), source: 'Local relay', kind: 'relay' });
      if (cloud) records.push({ id: `jules:${folder}`, agent: 'jules', project, task: taskTitle(task.objective) || clean(task.id), taskId: clean(task.id), description: clean(task.id), status: cloud.stage === 'handed-off' ? 'ready' : cloud.status === 'done' ? 'review' : cloud.status,
        summary: clean(cloud.reason || `Cloud session · ${cloud.stage}`), next: '', evidence: '', tokens: null,
        timestamp: statSync(join(folder, 'jules.json')).mtime.toISOString(), source: 'Jules · relay', kind: 'cloud', url: /^https:\/\/jules\.google\.com\/session\/\d+$/.test(cloud.url || '') ? cloud.url : null });
    }
  }
  return { records, warnings };
}

export function taskTitle(value) {
  if (typeof value !== 'string') return '';
  return clean(value.replace(/<[^>]*>[\s\S]*?<\/[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 180);
}
export function requestDescription(value) {
  if (typeof value !== 'string') return '';
  let text = value;
  if (text.includes('## My request:')) text = text.split('## My request:').at(-1);
  else if (/^\s*(# AGENTS|<environment_context>|<system|<task-notification>|\[Request interrupted)/i.test(text)) return '';
  text = text.replace(/<([\w-]+)\b[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/```[\s\S]*?```/g, ' ').replace(/<[^>]*>/g, ' ');
  text = text.split(/\r?\n/).map(line => line.replace(/^\s*[#>*-]+\s*/, '').trim()).filter(line => line && !/^\s*(PS [A-Z]:|Copyright|Windows PowerShell|Error:|at |\{|\}|\/\/)/i.test(line)).join(' ');
  text = clean(text.replace(/\s+/g, ' ').trim());
  // Bare acknowledgements say nothing about the session.
  if (/^(hi|hello|ok|okay|yes|thanks|thank you|continue|go on|done|hola|listo|si|sí|continua|continúa|gracias|ya funciono)[.!\s]*$/i.test(text)) return '';
  return text.length > 240 ? text.slice(0, 237).replace(/\s+\S*$/, '') + '…' : text;
}
export function requestTitle(value) {
  let title = requestDescription(value).replace(/^(?:please[, ]+|can you\s+|could you\s+|i want you to\s+|i need you to\s+|por favor[, ]+|quiero que\s+|necesito que\s+|puedes\s+|podrías\s+)/i, '');
  if (!title) return '';
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return title.length > 100 ? title.slice(0, 97).replace(/\s+\S*$/, '') + '…' : title;
}
export async function nativeTitles(path = join(homedir(), '.codex/session_index.jsonl')) {
  const titles = new Map(); if (!existsSync(path)) return titles;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) { try { const row = JSON.parse(line); if (row.id && row.thread_name) titles.set(row.id, taskTitle(row.thread_name)); } catch {} }
  return titles;
}
const nativeCache = new Map();
function walkJSONL(directory, maxDepth = 4, result = []) {
  if (maxDepth < 0 || result.length > 500) return result;
  let entries; try { entries = readdirSync(directory, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkJSONL(path, maxDepth - 1, result);
    else if (entry.name.endsWith('.jsonl')) result.push({ path, modified: statSync(path).mtimeMs, size: statSync(path).size });
    if (result.length > 500) break;
  }
  return result;
}
export async function parseNative(file, agent, projects) {
  const messages = new Map(); let session = {}, total = null, model = '', branch = '', last = null, title = '', request = '';
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    if (entry.timestamp) last = entry.timestamp;
    if (agent === 'claude') {
      session.id ||= entry.sessionId; session.cwd ||= entry.cwd;
      if (entry.gitBranch) branch = entry.gitBranch;
      if (entry.type === 'custom-title' && entry.customTitle) title = taskTitle(entry.customTitle);
      if (!title && entry.type === 'summary') title = taskTitle(entry.summary);
      if (!request && entry.type === 'user' && !entry.isMeta) {
        const content = entry.message?.content;
        request = requestDescription(typeof content === 'string' ? content : Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '');
      }
      if (entry.type === 'assistant' && entry.message?.usage) {
        model = entry.message.model || model;
        // Streaming partial records may repeat a message: take its latest usage once.
        messages.set(entry.message.id || entry.uuid, entry.message.usage);
      }
    } else {
      if (entry.type === 'session_meta') session = { id: entry.payload?.id, cwd: entry.payload?.cwd };
      if (!request && entry.type === 'event_msg' && entry.payload?.type === 'user_message') request = requestDescription(entry.payload.message);
      if (entry.type === 'turn_context') model = entry.payload?.model || model;
      if (entry.type === 'event_msg' && entry.payload?.type === 'token_count') total = finite(entry.payload.info?.total_token_usage?.total_tokens) ?? total;
      if (entry.payload?.git?.branch) branch = entry.payload.git.branch;
    }
  }
  if (!session.id || !session.cwd) return null;
  if (messages.size) total = [...messages.values()].reduce((sum, usage) => sum + ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'].reduce((n, key) => n + (finite(usage[key]) || 0), 0), 0);
  return { id: `${agent}:${session.id}`, agent, project: projectName(session.cwd, projects),
    task: title || requestTitle(request) || (branch ? `Untitled session · ${clean(branch)}` : 'Untitled session'), description: request || (branch ? `Branch: ${clean(branch)}` : 'No description available'), sessionId: session.id, titleSource: title ? 'Session title' : request ? 'First request · extracted locally' : 'No title',
    timestamp: last || statSync(file).mtime.toISOString(), status: 'registered', model: clean(model), branch: clean(branch),
    tokens: total, cwd: session.cwd, summary: request || title || 'No title available. You can name this session in Details.',
    evidence: '', next: '', source: 'Local session', kind: 'session' };
}
export async function collectNative(config) {
  if (config.nativeSessions === false) return [];
  const files = [
    ...walkJSONL(join(homedir(), '.claude/projects'), 1).map(file => ({ ...file, agent: 'claude' })),
    ...walkJSONL(join(homedir(), '.codex/sessions'), 4).map(file => ({ ...file, agent: 'codex' })),
  ].sort((a, b) => b.modified - a.modified).slice(0, 80);
  const results = [], titles = await nativeTitles();
  for (const file of files) {
    if (file.size > 64 * 1024 * 1024) continue;
    const key = `${file.path}:${file.modified}:${file.size}`;
    let record = nativeCache.get(key);
    if (record === undefined) {
      try { record = await parseNative(file.path, file.agent, config.projects); } catch { record = null; }
      nativeCache.set(key, record);
    }
    if (record && !results.some(item => item.id === record.id)) results.push({ ...record, ...(titles.has(record.id.replace(/^codex:/, '')) && record.agent === 'codex' ? { task: titles.get(record.id.slice(6)), titleSource: 'Codex title' } : {}), project: projectName(record.cwd, config.projects) });
  }
  if (nativeCache.size > 200) nativeCache.clear();
  return results;
}

export function collectQwen(config, databasePath = join(homedir(), '.local/share/opencode/opencode.db')) {
  if (!existsSync(databasePath)) return [];
  let database;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    // Select numerical usage and routing metadata only, never message content,
    // auth tables or session titles that may contain prompts.
    const hasTitle = database.prepare('PRAGMA table_info(session)').all().some(column => column.name === 'title');
    const rows = database.prepare(`SELECT ${hasTitle ? 's.title' : 'NULL'} title, m.session_id id, s.directory cwd,
      MAX(m.time_updated) updated, json_extract(m.data, '$.modelID') model,
      SUM(json_extract(m.data, '$.tokens.total')) total,
      SUM(json_extract(m.data, '$.tokens.input')) input,
      SUM(json_extract(m.data, '$.tokens.output')) output,
      SUM(json_extract(m.data, '$.tokens.cache.read')) cached,
      SUM(json_extract(m.data, '$.tokens.cache.write')) cacheWrite,
      SUM(json_extract(m.data, '$.tokens.reasoning')) reasoning
      FROM message m JOIN session s ON s.id=m.session_id
      WHERE json_extract(m.data, '$.role')='assistant'
      AND json_extract(m.data, '$.providerID')='local'
      AND lower(json_extract(m.data, '$.modelID')) LIKE '%qwen%'
      GROUP BY m.session_id, json_extract(m.data, '$.modelID') ORDER BY updated DESC LIMIT 200`).all();
    return rows.map(row => ({ id: `qwen:${row.id}:${row.model}`, agent: 'qwen', project: projectName(row.cwd, config.projects),
      task: taskTitle(row.title) || 'Untitled Qwen session', description: `Session ${row.id.slice(-8)}`, titleSource: row.title ? 'OpenCode title' : 'No title', status: 'registered', model: clean(row.model), tokens: finite(row.total),
      tokenDetails: { input: finite(row.input), output: finite(row.output), cached: finite(row.cached), cacheWrite: finite(row.cacheWrite), reasoning: finite(row.reasoning) },
      timestamp: new Date(row.updated).toISOString(), source: 'OpenCode · local read', kind: 'session', summary: 'Usage measured by OpenCode for the local Qwen provider; includes cache tokens.', evidence: '', next: '', branch: '' }));
  } catch { return []; } finally { database?.close(); }
}
