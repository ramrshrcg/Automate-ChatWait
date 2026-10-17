// Reading prompts and the done-list, shared by queue.js and dashboard.js.
// Prompts come from prompts.txt plus every .txt file in data/prompts/.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PROGRESS_FILE = '.progress.json';
export const PROMPTS_DIR = path.join('data', 'prompts');
export const ADDED_FILE = path.join(PROMPTS_DIR, 'added.txt');

function promptFiles() {
  const files = fs.existsSync('prompts.txt') ? ['prompts.txt'] : [];
  if (fs.existsSync(PROMPTS_DIR)) {
    for (const f of fs.readdirSync(PROMPTS_DIR).sort()) if (f.endsWith('.txt')) files.push(path.join(PROMPTS_DIR, f));
  }
  return files;
}

export function loadPrompts(file = null, defaultSite = 'chatgpt') {
  const seen = new Set();
  return (file ? [file] : promptFiles())
    .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n'))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const m = line.match(/^(chatgpt|gemini):\s*(.+)$/i);
      const site = m ? m[1].toLowerCase() : defaultSite;
      const text = m ? m[2] : line;
      const id = createHash('sha1').update(`${site}:${text}`).digest('hex').slice(0, 10);
      return { site, text, id };
    })
    .filter((p) => !seen.has(p.id) && seen.add(p.id));
}

export function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function pendingPrompts(file, defaultSite) {
  const progress = loadProgress();
  return loadPrompts(file, defaultSite).filter((p) => !progress[p.id]);
}
