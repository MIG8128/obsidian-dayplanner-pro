CLAUDE.md - Day Planner Pro (Obsidian Plugin)



Obsidian plugin providing daily/weekly/monthly timeline views, Kanban boards, and bidirectional Google Calendar OAuth2 synchronization.



Build \& Dev Commands



Build: npm run build (or pnpm build)



Dev Watch: npm run dev



Type Check: npx tsc --noEmit



Package Manager: npm (or pnpm)



Code Architecture \& File Map



main.ts: Plugin lifecycle (onload/onunload), settings tab (DayPlannerSettingTab), status bar updates, vault event listeners (modify, create, delete), codeblock processor (dayplanner, dayplanner-pro).



views.ts: View components (DayPlannerCombinedView, DayPlannerDailyView, DayPlannerCodeBlockRenderer). Handles timeline rendering, clustering, drag-and-drop, marquee selection, and codeblock-embedded filters.



types.ts: Core data structures (TaskItem, GCalEvent, DayPlannerSettings, GoogleCalendarConfig, DEFAULT\_SETTINGS).



utils.ts: Parsing and formatting helpers (parseTaskLine, cleanTaskTextForDisplay, updateTaskInFile, scanVaultTasks, calculateClusteredLayout).



modals.ts: Modals for task/event creation, edition, selector, and sync triggers (TaskEditModal, GCalEventEditModal, TaskSyncModal, PathSelectorModal).



gcalApi.ts: Google Calendar REST API v3 client, OAuth2 token refresh, event PATCH/DELETE/POST, batch/single task sync engine.



styles.ts: Exported STYLES template literal injected directly into DOM via document.head.appendChild. Keep CSS rules aligned here.



Key Design Patterns \& Critical Constraints



1\. Loop-Safe File Syncing



Avoid infinite update loops between Obsidian file change events and Google Calendar sync.



Always invoke plugin.markSelfWrite(filePath) before modifying vault files programmatically.



2\. Syncthing Conflict Protection



Exclude sync conflict files matching /\\.sync-conflict-/i using isSyncConflictPath(path) whenever reading or scanning markdown files.



3\. Task Syntax \& Compatibility (Obsidian Tasks plugin)



Task format:

\- \[statusChar] Task Text ⏰HH:mm-HH:mm \[gcalId:: id] \[🔺|⏫|🔼|🔽|⏬] 🔁 recurrence 🛫 start ⏳ scheduled 📅 due ✅ done ❌ cancelled



Maintain emoji-based priorities (🔺 highest, ⏫ high, 🔼 medium, 🔽 low, ⏬ lowest).



Date parsing: Fallback order is scheduled date ⏳ -> due date 📅 -> daily note filename.



4\. Stylesheet Injection



Do not create separate .css files unless migrating the build configuration. All custom CSS must reside in styles.ts and use Obsidian CSS variables (--background-modifier-\*, --interactive-accent, etc.).



5\. Third-Party \& Obsidian API Usage



Use (window as any).moment for date manipulations (Obsidian bundle).



Network requests to Google APIs must use Obsidian's requestUrl to avoid CORS issues.



Use TFile and TFolder checks from Obsidian API before reading/writing paths.



Coding Style Guide



Language: TypeScript (strict mode preferred).



Indentation: 4 spaces.



Naming: PascalCase for classes/interfaces, camelCase for methods/variables, UPPER\_CASE for constants.



Error handling: Wrap external API/vault operations in try/catch and use new Notice() or showRateLimitedNotice() for user-facing errors.



Output Style & Response Guidelines

- Always provide a 2-sentence diagnosis first before presenting code changes.
- Output minimal diffs only. Avoid conversational filler or echoing unchanged code.



Version Bump Policy (MANDATORY)

Whenever modifying code in this repository, ALWAYS bump the version in both `package.json` and `manifest.json`:
- **Patch (+0.0.1)**: Small bug fixes, minor CSS tweaks, small text/layout adjustments.
- **Minor (+0.1.0)**: New features, new settings options, noticeable UI overhauls.
- **Major (+1.0.0)**: Architectural rewrites, major breaking changes.
Keep versions strictly synchronized between `package.json` and `manifest.json`.



UI & Localization Rules

- All settings, labels, placeholders, and default values must be in standard English.
- Avoid full DOM wipes (`innerHTML = ''`) that cause screen flickering; use selective updates/diffing.

