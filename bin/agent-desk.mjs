#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDirectory, toolDirectory } from '../paths.mjs';

const { version } = JSON.parse(readFileSync(join(toolDirectory, 'package.json'), 'utf8'));
const help = `Agent Desk ${version}: a local dashboard for your AI coding agents' sessions and quotas.

Usage:
  agent-desk [--port <n>]       Start the panel on http://127.0.0.1:4318 (default port)
  agent-desk record <file.json> Add a work record (see the README for the format)
  agent-desk capture [agy]      Status-line command: reads the official status JSON on stdin
  agent-desk data               Print the data folder (AGENT_DESK_DATA or ~/.agent-desk)
  agent-desk --version | --help`;

const [command, ...rest] = process.argv.slice(2);
if (command === '--help' || command === '-h' || command === 'help') console.log(help);
else if (command === '--version' || command === '-v') console.log(version);
else if (command === 'data') console.log(dataDirectory());
else if (command === 'record') { process.argv = [process.argv[0], 'record', ...rest]; await import('../record.mjs'); }
else if (command === 'capture') { process.argv = [process.argv[0], 'capture', ...rest]; await import('../capture.mjs'); }
else if (command === undefined || command === '--port') {
  const port = command === '--port' ? Number(rest[0]) : 4318;
  if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('--port needs a number between 1 and 65535.'); process.exit(2); }
  const { start } = await import('../server.mjs');
  await start({ port }).catch(error => { console.error(error.message); process.exitCode = 1; });
} else { console.error(`Unknown command: ${command}\n\n${help}`); process.exitCode = 2; }
