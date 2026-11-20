# Chrome Web Store Listing: Burrow

> Last Updated: 2026-11-20 · Not yet published (MVP step 4 of 7)

## Store Listing

**Extension Name:** Burrow

**Short Description:** Scores your open tabs by how you use them and what matters to you, so you can clear clutter without losing anything.

**Detailed Description:**
Burrow gives every open tab a score from 0 to 100, based on how recently and how much you actually use it, and tells you why, so you can see at a glance which tabs matter and which are clutter.

Tell Burrow what matters to you: the kind of work you do, which types of pages are important, the topics you follow, and the sites you always or never care about. Scores follow your preferences, and you can fine-tune every part of the formula.

How to use it: click the Burrow icon to open the side panel, answer a few setup questions, and your tabs appear sorted into "Clutter" and "Keeping", each with a score and a short reason. Click any tab to jump to it.

Archive instead of close: archive one clutter tab or all of them at once. Burrow saves each page's title and address before closing the tab, every archive can be undone, and the Archive view lets you search, reopen or delete archived pages. Email, banking and health pages are never archived by default. You can export all your data as a file at any time.

Search inside pages (optional): turn on page-text saving and Burrow keeps the readable text of pages you archive, so you can find them later by what they said, not just their title. It's off by default, asks for permission only when you turn it on, and skips pages with password fields.

Privacy: Burrow runs entirely in your browser. It has no servers, sends nothing over the internet, and contains no analytics or third-party tracking. Your preferences are stored in your own Chrome profile, archived pages stay on this device, and usage counts are kept in memory only and cleared when Chrome closes.

Support: https://github.com/Matutozi/Burrow/issues

**Category:** Productivity

**Single Purpose:** Helps users organise and declutter their open browser tabs by scoring each tab's importance.

**Primary Language:** English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ⬜ Not created | |
| Screenshot 1 | 1280×800 | ⬜ Not created | |
| Screenshot 2 | 1280×800 | ⬜ Not created | |
| Small Promo Tile | 440×280 | ⬜ Not created | |

### Screenshot Notes
1. Side panel showing scored tabs split into Clutter and Keeping, next to a browser with many tabs.
2. The Archive view searching inside saved page text, with a highlighted snippet and an "Archived 5 tabs · Undo" message.
3. The setup wizard's "How important is each kind of page?" step.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| tabs | permissions | Reads the title, address and last-used time of open tabs to calculate each tab's importance score shown in the side panel, and switches to a tab when the user clicks it in the list. |
| storage | permissions | Saves the user's setup choices (priorities, topics, site lists, scoring settings) so scores reflect their preferences, and stores archived pages (title, address, date) on the device so the user can search and reopen them. |
| sidePanel | permissions | Burrow's whole interface (setup and the scored tab list) is displayed in Chrome's side panel. |
| scripting | optional_permissions | Requested only when the user turns on "Save the text of Full text pages". When the user archives a tab, Burrow runs a small function in that tab to read its visible text, so the archived page can be searched by content later. Not used for any other purpose, and never on pages with password fields. |
| https://\*/\*, http://\*/\* | optional_host_permissions | Requested together with scripting, only when the user opts in to page-text saving. Needed because the user may archive a tab on any website. Used only when the user archives a tab, and given back to Chrome when the setting is turned off. Not requested at install. |
| idle | permissions | Pauses the "time spent on this tab" counter when the user is away from the keyboard or has locked the screen, so a tab left open overnight isn't scored as heavily used. Only the active/idle/locked state is read. |

## Privacy & Data Use

**Does the extension collect user data?** It reads web history data (open tab titles and addresses) locally to compute scores, and stores the title and address of tabs the user chooses to archive (plus their visible text, if the user opts in to page-text saving), on the device only. Nothing is transmitted off the device or to the developer.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | | No |
| Health info | No | No | | No |
| Financial info | No | No | | No |
| Authentication info | No | No | | No |
| Personal communications | No | No | | No |
| Location | No | No | | No |
| Web history | Yes (open tabs processed locally; titles and addresses of tabs the user archives, stored on the device) | No | Calculating tab scores; letting the user search and reopen archived tabs | No |
| User activity | Yes: tab switch counts and time each tab was in front, held in memory only and cleared when Chrome closes. User can turn it off. | No | Calculating tab scores | No |
| Website content | Only if the user opts in: visible text (up to 8,000 characters) of pages the user archives, stored on the device | No | Letting the user search archived pages by their content | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy
**Privacy Policy URL:** TODO: host PRIVACY.md publicly (e.g. GitHub Pages) before submission.

## Distribution
**Visibility:** Public · **Regions:** All regions

## Developer Info
**Publisher Name:** TODO
**Contact Email:** TODO
**Support URL:** https://github.com/Matutozi/Burrow/issues
**Homepage URL:** https://github.com/Matutozi/Burrow

## Version History
| Version | Date | Summary |
|---|---|---|
| 0.1.0 | 2026-11-20 | Initial MVP: setup wizard, configurable tab scoring, side panel tab list. Not submitted. |
| 0.2.0 | 2026-11-20 | Activity tracking (visits, time in front, idle-aware, in memory only); hardened data validation; network access blocked by security policy. Not submitted. |
| 0.3.0 | 2026-11-20 | Archiving: save-then-close, undo, searchable Archive view with reopen and delete, data export. No new permissions. Not submitted. |
| 0.4.0 | 2026-11-20 | Opt-in page-text saving for "Full text" pages and search inside archived pages with snippets. New optional permissions: scripting and http/https host access, requested only on opt-in. Not submitted. |
