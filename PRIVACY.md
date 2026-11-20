# Burrow Privacy Policy

_Last updated: 2026-11-20 (v0.3.0)_

Burrow is built so that your data never leaves your control.

## What Burrow stores

| Data | Where it is stored | Leaves your device? |
|---|---|---|
| Your preferences (persona, priorities, topics, site lists, scoring settings) | Your Chrome profile (`chrome.storage.sync`) | Only through your own Chrome sync, to your own signed-in devices, if you have Chrome sync turned on. Burrow never receives it. |
| Open tab titles, addresses and last-used times | Read on demand to calculate scores. Not stored. | No |
| Archived pages: title, address, page type, score and the date you archived it | This device only (`chrome.storage.local`). Never synced. | No |
| How many times you switched to each open tab, and how long it was in front | In memory only (`chrome.storage.session`). Never written to disk, never readable by websites, deleted when Chrome closes or the tab is closed. You can switch this off in setup. | No |

Archiving follows the "What to save" choices you made in setup. Pages set to "never save"
(email, banking and health by default) are never archived: Burrow stores nothing about them and
leaves them open. A later version will add optional page-text capture for pages set to "full",
also kept only on your device.

## What Burrow never does
- It runs no servers and makes no network requests. Its security policy tells Chrome to block
  any network connection from Burrow's pages.
- It contains no analytics, tracking, advertising or third-party code.
- It never sells, shares or transfers your data.
- It never reads incognito tabs.

## Your rights
Under laws such as the GDPR, Nigeria's Data Protection Act 2023 and the CCPA, you can access,
export and delete your data. Because everything stays in your own browser, you keep full
control:
- **Access and change:** open Burrow, then **Preferences**.
- **Export:** **Archive → Export all data** saves your preferences and archive as a JSON file.
- **Delete:** **Archive** lets you delete single pages or the whole archive (with undo).
  Removing the extension deletes all of its data from this device. Chrome sync removes the synced
  preferences once the extension is uninstalled on all your devices.

## Contact
Questions: open an issue at https://github.com/Matutozi/Burrow/issues
