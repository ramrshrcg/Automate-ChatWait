// Live earnings dashboard and control panel: reloads chatwait.com/dashboard in
// the workflow Chrome every minute, captures the data the page itself loads,
// keeps a local history, serves it at http://localhost:4000, and starts prompt
// runs (queue.js) from the page.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SITES } from './sites.js';
import { openInOwnWindow } from './windows.js';
import { ADDED_FILE, PROMPTS_DIR, pendingPrompts } from './prompts.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const CDP_URL = `http://localhost:${flag('port', '9222')}`;
const HTTP_PORT = Number(flag('http', '4000'));
const POLL_SECONDS = Number(flag('every', '60'));
const DASHBOARD_URL = 'https://chatwait.com/dashboard';
const DATA_DIR = 'data';
const IMPRESSIONS_FILE = path.join(DATA_DIR, 'impressions.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

fs.mkdirSync(DATA_DIR, { recursive: true });

const state = {
  user: null,
  earnings: [],
  referrals: 0,
  // The site only loads the latest 50 impressions, so we merge them by id.
  impressions: readJson(IMPRESSIONS_FILE, {}),
  history: readJson(HISTORY_FILE, []),
  lastUpdated: null,
  error: null,
};

function summarizeEarnings(rows) {
  const sum = (filter) => rows.filter(filter).reduce((t, r) => t + Number(r.amount_usd || 0), 0);
  const byStatus = {};
  const byType = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + Number(r.amount_usd || 0);
    byType[r.type] = (byType[r.type] || 0) + Number(r.amount_usd || 0);
  }
  return {
    total: sum(() => true),
    pending: sum((r) => r.status === 'pending'),
    count: rows.length,
    impressionEarnings: sum((r) => r.type === 'impression'),
    impressionEarningRows: rows.filter((r) => r.type === 'impression').length,
    byStatus,
    byType,
  };
}

function handleTable(table, body) {
  if (table === 'users') state.user = Array.isArray(body) ? body[0] : body;
  if (table === 'earnings') state.earnings = body;
  if (table === 'referrals') state.referrals = body.length;
  if (table === 'impressions') {
    for (const row of body) {
      state.impressions[row.id] = {
        site: row.site,
        ts: row.ts,
        dwell_ms: row.dwell_ms,
        billable: row.billable,
        not_billed_reason: row.not_billed_reason,
        ad: row.campaigns?.text ?? '',
      };
    }
    writeJson(IMPRESSIONS_FILE, state.impressions);
  }
}

function recordSnapshot() {
  const s = summarizeEarnings(state.earnings);
  const last = state.history.at(-1);
  if (!last || Math.abs(last.total - s.total) > 1e-9 || Date.now() - last.t > 15 * 60_000) {
    state.history.push({ t: Date.now(), total: s.total, pending: s.pending, count: s.count });
    writeJson(HISTORY_FILE, state.history);
  }
}

async function startPolling() {
  const browser = await chromium.connectOverCDP(CDP_URL).catch(() => {
    console.error(`Could not reach Chrome at ${CDP_URL}. Run \`npm run chrome\` first.`);
    process.exit(1);
  });
  const context = browser.contexts()[0];
  let page = null;

  // Reuses the ChatWait tab, or opens a new one if it was closed.
  const ensurePage = async () => {
    if (page && !page.isClosed()) return page;
    // Old ChatWait tabs in the chat window get closed; the poller uses its own minimized window.
    for (const p of context.pages().filter((p) => p.url().startsWith(DASHBOARD_URL))) await p.close();
    page = await openInOwnWindow(context, 'about:blank', { minimized: true });
    page.on('response', async (res) => {
      const m = res.url().match(/\/rest\/v1\/(users|earnings|impressions|referrals)\?/);
      if (!m || res.request().method() !== 'GET' || !res.ok()) return;
      try {
        handleTable(m[1], await res.json());
      } catch {
        // Body unavailable (e.g. page navigated away); the next poll fills it in.
      }
    });
    return page;
  };

  const poll = async () => {
    try {
      await ensurePage();
      await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle', timeout: 45_000 });
      if (!page.url().startsWith(DASHBOARD_URL)) throw new Error('Not logged in to ChatWait in the workflow Chrome.');
      recordSnapshot();
      state.lastUpdated = Date.now();
      state.error = null;
      const s = summarizeEarnings(state.earnings);
      console.log(`${new Date().toLocaleTimeString()}  $${s.total.toFixed(5)}  ·  ${Object.keys(state.impressions).length} impressions`);
    } catch (err) {
      state.error = err.message;
      console.log(`${new Date().toLocaleTimeString()}  ${err.message}`);
    }
  };

  await poll();
  setInterval(poll, POLL_SECONDS * 1000);
}

