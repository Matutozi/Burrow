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
- Activity data (visits, time per tab) lives only in `chrome.storage.session` (memory, cleared when
  Chrome closes, `TRUSTED_CONTEXTS` only) and respects `prefs.trackActivity`.
- The production CSP sets `connect-src 'none'`, so Chrome itself blocks network access from
  extension pages. CI fails if a network API appears in the build. Never loosen this without an
  explicit, documented decision.
- `incognito: "not_allowed"` stays in the manifest.

## 4. Data integrity
- **Never trust stored data.** Everything read from storage goes through `sanitizePreferences`
  (validate.ts): wrong types fall back to defaults, numbers are clamped, lists are capped.
- When copies disagree, the newest `updatedAt` wins, so a failed cleanup can never resurrect stale data.
- Never close a tab until its archive record is durably saved. If saving fails, keep the tab.
- Nothing is ever deleted without an explicit user action, and every destructive action has an undo.
- Version stored data (`PREFERENCES_VERSION`) and add a step to `migrate()` for every shape change.

## 5. Architecture
- **Compile once, run many:** `createScorer(prefs)` and `createClassifier()` precompute maps and
  regexes per preference change. Never rebuild them per tab.
- The engine returns structured `ScoreReason` codes. All wording lives in `sidepanel/format.ts`.
- Storage takes injectable areas (`PreferenceAreas`) so integrity logic is unit-tested with fakes.

## 6. Code standards
- The service worker holds no state in memory. Chrome stops idle workers, so persist state in storage.
- Pure, unit-tested logic lives in `src/prefs`, `src/scoring`, `src/activity` and `src/archive`. The UI stays thin.
- async/await everywhere, and handle every rejected promise.
- Strict TypeScript. No `any`.
- Run `npm run check` (typecheck + tests + build) before every commit. CI runs the same.
- Update CHROMEWEBSTORE.md whenever permissions, data use, or user-facing features change.

## Layout
- `src/background/service-worker.ts`: event wiring only
- `src/activity/`: pure activity reducer (`tracker.ts`) and the serialised session store (`store.ts`)
- `src/archive/`: pure record logic and search (`record.ts`), save-then-close archive store with undo (`store.ts`),
  opt-in page-text capture (`capture.ts`), shared tab selection and auto-archive guards (`plan.ts`),
  automatic-run undo record (`autoRun.ts`), thin Chrome wrappers (`chromeApi.ts`), address-bar suggestions
  (`omnibox.ts`), export, import (`importData.ts`) and delete-all with undo (`allData.ts`)
- `src/prefs/`: preference types, defaults, validation and migration, classifier, site rules, storage
- `src/scoring/`: the pure scoring function
- `scripts/`: dependency-free icon drawing (`icons.mjs`) and store packaging with pre-flight checks (`package.mjs`)
- `public/icons/`: generated icons, committed
- `src/sidepanel/`: Preact UI (setup wizard, tab list, archive) and all user-facing wording (`format.ts`)
