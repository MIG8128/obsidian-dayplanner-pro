// Module-level helpers shared by the planner views: undo notices, task-file wrappers, filters, GCal day spans, motion helpers.
import { App, Notice, Platform, TFile } from 'obsidian';
import { deadlineLabel, isDeadlineMissed, isDeadlineOnly, isScheduledAfterDeadline } from '../../drawer';
import { deleteGoogleCalendarEvent, restoreGoogleCalendarEvent, syncEditedTaskToGCal, updateGoogleCalendarEvent } from '../../gcalApi';
import { t } from '../../i18n';
import DayPlannerPlugin from '../../main';
import { DayReviewModal, ReviewChoice } from '../../modals';
import { GCalEvent, MOTION, TaskItem } from '../../types';
import { cleanTaskTextForDisplay, createNewTaskInFile as rawCreateNewTaskInFile, deleteTaskLines, fileNameTaskDate, openNoteForDate, periodicNotePath, PRIORITY_EMOJI, RemovedTaskLine, restoreTaskLines, updateTaskInFile as rawUpdateTaskInFile } from '../../utils';

export type TabPillMemo = { key: string; left: number; width: number };

/**
 * A task title with its priority, the same in the timeline-style views (Daily / N-day / Weekly cards, all-day chips,
 * Monthly; List rows show a trailing priority pill instead, see renderListView):
 * the emoji leads the title inside its text element, after the checkbox (and the Monthly start time), as one inline
 * mark that wraps and clamps with the title. Its text-decoration is its own: done tasks strike the title, not the mark.
 */
export function renderTaskTitle(textEl: HTMLElement, title: string, priority: string | undefined, prefix = '') {
    if (prefix) textEl.appendText(prefix);
    const emoji = priority ? PRIORITY_EMOJI[priority] : undefined;
    if (emoji) {
        const label = t(`priority.${priority}` as Parameters<typeof t>[0]);
        textEl.createSpan({ cls: `dp-priority-mark is-${priority}`, text: emoji, attr: { 'aria-label': label, title: label } });
    }
    textEl.createSpan({ cls: 'dp-task-title', text: title });
}
/** In-progress tracker tick: a cheap check (the DOM changes once a minute), so "N m remaining" never lags behind */
export const CURRENT_TASK_TICK_MS = 5000;

/** Done or cancelled tasks are history: no drag, resize or drop moves them */
export const isLockedTask = (task?: TaskItem | null): boolean =>
    !!task && (task.completed || task.statusChar === 'x' || task.statusChar === '-');

/**
 * How far below a timeline card's top edge the pointer grabbed it, from layout (offsetTop in its column) rather than
 * getBoundingClientRect: the hover (scale 1.01) and selected (scale 0.97) transforms scale around the card's centre,
 * moving a tall card's painted top by up to 1.5% of its height. That error carried into every snapped preview
 * position as a gap between the cursor and the dragged card.
 */
export function grabOffsetIn(card: HTMLElement, clientY: number): number {
    const col = card.offsetParent as HTMLElement | null;
    if (!col) return clientY - card.getBoundingClientRect().top;
    return clientY - (col.getBoundingClientRect().top + col.clientTop + card.offsetTop);
}

/**
 * What a desktop pointer drag carries: timed timeline card(s) being moved (with the multi-selection), or one task
 * picked up from the side drawer (Undated or Overdue section), an all-day row (dated, untimed) or a monthly cell
 */
export type PointerDragSource =
    | { kind: 'timeline'; refId: string; isGCal: boolean; previewRoot: HTMLElement }
    | { kind: 'task'; task: TaskItem; origin: 'focus' | 'today' | 'deadline' | 'undated' | 'overdue' | 'allday' | 'month' | 'board' };

/** Where a pointer drag would land: a timeline column (date + time), a monthly day cell (date only), the side drawer
 *  (unschedule), or a Weekly / N-day day header ("fit it in": first free slot of that day) */
export type PointerDropTarget = { kind: 'timeline' | 'day' | 'allday' | 'drawer' | 'fit' | 'board' | 'focus'; el: HTMLElement; dateStr: string };

/** Fill for Google events whose calendar has no colour (Google Calendar's own default blue) */
export const GCAL_DEFAULT_COLOR = '#4285f4';

/** Board layouts: Scheduled (by ⏳, id 'kanban' kept for saved state and code blocks), Priority, Deadline (by 📅) */
export type BoardMode = 'kanban' | 'priority' | 'deadline';
export const BOARD_MODES: BoardMode[] = ['kanban', 'priority', 'deadline'];

