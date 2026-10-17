// Prompt queue: sends prompts from prompts.txt to ChatGPT / Gemini one at a
// time and saves every answer. Started from the dashboard or the command line.
import { chromium } from 'playwright-core';
import { createInterface } from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { SITES } from './sites.js';
import { openInOwnWindow } from './windows.js';
import { PROGRESS_FILE, loadProgress, pendingPrompts } from './prompts.js';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const DEFAULT_SITE = flag('site', 'chatgpt');
const PROMPTS_FILE = flag('prompts', null); // default: prompts.txt + data/prompts/*.txt
const CDP_URL = `http://localhost:${flag('port', '9222')}`;
const RESULTS_DIR = 'results';
const RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
const PROMPTS_PER_CHAT = Number(flag('per-chat', '5'));
const ONLY_SITES = flag('sites', null)?.split(',');

const rl = createInterface({ input: process.stdin, output: process.stdout });

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function connect() {
  try {
    const browser = await chromium.connectOverCDP(CDP_URL);
    return { browser, context: browser.contexts()[0] };
  } catch {
    console.error(`Could not reach Chrome at ${CDP_URL}. Run \`npm run chrome\` first.`);
    process.exit(1);
  }
}

// Uses the site's tab only if it's the visible tab of its window; otherwise the
// site gets its own window. Never brings anything to the front.
async function pageFor(context, site, newChat = true) {
  for (const p of context.pages().filter((p) => p.url().includes(site.host))) {
    const visible = await p.evaluate(() => document.visibilityState === 'visible').catch(() => false);
    if (visible) {
      if (newChat) await p.goto(site.newChatUrl, { waitUntil: 'domcontentloaded' });
      return p;
    }
  }
  return openInOwnWindow(context, site.newChatUrl);
}

async function waitForResponse(page, site, previousCount) {
  await page.waitForFunction(
    ([sel, n]) => document.querySelectorAll(sel).length > n,
    [site.response, previousCount],
    { timeout: 60_000 },
  );

  // Done when the stop button is gone and the text hasn't changed for 2s.
  const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const generating = (await page.locator(site.stop).count()) > 0;
    const text = await page.locator(site.response).last().innerText().catch(() => '');
    if (text !== last) {
      last = text;
      stableSince = Date.now();
    }
    if (!generating && text && Date.now() - stableSince > 2000) return text;
    await page.waitForTimeout(500);
  }
  throw new Error('Timed out waiting for the response to finish.');
}

function saveResult(prompt, site, response) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = prompt.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const file = path.join(RESULTS_DIR, `${stamp}_${prompt.site}_${slug}.md`);
  fs.writeFileSync(file, `# ${prompt.text}\n\n_${site.name} · ${new Date().toLocaleString()}_\n\n${response}\n`);
  return file;
}

async function runQueue() {
  const { browser, context } = await connect();
  const progress = loadProgress();
  const pending = pendingPrompts(PROMPTS_FILE, DEFAULT_SITE)
    .filter((p) => !ONLY_SITES || ONLY_SITES.includes(p.site));

  if (pending.length === 0) {
    console.log('Nothing to do — every prompt in prompts.txt and data/prompts/ is done.');
    console.log(`(Delete ${PROGRESS_FILE} to start over.)`);
    rl.close();
    return browser.close();
  }

  // Asked once per run (or passed as --count / --gap); no per-prompt questions after this.
  const countAnswer = flag('count', null) ??
    (await rl.question(`${pending.length} prompt(s) waiting. How many should I run? [Enter = all] `));
  const count = Math.min(pending.length, Math.max(1, parseInt(countAnswer, 10) || pending.length));
  const gapAnswer = flag('gap', null) ?? (await rl.question('Seconds to wait between prompts? [Enter = 30] '));
  const gapSeconds = Math.max(0, parseInt(gapAnswer, 10) || 30);
  rl.close();
  const batch = pending.slice(0, count);
  console.log(`\nRunning ${batch.length} prompt(s), ${gapSeconds}s apart. Press Ctrl+C to stop.\n`);
  // Prompts sent in the current chat per site; a new chat starts every PROMPTS_PER_CHAT.
  const chatUses = {};

  for (const [i, prompt] of batch.entries()) {
    const site = SITES[prompt.site];
    if (!site) {
      console.log(`Skipping unknown site "${prompt.site}".`);
      continue;
    }

    if (i > 0 && gapSeconds) await new Promise((r) => setTimeout(r, gapSeconds * 1000));
    console.log(`[${i + 1}/${batch.length}] ${site.name}: ${prompt.text}`);
    const used = chatUses[prompt.site] ?? 0;
    const newChat = used === 0 || used >= PROMPTS_PER_CHAT;
    if (newChat) chatUses[prompt.site] = 0;
    const page = await pageFor(context, site, newChat);
    const input = page.locator(site.input).first();
    try {
      await input.waitFor({ timeout: 30_000 });
    } catch {
      console.log(`  Couldn't find the ${site.name} input box. Are you logged in? Try \`npm run check\`.`);
      continue;
    }
    await input.click();
    await page.keyboard.insertText(prompt.text);

    const previousCount = await page.locator(site.response).count();
    const sendButton = page.locator(site.send).first();
    if (await sendButton.isVisible().catch(() => false)) await sendButton.click();
    else await page.keyboard.press('Enter');
    chatUses[prompt.site]++;

    console.log('  Waiting for the answer…');
    try {
      const response = await waitForResponse(page, site, previousCount);
      const file = saveResult(prompt, site, response);
      progress[prompt.id] = { site: prompt.site, text: prompt.text, file, at: new Date().toISOString() };
      saveProgress(progress);
      console.log(`  Saved → ${file}\n`);
    } catch (err) {
      console.log(`  ${err.message} The prompt stays in the queue.\n`);
    }
  }

  console.log('Done.');
  await browser.close(); // disconnects only; your Chrome window stays open
}

// Opens each site and reports which selectors it can find, for fixing sites.js.
async function check() {
  const { browser, context } = await connect();
  for (const [key, site] of Object.entries(SITES)) {
    const page = await pageFor(context, site);
    await page.waitForTimeout(3000);
    console.log(`${site.name} (${key})`);
    for (const field of ['input', 'send', 'stop', 'response']) {
      const n = await page.locator(site[field]).count();
      console.log(`  ${field.padEnd(9)} ${n > 0 ? `found (${n})` : 'not found'}  ${site[field]}`);
    }
  }
  console.log('\n"send", "stop" and "response" only show up mid-chat, so "not found" there is normal on a new chat.');
  rl.close();
  await browser.close();
}

await (args.includes('--check') ? check() : runQueue());
