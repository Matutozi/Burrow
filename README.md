# Burrow

**Close tabs without fear.** Burrow scores every open tab based on how you use it and what you
told it matters. Clutter can then be archived instead of closed, and everything stays searchable.

> Status: early MVP (step 1 of 7). Scoring and setup work. Archiving and search are coming next.

## Features (so far)
- **Setup wizard** that learns your preferences: who you are, how much each kind of page
  matters, your topics, always-important and low-priority sites, your own site categories,
  what to save per content type, and when a tab counts as stale.
- **Tab scores (0–100)** with a plain-English reason for each, for example
  `9 · last opened 3 days ago (+9)`.
- **Fully configurable:** every scoring weight can be tuned, and your own site rules
  override the built-in lists.
- **Private by design:** no servers, no network requests, no analytics. Preferences sync only
  through your own Chrome profile.

## How scoring works
```
score = recency + activity + content priority + topic match − low-priority site penalty
```
- **Recency** (default up to 70): halves every third of your stale period.
- **Activity** (default up to 15): visits and time on page (tracking arrives in step 2).
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
| `storage` | Save your preferences in your Chrome profile. |
| `sidePanel` | Show Burrow in Chrome's side panel. |

See [PRIVACY.md](PRIVACY.md) for the full privacy policy and [CLAUDE.md](CLAUDE.md) for
engineering rules.