// The prompt run started from the dashboard (a queue.js child process).
const run = { child: null, total: 0, done: 0, failed: 0, current: null, log: [], startedAt: null, endedAt: null };

// Appends prompts typed in the pop-up to data/prompts/added.txt. Lines without a
// "chatgpt:" / "gemini:" prefix are spread across the chosen models in turn.
function addPrompts(text, sites) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) return;
  const tagged = lines.map((l, i) => (/^(chatgpt|gemini):/i.test(l) ? l : `${sites[i % sites.length]}: ${l}`));
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
  const existing = fs.existsSync(ADDED_FILE) ? fs.readFileSync(ADDED_FILE, 'utf8') : '';
  const sep = existing && !existing.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(ADDED_FILE, sep + tagged.join('\n') + '\n');
}

function startRun({ sites, count, gap, newPrompts }) {
  if (run.child) throw new Error('A run is already in progress.');
  sites = (sites || []).filter((s) => SITES[s]);
  if (!sites.length) throw new Error('Choose at least one model.');
  addPrompts(newPrompts, sites);
  const available = pendingPrompts().filter((p) => sites.includes(p.site)).length;
  if (!available) throw new Error('No new prompts left for the chosen model(s). Add a .txt file to data/prompts/ or type some above. Prompts already run are skipped.');
  count = Math.min(available, Math.max(1, parseInt(count, 10) || 1));
  gap = Math.max(5, parseInt(gap, 10) || 30);

  Object.assign(run, { total: count, done: 0, failed: 0, current: null, log: [], startedAt: Date.now(), endedAt: null });
  const child = spawn(process.execPath, ['queue.js', '--sites', sites.join(','), '--count', String(count), '--gap', String(gap)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  run.child = child;
  let buffer = '';
  const onData = (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines.filter((l) => l.trim())) {
      run.log.push({ t: Date.now(), line });
      if (run.log.length > 200) run.log.shift();
      const m = line.match(/^\[(\d+)\/(\d+)\] (.+)$/);
      if (m) run.current = m[3];
      if (line.includes('Saved →')) run.done++;
      if (line.includes('stays in the queue') || line.includes("Couldn't find")) run.failed++;
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code, signal) => {
    if (signal) run.log.push({ t: Date.now(), line: 'Stopped.' });
    else if (code) run.log.push({ t: Date.now(), line: `Run ended with an error (code ${code}).` });
    Object.assign(run, { child: null, current: null, endedAt: Date.now() });
  });
}

function queueStatus() {
  const pending = pendingPrompts();
  const waiting = Object.fromEntries(Object.keys(SITES).map((k) => [k, pending.filter((p) => p.site === k).length]));
  return {
    sites: Object.fromEntries(Object.entries(SITES).map(([k, v]) => [k, v.name])),
    waiting,
    running: Boolean(run.child),
    total: run.total,
    done: run.done,
    failed: run.failed,
    current: run.current,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    log: run.log.slice(-40),
  };
}

const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });

function apiData() {
  const impressions = Object.entries(state.impressions)
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  return {
    user: state.user && {
      flagged: state.user.flagged,
      suspended: state.user.suspended,
      created_at: state.user.created_at,
    },
    earnings: summarizeEarnings(state.earnings),
    referrals: state.referrals,
    impressions,
    history: state.history,
    lastUpdated: state.lastUpdated,
    pollSeconds: POLL_SECONDS,
    error: state.error,
  };
}

http
  .createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'POST') {
      // Only this page may start or stop runs, not other websites open in the browser.
      if (req.headers.origin !== `http://localhost:${HTTP_PORT}` || req.headers['content-type'] !== 'application/json') {
        return json(403, { error: 'Forbidden' });
      }
      try {
        if (req.url === '/api/run') {
          startRun(await readBody(req));
          return json(200, queueStatus());
        }
        if (req.url === '/api/stop') {
          run.child?.kill('SIGINT');
          return json(200, queueStatus());
        }
      } catch (err) {
        return json(400, { error: err.message });
      }
    }
    if (req.url === '/api/queue') {
      try {
        return json(200, queueStatus());
      } catch (err) {
        return json(500, { error: err.message });
      }
    }
    if (req.url === '/api/data') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(apiData()));
    }
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(fs.readFileSync('dashboard.html'));
    }
    res.writeHead(404).end();
  })
  .listen(HTTP_PORT, '127.0.0.1', () => {
    console.log(`Dashboard → http://localhost:${HTTP_PORT}  (refreshing every ${POLL_SECONDS}s)`);
  });

await startPolling();
