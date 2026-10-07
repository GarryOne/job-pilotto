// The engine's Python for suites that run it directly (pool, mailreading, visitread), with the environment the app gives it (desktop/lib/pipeline.js).
// PYTHONUTF8: files and pipes in UTF-8 on Windows too, whose default is the ANSI code page (7 Oct 2026: the pool suite stopped on Windows at
// "'charmap' codec can't decode byte 0x8f" reading config/search.json, whose ⚙️ heading the app's engine reads fine).
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..', '..', '..');

export const python = () => process.env.E2E_PYTHON || (fs.existsSync(path.join(repo, '.venv', 'bin', 'python')) ? path.join(repo, '.venv', 'bin', 'python') : 'python3');
export const pythonEnv = (extra = {}) => ({...process.env, PYTHONUTF8: '1', ...extra});
