# Day Planner Pro (Obsidian plugin, "Dayloom")

Daily / N-day / weekly / monthly timelines, Board, List, side drawer, two-way Google Calendar sync (OAuth2).

## Commands
- Node is not on PATH: in Bash, first `export PATH="/c/Program Files/nodejs:$PATH"`.
- Type check: `npx tsc --noEmit` · Build: `npm run build` · Dev: `npm run dev`
- Test build + push (routine changes): `npm run testbuild -- "Fix: ..." ["UI: ..."] --trailer "Co-Authored-By: ..."`
  (builds, bumps the 4th version segment in package.json + manifest.json, appends each summary to PENDING_CHANGES.md, commits main.js + manifest.json, pushes master; no tag).

## Files
Keep this map in sync: whenever a file is created, split, renamed or removed, update this list in the same change (exact path + one sentence on its responsibility). CLAUDE.md is gitignored, so the "same commit" is the same piece of work.
- `main.ts`: plugin lifecycle, settings tab, reminders, status bar, vault events, `dayplanner` codeblocks.
- `views.ts`: re-export facade for `src/views/*` (keeps `import ... from './views'` working); add no code here.
- `src/views/shared.ts`: module-level view helpers: filters, undo notices, task-file wrappers, GCal day spans, view reveal animation.
- `src/views/pageSwipe.ts`: page push/pull transition for date and board paging (ghost clone of the old page, touch pull, spring back).
- `src/views/secondFinger.ts`: second-finger gestures while a card is held by touch (slide sideways pages like j/k with the card, up/down scrolls the timeline).
- `src/views/viewSwitch.ts`: view-type switch animation between keep-alive panes (zoom between time scales, short slide to / from Board and List).
- `src/settings/pillTabs.ts`: `PillTabs`, the planner's view-tab bar (.dp-tabs, sliding pill) as a reusable control for the settings page (tab bar, two-way switches).
- `src/views/viewCore.ts`: `PlannerViewCore`, the bottom view layer: all view state/fields, data loading, render loop, nav header, selection, shortcuts, sync.
- `src/views/dragDrop.ts`: `DragDropLayer`: native/pointer/touch drag, drag previews, resize, marquee selection, scheduling on drop.
- `src/views/timelineView.ts`: `TimelineLayer`: Daily / N-day / Weekly timelines, deadlines, all-day chips, inline create.
- `src/views/monthView.ts`: `MonthLayer`: Monthly calendar view.
- `src/views/boardView.ts`: `BoardLayer`: Board (Kanban / Priority / Deadline modes).
- `src/views/listView.ts`: `ListLayer`: List view.
- `src/views/baseView.ts`: `DayPlannerBaseView`, the class chain assembled (Core → DragDrop → Timeline → Month → Board → List → Base).
- `src/views/combinedView.ts`: the tabbed Dayloom view (`DayPlannerCombinedView`) and its compact variant (`DayPlannerDailyView`).
- `src/views/codeblock.ts`: `dayplanner` codeblock renderer; copies every base-layer method onto its prototype (lowest layer first).
- `drawer.ts`: side drawer / mobile menu panels (`SIDE_DRAWER_PANELS`), Deadlines, due chips.
- `utils.ts`: `parseTaskLine`, `updateTaskInFile`, `scanVaultTasks`, layout helpers.
- `sidebarCalendar.ts`: month calendar in Obsidian's sidebar (daily / weekly note links, task + per-calendar dots).
- `modals.ts`, `gcalApi.ts` (Calendar v3 + token refresh), `types.ts` (TaskItem, settings, defaults), `i18n.ts` (en/ko/ja/zh), `styles.ts` (all CSS).

## Rules
- Call `plugin.markSelfWrite(path)` before writing vault files (no sync loops).
- Skip Syncthing conflict files: `isSyncConflictPath(path)` when reading/scanning.
- Task syntax (Obsidian Tasks compatible): `- [s] Text ⏰HH:mm-HH:mm [gcalId:: id] [dueTime:: HH:mm] 🔺⏫🔼🔽⏬ 🔁 rule 🛫 ⏳ 📅 ✅ ❌`. 📅 stays date-only. Placement date: ⏳ → 📅 → daily-note filename.
- CSS only in `styles.ts`, with Obsidian variables; no new .css files. Check light and dark themes.
- `(window as any).moment` for dates; `requestUrl` for Google APIs; check `TFile`/`TFolder` before file access.
- Wrap vault/API calls in try/catch; user-facing errors via `new Notice()` / `showRateLimitedNotice()`.
- New UI text goes in `i18n.ts` for all 4 languages (English is the base). No full DOM wipes (`innerHTML = ''`) that flicker.
- TypeScript, 4-space indent, PascalCase types, camelCase members, UPPER_CASE constants.

## Modularization
- TypeScript files under `src/` stay at 200–250 lines; hard ceiling 300. When a change would push a file past that, split it into cohesive domain submodules under `src/` as part of the change.
- Proactively decompose the remaining monoliths (`main.ts`, `modals.ts`, the `src/views/*` layers still over 300 lines, then `drawer.ts`, `utils.ts`, `gcalApi.ts`) into `src/<domain>/` modules; leave the old root file as a re-export facade until no import uses it.
- View layers are a class chain: methods of a layer can call lower layers freely; a call into a higher layer needs an `abstract` declaration in the lower one. Lower layers import higher view classes with `import type` only (a value import makes a circular `extends` crash at load).
- After every split, and after updating the `## Files` map: `npx tsc --noEmit && npm run build` (zero errors), then load the build in the sandbox (port 9234) and confirm it loads with no console errors and the touched views render.

