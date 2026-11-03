import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initData, validateRecord, saveJSON } from './store.mjs';
import { dataDirectory } from './paths.mjs';
const directory = dataDirectory();
try {
  const input = JSON.parse(readFileSync(process.argv[2] || 0, 'utf8'));
  const record = validateRecord(input);
  initData(directory); saveJSON(join(directory, 'records', `${record.id}.json`), record);
  console.log(`Recorded: ${record.task}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