/** Kanban card priority badge: the level's English name (the emoji follows it) */
export const BOARD_PRIORITY_LABEL: Record<string, string> = { highest: 'Highest', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' };

/** A timed task or Google event as a timeline column lays it out (calculateClusteredLayout sets its position) */
export interface TimelineItem {
    type: 'task' | 'gcal';
    /** A subscribed (.ics) calendar's event: shown, never moved or resized */
    readOnly?: boolean;
    refId: string;
    calendarId?: string;
    text: string;
    startMin: number;
    endMin: number;
    completed?: boolean;
    taskRef?: TaskItem;
    color?: string;
    location?: string;
    description?: string;
    leftPct?: number;
    widthPct?: number;
    leftIndent?: number;
    widthIndent?: number;
    depth?: number;
    startTime: string;
    endTime: string;
}

/** Weekend tint class for a day (by real weekday, so any N-day window or week start is tagged correctly). */
export function weekendCls(day: any): string {
    const dow = day.day();
    return dow === 0 ? ' is-sunday' : dow === 6 ? ' is-saturday' : '';
}

/**
 * An event description as one line of plain text: Google sends HTML (links, <br>), .ics feeds plain text. Parsed
 * inertly (DOMParser runs no scripts and loads nothing) and only its text is kept.
 */
export function eventDescriptionText(description: string | undefined): string {
    if (!description) return '';
    const withBreaks = description.replace(/<br\s*\/?>|<\/(p|div|li)>/gi, ' ');
    const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '';
    return text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A deadline's state class: done / cancelled tasks fade like done cards; an open one past its due time is missed */
export function deadlineStateCls(task: TaskItem): string {
    if (task.statusChar === 'x') return ' is-done';
    if (task.statusChar === '-') return ' is-done is-cancelled';
    return isDeadlineMissed(task) ? ' is-missed' : '';
}

/** ⚠ on a task card / chip planned past its deadline (hover: which deadline) */
export function renderLateBadge(parent: HTMLElement, task: TaskItem | undefined) {
    if (!task || !isScheduledAfterDeadline(task)) return;
    const text = t('deadline.late', { due: deadlineLabel(task) });
    parent.createSpan({ cls: 'dp-late-badge', text: '⚠', attr: { title: text, 'aria-label': text } });
}

/** Height of one deadline flag row (px): deadlines closer than this on the timeline share a stacked flag */
export const DEADLINE_ROW_PX = 22;

/**
 * The header is rebuilt on every tab switch, so a CSS transition has nothing to transition from.
 * Instead, remember the previous active tab's geometry and let the new pill play a FLIP slide from there.
 */
export function animateActiveTabPill(tabsContainer: HTMLElement, owner: { tabPillMemo?: TabPillMemo }, activeKey: string) {
    const activeEl = tabsContainer.querySelector(':scope > .dp-tab.active') as HTMLElement | null;
    if (!activeEl) return;
    const left = activeEl.offsetLeft;
    const width = activeEl.offsetWidth;
    const prev = owner.tabPillMemo;
    if (prev && prev.key !== activeKey && prev.width > 0 && width > 0) { // width 0 = hidden leaf, nothing to slide from
        activeEl.style.setProperty('--dp-pill-dx', `${prev.left - left}px`);
        activeEl.style.setProperty('--dp-pill-sx', String(prev.width / width));
        activeEl.addClass('dp-tab-pill-slide');
    }
    owner.tabPillMemo = { key: activeKey, left, width };
}

/**
 * The tab bar is rebuilt on every render, which would reset its horizontal scroll to 0 on narrow/mobile panes.
 * Restores the last scroll offset instantly, tracks further scrolling, then brings the active tab into view.
 * Scrolls only the tab bar itself (scrollIntoView would also scroll overflow:hidden ancestors of the view).
 */
export function keepActiveTabInView(tabsContainer: HTMLElement, owner: { tabScrollLeft?: number }) {
    tabsContainer.scrollLeft = owner.tabScrollLeft ?? 0;
    tabsContainer.addEventListener('scroll', () => { owner.tabScrollLeft = tabsContainer.scrollLeft; }, { passive: true });

    const active = tabsContainer.querySelector<HTMLElement>(':scope > .dp-tab.active');
    if (!active || tabsContainer.clientWidth === 0) return; // 0 = hidden leaf, nothing to measure
    const pad = 8; // keep a little of the neighbouring tab visible
    const viewLeft = tabsContainer.scrollLeft;
    const viewRight = viewLeft + tabsContainer.clientWidth;
    const tabLeft = active.offsetLeft;
    const tabRight = tabLeft + active.offsetWidth;
    let target: number | null = null;
    if (tabLeft < viewLeft + pad) target = tabLeft - pad;                                   // clipped on the left
    else if (tabRight > viewRight - pad) target = tabRight - tabsContainer.clientWidth + pad; // clipped on the right
    if (target !== null) {
        tabsContainer.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
    }
}

// ---------------------------------------------------------------------------------------------
// View transitions: every slide / reveal in the planner goes through these two helpers.
// ---------------------------------------------------------------------------------------------

export const REVEAL_CLASS = 'dp-view-reveal';

export function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Adds an animation class for one playback and removes it (plus any extra cleanup) when that animation ends. */
export function playOnce(el: HTMLElement, cls: string, onDone?: () => void) {
    const done = (e: AnimationEvent) => {
        if (e.target !== el) return; // ignore animations bubbling up from descendants
        el.removeEventListener('animationend', done);
        el.removeClass(cls);
        onDone?.();
    };
    el.addEventListener('animationend', done);
    el.addClass(cls);
}

/**
 * A sync button's icon (motion standard): spins while a sync runs; when it stops, the turn in progress completes and
 * one last eased turn settles it, then `onSettled`. No spin with reduced motion.
 */
export function setSyncSpin(btn: HTMLElement, spinning: boolean, onSettled?: () => void) {
    if (spinning) {
        btn.removeClass('is-sync-settling');
        if (!prefersReducedMotion()) btn.addClass('is-syncing');
        return;
    }
    const icon = btn.querySelector('svg');
    if (!btn.hasClass('is-syncing') || !icon) {
        btn.removeClass('is-syncing');
        onSettled?.();
        return;
    }
    let settled = false;
    const settle = () => {
        if (settled) return;
        settled = true;
        icon.removeEventListener('animationiteration', settle);
        btn.removeClass('is-syncing');
        btn.addClass('is-sync-settling');
        window.setTimeout(() => {
            btn.removeClass('is-sync-settling');
            onSettled?.();
        }, MOTION.spinSettleMs);
    };
    icon.addEventListener('animationiteration', settle);
    window.setTimeout(settle, MOTION.spinTurnMs + 100); // a hidden button runs no animation, so no iteration comes
}

/** The current-time line, just glided into view: its dot ripples twice, a glint runs along it and its glow fades */
export function greetNowLine(line: HTMLElement) {
    if (!line.isConnected) return;
    const done = (e: AnimationEvent) => {
        if (e.target !== line || e.pseudoElement) return; // the line's own glow ends last; the dot / glint end earlier
        line.removeEventListener('animationend', done);
        line.removeClass('is-arriving');
    };
    line.addEventListener('animationend', done);
    line.addClass('is-arriving');
}

/**
 * Top-level view switch: shows the target keep-alive pane, hides and deactivates every sibling pane,
 * and plays the 150ms reveal only when the target was not already the visible pane.
 */
export function applyViewReveal(targetPaneEl: HTMLElement): void {
    const parent = targetPaneEl.parentElement;
    parent?.querySelectorAll<HTMLElement>(':scope > .day-planner-view-pane').forEach(p => {
        if (p === targetPaneEl) return;
        p.removeClass('is-active', REVEAL_CLASS);
        p.addClass('is-hidden');
    });
    const wasVisible = targetPaneEl.hasClass('is-active') && !targetPaneEl.hasClass('is-hidden');
    targetPaneEl.removeClass('is-hidden');
    targetPaneEl.addClass('is-active');
    if (!wasVisible && !prefersReducedMotion()) playOnce(targetPaneEl, REVEAL_CLASS);
}

/** The plugin instance, for the module-level write helpers that only receive `app` */
export const getPlannerPlugin = (app: App): DayPlannerPlugin | undefined => (app as any).plugins?.getPlugin('obsidian-day-planner-pro');

/** Re-parses notes right after the plugin rewrote them (lines below a removed / restored one moved), then redraws */
export async function reparseAndRefresh(plugin: DayPlannerPlugin, paths: string[]) {
    for (const path of new Set(paths)) {
        const file = plugin.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) await plugin.updateCacheForFile(file);
    }
    plugin.refreshActiveViews();
    plugin.codeBlockRenderers.forEach(r => void r.refreshContentOnly());
}

/**
 * Deletes tasks (their lines, one Undo for the batch) and Google Calendar events, along with the calendar copies of
 * synced tasks (after an Undo, the next Sync recreates those). Deleted events leave the caches at once. Shared by the
 * Delete key / selection bar and the Task / Event Edit modals; callers confirm first (DeleteConfirmModal). One Undo
 * brings back the task lines and the deleted events.
 */
export async function deletePlannerItems(plugin: DayPlannerPlugin, tasks: TaskItem[], events: GCalEvent[] = []) {
    events = events.filter(e => !e.readOnly); // subscribed (.ics) events are read-only
    const app = plugin.app;
    const markSelfWrite = (path: string) => plugin.markSelfWrite(path);
    let removed: RemovedTaskLine[] = [];
    let failed = 0;
    if (tasks.length > 0) {
        try {
            const result = await deleteTaskLines(app, tasks, markSelfWrite);
            removed = result.removed;
            failed += result.failed;
        } catch (err) {
            console.error('Dayloom: deleting tasks failed', err);
            failed += tasks.length;
        }
    }
    const gone = new Set<string>();
    const syncCalendarId = plugin.settings.enableGoogleCalendar ? plugin.settings.taskSyncCalendarId : '';
    if (syncCalendarId) {
        const removedLines = new Set(removed.map(r => `${r.filePath}\u0000${r.line}`));
        for (const task of tasks) {
            if (!task.gcalEventId || !removedLines.has(`${task.filePath}\u0000${task.originalLine}`)) continue;
            if (await deleteGoogleCalendarEvent(plugin, syncCalendarId, task.gcalEventId)) gone.add(`${syncCalendarId}::${task.gcalEventId}`);
        }
    }
    const deletedEvents: GCalEvent[] = [];
    for (const e of events) {
        if (await deleteGoogleCalendarEvent(plugin, e.calendarId, e.id)) {
            gone.add(`${e.calendarId}::${e.id}`);
            deletedEvents.push(e);
        } else {
            failed++;
        }
    }
    if (gone.size > 0) plugin.removeCachedEvents(gone);
    await reparseAndRefresh(plugin, removed.map(r => r.filePath));

    const parts = [];
    if (removed.length + deletedEvents.length > 0) parts.push(t('delete.done', { n: removed.length + deletedEvents.length }));
    if (failed > 0) parts.push(t('delete.failed', { n: failed }));
    const notice = new Notice('', 8000);
    const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
    if (!messageEl) return;
    messageEl.empty();
    messageEl.createSpan({ text: `${parts.join(' ')} ` });
    if (removed.length + deletedEvents.length === 0) return;
    const undoBtn = messageEl.createEl('button', { text: t('common.undo') });
    undoBtn.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        notice.hide();
        let restored = removed.length > 0 ? await restoreTaskLines(app, removed, markSelfWrite) : 0;
        let eventsRestored = 0;
        for (const ev of deletedEvents) {
            if (await restoreGoogleCalendarEvent(plugin, ev.calendarId, ev.id)) eventsRestored++;
        }
        restored += eventsRestored;
        if (removed.length > 0) await reparseAndRefresh(plugin, removed.map(r => r.filePath));
        if (eventsRestored > 0) plugin.refreshActiveViews(true);
        new Notice(t('delete.restored', { n: restored }));
    });
}
/**
 * Review today: today's open tasks (not the ones only due today) in a DayReviewModal; Apply moves, unschedules,
 * finishes or cancels them in one batch with one Undo. `auto` (the evening prompt) opens nothing when none are open.
 * Resolves whether the modal opened.
 */