## Versions & releases
- Routine change: `npm run testbuild` (4th segment +1). Never bump patch/minor on your own.
- Release only when the user says "release" / "배포": bump patch (e.g. 4.4.7.x → 4.4.8), turn PENDING_CHANGES.md into Features / Improvements / Fixes in `releaseNotes.ts`, reset PENDING_CHANGES.md to `# Pending Changes\n\n`, build, commit `release: v<ver>`, `git tag <ver>`, `git push origin master --tags` (GitHub Actions publishes for BRAT).
- Push only `main.js` + `manifest.json`; never `.ts`, `.env`, `data.json`.

## User's vault & testing (sandbox)
- Don't read files in the user's real vault (`C:\Users\MIG\Documents\obsidian\mig8128`): their notes and writing are private. Don't open, cat, grep or list them to debug. The only allowed write there is installing this plugin's build (`main.js`, `manifest.json`, `styles.css` if any) into `.obsidian/plugins/obsidian-day-planner-pro/`, and only after it passed the sandbox test. Never touch `data.json` there.
- Reproduce and test everything in the Obsidian sandbox vault (`sandbox/vault`, gitignored): only this plugin's build and made-up notes. Ask the user for details or a screenshot when a description isn't enough to rebuild a case.
- Sandbox content is neutral placeholders only ("테스트 소설", "인물 A", "테스트 문장입니다."): never titles, characters, settings or sentences taken from or inspired by the user's writing, even ones seen earlier in the conversation.
- Every change is tested in the sandbox before it is reported done: build, copy the build into the sandbox plugin folder, reload the plugin, check it on screen (screenshots over the DevTools protocol), and say in the report what was checked. If something couldn't be checked, say so.
- Keep the sandbox window out of the user's way: don't open or focus their real Obsidian, close the sandbox instance when the test is finished, and never close or restart their own Obsidian.

### Sandbox workflow (Node on PATH first: `export PATH="/c/Program Files/nodejs:$PATH"`)
- `sandbox/vault`: placeholder notes + `.obsidian/community-plugins.json` (`["obsidian-day-planner-pro"]`), basic core plugins, build in `.obsidian/plugins/obsidian-day-planner-pro/`.
- `sandbox/app-data`: the sandbox's own Obsidian profile (`obsidian.json` lists only the sandbox vault, plus a copy of the newest `obsidian-*.asar` from `%APPDATA%\obsidian\`, so it runs the user's Obsidian version). The user's profile is never touched.
- (Re)build both + copy the current `main.js`/`manifest.json`: `npm run build && node sandbox/setup.mjs` (existing notes are kept). If `sandbox/` is missing, recreate `setup.mjs` / `cdp.mjs` from this section.
- Launch (PowerShell; separate instance next to the user's Obsidian, DevTools port 9234 belongs to this project):
  `Start-Process "$env:LOCALAPPDATA\Programs\Obsidian\Obsidian.exe" -ArgumentList '--user-data-dir="C:\Users\MIG\Documents\Use with LLM\for coding\obsidian-dayplanner-pro\sandbox\app-data"','--remote-debugging-port=9234' -WindowStyle Minimized`
- First start only: the trust dialog. Click "작성자를 신뢰하고 플러그인 사용하기" over DevTools (Runtime.evaluate), matching by text on any element: `[...document.querySelectorAll('button, .mod-cta, div')].reverse().find(e => e.textContent.trim() === '작성자를 신뢰하고 플러그인 사용하기')?.click()`.
- Helper `sandbox/cdp.mjs` (Node global WebSocket; Runtime.evaluate with awaitPromise/returnByValue; Page.captureScreenshot): `node sandbox/cdp.mjs list` · `eval "<js>" [--page <title/url part>]` · `shot <out.png> [--page …] [--clip x,y,w,h] [--selector <css>]`. Save screenshots to the scratchpad and Read them.
- Reload the plugin after copying a build: `app.plugins.disablePlugin('obsidian-day-planner-pro')`, then `enablePlugin(...)` (both awaited).
- Close the sandbox (PowerShell), matching only its own profile:
  `Get-CimInstance Win32_Process -Filter "Name='Obsidian.exe'" | ? { $_.CommandLine -like '*--user-data-dir=*obsidian-dayplanner-pro\sandbox\app-data*' } | % { Stop-Process -Id $_.ProcessId -Force }`

### Gotchas
- The settings window is its own DevTools page (title starts with "설정"). In it, `app` is undefined: use `window.opener.app`.
- Reload the plugin with `disablePlugin(id)` then `enablePlugin(id)`.
- Never kill Obsidian processes by matching the word "sandbox" alone: Chromium flags (`--service-sandbox-type`) contain it in the user's own Obsidian processes too. Match the full `--user-data-dir=...sandbox\app-data` path.

## Output
- 2-sentence diagnosis before code changes; minimal diffs, no filler.
- Agents only when the user asks: `scout` (Haiku) for searches, `coder` (Sonnet) for exact edits.
