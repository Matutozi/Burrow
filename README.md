# Burrow

**Close tabs without fear.** Burrow scores every open tab based on how you use it and what you
told it matters. Clutter can then be archived instead of closed, and everything stays searchable.

> Status: early MVP (step 6 of 7). Setup, scoring, activity tracking, archiving, page-text search, automatic
> archiving, address-bar search and full data controls work.

## Features (so far)
- **Setup wizard** that learns your preferences: who you are, how much each kind of page
  matters, your topics, always-important and low-priority sites, your own site categories,
  what to save per content type, and when a tab counts as stale.
- **Tab scores (0–100)** with a plain-English reason for each, for example
  `9 · last opened 3 days ago (+9)`.
- **Fully configurable:** every scoring weight can be tuned, and your own site rules
  override the built-in lists.
- **Activity-aware:** visits and real time spent on each tab feed the score.
- **Archive instead of close:** archive one clutter tab or all of them. Burrow saves the page's title and
  address first and closes the tab only once that is stored. Every archive can be undone, and archived pages
  can be searched, reopened or deleted from the **Archive** view. Pages whose type is set to "never save"
  (email, banking and health by default) are never archived, so they stay open.
- **Search inside archived pages (opt-in):** turn on "Save the text of Full text pages" in
  **Preferences → What to save** and Chrome asks you to allow page access. Burrow then saves up to
  8,000 characters of readable text when you archive a "Full text" page, and the Archive search shows
  a snippet around each match. It reads a page only at the moment you archive it, skips pages with a
  password box, and falls back to the title if a page can't be read in 3 seconds or storage is full.
  Turning it off gives the permission back to Chrome.
- **Automatic archiving (opt-in):** choose **Archive automatically** under **Preferences → Cleanup**.
  Every hour (configurable) Burrow archives clutter that has been untouched for at least 12 hours,
  at most 20 tabs per check. It never touches pinned, audible or open-in-front tabs, sensitive pages,
  browser pages, or the last tab in a window. A banner in the tab list shows what it archived, with
  one-click **Undo**.
- **Search from the address bar:** type `burrow`, a space, then a few words. Matching archived pages
  appear as suggestions; press Enter to open one. The page stays in your archive, like a bookmark you
  never had to make.
- **Your data, your file:** under **Archive → Your data** you can export everything as JSON, import an
  export (for each page the newest copy wins, so an old backup never overwrites newer entries), delete
  the archive, or delete all Burrow data. Every import and delete can be undone.
- **Private by design:** no servers, no network requests (blocked by the extension's security
  policy), no analytics. Preferences sync only through your own Chrome profile. Archived pages
  stay on this device. Activity stays in memory and is cleared when Chrome closes.

## How scoring works
```
score = recency + activity + content priority + topic match − low-priority site penalty
```
- **Recency** (default up to 70): halves every third of your stale period.
- **Activity** (default up to 15): half from visits, half from time on the tab. Time counts only
  while the tab is in front, Chrome is focused, and you're not idle. You can switch it off.
- **Content priority** (default ±20): from your High/Low choices per content type.
- **Topic match** (default +15): the tab mentions one of your topics.
- **Low-priority site** (default −25).
- **Always-important sites** score 100. Pinned, audible and active tabs are protected and
  never suggested for archiving.

All defaults can be changed under **Preferences → Cleanup → Advanced**.

## Develop
Requires Node 22+.
```bash
npm install
npm run dev        # dev build with hot reload into dist/
npm test           # unit tests
npm run typecheck
npm run build      # production build into dist/
```

## Load in Chrome
1. Run `npm run build` (or `npm run dev`).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Click the Burrow toolbar icon to open the side panel.

## Permissions
| Permission | Why |
|---|---|
| `tabs` | Read tab titles, addresses and last-used times to score them, and switch to a tab when you click it. |
| `storage` | Save your preferences in your Chrome profile and archived pages on this device. |
| `sidePanel` | Show Burrow in Chrome's side panel. |
| `idle` | Pause time counting when you step away or lock your screen, so scores reflect real use. |
| `alarms` (**optional**) | Only if you choose automatic archiving: run the cleanup on a schedule. Granted without a prompt. |
| `scripting` + access to `http`/`https` sites (**optional**) | Only if you turn on page-text saving: read the text of a page at the moment you archive it. Not requested at install. |

See [PRIVACY.md](PRIVACY.md) for the full privacy policy and [CLAUDE.md](CLAUDE.md) for
engineering rules.
