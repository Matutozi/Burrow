# Burrow: engineering rules

Burrow is a Chrome extension (Manifest V3) that scores open tabs, archives low-value tabs
instead of closing them, and keeps archived pages searchable so users never need bookmarks.

These rules are non-negotiable. Every change must follow them.

## 1. Lightweight
- Runtime dependencies: `preact` only. Ask before adding any other runtime dependency, and
  justify it against its gzipped size. Current side panel bundle: ~12 KB gzipped. Keep it under 50 KB.
- No polling in the service worker. Use events and `chrome.alarms`.
- Debounce tab events and batch storage writes. Must stay smooth with 1,000 open tabs.
- No remote code, no CDNs, no fonts or images loaded from the network.

## 2. Configurable, not hardcoded
- Every scoring number lives in `Preferences.weights`. Never add a magic number to the scorer.
- Built-in site lists (`BUILT_IN_DOMAINS`, `BUILT_IN_PATTERNS`) are defaults only. User
  `siteRules` always win, and users can switch built-ins off.
- New behaviour gets a preference with a sensible default, plus a migration in `withDefaults`.

## 3. Privacy and data protection (GDPR, Nigeria NDPA 2023, CCPA)
- No backend. Burrow makes **zero network requests**. Any future network feature must be
  opt-in, documented in PRIVACY.md and CHROMEWEBSTORE.md, and encrypted end to end.
- Data minimisation: store only what a feature needs. Sensitive types (email, finance, health)
  default to `indexPolicy: 'never'`.
- Never read or store incognito tabs.
- Preferences may use `chrome.storage.sync` (the user's own Chrome profile). Archived pages and
  activity history must stay in local storage on the device. Only an opt-in, client-side
  encrypted backup may ever move them off it.
- Users must always be able to export and delete all their data.
- Request permissions only when a feature needs them. Prefer `optional_permissions` and
  `optional_host_permissions`. Never ask for `<all_urls>` up front.

## 4. Data integrity
- Never close a tab until its archive record is durably saved. If saving fails, keep the tab.
- Nothing is ever deleted without an explicit user action, and every destructive action has an undo.
- Version stored data (`Preferences.version`) and migrate it. Never silently drop fields.

## 5. Code standards
- The service worker holds no state in memory. Chrome stops idle workers, so persist state in storage.
- Pure, unit-tested logic lives in `src/prefs` and `src/scoring`. The UI stays thin.
- async/await everywhere, and handle every rejected promise.
- Strict TypeScript. No `any`.
- Run `npm run typecheck && npm test && npm run build` before every commit.
- Update CHROMEWEBSTORE.md whenever permissions, data use, or user-facing features change.

## Layout
- `src/background/service-worker.ts`: event wiring only
- `src/prefs/`: preference types, defaults, classifier, site rules, storage
- `src/scoring/`: the pure scoring function
- `src/sidepanel/`: Preact UI (setup wizard, tab list)