export async function openDayReview(plugin: DayPlannerPlugin, auto = false): Promise<boolean> {
    const todayStr = (window as any).moment().format('YYYY-MM-DD');
    let tasks: TaskItem[];
    try {
        tasks = (await plugin.ensureTasksCache()).filter(task => task.date === todayStr);
    } catch (err) {
        console.error('Day Planner Pro: could not read tasks for the review', err);
        new Notice(t('review.failed'));
        return false;
    }
    const open = tasks.filter(task => (task.statusChar === ' ' || task.statusChar === '/') && !isDeadlineOnly(task))
        .sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99')
            || cleanTaskTextForDisplay(a.text).localeCompare(cleanTaskTextForDisplay(b.text)));
    // Today's daily note not written yet: the review says so (and the evening prompt opens for it alone too)
    const notePath = periodicNotePath(todayStr, 'daily', plugin.settings);
    const noteMissing = !(plugin.app.vault.getAbstractFileByPath(notePath) instanceof TFile);
    if (auto && open.length === 0 && !noteMissing) return false;
    const done = tasks.filter(task => task.statusChar === 'x').length;
    const writeNote = noteMissing ? () => void openNoteForDate(plugin.app, todayStr, 'daily', plugin.settings) : null;
    new DayReviewModal(plugin.app, open, done, choices => void applyDayReview(plugin, choices), writeNote).open();
    return true;
}

