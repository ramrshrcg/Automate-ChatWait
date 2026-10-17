# ChatWait prompt queue

A small helper for working through a list of real tasks on ChatGPT and
Gemini. You choose how many prompts from `prompts.txt` to run, and it sends
them one at a time and saves every answer to `results/` as Markdown.

## One-time setup

```sh
npm install
npm run chrome
```

This opens a separate Chrome window with its own profile. In that window:

1. Log in to ChatGPT and Gemini.
2. Install ChatWait from the Chrome Web Store.

The profile is saved in `~/.chatwait-workflow-profile`, so you only do this once.

## Daily use

1. Put your tasks in `prompts.txt`, one per line:
   ```
   chatgpt: Explain SQL joins with practical examples.
   chatgpt: Review this function for bugs: ...
   gemini: Create five IELTS vocabulary exercises.
   ```
   If a line has no prefix, it goes to `--site` (default `chatgpt`).
2. `npm run go`. This opens the dashboard at <http://localhost:4000>.
3. Click **Run prompts**, choose the models, the number of prompts and the
   delay between them, and click **Start**.

The dashboard shows progress and a log while it runs, and **Stop** ends a run
early. Each site reuses one chat for 5 prompts before starting a new one.

Finished prompts go into `.progress.json`, so a later run continues where you
stopped. Delete that file to start over.

Options: `node queue.js --count 5 --gap 30 --per-chat 5 --site gemini --prompts other.txt`

## When a site stops working

These sites change their page layout often. Run:

```sh
npm run check
```

It shows which selectors from `sites.js` it can still find on each site. Update
any that show as missing.

## Earnings dashboard

```sh
npm run chrome      # if that window isn't open already
npm run dashboard
```

Then open <http://localhost:4000>. Every 60 seconds, the server reloads
chatwait.com/dashboard in the workflow Chrome window and reads the data that
page loads. The page itself updates every 10 seconds.

- ChatWait only shows your latest 50 impressions, so the dashboard saves each
  one in `data/` and keeps a full history over time.
- The "total earned over time" chart is built from those saved snapshots. It
  starts empty and fills in while the dashboard runs.
- Change the refresh interval with `node dashboard.js --every 120`. For a
  different port, use `--http 4001`.
# Automate-ChatWait
