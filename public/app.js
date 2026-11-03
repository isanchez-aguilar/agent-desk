const $ = selector => document.querySelector(selector);
const element = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = String(text); if (className) node.className = className; return node; };
let data = null, view = 'overview', busy = false;
const names = { registered: 'Registered', running: 'In progress', waiting: 'Waiting', review: 'To review', continue: 'Continue', done: 'Finished', blocked: 'Blocked', unavailable: 'No agent available', ready: 'Ready to merge' };
const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'No date';
const number = value => typeof value === 'number' ? new Intl.NumberFormat().format(Math.round(value)) : 'Unknown';
const title = id => Object.hasOwn(data.agents, id) ? data.agents[id] : 'Unknown agent';
const avatar = id => element('span', id === 'unknown' ? '?' : ({ claude: 'C', codex: '◎', agy: 'A', jules: 'J', chatgpt: 'G', qwen: 'Q' }[id] || '?'), `avatar ${Object.hasOwn(data.agents, id) ? id : ''}`);
function notify(text) { $('#notice').textContent = text; $('#notice').hidden = false; }
async function post(path, payload) {
  const response = await fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent-Desk-Token': data.csrf }, body: JSON.stringify(payload) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not save.'); return result;
}
async function load() {
  if (busy) return; busy = true;
  try { const response = await fetch('/api/data'); if (!response.ok) throw new Error('The panel could not load its data.'); data = await response.json(); render(); }
  catch (error) { notify(error.message); } finally { busy = false; }
}
function option(select, value, text) { const node = element('option', text); node.value = value; select.append(node); }
function fillFilters() {
  const project = $('#project-filter'), previous = project.value;
  project.replaceChildren(); option(project, '', 'All projects');
  const projects = [...new Set([...data.projects.map(item => item.name), ...data.records.map(item => item.project)])].filter(Boolean).sort();
  projects.forEach(name => option(project, name, name)); project.value = projects.includes(previous) ? previous : '';
  const select = $('#agent-filter'), agent = select.value;
  select.replaceChildren(); option(select, '', 'All agents'); Object.keys(data.agents).forEach(id => option(select, id, title(id)));
  option(select, 'unknown', 'Unknown agent'); select.value = agent;
  for (const selector of ['#record-form select[name=agent]', '#quota-form select[name=agent]']) {
    const target = $(selector); if (!target.options.length) Object.keys(data.agents).filter(id => !(selector.includes('quota') && id === 'qwen')).forEach(id => option(target, id, title(id)));
  }
}
function renderQuotas() {
  const grid = $('#quotas'); grid.replaceChildren();
  for (const id of Object.keys(data.agents)) {
    const quota = data.quotas.find(item => item.agent === id);
    const card = element('article', null, 'quota-card'), top = element('div', null, 'quota-top'); top.append(avatar(id));
    const heading = element('div', title(id), 'quota-name'); heading.append(element('span', quota?.source || (id === 'qwen' ? 'Local model · optional' : 'No reading yet'), 'source-chip')); top.append(heading);
    if (id !== 'qwen' && !data.readOnly) { const button = element('button', '⋯', 'quota-manual'); button.setAttribute('aria-label', `Record a quota for ${title(id)}`); button.addEventListener('click', () => { $('#quota-form').elements.agent.value = id; $('#quota-dialog').showModal(); }); top.append(button); }
    card.append(top);
    if (id === 'qwen') {
      const sessions = data.records.filter(record => record.agent === 'qwen' && record.source === 'OpenCode · local read');
      const measured = sessions.filter(record => record.tokens != null);
      card.append(element('div', measured.length ? number(measured.reduce((sum, record) => sum + record.tokens, 0)) : 'Unknown', 'unknown'));
      card.append(element('p', `Tokens observed in ${sessions.length} OpenCode sessions · input, output and cache included.`, 'unknown-note'));
      card.append(element('div', 'Local history available · no cloud quota', 'quota-bottom')); grid.append(card); continue;
    }
    if (quota?.buckets.length) {
      for (const bucket of quota.buckets) {
        const section = element('div', null, 'bucket'), label = element('div', null, 'bucket-top');
        label.append(element('span', bucket.label), element('strong', bucket.remaining == null ? 'Unknown' : `${Number(bucket.remaining.toFixed(1))}%`));
        section.append(label);
        const bar = element('div', null, 'bar'), fill = element('div', null, `bar-fill ${bucket.remaining != null && bucket.remaining < 20 ? 'low' : ''}`);
        fill.style.width = `${bucket.remaining || 0}%`; bar.append(fill); section.append(bar);
        section.append(element('div', bucket.resetsAt ? `Renews ${date(bucket.resetsAt)}` : 'Renewal unknown', 'renewal')); card.append(section);
      }
      const expired = Date.now() - Date.parse(quota.checkedAt) > 600000 || quota.buckets.some(bucket => bucket.resetsAt && Date.parse(bucket.resetsAt) < Date.now());
      card.append(element('div', `${expired ? '◷ Last reading · check again' : '● Current reading'} · ${date(quota.checkedAt)}`, `quota-bottom ${expired ? 'stale' : ''}`));
      if (id === 'codex' && quota.extraResets != null) card.append(element('div', `${quota.extraResets} extra reset(s) available · no confirmed schedule for more`, 'renewal'));
      if (id === 'jules') card.append(element('div', 'Session quota · per-task tokens not available', 'renewal'));
    } else {
      card.append(element('div', id === 'qwen' ? 'No cloud quota' : 'Unknown', 'unknown'));
      const notes = { claude: 'Updates while you use Claude Code with the status-line capture installed.', codex: "The official app server returns this account's limits when they are available.", agy: 'Automatic reading of the shared Gemini and Claude / GPT limits.', jules: 'The website shows a session quota. You can record an observed reading here; it does not publish per-task tokens.', chatgpt: "The chat lives on OpenAI's servers: there is no local file or official query to read. Record what you see in ChatGPT; the Codex quota is not the chat quota.", qwen: 'Runs on your computer. Its availability depends on the local server.' };
      card.append(element('p', notes[id], 'unknown-note')); card.append(element('div', id === 'qwen' ? 'Local availability not checked' : 'Never assumed to have quota left', 'quota-bottom'));
    }
    grid.append(card);
  }
}
function filtered() {
  const query = $('#search').value.trim().toLowerCase(), project = $('#project-filter').value, agent = $('#agent-filter').value, period = Number($('#period').value);
  return data.records.filter(record => (!project || record.project === project) && (!agent || record.agent === agent) && (!period || Date.parse(record.timestamp) >= Date.now() - period * 86400000) && (!query || [record.task, record.description, record.project, record.model, record.summary, record.branch, title(record.agent)].join(' ').toLowerCase().includes(query)));
}
function renderHistory() {
  const records = filtered(), rows = $('#rows'); rows.replaceChildren();
  for (const record of records.slice(0, 100)) {
    const row = element('tr'), task = element('td'); task.append(element('div', record.task, 'task-name'), element('small', `${record.project || 'No project'} · ${record.source}`));
    if (record.description) task.append(element('small', record.description, 'task-description'));
    const agent = element('td'), name = element('div', null, 'agent-name'); name.append(avatar(record.agent), element('span', title(record.agent))); agent.append(name);
    const status = element('td'); const statusText = record.kind === 'relay' && record.status === 'done' ? 'Task reviewed' : record.kind === 'cloud' && record.status === 'ready' ? 'Cloud, ready to merge' : Object.hasOwn(names, record.status) ? names[record.status] : 'Unknown'; status.append(element('span', statusText, `badge ${['done', 'blocked', 'review', 'running'].includes(record.status) ? record.status : ''}`));
    const tokens = element('td', number(record.tokens)); if (record.tokens != null) tokens.append(element('small', record.kind === 'session' ? 'In this session' : 'In this record'));
    const updated = element('td', date(record.timestamp)), action = element('td'), button = element('button', 'Details ↗', 'detail-button'); button.addEventListener('click', () => detail(record)); action.append(button);
    row.append(task, agent, status, tokens, updated, action); rows.append(row);
  }
  $('#empty').hidden = records.length > 0; $('#record-count').textContent = `${records.length} records${records.length > 100 ? ' · showing the 100 most recent' : ''}`;
  const stats = $('#stats'); stats.replaceChildren();
  const metrics = [['Observed records', records.length, 'For this project, agent and period'], ['Active agents', new Set(records.map(record => record.agent).filter(agent => agent !== 'unknown')).size, 'With a record in this period'], ['Finished work', records.filter(record => record.status === 'done').length, 'Does not mean the task was accepted'], ['To review or blocked', records.filter(record => ['blocked', 'review', 'unavailable'].includes(record.status)).length, 'Need a follow-up']];
  for (const [label, value, note] of metrics) { const stat = element('article', null, 'stat'); stat.append(element('span', label), element('strong', value), element('small', note)); stats.append(stat); }
  const chart = $('#usage-bars'); chart.replaceChildren();
  for (const id of Object.keys(data.agents)) {
    const count = records.filter(record => record.agent === id).length, row = element('div', null, 'usage-row'); row.append(element('span', title(id)));
    const bar = element('div', null, 'bar'), fill = element('div', null, 'bar-fill'); fill.style.width = `${count / Math.max(1, records.length) * 100}%`; bar.append(fill); row.append(bar, element('strong', `${count} records`)); chart.append(row);
  }
}
function detail(record) {
  const form = $('#detail-form'); for (const name of ['id', 'task', 'summary', 'evidence', 'next']) form.elements[name].value = record[name] || '';
  $('#detail-agent').textContent = title(record.agent); $('#detail-meta').textContent = `${record.project} · ${record.model || 'Model unknown'} · ${record.branch || 'Branch unknown'} · ${record.source} · ${number(record.tokens)} tokens`;
  if (record.tokenDetails) $('#detail-meta').textContent += ` · Input: ${number(record.tokenDetails.input)} · Output: ${number(record.tokenDetails.output)} · Cache read: ${number(record.tokenDetails.cached)}`;
  if (record.reportedStatus) $('#detail-meta').textContent += ` · Agent reported: ${record.reportedStatus} · Status shown: the task controller's`;
  $('#detail-link').replaceChildren(); if (record.url && /^https:\/\/jules\.google\.com\/session\/\d+$/.test(record.url)) { const link = element('a', 'Open the Jules session ↗', 'text-button'); link.href = record.url; link.target = '_blank'; link.rel = 'noreferrer'; $('#detail-link').append(link); }
  $('#detail-dialog').showModal();
}
function render() {
  fillFilters(); renderQuotas(); renderHistory();
  $('#warnings').hidden = !data.warnings.length; $('#warnings').textContent = data.warnings.join(' ');
  $('#last-updated').textContent = `Local data read ${date(data.generatedAt)}`;
  $('#project-list').replaceChildren(); for (const project of data.projects) { const node = element('div', project.name, 'project-entry'); node.append(element('small', project.path)); $('#project-list').append(node); }
  // Over the network the panel is read-only: the server refuses changes, so hide the controls.
  for (const selector of ['#new-record', '#project-form', '#detail-form .dialog-actions']) $(selector).hidden = data.readOnly;
  $('#connection').lastChild.textContent = data.readOnly ? ' Read-only · local network' : ' Only on this computer';
  setView(view);
}
function setView(next) {
  view = next; document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#quota-section').hidden = view === 'tasks'; $('#usage-section').hidden = view !== 'usage';
  $('#history-title').textContent = view === 'tasks' ? 'Tasks and sessions' : 'Recent activity';
  $('#breadcrumb').replaceChildren(document.createTextNode('Local workspace '), element('span', `/ ${view === 'tasks' ? 'Tasks and sessions' : view === 'usage' ? 'Usage by agent' : 'Overview'}`));
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('#new-record').addEventListener('click', () => $('#record-dialog').showModal());
$('#projects-button').addEventListener('click', () => $('#project-dialog').showModal());
for (const selector of ['#search', '#project-filter', '#agent-filter', '#period']) $(selector).addEventListener(selector === '#search' ? 'input' : 'change', renderHistory);
for (const [name, route] of [['record', 'record'], ['project', 'project'], ['quota', 'quota'], ['detail', 'label']]) {
  $(`#${name}-form`).addEventListener('submit', async event => {
    event.preventDefault(); const form = event.target, button = form.querySelector('button.primary'); button.disabled = true;
    try { await post(route, Object.fromEntries(new FormData(form))); form.closest('dialog').close(); if (name !== 'detail') form.reset(); await load(); notify('Saved on this computer.'); }
    catch (error) { alert(error.message); } finally { button.disabled = false; }
  });
}
$('#refresh').addEventListener('click', async () => {
  const button = $('#refresh'); button.disabled = true; button.textContent = 'Querying accounts…';
  try { const result = await post('refresh', {}); await load(); notify(result.queried ? 'Quotas queried. Each card shows its source and the time of the reading.' : 'There was a query less than a minute ago. The current reading is kept; try again in a minute.'); }
  catch (error) { notify(error.message); } finally { button.disabled = false; button.textContent = '↻ Refresh quotas'; }
});
// Opening or reloading the page re-reads the accounts, so the cards are not the
// readings of the last start. The server still answers at most one query a
// minute (it returns queried:false when it just did), so a quick reload costs nothing.
async function refreshOnOpen() {
  const button = $('#refresh'); button.disabled = true; button.textContent = 'Querying accounts…';
  try { const result = await post('refresh', {}); if (result.queried) await load(); }
  catch { /* the stored readings stay on screen */ }
  finally { button.disabled = false; button.textContent = '↻ Refresh quotas'; }
}
load().then(refreshOnOpen); setInterval(load, 30000);