export async function applyDayReview(plugin: DayPlannerPlugin, choices: Array<{ task: TaskItem; choice: ReviewChoice }>) {
    const tomorrowStr = (window as any).moment().add(1, 'day').format('YYYY-MM-DD');
    // A task in a dated note (a daily note) without a 📅 takes its date from the file name: it cannot be unscheduled
    const pinned = choices.filter(c => c.choice === 'unschedule' && !c.task.dueDate && fileNameTaskDate(c.task.filePath));
    const changing = choices.filter(c => !pinned.includes(c));
    const choiceOf = new Map(changing.map(c => [c.task, c.choice]));
    const changed = await updateTasksInFile(plugin.app, changing.map(c => c.task), (task): TaskUpdates => {
        switch (choiceOf.get(task)) {
            case 'tomorrow': return isDeadlineOnly(task) ? { date: tomorrowStr, scheduledDate: tomorrowStr } : { date: tomorrowStr };
            case 'unschedule': return { date: task.dueDate, scheduledDate: null, startTime: null, endTime: null };
            case 'done': return { statusChar: 'x' };
            default: return { statusChar: '-' };
        }
    }, n => t('review.applied', { n }));
    if (pinned.length > 0) new Notice(t('review.pinned', { n: pinned.length }));
    if (changed > 0) await reparseAndRefresh(plugin, changing.map(c => c.task.filePath));
}

export const isTimedTask = (task: TaskItem) => !!(task.date && task.startTime && task.endTime);

/** Phones, tablets and touchscreen laptops: a finger drags only after a long-press, so a swipe still scrolls */
export const hasTouchScreen = (): boolean => Platform.isMobile || navigator.maxTouchPoints > 0;
/** An Apple Pencil touch (iPadOS sets touchType 'stylus') */
export const isStylusTouch = (e: TouchEvent): boolean => (e.touches[0] as (Touch & { touchType?: string }) | undefined)?.touchType === 'stylus';

export function showTaskUndoNotice(
    app: App,
    task: TaskItem,
    previous: Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>>
) {
    const notice = new Notice('', 8000);
    const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
    if (!messageEl) return;

    messageEl.empty();
    const cleanText = cleanTaskTextForDisplay(task.text);
    const displayText = cleanText.length > 20 ? cleanText.substring(0, 17) + '...' : cleanText;
    messageEl.createSpan({ text: t('common.updated', { title: displayText }) });
    const undoBtn = messageEl.createEl('button', { text: t('common.undo') });
    undoBtn.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const plugin = getPlannerPlugin(app);
        plugin?.markSelfWrite(task.filePath);
        const wasTimed = isTimedTask(task);
        const success = await rawUpdateTaskInFile(app, task, previous);
        if (success) {
            if (plugin) syncEditedTaskToGCal(plugin, task, wasTimed);
            notice.hide();
            new Notice('Task edit undone.');
            const file = app.vault.getAbstractFileByPath(task.filePath);
            if (plugin && file instanceof TFile) {
                await plugin.updateCacheForFile(file);
            }
        }
    });
}

export function showGCalEventUndoNotice(
    plugin: DayPlannerPlugin,
    calendarId: string,
    eventId: string,
    previous: {
        summary: string;
        description?: string;
        location?: string;
        dateStr: string;
        endDateStr?: string;
        startTimeStr?: string | null;
        endTimeStr?: string | null;
        isAllDay: boolean;
    }
) {
    const notice = new Notice('', 8000);
    const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
    if (!messageEl) return;

    messageEl.empty();
    const displayText = previous.summary.length > 20 ? previous.summary.substring(0, 17) + '...' : previous.summary;
    messageEl.createSpan({ text: t('common.updated', { title: displayText }) });
    const undoBtn = messageEl.createEl('button', { text: t('common.undo') });
    undoBtn.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const cached = plugin.gcalCache.find((ev: any) => ev.id === eventId);
        if (cached) {
            const moment = (window as any).moment;
            cached.summary = previous.summary;
            cached.description = previous.description || '';
            cached.location = previous.location || '';
            cached.dateStr = previous.dateStr;
            cached.startTimeStr = previous.startTimeStr ?? null;
            cached.endTimeStr = previous.endTimeStr ?? null;
            cached.isAllDay = previous.isAllDay;
            if (previous.endDateStr) {
                cached.end = previous.isAllDay
                    ? moment(previous.endDateStr, 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD')
                    : previous.endDateStr;
            }
        }

        const success = await updateGoogleCalendarEvent(plugin, calendarId, eventId, previous);
        if (success) {
            notice.hide();
            new Notice('Google Calendar edit undone.');
            plugin.refreshActiveViews(true);
        }
    });
}

export type TaskUpdates = Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>>;

/** The editable fields an Undo restores */
export const snapshotTask = (task: TaskItem): TaskUpdates => ({
    text: task.text,
    statusChar: task.statusChar,
    priority: task.priority,
    date: task.date,
    startTime: task.startTime,
    endTime: task.endTime,
    recurrence: task.recurrence,
    dueDate: task.dueDate,
    dueTime: task.dueTime ?? null,
    scheduledDate: task.scheduledDate,
    startDate: task.startDate,
    completionDate: task.completionDate,
    cancelledDate: task.cancelledDate
    // gcalEventId is sync metadata, not an edit: Undo must not unlink an event the background sync just created
});

