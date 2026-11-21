# Burrow

**Close tabs without fear.** Burrow scores every open tab based on how you use it and what you
told it matters. Clutter can then be archived instead of closed, and everything stays searchable.

> Status: 1.6.0, ready for Chrome Web Store submission. See the checklist in
> [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md#submission-checklist).

## Features (so far)
- **Setup wizard** that learns your preferences: who you are, how much each kind of page
  matters, your topics, always-important and low-priority sites, your own site categories,
  what to save per content type, and when a tab counts as stale.
- **Your own categories:** add the kinds of page that matter to you, like "IEEE opportunities" or
  "Travel grants". Give each a priority and what to save when archived, and tell Burrow how to spot it:
  by site (`ieee.org`) or by words in the title or address ("call for papers", "travel grant"). Your
  categories are checked before the built-in types, and archived pages can be searched by category name.
- **Organise (a cleanup, not just a tidy-up):** click **Organise** and Burrow proposes what to do with
  every tab. Low-score tabs, including clutter inside your existing groups, go to **Archive**: saved,
  searchable, and closed to free memory. Tabs worth keeping are grouped where it helps: your own categories
  first (e.g. "Courses"), then built-in types, then tabs from the same site. Nothing changes until you
  confirm. Move any tab between Archive and the groups, rename or recolour groups, skip a group, put a whole
  group away, or add a new one. One confirmation does both, and one Undo reverses both. Pinned tabs and
  your existing groups are never regrouped. After the trial, Organise still groups for free.
- **Uses your tab groups (opt-in):** a tab in a group named like one of your categories belongs to it.
  Archived pages remember their group, can be searched by it, and go back into it when reopened.
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
- **Archive the tab you're on:** the **This tab** card at the top of the side panel has an **Archive this
  tab** button (it uses the **Save under** name too), or press **Alt+Shift+A** on any tab without opening
  Burrow (change it in chrome://extensions/shortcuts). Its score doesn't matter, since you chose it. Pinned
  tabs, "never save" pages and browser pages are refused. The toolbar icon flashes ✓, and Undo is in
  Burrow's banner.
- **Save under a name:** when archiving (from the tab list or Organise), type a name like *School* in
  **Save under**. Later, type `school` in the Archive search or `burrow school` in the address bar to list
  everything saved under it, or click its chip in the Archive view. "Archive group" in Organise saves under
  the group's name automatically. You can also name pages you archived earlier: search or pick a chip, then
  use **Save these pages under**.
- **Smarter built-in types:** Courses & learning, Jobs & opportunities (internships, scholarships, grants,
  fellowships, hackathons), and coding practice sites like LeetCode and NeetCode are recognised, by site,
  address or, for unknown sites, the tab's title.
- **Search from the address bar:** type `burrow`, a space, then a few words. Matching archived pages
  appear as suggestions; press Enter to open one. The page stays in your archive, like a bookmark you
  never had to make.
- **Your data, your file:** under **Archive → Your data** you can export everything as JSON, import an
  export (for each page the newest copy wins, so an old backup never overwrites newer entries), delete
  the archive, or delete all Burrow data. Every import and delete can be undone.
- **Private by design:** no servers, no network requests (blocked by the extension's security
  policy), no analytics. Preferences sync only through your own Chrome profile. Archived pages
  stay on this device. Activity stays in memory and is cleared when Chrome closes.

## Pricing
Burrow is free to try for 14 days, with everything unlocked. After that, archiving new tabs (by hand
or automatically, including page-text saving) needs a one-time license. Your data is never locked:
scores, reopening and searching your archive (including from the address bar), export, import and
delete stay free forever. License keys are checked on your device; Burrow never contacts a server.

## How scoring works
```
score = recency + activity + content priority + topic match − low-priority site penalty
```
- **Recency** (default up to 70): halves every third of your stale period.
- **Activity** (default up to 15): half from visits, half from time on the tab. Time counts only
  while the tab is in front, Chrome is focused, and you're not idle. You can switch it off.
- **Content priority** (default ±20): from your High/Low choice for the tab's category (if it matches one
  of yours) or its content type. Never both.
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

## Release
```bash
npm run icons      # redraw public/icons from scripts/icons.mjs (only after changing the design)
npm run package    # production build + release/burrow-<version>.zip for the Chrome Web Store
```
`npm run package` refuses to pack a build with network APIs, remote code, source maps, a dev CSP or
a version that doesn't match `package.json`. CI runs it on every push and keeps the zip as a build
artifact.

## Selling licenses
Keys are signed with an ECDSA P-256 key that only you hold, and verified offline by the extension.
```bash
npm run license -- keygen            # once: creates .license/private-key.json and src/license/publicKey.ts
npm run license -- issue <orderId>   # prints a key to send to the buyer (orderId: 1-64 chars, no personal data)
npm run license -- verify <key>      # checks a key
```
- `.license/` is git-ignored. **Back up `.license/private-key.json` somewhere safe and private.** If it is
  lost, you can't issue keys for existing versions; if it leaks, anyone can make keys.
- Generating a new key pair invalidates every key already sold, so do it only before launch.
- Set the store page in `src/license/config.ts` (`PURCHASE_URL`); the Buy button stays hidden while it's empty.
- `npm run package` refuses to pack a build that contains private key material.

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
| `tabGroups` (**optional**) | Only for **Organise** and "Use my Chrome tab groups": read group names, and create and name groups you confirm. Granted without a prompt. |
| `alarms` (**optional**) | Only if you choose automatic archiving: run the cleanup on a schedule. Granted without a prompt. |
| `scripting` + access to `http`/`https` sites (**optional**) | Only if you turn on page-text saving: read the text of a page at the moment you archive it. Not requested at install. |

See [PRIVACY.md](PRIVACY.md) for the full privacy policy and [CLAUDE.md](CLAUDE.md) for
engineering rules.

## License
[MIT](LICENSE)