/**
 * Several tasks at once (overdue triage "Roll all", unscheduling a multi-selection): the same write + background
 * calendar sync per task as updateTaskInFile, but ONE notice with one Undo for the batch instead of a notice each.
 * A single task goes through updateTaskInFile unchanged. Returns how many tasks were written.
 */
export async function updateTasksInFile(app: App, tasks: TaskItem[], updates: TaskUpdates | ((task: TaskItem) => TaskUpdates),
    summary: (count: number) => string): Promise<number> {
    const updatesFor = (task: TaskItem) => typeof updates === 'function' ? updates(task) : updates;
    if (tasks.length === 1) return (await updateTaskInFile(app, tasks[0], updatesFor(tasks[0]))) ? 1 : 0;
    const plugin = getPlannerPlugin(app);
    const done: Array<{ task: TaskItem; previous: TaskUpdates }> = [];
    for (const task of tasks) {
        const previous = snapshotTask(task);
        const wasTimed = isTimedTask(task);
        if (await rawUpdateTaskInFile(app, task, updatesFor(task))) {
            if (plugin) syncEditedTaskToGCal(plugin, task, wasTimed);
            warnIfNowLate(task, previous);
            done.push({ task, previous });
        }
    }
    if (done.length === 0) return 0;

    const notice = new Notice('', 8000);
    const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
    if (!messageEl) return done.length;
    messageEl.empty();
    messageEl.createSpan({ text: `${summary(done.length)} ` });
    const undoBtn = messageEl.createEl('button', { text: t('common.undo') });
    undoBtn.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        notice.hide();
        const files = new Set<string>();
        for (const { task, previous } of done) {
            plugin?.markSelfWrite(task.filePath);
            const wasTimed = isTimedTask(task);
            if (await rawUpdateTaskInFile(app, task, previous)) {
                if (plugin) syncEditedTaskToGCal(plugin, task, wasTimed);
                files.add(task.filePath);
            }
        }
        new Notice(`Undid ${done.length} task change(s).`);
        for (const path of files) {
            const file = app.vault.getAbstractFileByPath(path);
            if (plugin && file instanceof TFile) await plugin.updateCacheForFile(file);
        }
    });
    return done.length;
}

/** `previous`: the task before the edit, when the view already shows the edit (applyTaskEditNow); Undo restores it */
export async function updateTaskInFile(
    app: App,
    task: TaskItem,
    updates: TaskUpdates,
    previous: TaskUpdates = snapshotTask(task)
): Promise<boolean> {
    const wasTimed = !!(previous.date && previous.startTime && previous.endTime);
    const success = await rawUpdateTaskInFile(app, task, updates);
    if (success) {
        // This one task only, in the background; the Sync button remains the full vault ↔ calendar reconciliation
        const plugin = getPlannerPlugin(app);
        if (plugin) syncEditedTaskToGCal(plugin, task, wasTimed);
        showTaskUndoNotice(app, task, previous);
        warnIfNowLate(task, previous);
    }
    return success;
}

/** An edit that plans the task past its deadline (it was not before): a warning, longer-lived than a plain notice */
export function warnIfNowLate(task: TaskItem, previous: TaskUpdates) {
    if (!isScheduledAfterDeadline(task) || isScheduledAfterDeadline({ ...task, ...previous } as TaskItem)) return;
    new Notice(t('deadline.lateNotice', { title: cleanTaskTextForDisplay(task.text), due: deadlineLabel(task) }), 10000);
}

export async function createNewTaskInFile(
    app: App,
    filePath: string,
    text: string,
    date: string | null,
    startTime: string | null,
    endTime: string | null,
    statusChar: string = ' ',
    priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest' = 'normal',
    gcalEventId: string | null = null,
    due: { date: string | null; time?: string | null } | null = null
): Promise<void> {
    const task = await rawCreateNewTaskInFile(app, filePath, text, date, startTime, endTime, statusChar, priority, gcalEventId, due);
    const plugin = getPlannerPlugin(app);
    if (task && plugin) syncEditedTaskToGCal(plugin, task, false);
}

export interface FilterRule {
    kind?: 'rule';
    id?: string;
    type: 'folder' | 'file' | 'tag' | 'status' | 'priority' | 'text' | 'itemType' | 'date';
    operator: 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'isHigher' | 'isLower' | 'isBefore' | 'isAfter' | 'isEmpty' | 'isNotEmpty';
    value: string;
}

export interface FilterGroup {
    kind?: 'group';
    id?: string;
    mode: 'all' | 'any' | 'none';
    rules?: FilterRule[];
    children?: (FilterRule | FilterGroup)[];
}

export const randomFilterId = () => Math.random().toString(36).substring(2, 9);

/** Chip / editor vocabulary for the inline filter bar (the stored rule keeps its type / operator / value) */
export const FILTER_TYPES: Array<{ type: FilterRule['type']; label: string; icons: string[] }> = [
    { type: 'folder', label: 'Folder', icons: ['folder'] },
    { type: 'file', label: 'File', icons: ['file-text'] },
    { type: 'tag', label: 'Tag', icons: ['hash'] },
    { type: 'status', label: 'Status', icons: ['circle-check', 'check-circle', 'check'] },
    { type: 'priority', label: 'Priority', icons: ['flag'] },
    { type: 'date', label: 'Date', icons: ['calendar'] },
    { type: 'text', label: 'Text', icons: ['type', 'text'] },
    { type: 'itemType', label: 'Item type', icons: ['layers'] }
];

export const FILTER_OP_LABEL: Record<FilterRule['operator'], string> = {
    contains: 'contains', notContains: 'does not contain', equals: 'is', notEquals: 'is not',
    startsWith: 'starts with', endsWith: 'ends with', isHigher: 'above', isLower: 'below',
    isBefore: 'before', isAfter: 'after', isEmpty: 'is empty', isNotEmpty: 'is set'
};

/** One-line chip text for a rule, e.g. "Folder in Work", "Tag contains #urgent", "Date before today" */
export function describeFilterRule(rule: FilterRule): string {
    const type = FILTER_TYPES.find(t => t.type === rule.type)?.label ?? rule.type;
    let op = FILTER_OP_LABEL[rule.operator] ?? rule.operator;
    if (rule.type === 'folder') op = rule.operator === 'notContains' ? 'not in' : 'in';
    if (rule.type === 'file') op = rule.operator === 'notContains' ? 'does not match' : 'matches';
    if (rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty') return `${type} ${op}`;
    let value = rule.value.trim();
    if (rule.type === 'tag' && value && !value.startsWith('#')) value = `#${value}`;
    if (rule.type === 'itemType') value = value === 'gcal' ? 'appointment' : 'task';
    return `${type} ${op} ${value || '…'}`;
}

/** A new rule of `type` with the same defaults the type picker has always applied */
export function newFilterRule(type: FilterRule['type']): FilterRule {
    const defaults: Partial<Record<FilterRule['type'], [FilterRule['operator'], string]>> = {
        status: ['equals', 'todo'], priority: ['equals', 'normal'], itemType: ['equals', 'task'], date: ['equals', 'today']
    };
    const [operator, value] = defaults[type] ?? ['contains', ''];
    return { kind: 'rule', id: randomFilterId(), type, operator, value };
}

export function parseFilterGroup(obj: any, isRoot = true): FilterGroup {
    const mode = obj.mode || 'all';
    const children: (FilterRule | FilterGroup)[] = [];
    if (Array.isArray(obj.children)) {
        for (const child of obj.children) {
            if (child.kind === 'group') {
                children.push(parseFilterGroup(child, false));
            } else {
                children.push({
                    kind: 'rule',
                    id: child.id || Math.random().toString(36).substring(2, 9),
                    type: child.type || 'text',
                    operator: child.operator || 'contains',
                    value: child.value !== undefined ? String(child.value) : ''
                });
            }
        }
    } else if (Array.isArray(obj.rules)) {
        for (const r of obj.rules) {
            children.push({
                kind: 'rule',
                id: Math.random().toString(36).substring(2, 9),
                type: r.type || 'text',
                operator: r.operator || 'contains',
                value: r.value !== undefined ? String(r.value) : ''
            });
        }
    }
    return {
        kind: 'group',
        // Nested groups get their own id (ids are never serialized): they all used to be "root", so removing one
        // could remove the wrong group
        id: obj.id || (isRoot ? 'root' : randomFilterId()),
        mode,
        children
    };
}

export function isFilterGroup(node: FilterRule | FilterGroup): node is FilterGroup {
    const n = node as FilterGroup;
    return n.kind === 'group' || (n.children !== undefined && n.rules === undefined);
}

export function serializeFilterNode(node: FilterRule | FilterGroup, indent: string): string[] {
    const lines: string[] = [];
    if (isFilterGroup(node)) {
        lines.push(`${indent}- kind: group`);
        lines.push(`${indent}  mode: ${node.mode}`);
        if (node.children && node.children.length > 0) {
            lines.push(`${indent}  children:`);
            for (const child of node.children) {
                lines.push(...serializeFilterNode(child, indent + '    '));
            }
        }
    } else {
        lines.push(`${indent}- kind: rule`);
        lines.push(`${indent}  type: ${node.type}`);
        lines.push(`${indent}  operator: ${node.operator}`);
        lines.push(`${indent}  value: "${node.value.replace(/"/g, '\\"')}"`);
    }
    return lines;
}

export function debounce(func: Function, wait: number) {
    let timeout: any;
    return function(...args: any[]) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export const RELATIVE_DATE_VALUES = new Set(['today', 'yesterday', 'tomorrow', 'this week', 'this month', 'this year']);

// Date filter rules ran several moment() constructions per task per rule on every refresh: the relative ranges are
// fixed for the day (and locale: week start), and a date string's validity never changes
export let relativeRangesKey = '';
export const relativeRanges = new Map<string, [string, string]>();
export const strictDateValidity = new Map<string, boolean>();

/** [first, last] YYYY-MM-DD of a relative filter value ('today', 'this week', …) */
export function relativeDateRange(val: string): [string, string] {
    const moment = (window as any).moment;
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}|${moment.locale()}`;
    if (key !== relativeRangesKey) {
        relativeRangesKey = key;
        relativeRanges.clear();
    }
    const hit = relativeRanges.get(val);
    if (hit) return hit;
    const fmt = (m: any) => m.format('YYYY-MM-DD');
    let range: [string, string];
    if (val === 'yesterday') range = [fmt(moment().subtract(1, 'day')), fmt(moment().subtract(1, 'day'))];
    else if (val === 'tomorrow') range = [fmt(moment().add(1, 'day')), fmt(moment().add(1, 'day'))];
    else if (val === 'this week') range = [fmt(moment().startOf('week')), fmt(moment().endOf('week'))];
    else if (val === 'this month') range = [fmt(moment().startOf('month')), fmt(moment().endOf('month'))];
    else if (val === 'this year') range = [fmt(moment().startOf('year')), fmt(moment().endOf('year'))];
    else range = [fmt(moment()), fmt(moment())]; // today
    relativeRanges.set(val, range);
    return range;
}

export function isStrictValidDate(dateStr: string): boolean {
    let valid = strictDateValidity.get(dateStr);
    if (valid === undefined) {
        valid = !!(window as any).moment(dateStr, 'YYYY-MM-DD', true).isValid();
        if (strictDateValidity.size >= 5000) strictDateValidity.clear();
        strictDateValidity.set(dateStr, valid);
    }
    return valid;
}

export function matchFilterRule(task: TaskItem, rule: FilterRule): boolean {
    const type = rule.type;
    const op = rule.operator;
    const val = rule.value.toLowerCase().trim();

    let taskValue = '';
    if (type === 'itemType') {
        taskValue = 'task';
    } else if (type === 'folder') {
        const lastSlash = task.filePath.lastIndexOf('/');
        const folder = lastSlash === -1 ? '' : task.filePath.substring(0, lastSlash);
        taskValue = folder.toLowerCase();
    } else if (type === 'file') {
        const lastSlash = task.filePath.lastIndexOf('/');
        const filename = lastSlash === -1 ? task.filePath : task.filePath.substring(lastSlash + 1);
        taskValue = filename.toLowerCase();
    } else if (type === 'tag') {
        const tags = Array.from(task.text.matchAll(/#([a-zA-Z0-9_\-\/]+)/g)).map(m => m[1].toLowerCase());
        const cleanVal = val.startsWith('#') ? val.substring(1) : val;
        const matched = tags.some(tag => tag === cleanVal || tag.startsWith(cleanVal + '/'));
        if (op === 'contains') return matched;
        if (op === 'notContains') return !matched;
        if (op === 'equals') return tags.includes(cleanVal);
        if (op === 'notEquals') return !tags.includes(cleanVal);
        return false;
    } else if (type === 'status') {
        let status = 'todo';
        if (task.completed || task.statusChar === 'x') status = 'completed';
        else if (task.statusChar === '/') status = 'in-progress';
        else if (task.statusChar === '-') status = 'cancelled';
        taskValue = status;
    } else if (type === 'priority') {
        taskValue = task.priority;
    } else if (type === 'text') {
        taskValue = task.text.toLowerCase();
    } else if (type === 'date') {
        const itemDate = task.date || ''; // YYYY-MM-DD

        if (op === 'isEmpty') {
            return !itemDate;
        }
        if (op === 'isNotEmpty') {
            return !!itemDate;
        }
        if (!itemDate) {
            return false;
        }

        if (RELATIVE_DATE_VALUES.has(val)) {
            if (!isStrictValidDate(itemDate)) return false;
            // A valid YYYY-MM-DD lies in the week / month / year of today exactly when it sorts between its bounds
            const [first, last] = relativeDateRange(val);
            if (op === 'equals') return itemDate >= first && itemDate <= last;
            if (op === 'notEquals') return !(itemDate >= first && itemDate <= last);
            if (op === 'isBefore') return itemDate < first;
            if (op === 'isAfter') return itemDate > last;
            return false;
        }

        if (op === 'equals') return itemDate === val;
        if (op === 'notEquals') return itemDate !== val;
        if (op === 'isBefore') return itemDate < val;
        if (op === 'isAfter') return itemDate > val;
        return false;
    }

    if (type === 'priority' && (op === 'isHigher' || op === 'isLower')) {
        const prioritiesOrder = ['lowest', 'low', 'normal', 'medium', 'high', 'highest'];
        const taskIdx = prioritiesOrder.indexOf(taskValue);
        const valIdx = prioritiesOrder.indexOf(val);
        if (taskIdx === -1 || valIdx === -1) return false;
        if (op === 'isHigher') return taskIdx > valIdx;
        if (op === 'isLower') return taskIdx < valIdx;
    }

    if (op === 'contains') {
        return taskValue.includes(val);
    } else if (op === 'notContains') {
        return !taskValue.includes(val);
    } else if (op === 'equals') {
        return taskValue === val;
    } else if (op === 'notEquals') {
        return taskValue !== val;
    } else if (op === 'startsWith') {
        return taskValue.startsWith(val);
    } else if (op === 'endsWith') {
        return taskValue.endsWith(val);
    }
    return false;
}

/**
 * A filter group against one item (a task or a Google event, each with its own rule matcher). Nested groups recurse;
 * matching is side-effect free, so it stops at the first child that decides the group. Older notes store flat `rules`.
 */
export function matchGroup<T>(item: T, group: FilterGroup, matchRule: (item: T, rule: FilterRule) => boolean): boolean {
    const nodes: (FilterRule | FilterGroup)[] | undefined = group.children ?? group.rules;
    if (!nodes || nodes.length === 0) return true;
    const matches = (node: FilterRule | FilterGroup) => node.kind === 'group' || (node as FilterGroup).children !== undefined
        ? matchGroup(item, node as FilterGroup, matchRule)
        : matchRule(item, node as FilterRule);
    if (group.mode === 'all') return nodes.every(matches);
    if (group.mode === 'any') return nodes.some(matches);
    if (group.mode === 'none') return !nodes.some(matches);
    return true;
}

export const matchFilterGroup = (task: TaskItem, group: FilterGroup) => matchGroup(task, group, matchFilterRule);

/** Per-render grouping of a view's Google events by day (getCalendarEventsForDate) */
export interface GCalDayIndex { key: string; events: GCalEvent[] | undefined; byDate: Map<string, GCalEvent[]> }

/** The days an event covers, plus (timed events) the local days it starts and ends on */
export interface EventDaySpan { dates: string[]; startDay: string; endDay: string }

// Span per event content (not identity: cached events are edited in place after a drag or an Undo). Views asked for
// it once per event per visible day, each answer a fresh run of moment parsing; the timezone is part of the key.
export const eventSpanCache = new Map<string, EventDaySpan>();
export const EVENT_SPAN_CACHE_MAX = 5000;

export function getEventDaySpan(e: GCalEvent): EventDaySpan {
    const key = `${e.isAllDay ? 1 : 0}|${e.start}|${e.end}|${e.dateStr}|${new Date().getTimezoneOffset()}`;
    const hit = eventSpanCache.get(key);
    if (hit) return hit;
    const moment = (window as any).moment;
    const span: EventDaySpan = {
        dates: computeSpannedDates(e),
        startDay: e.isAllDay ? '' : moment(e.start).format('YYYY-MM-DD'),
        endDay: e.isAllDay ? '' : moment(e.end).format('YYYY-MM-DD')
    };
    if (eventSpanCache.size >= EVENT_SPAN_CACHE_MAX) eventSpanCache.clear();
    eventSpanCache.set(key, span);
    return span;
}

/** Start / end time of an event as drawn on one of its days: a multi-day timed event runs from 00:00 / to 24:00 between */
export function eventTimesOnDate(e: GCalEvent, dateStr: string): { startTimeStr: string | null; endTimeStr: string | null } {
    if (e.isAllDay) return { startTimeStr: e.startTimeStr, endTimeStr: e.endTimeStr };
    const span = getEventDaySpan(e);
    return {
        startTimeStr: dateStr === span.startDay ? e.startTimeStr : '00:00',
        endTimeStr: dateStr === span.endDay ? e.endTimeStr : '24:00'
    };
}

/** Read-only (shared with the span cache): callers must not mutate the returned array */
export function getSpannedDates(e: GCalEvent): string[] {
    return getEventDaySpan(e).dates;
}

export function computeSpannedDates(e: GCalEvent): string[] {
    const dates: string[] = [];
    const moment = (window as any).moment;
    if (e.isAllDay) {
        const startMom = moment(e.start, 'YYYY-MM-DD');
        const endMom = moment(e.end, 'YYYY-MM-DD');
        let current = startMom.clone();
        while (current.isBefore(endMom, 'day')) {
            dates.push(current.format('YYYY-MM-DD'));
            current.add(1, 'day');
        }
    } else {
        const startMom = moment(e.start).startOf('day');
        const endMom = moment(e.end).startOf('day');
        let current = startMom.clone();
        while (current.isSameOrBefore(endMom, 'day')) {
            dates.push(current.format('YYYY-MM-DD'));
            current.add(1, 'day');
        }
    }
    if (dates.length === 0) {
        dates.push(e.dateStr);
    }
    return dates;
}

export function matchGCalEventRule(event: GCalEvent, rule: FilterRule): boolean {
    const type = rule.type;
    const op = rule.operator;
    const val = rule.value.toLowerCase().trim();

    let eventValue = '';
    if (type === 'itemType') {
        eventValue = 'gcal';
    } else if (type === 'text') {
        eventValue = (event.summary + ' ' + (event.description || '')).toLowerCase();
    } else if (type === 'tag') {
        const text = event.summary + ' ' + (event.description || '');
        const tags = Array.from(text.matchAll(/#([a-zA-Z0-9_\-\/]+)/g)).map(m => m[1].toLowerCase());
        const cleanVal = val.startsWith('#') ? val.substring(1) : val;
        const matched = tags.some(tag => tag === cleanVal || tag.startsWith(cleanVal + '/'));
        if (op === 'contains') return matched;
        if (op === 'notContains') return !matched;
        if (op === 'equals') return tags.includes(cleanVal);
        if (op === 'notEquals') return !tags.includes(cleanVal);
        return false;
    } else if (type === 'date') {
        const spanned = getSpannedDates(event);
        if (spanned.length === 0) return false;

        const firstDate = spanned[0];
        const lastDate = spanned[spanned.length - 1];

        if (op === 'isEmpty') {
            return false;
        }
        if (op === 'isNotEmpty') {
            return true;
        }

        if (RELATIVE_DATE_VALUES.has(val)) {
            const [startRange, endRange] = relativeDateRange(val);

            if (op === 'equals') {
                return spanned.some(d => d >= startRange && d <= endRange);
            }
            if (op === 'notEquals') {
                return !spanned.some(d => d >= startRange && d <= endRange);
            }
            if (op === 'isBefore') {
                return lastDate < startRange;
            }
            if (op === 'isAfter') {
                return firstDate > endRange;
            }
            return false;
        }

        if (op === 'equals') return spanned.includes(val);
        if (op === 'notEquals') return !spanned.includes(val);
        if (op === 'isBefore') return lastDate < val;
        if (op === 'isAfter') return firstDate > val;
        return false;
    } else {
        return false;
    }

    if (op === 'contains') {
        return eventValue.includes(val);
    } else if (op === 'notContains') {
        return !eventValue.includes(val);
    } else if (op === 'equals') {
        return eventValue === val;
    } else if (op === 'notEquals') {
        return eventValue !== val;
    } else if (op === 'startsWith') {
        return eventValue.startsWith(val);
    } else if (op === 'endsWith') {
        return eventValue.endsWith(val);
    }
    return false;
}

export const matchGCalEventGroup = (event: GCalEvent, group: FilterGroup) => matchGroup(event, group, matchGCalEventRule);

/**
 * Plugin hotkeys never fire while someone types: a focused input / textarea / select, any contenteditable (the note
 * editor), or an IME composition. Checks the event target and the focused element of the event's own document
 * (popout windows have their own), duck-typed so elements from another window still count.
 */
export function isTypingContext(e: KeyboardEvent): boolean {
    if (e.isComposing) return true;
    const doc = (e.target as Node | null)?.ownerDocument ?? document;
    return [e.target, doc.activeElement].some(node => {
        const el = node as HTMLElement | null;
        if (!el || typeof el.closest !== 'function') return false;
        // closest() first: it settles every editor keystroke, while isContentEditable may bring styles up to date first
        return !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor') || el.isContentEditable;
    });
}

/**
 * A code block's `hours:` value (`8-18`, `08:00-18:00`, `8:30 - 17:30`, `[8, 18]`) as whole visible hours: the start
 * rounds down and the end up, so a half hour is never cut off. Null when missing or not a range inside 0-24.
 */
export function parseTimelineHours(raw: any): { startHour: number; endHour: number } | null {
    if (raw === undefined || raw === null) return null;
    let start: number, end: number;
    if (Array.isArray(raw) && raw.length === 2) {
        start = Number(raw[0]);
        end = Number(raw[1]);
    } else {
        const m = String(raw).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(?:-|–|~|to)\s*(\d{1,2})(?::(\d{2}))?$/i);
        if (!m) return null;
        start = Number(m[1]) + Number(m[2] || 0) / 60;
        end = Number(m[3]) + Number(m[4] || 0) / 60;
    }
    const startHour = Math.floor(start);
    const endHour = Math.ceil(end);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour) return null;
    return { startHour, endHour };
}
