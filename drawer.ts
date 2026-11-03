import { setIcon } from 'obsidian';
import type { TaskItem, OverdueMoveOption, GCalEvent } from './types';
import type DayPlannerPlugin from './main';
import type { DayPlannerCombinedView } from './views';
import { cleanTaskTextForDisplay, onEnterSubmit, readDraggedTaskIds, triggerHaptic, timeToMinutes, pageOnWheel } from './utils';
import { t, getLocale, TranslationKey } from './i18n';
import { PillTabs } from './src/settings/pillTabs';
import { parseSmartEntry, describeSmartEntry, SmartEntry } from './smartEntry';

/**
 * Desktop side drawer, three tiers: a mini calendar (its month header doubles as the drawer header), a segmented
 * mode switcher, and the active panel's scrolling body. A new panel is one more entry in SIDE_DRAWER_PANELS: the
 * switcher, the `s` hotkey and the persisted open / active-panel state need no changes.
 */
export interface SideDrawerPanel {
    id: string;
    /** Display title, resolved on each render so a language change applies */
    title(): string;
    /** Lucide icon names, first one the running Obsidian knows wins (Lucide renames icons between releases) */
    icon: string[];
    /** Short badge on the mode switcher (a count, a percentage); '' hides it */
    badge?(view: DayPlannerCombinedView): string;
    /** Fills the drawer body; called on every view render and on a mode switch (the body starts empty) */
    render(body: HTMLElement, view: DayPlannerCombinedView): void;
}

type Priority = TaskItem['priority'];

const isOpen = (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-';

/** An untimed task placed only by its 📅 (no ⏳): not scheduled, so the calendars show just its deadline chip */
export function isDeadlineOnly(task: TaskItem): boolean {
    return !task.scheduledDate && !!task.dueDate && task.date === task.dueDate && (!task.startTime || !task.endTime);
}

/**
 * An open task planned to finish after its 📅 deadline: its scheduled day (and end time) lies past the due day and
 * time (a date-only deadline lasts the whole day). An untimed task on its due day is not late.
 */
export function isScheduledAfterDeadline(task: TaskItem): boolean {
    if (!isOpen(task) || !task.dueDate || !task.date || isDeadlineOnly(task)) return false;
    if (!task.startTime || !task.endTime) return task.date > task.dueDate;
    return `${task.date} ${task.endTime}` > `${task.dueDate} ${task.dueTime ?? '24:00'}`;
}

/** The deadline as a short label for warnings: "Fri, Oct 24 17:00" */
export function deadlineLabel(task: TaskItem): string {
    const day = (window as any).moment(task.dueDate, 'YYYY-MM-DD').format('ddd, MMM D');
    return task.dueTime ? `${day} ${task.dueTime}` : day;
}

/** Active tasks not scheduled on any day: no date at all, or only a deadline (the drawer's Unscheduled section) */
export const isUndatedTask = (t: TaskItem) => (t.date === null || isDeadlineOnly(t)) && isOpen(t);

/** Active tasks scheduled before today (the real calendar day, not the date the view is paged to); a missed deadline
 *  of an unscheduled task is listed under Deadlines instead */
export const isOverdueTask = (t: TaskItem, todayStr: string) => t.date !== null && t.date < todayStr && isOpen(t) && !isDeadlineOnly(t);

/** MIT ("most important task"): an open task at the Highest priority (🔺, Obsidian Tasks syntax) */
export const isFocusTask = (t: TaskItem) => t.priority === 'highest' && isOpen(t);

const PRIORITY_RANK: Record<string, number> = { highest: 0, high: 1, medium: 2, normal: 3, low: 4, lowest: 5 };

/** Obsidian Tasks priority signifiers, highest first ('normal' has none) */
export const PRIORITY_LEVELS: ReadonlyArray<{ id: Priority; emoji: string }> = [
    { id: 'highest', emoji: '🔺' },
    { id: 'high', emoji: '⏫' },
    { id: 'medium', emoji: '🔼' },
    { id: 'normal', emoji: '' },
    { id: 'low', emoji: '🔽' },
    { id: 'lowest', emoji: '⏬' }
];

const priorityLabel = (p: Priority) => t(`priority.${p}` as TranslationKey);

/**
 * Priority first (🔺 ⏫ 🔼 normal 🔽 ⏬), then (with `byDate`) the oldest date, then the displayed title A→Z / ㄱ→ㅎ
 * (localeCompare orders Hangul too)
 */
export function sortByPriorityThenTitle(tasks: TaskItem[], byDate = false): TaskItem[] {
    const titles = new Map(tasks.map(t => [t, cleanTaskTextForDisplay(t.text)]));
    return tasks.sort((a, b) =>
        (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
        || (byDate ? (a.date ?? '').localeCompare(b.date ?? '') : 0)
        || titles.get(a)!.localeCompare(titles.get(b)!));
}

/** 📅 first (soonest, missed ones on top; a due time before none on the same day), then priority and the displayed title */
export function sortByDueDate(tasks: TaskItem[]): TaskItem[] {
    const titles = new Map(tasks.map(t => [t, cleanTaskTextForDisplay(t.text)]));
    const key = (t: TaskItem) => `${t.dueDate ?? ''} ${t.dueTime ?? '99:99'}`;
    return tasks.sort((a, b) =>
        key(a).localeCompare(key(b))
        || (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3)
        || titles.get(a)!.localeCompare(titles.get(b)!));
}

/** A deadline already behind us: a 📅 before today, or today's whose due time has passed (a date-only one lasts all day) */
export function isDeadlineMissed(task: TaskItem, now: any = (window as any).moment()): boolean {
    if (!task.dueDate) return false;
    const todayStr = now.format('YYYY-MM-DD');
    return task.dueDate < todayStr || (task.dueDate === todayStr && !!task.dueTime && task.dueTime < now.format('HH:mm'));
}

/**
 * The countdown to a task's deadline: "missed Oct 18", "D-day · 17:00", "D-3 · 09:00"; on the day itself, with a due
 * time, the time left ("in 2h 15m") or "missed 17:00". `urgent` (amber) for missed and due today; null without a 📅.
 */
export function dueChip(task: TaskItem, todayStr: string): { text: string; urgent: boolean; tooltip: string } | null {
    if (!task.dueDate) return null;
    const moment = (window as any).moment;
    const due = moment(task.dueDate, 'YYYY-MM-DD');
    const days = due.diff(moment(todayStr, 'YYYY-MM-DD'), 'days');
    const at = task.dueTime ? ` · ${task.dueTime}` : '';
    const tooltip = t('drawer.deadline.tooltip', { date: localMoment(due).format('ddd, MMM D') + (task.dueTime ? ` ${task.dueTime}` : '') });
    if (days < 0) return { text: t('drawer.deadline.missedChip', { date: localMoment(due).format('MMM D') }), urgent: true, tooltip };
    if (days > 0) return { text: t('drawer.deadline.dminus', { n: days }) + at, urgent: false, tooltip };
    if (!task.dueTime || todayStr !== moment().format('YYYY-MM-DD')) return { text: t('drawer.deadline.dday') + at, urgent: true, tooltip };
    const now = moment();
    const left = timeToMinutes(task.dueTime) - (now.hour() * 60 + now.minute());
    return {
        text: left < 0 ? t('drawer.deadline.missedChip', { date: task.dueTime }) : t('drawer.deadline.inTime', { time: formatDuration(left) }),
        urgent: true,
        tooltip
    };
}

/** Day heading of a task in the Deadlines section: Missed, Today, Tomorrow, then the weekday and date */
function deadlineGroupLabel(task: TaskItem, todayStr: string): string {
    if (isDeadlineMissed(task)) return t('drawer.deadline.missed');
    const moment = (window as any).moment;
    const due = moment(task.dueDate, 'YYYY-MM-DD');
    const days = due.diff(moment(todayStr, 'YYYY-MM-DD'), 'days');
    if (days === 0) return t('common.today');
    if (days === 1) return t('common.tomorrow');
    return localMoment(due).format('ddd, MMM D');
}

/** Where a drawer card came from; the drag engine uses it to decide what a drop into the drawer means */
/** A Move menu choice of overdue cards: its target date (null: Pick a date…) and its menu / settings label */
export function overdueMoveTarget(option: OverdueMoveOption): { date: string | null; label: string } {
    const now = (window as any).moment();
    const at = (m: any) => ({ date: m.format('YYYY-MM-DD') as string, when: m.format('ddd, MMM D') as string });
    switch (option) {
        case 'today': { const d = at(now); return { date: d.date, label: t('drawer.card.moveToday', { date: d.when }) }; }
        case 'tomorrow': { const d = at(now.add(1, 'day')); return { date: d.date, label: t('drawer.card.moveTomorrow', { date: d.when }) }; }
        case 'in2Days': { const d = at(now.add(2, 'days')); return { date: d.date, label: t('drawer.card.moveIn2Days', { date: d.when }) }; }
        // The coming Monday, never today
        case 'nextMonday': { const d = at(now.add((8 - now.isoWeekday()) % 7 || 7, 'days')); return { date: d.date, label: t('drawer.card.moveNextMonday', { date: d.when }) }; }
        case 'nextWeek': { const d = at(now.add(7, 'days')); return { date: d.date, label: t('drawer.card.moveNextWeek', { date: d.when }) }; }
        case 'nextMonth': { const d = at(now.add(1, 'month')); return { date: d.date, label: t('drawer.card.moveNextMonth', { date: d.when }) }; }
        case 'pickDate': return { date: null, label: t('drawer.card.pickDate') };
    }
}

export type DrawerSectionId ='focus' | 'today' | 'deadline' | 'overdue' | 'undated';

/** `moment` in the planner's UI language (Language setting), for month and weekday names */
export function localMoment(m: any): any {
    const moment = (window as any).moment;
    const code = { en: 'en', ko: 'ko', ja: 'ja', zh: 'zh-cn' }[getLocale()];
    return moment.locales?.().includes(code) ? m.clone().locale(code) : m.clone();
}

/** "6h 30m" / "6시간 30분" … */
export function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h === 0) return t('duration.m', { m });
    return m === 0 ? t('duration.h', { h }) : t('duration.hm', { h, m });
}

// ---------------------------------------------------------------------------------------------------------------
// Tasks panel
// ---------------------------------------------------------------------------------------------------------------

/**
 * Work left in a list: open tasks only, each counted by its own length when timed, else its ⏱ estimate; tasks with
 * neither are left out (`counted` says how many had a length)
 */
function openWorkMinutes(tasks: TaskItem[]): { minutes: number; counted: number; open: number } {
    let minutes = 0, counted = 0, open = 0;
    tasks.forEach(task => {
        if (!isOpen(task)) return;
        open++;
        const length = task.startTime && task.endTime
            ? timeToMinutes(task.endTime) - timeToMinutes(task.startTime)
            : task.estimateMinutes ?? 0;
        if (length > 0) {
            minutes += length;
            counted++;
        }
    });
    return { minutes, counted, open };
}

/**
 * Today's free time: what is left of the working hours (timeline start / end hour) from now on, after timed tasks
 * and Google Calendar events, against the time today's untimed tasks still need (⏱ estimate, else the default task
 * duration a drop gives them). Turns into a warning when they do not fit. Always the real today, like Today's Tasks.
 */
function renderDayCapacity(body: HTMLElement, view: DayPlannerCombinedView) {
    const moment = (window as any).moment;
    const settings = view.plugin.settings;
    const now = moment();
    const todayStr = now.format('YYYY-MM-DD');
    // The whole day, whatever the planner search currently narrows the view to
    const source = view.searchQuery ? view.unsearchedTasks : view.tasks;
    const dayStart = (settings.timelineStartHour ?? 0) * 60;
    const dayEnd = Math.min((settings.timelineEndHour ?? 24) * 60, 24 * 60 - 1);
    const from = Math.max(dayStart, now.hour() * 60 + now.minute());
    const windowMin = Math.max(0, dayEnd - from);

    // Busy minutes inside [from, dayEnd], overlaps merged (intervals come sorted by start)
    let booked = 0, cursor = from;
    for (const [start, end] of view.busyIntervals(todayStr, undefined, source)) {
        const s = Math.max(start, cursor), e = Math.min(end, dayEnd);
        if (e > s) {
            booked += e - s;
            cursor = e;
        }
    }
    const free = Math.max(0, windowMin - booked);
    const fallback = settings.defaultTaskDuration || 60;
    const unplanned = source.filter(task => task.date === todayStr && isOpen(task) && !task.startTime);
    const toPlan = unplanned.reduce((sum, task) => sum + (task.estimateMinutes || fallback), 0);
    if (windowMin === 0 && toPlan === 0) return; // working hours over and nothing left to place: nothing to say

    const over = toPlan > free;
    const hours = (h: number) => moment().startOf('day').add(h, 'hours').format('HH:mm');
    const wrap = body.createDiv({
        cls: `dp-drawer-capacity${over ? ' is-over' : ''}`,
        attr: { title: t('drawer.capacity.tooltip', { start: hours(settings.timelineStartHour ?? 0), end: hours(settings.timelineEndHour ?? 24) }) }
    });
    const head = wrap.createDiv({ cls: 'dp-capacity-head' });
    head.createSpan({ cls: 'dp-capacity-label', text: t('drawer.capacity.free') });
    head.createSpan({ cls: 'dp-capacity-value', text: windowMin === 0 ? '—' : formatDuration(free) });

    if (windowMin > 0) {
        const bar = wrap.createDiv({ cls: 'dp-capacity-bar' });
        const pct = (m: number) => `${Math.round(Math.min(1, m / windowMin) * 1000) / 10}%`;
        bar.createDiv({ cls: 'dp-capacity-booked' }).style.setProperty('--dp-fill', pct(booked));
        bar.createDiv({ cls: 'dp-capacity-plan' }).style.setProperty('--dp-fill', pct(Math.min(toPlan, free)));
    }

    const meta = [t('drawer.capacity.booked', { time: formatDuration(booked) })];
    if (toPlan > 0) meta.push(t('drawer.capacity.toPlan', { time: formatDuration(toPlan), n: unplanned.length }));
    wrap.createDiv({ cls: 'dp-capacity-meta', text: meta.join(' · ') });
    if (windowMin === 0) {
        wrap.createDiv({ cls: 'dp-capacity-warn', text: t('drawer.capacity.dayOver') });
    } else if (over) {
        wrap.createDiv({ cls: 'dp-capacity-warn', text: `⚠ ${t('drawer.capacity.over', { time: formatDuration(toPlan - free) })}` });
    }
}

/**
 * One folding section of a panel (accordion). Auto rule: folded when empty, unfolded when it has tasks. A click on
 * the header overrides that for the session, until the section flips between empty and non-empty (then the rule
 * takes over again, e.g. Overdue folds once its last task is scheduled). State lives on the view, because the drawer
 * is rebuilt on every render; a state change across renders is replayed as a CSS transition.
 */
function renderDrawerSection(
    body: HTMLElement,
    view: DayPlannerCombinedView,
    id: DrawerSectionId,
    title: string,
    tasks: TaskItem[],
    empty: string,
    actions: Array<{ label: string; tooltip: string; run: () => void }> = [],
    focus: TaskItem[] = [],
    groupOf?: (task: TaskItem) => string
) {
    // `focus`: hero cards on top of the list (Today's Tasks), counted with it and never repeated in it
    // `groupOf`: a small heading before each run of tasks with the same label (Deadlines: by due day)
    const total = tasks.length + focus.length;
    const isEmpty = total === 0;
    if (view.drawerSectionOverrides.get(id)?.empty !== isEmpty) view.drawerSectionOverrides.delete(id);
    const collapsed = view.drawerSectionOverrides.get(id)?.collapsed ?? isEmpty;
    // Drawn in the previous render's state first, so a fold / unfold caused by data animates instead of jumping
    const wasCollapsed = view.drawerSectionState.get(id) ?? collapsed;
    view.drawerSectionState.set(id, collapsed);

    // An empty section is hidden (styles.ts); Today / Undated come back while a task is dragged, as drop targets
    const section = body.createDiv({ cls: `dp-drawer-section${wasCollapsed ? ' is-collapsed' : ''}${isEmpty ? ' is-empty' : ''}`, attr: { 'data-section': id } });
    // Header row: the fold toggle (chevron, title, count) plus an optional section action beside it (not inside:
    // a button cannot hold another button)
    const header = section.createDiv({ cls: 'dp-drawer-section-header' });
    const head = header.createEl('button', { cls: 'dp-drawer-section-toggle', attr: { 'aria-expanded': String(!collapsed) } });
    head.createSpan({ cls: 'dp-drawer-chevron', text: '▾' });
    head.createSpan({ cls: 'dp-drawer-section-title', text: title });
    head.createSpan({ cls: 'dp-drawer-count', text: String(total) });
    // Work left in the section: lengths of timed tasks plus ⏱ estimates
    const work = openWorkMinutes(focus.length > 0 ? focus.concat(tasks) : tasks);
    if (work.minutes > 0) {
        head.createSpan({
            cls: 'dp-drawer-section-time',
            text: formatDuration(work.minutes),
            attr: { title: t('drawer.sectionTimeTooltip', { time: formatDuration(work.minutes), n: work.counted, total: work.open }) }
        });
    }
    if (tasks.length > 0) actions.forEach(action => {
        const actionBtn = header.createEl('button', { cls: 'dp-drawer-section-action', text: action.label, attr: { 'aria-label': action.tooltip } });
        actionBtn.addEventListener('click', () => {
            triggerHaptic('selection');
            action.run();
        });
    });
    head.addEventListener('click', () => {
        triggerHaptic('selection');
        const nowCollapsed = !section.hasClass('is-collapsed');
        section.toggleClass('is-collapsed', nowCollapsed);
        head.setAttr('aria-expanded', String(!nowCollapsed));
        view.drawerSectionOverrides.set(id, { collapsed: nowCollapsed, empty: isEmpty });
        view.drawerSectionState.set(id, nowCollapsed);
    });
    if (wasCollapsed !== collapsed) {
        // Two frames: the first lays the section out in its old state, the second flips it (and the transition runs)
        requestAnimationFrame(() => requestAnimationFrame(() => section.toggleClass('is-collapsed', collapsed)));
    }

    // Grid rows 1fr ↔ 0fr animate the height without measuring it
    const inner = section.createDiv({ cls: 'dp-drawer-section-body' }).createDiv({ cls: 'dp-drawer-section-inner' });
    if (id === 'today') renderFocusSlot(inner, view, focus);
    if (isEmpty) {
        inner.createDiv({ cls: 'dp-drawer-empty', text: empty });
        return;
    }
    if (tasks.length === 0) return;
    const list = inner.createDiv({ cls: 'dp-drawer-list' });
    let group: string | undefined;
    tasks.forEach(task => {
        const label = groupOf?.(task);
        if (label !== undefined && label !== group) {
            group = label;
            list.createDiv({ cls: 'dp-drawer-group-label', text: label });
        }
        view.renderDrawerTaskCard(list, task, id);
    });
}

/**
 * Today's Focus, embedded at the top of Today's Tasks: the open 🔺 Highest tasks of today as hero cards, each carrying
 * its own 🎯 FOCUS pill (see renderDrawerTaskCard). Still the Focus drop target (data-section="focus": a task dropped
 * here becomes 🔺 Highest); with no focus task it is an empty, labelled slot that only shows up while a task is dragged.
 */
function renderFocusSlot(inner: HTMLElement, view: DayPlannerCombinedView, focus: TaskItem[]) {
    const slot = inner.createDiv({ cls: `dp-drawer-focus-slot${focus.length === 0 ? ' is-empty' : ''}`, attr: { 'data-section': 'focus' } });
    if (focus.length === 0) {
        slot.createDiv({ cls: 'dp-drawer-focus-label', text: `🎯 ${t('drawer.focus')}` });
        slot.createDiv({ cls: 'dp-drawer-focus-hint', text: t('drawer.focusEmpty') });
        return;
    }
    const list = slot.createDiv({ cls: 'dp-drawer-list' });
    focus.forEach(task => view.renderDrawerTaskCard(list, task, 'focus'));
}

/**
 * One-line capture at the top of the panel: Enter adds the task to the default task file, reading its date, time,
 * length, deadline and priority from the words (smartEntry.ts: "Report fri 3pm 1h !high"); without any it is an
 * undated task. A preview under the field shows what was recognized. The drawer is rebuilt on every render, so the
 * draft and the focus are restored from the view.
 */
function renderQuickCapture(body: HTMLElement, view: DayPlannerCombinedView) {
    const input = body.createEl('input', {
        cls: 'dp-drawer-capture',
        attr: { type: 'text', placeholder: t('drawer.capturePlaceholder'), 'aria-label': t('drawer.captureAria') }
    });
    input.value = view.drawerCaptureDraft;
    const preview = body.createDiv({ cls: 'dp-smart-preview', attr: { 'aria-live': 'polite' } });
    const updatePreview = () => renderSmartPreview(preview, input.value.trim()
        ? parseSmartEntry(input.value, { defaultDuration: view.plugin.settings.defaultTaskDuration || 60 }) : null);
    updatePreview();
    input.addEventListener('input', () => {
        view.drawerCaptureDraft = input.value;
        updatePreview();
    });
    input.addEventListener('focus', () => { view.drawerCaptureFocused = true; });
    // A re-render detaches the input (blur may fire then): only a real focus change ends the capture session
    input.addEventListener('blur', () => { if (input.isConnected) view.drawerCaptureFocused = false; });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') input.blur();
    });
    // Enter (IME-safe: a Hangul syllable still composing is committed first, then submitted)
    onEnterSubmit(input, () => {
        const raw = input.value;
        if (!raw.trim()) return;
        input.value = ''; // cleared at once: a second Enter from the IME sequence finds nothing to submit
        view.drawerCaptureDraft = '';
        updatePreview();
        triggerHaptic('success');
        void view.captureTask(raw);
    });
    if (view.drawerCaptureFocused) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }
}

/** The recognized parts of a smart entry as chips (hidden when nothing beyond a title was read) */
export function renderSmartPreview(el: HTMLElement, entry: SmartEntry | null) {
    const chips = entry?.recognized ? describeSmartEntry(entry) : [];
    el.toggleClass('is-empty', chips.length === 0);
    // Only the chips change (the element stays): no flicker while typing
    const existing = Array.from(el.children) as HTMLElement[];
    chips.forEach((text, i) => {
        const chip = existing[i] ?? el.createSpan({ cls: 'dp-smart-chip' });
        if (chip.textContent !== text) chip.setText(text);
    });
    existing.slice(chips.length).forEach(chip => chip.remove());
}

const tasksPanel: SideDrawerPanel = {
    id: 'tasks',
    title: () => t('drawer.tasks'),
    icon: ['list-checks', 'check-square'],
    badge(view) {
        const todayStr = (window as any).moment().format('YYYY-MM-DD');
        const n = view.tasks.filter(t => isUndatedTask(t) || isOverdueTask(t, todayStr) || isScheduledAfterDeadline(t)).length;
        return n > 0 ? String(n) : '';
    },
    render(body, view) {
        const todayStr = (window as any).moment().format('YYYY-MM-DD');
        renderQuickCapture(body, view);
        renderDayCapacity(body, view);
        // Missed work first, above today
        const overdue = sortByPriorityThenTitle(view.tasks.filter(t => isOverdueTask(t, todayStr)), true);
        renderDrawerSection(body, view, 'overdue', `🚨 ${t('drawer.overdueTasks')}`, overdue, t('drawer.allCaughtUp'), [
            { label: t('fit.all'), tooltip: t('fit.allTooltip'), run: () => void view.fitTasksIn(overdue) },
            { label: t('drawer.rollToToday'), tooltip: t('drawer.rollToTodayTooltip'), run: () => void view.rescheduleOverdueTasks(overdue, { date: todayStr }) }
        ]);
        // Today's MITs, in the order the day runs (timed first, by start), then by title
        const focus = view.tasks.filter(t => t.date === todayStr && isFocusTask(t)).sort((a, b) =>
            (a.startTime ?? '99').localeCompare(b.startTime ?? '99')
            || cleanTaskTextForDisplay(a.text).localeCompare(cleanTaskTextForDisplay(b.text)));
        // The rest of today, done ones too (a checkbox can be undone in place), minus the focus cards above it and tasks
        // only due today (Unscheduled, and under Deadlines): open before done, then timed by start (untimed after),
        // then priority and title
        const focusIds = new Set(focus.map(f => f.id));
        const todayTasks = sortByPriorityThenTitle(view.tasks.filter(t => t.date === todayStr && t.statusChar !== '-'
            && !focusIds.has(t.id) && !(isOpen(t) && isDeadlineOnly(t))))
            .sort((a, b) => Number(a.statusChar === 'x') - Number(b.statusChar === 'x')
                || (a.startTime ?? '99').localeCompare(b.startTime ?? '99'));
        renderDrawerSection(body, view, 'today', `📅 ${t('drawer.todayTasks')}`, todayTasks, t('drawer.todayEmpty'),
            [{ label: t('review.button'), tooltip: t('review.buttonTooltip'), run: () => view.reviewToday() }], focus);
        // Open tasks by their 📅: every missed deadline, then those due within the look-ahead (Settings), and any task
        // scheduled past its deadline however far off (its card carries the ⚠)
        const lookahead = view.plugin.settings.deadlineLookaheadDays || 7;
        const horizon = (window as any).moment().add(lookahead, 'days').format('YYYY-MM-DD');
        const deadlines = sortByDueDate(view.tasks.filter(task => isOpen(task) && task.dueDate !== null
            && (task.dueDate <= horizon || isScheduledAfterDeadline(task))));
        renderDrawerSection(body, view, 'deadline', `⌛ ${t('drawer.deadlines')}`, deadlines, t('drawer.deadlineEmpty', { n: lookahead }),
            [], [], task => deadlineGroupLabel(task, todayStr));
        renderDrawerSection(body, view, 'undated', `📂 ${t('drawer.undatedTasks')}`,
            sortByPriorityThenTitle(view.tasks.filter(isUndatedTask)), t('drawer.noUndated'));
    }
};

// ---------------------------------------------------------------------------------------------------------------
// Priority picker (drawer cards): one click on the priority badge, or `p` on a focused card
// ---------------------------------------------------------------------------------------------------------------

let openPicker: { el: HTMLElement; close: () => void } | null = null;

/** The badge on a drawer card: the task's priority emoji, or a faint flag (shown on hover) when it has none */
export function renderPriorityTrigger(card: HTMLElement, task: TaskItem, view: DayPlannerCombinedView): HTMLElement {
    const emoji = PRIORITY_LEVELS.find(l => l.id === task.priority)?.emoji ?? '';
    const trigger = card.createEl('button', {
        cls: `dp-priority-trigger${emoji ? '' : ' is-empty'}`,
        attr: { 'aria-label': `${t('priority.set')} · ${priorityLabel(task.priority)}`, 'aria-haspopup': 'true' }
    });
    if (emoji) trigger.setText(emoji);
    else setIcon(trigger, 'flag');
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerHaptic('selection');
        togglePriorityPicker(trigger, task, view);
    });
    return trigger;
}

/** Opens the picker under `anchor` (above it when the drawer has no room below); a second call closes it */
export function togglePriorityPicker(anchor: HTMLElement, task: TaskItem, view: DayPlannerCombinedView, viaKeyboard = false) {
    const reopen = openPicker?.el.dataset.taskId !== task.id;
    openPicker?.close();
    if (!reopen) return;

    const doc = anchor.ownerDocument;
    const win = doc.defaultView ?? window;
    const pop = doc.body.createDiv({ cls: 'dp-priority-popover', attr: { role: 'menu', 'aria-label': t('priority.set') } });
    pop.dataset.taskId = task.id;
    const buttons: HTMLButtonElement[] = [];
    PRIORITY_LEVELS.forEach(level => {
        const btn = pop.createEl('button', {
            cls: `dp-priority-option${level.id === task.priority ? ' is-active' : ''}${level.id === 'highest' ? ' is-mit' : ''}`,
            attr: { role: 'menuitemradio', 'aria-checked': String(level.id === task.priority), 'aria-label': priorityLabel(level.id) }
        });
        btn.createSpan({ cls: 'dp-priority-option-emoji', text: level.emoji || '○' });
        btn.createSpan({ cls: 'dp-priority-option-label', text: priorityLabel(level.id) });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            triggerHaptic('selection');
            close();
            if (level.id !== task.priority) void view.setTaskPriority(task, level.id);
        });
        buttons.push(btn);
    });

    // Below the badge, right-aligned to it; flipped above when it would run past the window
    const r = anchor.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const below = r.bottom + 6 + popRect.height <= win.innerHeight - 8;
    pop.style.top = `${below ? r.bottom + 6 : r.top - 6 - popRect.height}px`;
    pop.style.left = `${Math.max(8, Math.min(r.right - popRect.width, win.innerWidth - popRect.width - 8))}px`;
    pop.addClass(below ? 'is-below' : 'is-above');

    const onPointerDown = (e: PointerEvent) => {
        // The badge's own click toggles the picker (its flag icon is a child <svg>, hence contains())
        if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
        const i = buttons.indexOf(doc.activeElement as HTMLButtonElement);
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
            anchor.focus();
        } else if (i >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            e.stopPropagation();
            buttons[(i + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
        }
    };
    const close = () => {
        doc.removeEventListener('pointerdown', onPointerDown, true);
        doc.removeEventListener('keydown', onKey, true);
        win.removeEventListener('resize', close);
        doc.removeEventListener('scroll', close, true);
        pop.remove();
        if (openPicker?.el === pop) openPicker = null;
    };
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('keydown', onKey, true);
    win.addEventListener('resize', close);
    doc.addEventListener('scroll', close, true); // the badge moved away under it
    openPicker = { el: pop, close };
    if (viaKeyboard) (buttons.find(b => b.hasClass('is-active')) ?? buttons[0]).focus();
}

// ---------------------------------------------------------------------------------------------------------------
// Stats panel: the timebox performance of the day the view is on
// ---------------------------------------------------------------------------------------------------------------

interface DayStats {
    dateStr: string;
    plannedMin: number;
    completedMin: number;
    total: number;
    done: number;
    focusTotal: number;
    focusDone: number;
    eventCount: number;
    eventMin: number;
    byPriority: Array<{ id: Priority; emoji: string; total: number; done: number }>;
    /** Time done / time planned; with nothing timed, tasks done / tasks; 0–100 */
    pct: number;
    basis: 'time' | 'tasks' | 'none';
}

/** Memo for one render: the mode switcher's badge and the panel both need the same day's numbers */
let statsMemo: { tasks: TaskItem[]; dateStr: string; stats: DayStats } | null = null;

function computeDayStats(view: DayPlannerCombinedView, dateStr: string): DayStats {
    // The whole day, whatever the planner search currently narrows the view to
    const source = view.searchQuery ? view.unsearchedTasks : view.tasks;
    if (statsMemo && statsMemo.tasks === source && statsMemo.dateStr === dateStr) return statsMemo.stats;
    const dayTasks = source.filter(t => t.date === dateStr && t.statusChar !== '-');
    let plannedMin = 0, completedMin = 0, done = 0, focusTotal = 0, focusDone = 0;
    const byPriority = new Map<Priority, { total: number; done: number }>();
    dayTasks.forEach(task => {
        const isDone = task.statusChar === 'x';
        if (isDone) done++;
        if (task.startTime && task.endTime) {
            const length = timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
            if (length > 0) {
                plannedMin += length;
                if (isDone) completedMin += length;
            }
        }
        if (task.priority === 'highest') {
            focusTotal++;
            if (isDone) focusDone++;
        }
        const entry = byPriority.get(task.priority) ?? { total: 0, done: 0 };
        entry.total++;
        if (isDone) entry.done++;
        byPriority.set(task.priority, entry);
    });

    let eventCount = 0, eventMin = 0;
    if (view.plugin.hasCalendars()) {
        view.getCalendarEventsForDate(dateStr).forEach(e => {
            if (e.isAllDay || !e.startTimeStr || !e.endTimeStr) return;
            eventCount++;
            eventMin += Math.max(0, timeToMinutes(e.endTimeStr) - timeToMinutes(e.startTimeStr));
        });
    }

    const basis = plannedMin > 0 ? 'time' : dayTasks.length > 0 ? 'tasks' : 'none';
    const ratio = basis === 'time' ? completedMin / plannedMin : basis === 'tasks' ? done / dayTasks.length : 0;
    const stats: DayStats = {
        dateStr, plannedMin, completedMin, total: dayTasks.length, done, focusTotal, focusDone, eventCount, eventMin,
        byPriority: PRIORITY_LEVELS.filter(l => byPriority.has(l.id)).map(l => ({ id: l.id, emoji: l.emoji, ...byPriority.get(l.id)! })),
        pct: Math.round(ratio * 100),
        basis
    };
    statsMemo = { tasks: source, dateStr, stats };
    return stats;
}

function statsMessage(s: DayStats, isPast: boolean): string {
    if (s.total === 0) return t('stats.msg.empty');
    if (s.pct >= 100) return t('stats.msg.done');
    if (isPast) return t('stats.msg.past');
    if (s.focusTotal > 0 && s.focusDone === s.focusTotal) return t('stats.msg.focusDone');
    if (s.pct === 0) return t('stats.msg.start');
    return s.pct < 50 ? t('stats.msg.progress') : t('stats.msg.half');
}

const SVG_NS = 'http://www.w3.org/2000/svg';
let ringGradientSeq = 0;

/** Apple-style ring; the arc and the number animate from the value the previous render showed */
function renderProgressRing(parent: HTMLElement, view: DayPlannerCombinedView, s: DayStats) {
    const size = 104, stroke = 10, r = (size - stroke) / 2, circumference = 2 * Math.PI * r;
    const wrap = parent.createDiv({ cls: `dp-stats-ring${s.pct >= 100 ? ' is-complete' : ''}` });
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.setAttribute('aria-hidden', 'true');
    const gradientId = `dp-ring-grad-${++ringGradientSeq}`;
    const defs = svg.appendChild(document.createElementNS(SVG_NS, 'defs'));
    const gradient = defs.appendChild(document.createElementNS(SVG_NS, 'linearGradient'));
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0');
    gradient.setAttribute('y1', '0');
    gradient.setAttribute('x2', '1');
    gradient.setAttribute('y2', '1');
    [['0%', 'var(--dp-ring-from)'], ['100%', 'var(--dp-ring-to)']].forEach(([offset, color]) => {
        const stop = gradient.appendChild(document.createElementNS(SVG_NS, 'stop'));
        stop.setAttribute('offset', offset);
        stop.setAttribute('style', `stop-color: ${color}`);
    });
    const circle = (cls: string) => {
        const c = svg.appendChild(document.createElementNS(SVG_NS, 'circle'));
        c.setAttribute('class', cls);
        c.setAttribute('cx', String(size / 2));
        c.setAttribute('cy', String(size / 2));
        c.setAttribute('r', String(r));
        c.setAttribute('stroke-width', String(stroke));
        return c;
    };
    circle('dp-stats-ring-track');
    const arc = circle('dp-stats-ring-arc');
    arc.setAttribute('stroke', `url(#${gradientId})`);
    arc.setAttribute('stroke-dasharray', String(circumference));
    const offsetFor = (pct: number) => String(circumference * (1 - Math.min(100, Math.max(0, pct)) / 100));
    const from = view.drawerStatsPct;
    arc.setAttribute('stroke-dashoffset', offsetFor(from));
    wrap.appendChild(svg);

    const center = wrap.createDiv({ cls: 'dp-stats-ring-center' });
    const value = center.createDiv({ cls: 'dp-stats-ring-value', text: `${from}%` });
    center.createDiv({
        cls: 'dp-stats-ring-caption',
        text: s.basis === 'time' ? t('stats.ofTime') : s.basis === 'tasks' ? t('stats.ofTasks') : '—'
    });

    view.drawerStatsPct = s.pct;
    if (from === s.pct) {
        value.setText(`${s.pct}%`);
        return;
    }
    // Two frames: the arc is laid out at the old value first, so the CSS transition runs to the new one
    requestAnimationFrame(() => requestAnimationFrame(() => arc.setAttribute('stroke-dashoffset', offsetFor(s.pct))));
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        value.setText(`${s.pct}%`);
        return;
    }
    const start = performance.now(), duration = 700;
    const tick = (now: number) => {
        if (!value.isConnected) return;
        const k = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        value.setText(`${Math.round(from + (s.pct - from) * eased)}%`);
        if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function renderMeter(parent: HTMLElement, label: string, value: string, ratio: number | null, cls = '') {
    const row = parent.createDiv({ cls: `dp-stats-meter${cls ? ` ${cls}` : ''}` });
    const head = row.createDiv({ cls: 'dp-stats-meter-head' });
    head.createSpan({ cls: 'dp-stats-meter-label', text: label });
    head.createSpan({ cls: 'dp-stats-meter-value', text: value });
    if (ratio !== null) {
        const fill = row.createDiv({ cls: 'dp-stats-bar' }).createDiv({ cls: 'dp-stats-bar-fill' });
        fill.style.setProperty('--dp-fill', `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);
    }
}

/** Ring + Planned / Completed / Remaining tiles (Day and Week alike) */
function renderStatsHero(wrap: HTMLElement, view: DayPlannerCombinedView, s: DayStats) {
    const hero = wrap.createDiv({ cls: 'dp-stats-hero' });
    renderProgressRing(hero, view, s);
    const tiles = hero.createDiv({ cls: 'dp-stats-tiles' });
    const tile = (label: string, value: string, cls: string) => {
        const el = tiles.createDiv({ cls: `dp-stats-tile ${cls}` });
        el.createDiv({ cls: 'dp-stats-tile-label', text: label });
        el.createDiv({ cls: 'dp-stats-tile-value', text: value });
    };
    const timed = s.plannedMin > 0;
    tile(t('stats.planned'), timed ? formatDuration(s.plannedMin) : '—', 'is-planned');
    tile(t('stats.completed'), timed ? formatDuration(s.completedMin) : '—', 'is-completed');
    tile(t('stats.remaining'), timed ? formatDuration(s.plannedMin - s.completedMin) : '—', 'is-remaining');
}

/** Tasks / Focus / Events meters and the priority breakdown (Day and Week alike) */
function renderStatsMeters(wrap: HTMLElement, s: DayStats) {
    const card = wrap.createDiv({ cls: 'dp-stats-card' });
    renderMeter(card, t('stats.tasks'), t('stats.tasksDone', { done: s.done, total: s.total }), s.total > 0 ? s.done / s.total : 0);
    if (s.focusTotal > 0) {
        renderMeter(card, `🎯 ${t('drawer.focus')}`, t('stats.tasksDone', { done: s.focusDone, total: s.focusTotal }),
            s.focusDone / s.focusTotal, 'is-focus');
    }
    if (s.eventCount > 0) {
        renderMeter(card, `📅 ${t('stats.events')}`, t('stats.eventsValue', { n: s.eventCount, time: formatDuration(s.eventMin) }), null);
    }

    if (s.byPriority.length > 0) {
        const breakdown = wrap.createDiv({ cls: 'dp-stats-card dp-stats-breakdown' });
        breakdown.createDiv({ cls: 'dp-stats-card-title', text: t('stats.byPriority') });
        s.byPriority.forEach(p => {
            renderMeter(breakdown, `${p.emoji || '○'} ${priorityLabel(p.id)}`, `${p.done}/${p.total}`, p.done / p.total,
                `dp-stats-priority is-${p.id}`);
        });
    }
}

function renderDailyStats(parent: HTMLElement, view: DayPlannerCombinedView): HTMLElement {
    const moment = (window as any).moment;
    const day = view.currentDate.clone().startOf('day');
    const dateStr = day.format('YYYY-MM-DD');
    const todayStr = moment().format('YYYY-MM-DD');
    const s = computeDayStats(view, dateStr);

    const wrap = parent.createDiv({ cls: 'dp-stats' });
    const head = wrap.createDiv({ cls: 'dp-stats-day' });
    head.createSpan({ cls: 'dp-stats-day-label', text: localMoment(day).format('dddd, LL') });
    if (dateStr === todayStr) head.createSpan({ cls: 'dp-stats-day-chip', text: t('common.today') });

    renderStatsHero(wrap, view, s);
    renderStatsMeters(wrap, s);
    wrap.createDiv({ cls: `dp-stats-message${s.pct >= 100 ? ' is-done' : ''}`, text: statsMessage(s, dateStr < todayStr) });
    return wrap;
}

interface WeekDayLoad {
    dateStr: string;
    /** Timed task minutes (done ones also in doneMin) and timed Google event minutes on that day */
    taskMin: number;
    doneMin: number;
    eventMin: number;
}

interface WeekStats extends DayStats {
    days: WeekDayLoad[];
}

let weekMemo: { tasks: TaskItem[]; from: string; stats: WeekStats } | null = null;

/** The week (locale's first day, as the Weekly tab) holding `from`: the Day totals summed, plus each day's load */
function computeWeekStats(view: DayPlannerCombinedView, from: string): WeekStats {
    const moment = (window as any).moment;
    const source = view.searchQuery ? view.unsearchedTasks : view.tasks;
    if (weekMemo && weekMemo.tasks === source && weekMemo.from === from) return weekMemo.stats;
    const start = moment(from, 'YYYY-MM-DD');
    const days: WeekDayLoad[] = Array.from({ length: 7 }, (_, i) => ({
        dateStr: start.clone().add(i, 'days').format('YYYY-MM-DD'), taskMin: 0, doneMin: 0, eventMin: 0
    }));
    const to = days[6].dateStr;
    const dayOf = new Map(days.map(d => [d.dateStr, d]));

    let total = 0, done = 0, plannedMin = 0, completedMin = 0, focusTotal = 0, focusDone = 0;
    const byPriority = new Map<Priority, { total: number; done: number }>();
    source.forEach(task => {
        const day = task.date ? dayOf.get(task.date) : undefined;
        if (!day || task.statusChar === '-') return;
        const isDone = task.statusChar === 'x';
        total++;
        if (isDone) done++;
        if (task.startTime && task.endTime) {
            const length = timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
            if (length > 0) {
                plannedMin += length;
                day.taskMin += length;
                if (isDone) {
                    completedMin += length;
                    day.doneMin += length;
                }
            }
        }
        if (task.priority === 'highest') {
            focusTotal++;
            if (isDone) focusDone++;
        }
        const entry = byPriority.get(task.priority) ?? { total: 0, done: 0 };
        entry.total++;
        if (isDone) entry.done++;
        byPriority.set(task.priority, entry);
    });

    let eventCount = 0, eventMin = 0;
    if (view.plugin.hasCalendars()) {
        // Every cached range (whole months, the neighbours prefetched: a week may straddle two) and the subscriptions
        view.plugin.forEachCalendarEvent(from, to, e => {
            if (e.isAllDay || !e.startTimeStr || !e.endTimeStr) return;
            // Clipped to each day it touches (an overnight event counts on both)
            const evStart = moment(e.start), evEnd = moment(e.end);
            let counted = false;
            for (let d = evStart.clone().startOf('day'), n = 0; d.isBefore(evEnd) && n < 60; d.add(1, 'day'), n++) {
                const day = dayOf.get(d.format('YYYY-MM-DD'));
                if (!day) continue;
                const minutes = moment.min(evEnd, d.clone().add(1, 'day')).diff(moment.max(evStart, d), 'minutes');
                if (minutes <= 0) continue;
                day.eventMin += minutes;
                eventMin += minutes;
                counted = true;
            }
            if (counted) eventCount++;
        });
    }

    const basis = plannedMin > 0 ? 'time' : total > 0 ? 'tasks' : 'none';
    const ratio = basis === 'time' ? completedMin / plannedMin : basis === 'tasks' ? done / total : 0;
    const stats: WeekStats = {
        dateStr: from, plannedMin, completedMin, total, done, focusTotal, focusDone, eventCount, eventMin,
        byPriority: PRIORITY_LEVELS.filter(l => byPriority.has(l.id)).map(l => ({ id: l.id, emoji: l.emoji, ...byPriority.get(l.id)! })),
        pct: Math.round(ratio * 100),
        basis,
        days
    };
    weekMemo = { tasks: source, from, stats };
    return stats;
}

/** "7.5h" / "45m": short enough for a day column */
function shortDuration(minutes: number): string {
    return minutes < 60 ? `${Math.round(minutes)}m` : `${Math.round(minutes / 6) / 10}h`;
}

/**
 * Week: the same ring, tiles and meters over the whole week, plus a bar per day (timed tasks done / still planned,
 * Google events) against the working hours (timeline start / end hour, the dashed line). A day past them turns red.
 * A timeline over the whole day (0–24) sets no working hours: no line, the bars scale to the busiest day (8h at least).
 * Click a day to show it in the planner.
 */
function renderWeeklyStats(parent: HTMLElement, view: DayPlannerCombinedView): HTMLElement {
    const moment = (window as any).moment;
    const start = view.currentDate.clone().startOf('week');
    const from = start.format('YYYY-MM-DD');
    const todayStr = moment().format('YYYY-MM-DD');
    const viewDateStr = view.currentDate.format('YYYY-MM-DD');
    const s = computeWeekStats(view, from);
    const to = s.days[6].dateStr;

    const wrap = parent.createDiv({ cls: 'dp-stats' });
    const head = wrap.createDiv({ cls: 'dp-stats-day' });
    const end = moment(to, 'YYYY-MM-DD');
    head.createSpan({ cls: 'dp-stats-day-label', text: `${localMoment(start).format('MMM D')} – ${localMoment(end).format('MMM D')}` });
    if (todayStr >= from && todayStr <= to) head.createSpan({ cls: 'dp-stats-day-chip', text: t('stats.thisWeek') });

    renderStatsHero(wrap, view, s);

    const { startHour, endHour } = view.getTimelineHours();
    const capacity = endHour - startHour < 24 ? Math.max(60, (endHour - startHour) * 60) : null;
    const load = (d: WeekDayLoad) => d.taskMin + d.eventMin;
    const scale = Math.max(capacity ?? 8 * 60, ...s.days.map(load));
    const pctOf = (minutes: number) => `${(minutes / scale) * 100}%`;

    const card = wrap.createDiv({ cls: 'dp-stats-card dp-stats-week' });
    card.createDiv({ cls: 'dp-stats-card-title', text: t('stats.week.load') });
    const bars = card.createDiv({ cls: 'dp-stats-week-bars' });
    if (capacity !== null) bars.style.setProperty('--dp-week-cap', pctOf(capacity));
    s.days.forEach(d => {
        const day = moment(d.dateStr, 'YYYY-MM-DD');
        const minutes = load(d);
        const cls = ['dp-stats-week-day'];
        if (d.dateStr === todayStr) cls.push('is-today');
        if (d.dateStr === viewDateStr) cls.push('is-current');
        if (capacity !== null && minutes > capacity) cls.push('is-over');
        const btn = bars.createEl('button', {
            cls: cls.join(' '),
            attr: {
                type: 'button',
                'aria-label': t('stats.week.dayAria', {
                    date: localMoment(day).format('ddd, MMM D'),
                    tasks: formatDuration(d.taskMin),
                    done: formatDuration(d.doneMin),
                    events: formatDuration(d.eventMin)
                })
            }
        });
        btn.createDiv({ cls: 'dp-stats-week-value', text: minutes > 0 ? shortDuration(minutes) : '' });
        const col = btn.createDiv({ cls: 'dp-stats-week-col' });
        // column-reverse: the first segment sits at the bottom
        const seg = (cls: string, m: number) => { if (m > 0) col.createDiv({ cls: `dp-stats-week-seg ${cls}` }).style.height = pctOf(m); };
        seg('is-done', d.doneMin);
        seg('is-planned', d.taskMin - d.doneMin);
        seg('is-event', d.eventMin);
        if (capacity !== null) col.createDiv({ cls: 'dp-stats-week-cap' });
        btn.createDiv({ cls: 'dp-stats-week-label', text: localMoment(day).format('dd') });
        btn.addEventListener('click', () => void view.goToDate(d.dateStr));
    });
    const legend = card.createDiv({ cls: 'dp-stats-week-legend' });
    legend.createSpan({ cls: 'is-done', text: t('stats.week.legendDone') });
    legend.createSpan({ cls: 'is-planned', text: t('stats.week.legendPlanned') });
    if (s.eventMin > 0) legend.createSpan({ cls: 'is-event', text: t('stats.week.legendEvents') });
    if (capacity !== null) legend.createSpan({ cls: 'is-cap', text: t('stats.week.legendCapacity') });

    renderStatsMeters(wrap, s);

    const over = capacity === null ? [] : s.days.filter(d => load(d) > capacity);
    const busiest = s.days.reduce((a, b) => (load(b) > load(a) ? b : a));
    const dayName = (d: WeekDayLoad) => localMoment(moment(d.dateStr, 'YYYY-MM-DD')).format('ddd');
    const message = load(busiest) === 0 && s.total === 0 ? t('stats.week.empty')
        : over.length > 0 ? t('stats.week.over', { days: over.map(dayName).join(', ') })
        : load(busiest) > 0 ? t('stats.week.busiest', { day: dayName(busiest), time: formatDuration(load(busiest)) })
        : t('stats.week.untimed');
    wrap.createDiv({ cls: `dp-stats-message${over.length > 0 ? ' is-warning' : s.pct >= 100 ? ' is-done' : ''}`, text: message });
    return wrap;
}

type StatsRange = 'day' | 'week';
/** Per device (the vault's local storage), not data.json: switching it never touches a synced file */
const STATS_RANGE_KEY = 'dayloom-stats-range';

function statsRange(view: DayPlannerCombinedView): StatsRange {
    if (view.drawerStatsRange === null) {
        let saved: unknown = null;
        try { saved = view.app.loadLocalStorage(STATS_RANGE_KEY); } catch { /* storage blocked */ }
        view.drawerStatsRange = saved === 'week' ? 'week' : 'day';
    }
    return view.drawerStatsRange;
}

function statsBadge(view: DayPlannerCombinedView): string {
    const s = statsRange(view) === 'week'
        ? computeWeekStats(view, view.currentDate.clone().startOf('week').format('YYYY-MM-DD'))
        : computeDayStats(view, view.currentDate.format('YYYY-MM-DD'));
    return s.basis === 'none' ? '' : `${s.pct}%`;
}

/** Day / Week switch above the stats; a switch swaps only the stats under it and the mode switcher's badge */
function renderStatsPanel(body: HTMLElement, view: DayPlannerCombinedView) {
    const renderRange = (range: StatsRange) => (range === 'week' ? renderWeeklyStats : renderDailyStats)(body, view);
    new PillTabs<StatsRange>(body, {
        options: [
            { value: 'day', label: t('stats.range.day') },
            { value: 'week', label: t('stats.range.week') }
        ],
        value: statsRange(view),
        ariaLabel: t('stats.range'),
        role: 'radiogroup',
        cls: 'dp-stats-range',
        onChange: (range) => {
            view.drawerStatsRange = range;
            try { view.app.saveLocalStorage(STATS_RANGE_KEY, range); } catch { /* storage blocked */ }
            triggerHaptic('selection');
            const old = content;
            content = renderRange(range); // appended after the old one, then the old one goes: no empty frame
            content.addClass('dp-stats-enter'); // the week bars grow in
            old.remove();
            const seg = body.closest('.dp-side-drawer')?.querySelector<HTMLElement>('.dp-drawer-mode[data-panel="stats"]');
            if (!seg) return;
            const badge = statsBadge(view);
            let count = seg.querySelector<HTMLElement>('.dp-drawer-count');
            if (!badge) count?.remove();
            else (count ??= seg.createSpan({ cls: 'dp-drawer-count' })).setText(badge);
        }
    });
    let content = renderRange(statsRange(view));
}

const statsPanel: SideDrawerPanel = {
    id: 'stats',
    title: () => t('drawer.stats'),
    icon: ['chart-pie', 'pie-chart'],
    badge: statsBadge,
    render: renderStatsPanel
};

export const SIDE_DRAWER_PANELS: SideDrawerPanel[] = [tasksPanel, statsPanel];

/** Tabs that show the drawer: every desktop tab (Board and List too since 4.2.5) */
export const SIDE_DRAWER_TABS: ReadonlyArray<string> = ['daily', 'multiDay', 'weekly', 'monthly', 'board', 'list'];

/** Lucide renamed sidebar-* to panel-*; older Obsidian builds only know the former */
export function setFirstIcon(el: HTMLElement, names: string[]) {
    for (const name of names) {
        setIcon(el, name);
        if (el.querySelector('svg')) return;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Mini calendar
// ---------------------------------------------------------------------------------------------------------------

/** One dot under a day: the tasks, or one calendar's events (in that calendar's colour from the settings) */
export interface DayDot { key: string; color: string | null; label: string; count: number; done?: boolean; focus?: boolean }

export const MAX_DAY_DOTS = 5;
const DEFAULT_EVENT_COLOR = '#4285f4';

/**
 * Dots per date in [from, to], shared by the drawer's mini calendar and Dayloom Calendar: one task dot (open tasks
 * counted; only done ones leave it faded), then one per calendar with events that day, in settings order.
 * `spanned`: the dates a multi-day or all-day event covers.
 */
export function collectDayDots(plugin: DayPlannerPlugin, tasks: TaskItem[], from: string, to: string,
    spanned: (e: GCalEvent) => string[]): Map<string, DayDot[]> {
    const s = plugin.settings;
    const byDate = new Map<string, Map<string, DayDot>>();
    const dotAt = (date: string, key: string, make: () => DayDot) => {
        let dots = byDate.get(date);
        if (!dots) byDate.set(date, dots = new Map());
        let dot = dots.get(key);
        if (!dot) dots.set(key, dot = make());
        return dot;
    };

    tasks.forEach(task => {
        if (!task.date || task.date < from || task.date > to || task.statusChar === '-') return;
        const dot = dotAt(task.date, 'tasks', () => ({ key: 'tasks', color: null, label: '', count: 0, done: true }));
        if (task.statusChar === 'x') return;
        dot.count++;
        dot.done = false;
        if (task.priority === 'highest') dot.focus = true;
    });

    const calendars = new Map<string, { name: string; color: string; order: number }>();
    let order = 0;
    if (s.enableGoogleCalendar) {
        (s.googleCalendars ?? []).forEach(c => { if (c.enabled && c.id) calendars.set(c.id, { name: c.name, color: c.color, order: order++ }); });
    }
    (s.icsCalendars ?? []).forEach(c => { if (c.enabled) calendars.set(c.id, { name: c.name, color: c.color, order: order++ }); });
    if (plugin.hasCalendars()) {
        plugin.forEachCalendarEvent(from, to, e => {
            const cal = calendars.get(e.calendarId);
            if (!cal) return; // a calendar switched off since it was fetched
            const days = e.isAllDay || e.start.slice(0, 10) !== e.end.slice(0, 10) ? spanned(e) : [e.dateStr];
            days.forEach(d => {
                if (d < from || d > to) return;
                dotAt(d, `cal:${e.calendarId}`, () => ({
                    key: `cal:${e.calendarId}`, color: cal.color || e.color || DEFAULT_EVENT_COLOR, label: cal.name, count: 0
                })).count++;
            });
        });
    }

    const rank = (dot: DayDot) => dot.key === 'tasks' ? -1 : calendars.get(dot.key.slice(4))?.order ?? 0;
    const result = new Map<string, DayDot[]>();
    byDate.forEach((dots, date) => result.set(date, Array.from(dots.values()).sort((a, b) => rank(a) - rank(b))));
    return result;
}

/** Fills a day cell's dot row (`cls`-dots / `cls`-dot) and returns the tooltip parts that describe them */
export function renderDayDots(cell: HTMLElement, dots: DayDot[], cls: string): string[] {
    if (dots.length === 0) return [];
    const row = cell.createSpan({ cls: `${cls}-dots` });
    dots.slice(0, MAX_DAY_DOTS).forEach(dot => {
        const el = row.createSpan({ cls: `${cls}-dot${dot.key === 'tasks' ? ' is-task' : ''}${dot.done ? ' is-done' : ''}${dot.focus ? ' is-focus' : ''}` });
        if (dot.color) el.style.setProperty(`--${cls}-dot`, dot.color);
    });
    return dots.flatMap(dot => {
        if (dot.key !== 'tasks') return [t('sidebarCal.calendarEvents', { name: dot.label, n: dot.count })];
        if (dot.done) return [t('sidebarCal.doneOnly')];
        const parts = [t('calendar.openTasks', { n: dot.count })];
        if (dot.focus) parts.push(`🎯 ${t('drawer.focus')}`);
        return parts;
    });
}

/** Dates the main view currently shows: the band the mini calendar highlights */
function shownRange(view: DayPlannerCombinedView): { start: string; end: string } | null {
    const d = view.currentDate;
    switch (view.activeTab) {
        case 'daily': return { start: d.format('YYYY-MM-DD'), end: d.format('YYYY-MM-DD') };
        case 'multiDay': return { start: d.format('YYYY-MM-DD'), end: d.clone().add(view.getNDayCount() - 1, 'days').format('YYYY-MM-DD') };
        case 'weekly': return { start: d.clone().startOf('week').format('YYYY-MM-DD'), end: d.clone().endOf('week').format('YYYY-MM-DD') };
        default: return null;
    }
}

/**
 * Month grid at the top of the drawer. Click a day: the planner goes there; Ctrl/Cmd+click: that day's note.
 * ‹ › page months (weeks when folded to a single week row; the month label folds / unfolds it). Paging only swaps
 * the grid, without re-rendering the view. Day cells are drop targets too: a drawer card dropped on one is
 * rescheduled to that date (its time is kept).
 */
function addCloseButton(header: HTMLElement, view: DayPlannerCombinedView) {
    const closeBtn = header.createEl('button', { cls: 'clickable-icon dp-drawer-close', attr: { 'aria-label': t('drawer.close') } });
    setFirstIcon(closeBtn, ['panel-right-close', 'sidebar-close', 'x']);
    closeBtn.addEventListener('click', () => void view.toggleSideDrawer(false));
}

/** Board: no mini calendar (the Board always shows today), so the task lists get the full height; today's date heads it */
function mountPlainHeader(drawer: HTMLElement, view: DayPlannerCombinedView) {
    const header = drawer.createDiv({ cls: 'dp-drawer-header dp-mc-header' });
    header.createDiv({ cls: 'dp-drawer-plain-title', text: localMoment((window as any).moment()).format('dddd, LL') });
    addCloseButton(header, view);
}

function mountMiniCalendar(drawer: HTMLElement, view: DayPlannerCombinedView) {
    const moment = (window as any).moment;
    const settings = view.plugin.settings;

    const header = drawer.createDiv({ cls: 'dp-drawer-header dp-mc-header' });
    const label = header.createEl('button', {
        cls: 'dp-mc-label',
        attr: { 'aria-label': t('calendar.toggle'), 'aria-expanded': String(!settings.miniCalendarCollapsed) }
    });
    const labelText = label.createSpan({ cls: 'dp-mc-label-text' });
    label.createSpan({ cls: 'dp-mc-label-chevron', text: '▾' });
    const nav = header.createDiv({ cls: 'dp-mc-nav' });
    const prev = nav.createEl('button', { cls: 'dp-mc-nav-btn', attr: { 'aria-label': t('calendar.previous') } });
    setIcon(prev, 'chevron-left');
    const todayBtn = nav.createEl('button', { cls: 'dp-mc-today', text: t('common.today') });
    const next = nav.createEl('button', { cls: 'dp-mc-nav-btn', attr: { 'aria-label': t('calendar.next') } });
    setIcon(next, 'chevron-right');
    addCloseButton(header, view);

    const cal = drawer.createDiv({ cls: `dp-mini-cal${settings.miniCalendarCollapsed ? ' is-collapsed' : ''}` });
    const weekdays = cal.createDiv({ cls: 'dp-mc-weekdays' });
    const weekStart = localMoment(moment()).startOf('week');
    for (let i = 0; i < 7; i++) weekdays.createSpan({ text: weekStart.clone().add(i, 'days').format('dd') });
    let grid: HTMLElement | null = null;

    // Following the view unless the reader paged away (cleared again by a click on a day or Today)
    const anchor = () => moment(view.drawerCalendarAnchor ?? view.currentDate.format('YYYY-MM-DD'), 'YYYY-MM-DD');

    const build = (direction: 'next' | 'prev' | null) => {
        const collapsed = !!settings.miniCalendarCollapsed;
        const a = anchor();
        const month = a.clone().startOf('month');
        const first = collapsed ? a.clone().startOf('week') : month.clone().startOf('week');
        const weeks = collapsed ? 1 : 6; // six rows always: the drawer below never jumps between months
        const last = first.clone().add(weeks * 7 - 1, 'days');
        labelText.setText(localMoment(collapsed ? a : month).format('MMMM YYYY'));

        const todayStr = moment().format('YYYY-MM-DD');
        const range = shownRange(view);
        const dayDots = collectDayDots(view.plugin, view.tasks, first.format('YYYY-MM-DD'), last.format('YYYY-MM-DD'), e => view.getSpannedDatesForEvent(e));
        const nextGrid = createDiv({ cls: 'dp-mc-grid' });
        const day = first.clone();
        for (let w = 0; w < weeks; w++) {
            const row = nextGrid.createDiv({ cls: 'dp-mc-week' });
            for (let i = 0; i < 7; i++, day.add(1, 'day')) {
                const dateStr = day.format('YYYY-MM-DD');
                const inRange = !!range && dateStr >= range.start && dateStr <= range.end;
                const cell = row.createEl('button', { cls: 'dp-mc-day' });
                cell.dataset.date = dateStr;
                cell.toggleClass('is-other-month', !collapsed && !day.isSame(month, 'month'));
                cell.toggleClass('is-today', dateStr === todayStr);
                cell.toggleClass('is-weekend', day.day() === 0 || day.day() === 6);
                cell.toggleClass('is-in-range', inRange);
                cell.toggleClass('is-range-start', inRange && dateStr === range!.start);
                cell.toggleClass('is-range-end', inRange && dateStr === range!.end);
                cell.createSpan({ cls: 'dp-mc-num', text: String(day.date()) });
                const parts = [localMoment(day).format('LL')];
                parts.push(...renderDayDots(cell, dayDots.get(dateStr) ?? [], 'dp-mc'));
                cell.setAttr('aria-label', parts.join(' · '));
                cell.addEventListener('click', (e) => {
                    if (e.ctrlKey || e.metaKey) {
                        void view.focusDay(dateStr); // desktop: opens that day's daily note
                        return;
                    }
                    view.drawerCalendarAnchor = null;
                    void view.goToDate(dateStr);
                });
            }
        }
        if (grid) {
            grid.replaceWith(nextGrid);
            if (direction) nextGrid.addClass(direction === 'next' ? 'dp-mc-slide-next' : 'dp-mc-slide-prev');
        } else {
            cal.appendChild(nextGrid);
        }
        grid = nextGrid;
    };

    const page = (step: number) => {
        const unit = settings.miniCalendarCollapsed ? 'week' : 'month';
        view.drawerCalendarAnchor = anchor().add(step, unit).format('YYYY-MM-DD');
        build(step > 0 ? 'next' : 'prev');
    };
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    todayBtn.addEventListener('click', () => {
        const paged = view.drawerCalendarAnchor !== null;
        view.drawerCalendarAnchor = null;
        if (view.currentDate.isSame(moment(), 'day')) {
            if (paged) build(null); // the view is already on today: only bring the grid back to it
        } else {
            void view.goToToday();
        }
    });
    label.addEventListener('click', () => {
        settings.miniCalendarCollapsed = !settings.miniCalendarCollapsed;
        cal.toggleClass('is-collapsed', settings.miniCalendarCollapsed);
        label.setAttr('aria-expanded', String(!settings.miniCalendarCollapsed));
        build(null);
        void view.plugin.saveSettings();
    });
    // Wheel or two-finger scroll over the grid pages it vertically (one step per swipe, so a fling does not skip a year)
    pageOnWheel(cal, page, () => grid);

    build(null);
}

/**
 * Board cards drag with native HTML5 drag-and-drop (their ids via readDraggedTaskIds), unlike the pointer-dragged drawer
 * and timeline cards. On the Board, cards dropped on Today's Focus become today's 🔺 Highest tasks; anywhere else on the
 * drawer they lose their date (Undated). A mini calendar day (not shown on the Board) would move them to that date.
 */
function acceptBoardCardDrops(drawer: HTMLElement, view: DayPlannerCombinedView) {
    let current: HTMLElement | null = null;
    const highlight = (el: HTMLElement | null) => {
        if (current === el) return;
        current?.removeClass('dp-drop-target');
        el?.addClass('dp-drop-target');
        current = el;
    };
    const targetOf = (e: DragEvent): HTMLElement =>
        (e.target as HTMLElement).closest<HTMLElement>('.dp-mc-day[data-date], .dp-drawer-focus-slot[data-section="focus"], .dp-drawer-section[data-section="today"]')
        ?? drawer.querySelector<HTMLElement>('.dp-drawer-section[data-section="undated"]')
        ?? drawer;
    drawer.addEventListener('dragover', (e) => {
        if (view.activeTab !== 'board' || !e.dataTransfer?.types.includes('text/plain')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        highlight(targetOf(e));
    });
    drawer.addEventListener('dragleave', (e) => {
        if (!drawer.contains(e.relatedTarget as Node | null)) highlight(null);
    });
    drawer.addEventListener('drop', (e) => {
        const target = current;
        highlight(null);
        if (view.activeTab !== 'board' || !target) return;
        // Every selected Board card when the grabbed one was part of the selection
        const ids = readDraggedTaskIds(e.dataTransfer);
        const tasks = view.tasks.filter(t => ids.includes(t.id));
        if (tasks.length === 0) return;
        e.preventDefault();
        // Routed by the section under the pointer: Undated is a .dp-drawer-section too, so match Focus by its id
        if (target.matches('.dp-mc-day')) void view.moveTasksToDate(tasks, target.dataset.date!);
        else if (target.dataset.section === 'focus') void view.promoteToFocus(tasks);
        else if (target.dataset.section === 'today') void view.moveTasksToDate(tasks, (window as any).moment().format('YYYY-MM-DD'));
        else {
            const dated = tasks.filter(t => t.date !== null);
            if (dated.length > 0) void view.unscheduleTasks(dated);
        }
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------------------------------------------

/** Options of the shared drawer content (see renderDrawerPanelContent) */
export interface DrawerContentOptions {
    /** Month grid on top (desktop date tabs); false: the plain dated header, or none with showHeader false */
    showMiniCalendar: boolean;
    /** Header row with the close button; the phone More sheet has its own grabber instead */
    showHeader?: boolean;
}

/**
 * The drawer's content, the single source of truth for the desktop side drawer and the phone / compact More sheet:
 * optional header (mini calendar, or today's date), the Tasks / Stats switcher and the active panel (quick capture,
 * Today's Focus, Today's Tasks, Overdue, Undated · the Stats ring and meters). `containerEl` should be a
 * .dp-side-drawer so the drawer styles apply.
 */
export function renderDrawerPanelContent(containerEl: HTMLElement, view: DayPlannerCombinedView, options: DrawerContentOptions) {
    const settings = view.plugin.settings;
    const panel = SIDE_DRAWER_PANELS.find(p => p.id === settings.sideDrawerPanel) ?? SIDE_DRAWER_PANELS[0];
    openPicker?.close(); // its card is about to be rebuilt
    statsMemo = null; // tasks may have changed in place since the last render
    weekMemo = null;
    containerEl.setAttr('aria-label', panel.title());
    containerEl.style.setProperty('--dp-task-color', settings.taskColor || '#ff9f1c'); // mini calendar task dots

    if (options.showHeader !== false) {
        if (options.showMiniCalendar) mountMiniCalendar(containerEl, view);
        else mountPlainHeader(containerEl, view);
    }
    renderPanelSwitcher(containerEl, view, panel);
}

const DRAWER_DEFAULT_W = 272;
const DRAWER_MIN_W = 220;
const DRAWER_MAX_W = 520;
/** The panes never get narrower than this while the drawer is dragged wider */
const PANES_MIN_W = 320;

/**
 * Left-edge grip: dragging sets --dp-drawer-w on the container (the panes' margin and the drawer width follow it),
 * saved on release; a double-click restores the default. Survives the drawer being rebuilt mid-drag (lostpointercapture).
 */
function mountDrawerResizer(rootEl: HTMLElement, drawer: HTMLElement, view: DayPlannerCombinedView) {
    const settings = view.plugin.settings;
    const clamp = (w: number, max = DRAWER_MAX_W) => Math.round(Math.max(DRAWER_MIN_W, Math.min(max, w)));
    const apply = (w: number) => rootEl.style.setProperty('--dp-drawer-w', `${w}px`);
    apply(clamp(settings.sideDrawerWidth || DRAWER_DEFAULT_W));

    const grip = drawer.createDiv({ cls: 'dp-drawer-resizer', attr: { 'aria-hidden': 'true', title: t('drawer.resize') } });
    let width = 0;
    let frame = 0;
    grip.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation(); // no box selection / pane drag from the grip
        grip.setPointerCapture(e.pointerId);
        rootEl.addClass('dp-drawer-resizing');
        const right = rootEl.getBoundingClientRect().right;
        const max = Math.min(DRAWER_MAX_W, rootEl.clientWidth - PANES_MIN_W);
        width = drawer.getBoundingClientRect().width;
        const onMove = (ev: PointerEvent) => {
            width = clamp(right - ev.clientX, max);
            if (frame) return;
            frame = requestAnimationFrame(() => { frame = 0; apply(width); }); // one pane reflow per frame
        };
        const onEnd = () => {
            grip.removeEventListener('pointermove', onMove);
            grip.removeEventListener('lostpointercapture', onEnd);
            if (frame) cancelAnimationFrame(frame);
            frame = 0;
            apply(width);
            rootEl.removeClass('dp-drawer-resizing');
            if (settings.sideDrawerWidth === width) return;
            settings.sideDrawerWidth = width;
            void view.plugin.saveSettings();
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('lostpointercapture', onEnd); // fires on pointerup / cancel, and if the grip is removed
    });
    grip.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        apply(DRAWER_DEFAULT_W);
        settings.sideDrawerWidth = DRAWER_DEFAULT_W;
        void view.plugin.saveSettings();
    });
}

/** Builds the desktop drawer into `rootEl` (absolutely positioned under the header; see .dp-side-drawer in styles.ts). */
export function renderSideDrawer(rootEl: HTMLElement, view: DayPlannerCombinedView): HTMLElement {
    const drawer = rootEl.createDiv({ cls: 'dp-side-drawer' });
    drawer.toggleClass('is-open', view.isSideDrawerOpen());
    // Board: no mini calendar (the Board always shows today), so the task lists get the full height
    renderDrawerPanelContent(drawer, view, { showMiniCalendar: view.activeTab !== 'board' });
    acceptBoardCardDrops(drawer, view);
    mountDrawerResizer(rootEl, drawer, view);

    // Keys reach the drawer after a click on it (a box selection's press moves no focus by itself): Esc then clears a
    // selection made here even when the view's own key handler would not see it
    drawer.tabIndex = -1;
    drawer.addEventListener('pointerdown', (e) => {
        if (!(e.target as HTMLElement).closest('input, textarea, button, [tabindex="0"]')) drawer.focus({ preventScroll: true });
    });
    drawer.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.isComposing || view.selectedTaskIds.size === 0) return;
        if ((e.target as HTMLElement).closest('input, textarea')) return; // quick capture's own Esc (blur)
        e.preventDefault();
        e.stopPropagation();
        view.dismissSelection();
    });
    return drawer;
}

/** Segmented mode switcher plus the active panel's body (part of renderDrawerPanelContent) */
function renderPanelSwitcher(drawer: HTMLElement, view: DayPlannerCombinedView, panel: SideDrawerPanel) {
    const settings = view.plugin.settings;
    // Segmented mode switcher: the thumb slides between segments (transform only)
    const modes = drawer.createDiv({ cls: 'dp-drawer-modes', attr: { role: 'tablist', 'aria-label': t('drawer.modes') } });
    modes.style.setProperty('--dp-mode-count', String(SIDE_DRAWER_PANELS.length));
    modes.createDiv({ cls: 'dp-drawer-modes-thumb' });
    const setThumb = () => modes.style.setProperty('--dp-mode-index', String(SIDE_DRAWER_PANELS.indexOf(panel)));
    setThumb();
    const segments = SIDE_DRAWER_PANELS.map(p => {
        const seg = modes.createEl('button', {
            cls: `dp-drawer-mode${p === panel ? ' is-active' : ''}`,
            attr: { role: 'tab', 'aria-selected': String(p === panel), 'data-panel': p.id }
        });
        setFirstIcon(seg.createSpan({ cls: 'dp-drawer-mode-icon' }), p.icon);
        seg.createSpan({ cls: 'dp-drawer-mode-label', text: p.title() });
        const badge = p.badge?.(view) ?? '';
        if (badge) seg.createSpan({ cls: 'dp-drawer-count', text: badge });
        return seg;
    });

    let body = drawer.createDiv({ cls: 'dp-drawer-body', attr: { role: 'tabpanel', 'data-panel': panel.id } });
    const fillBody = (target: HTMLElement) => {
        panel.render(target, view);
        // Box selection over the cards, as on the timeline (Ctrl / Cmd / Shift add to the selection)
        view.registerMarqueeSelection(target, () => Array.from(target.querySelectorAll<HTMLElement>('.dp-drawer-card')));
        // The drawer is rebuilt on every render: keep the reader's place in the list
        target.scrollTop = view.drawerScrollTop;
        target.addEventListener('scroll', () => { view.drawerScrollTop = target.scrollTop; }, { passive: true });
    };
    fillBody(body);

    segments.forEach((seg, i) => seg.addEventListener('click', () => {
        const p = SIDE_DRAWER_PANELS[i];
        if (p === panel) return;
        triggerHaptic('selection');
        const forward = i > SIDE_DRAWER_PANELS.indexOf(panel);
        panel = p;
        settings.sideDrawerPanel = p.id;
        view.drawerScrollTop = 0;
        segments.forEach((s, j) => {
            s.toggleClass('is-active', j === i);
            s.setAttr('aria-selected', String(j === i));
        });
        setThumb();
        drawer.setAttr('aria-label', p.title());
        // Only the body is swapped (no view render): the new panel slides in from the side of its segment
        const nextBody = createDiv({ cls: `dp-drawer-body ${forward ? 'dp-drawer-enter-next' : 'dp-drawer-enter-prev'}`, attr: { role: 'tabpanel', 'data-panel': p.id } });
        body.replaceWith(nextBody);
        body = nextBody;
        fillBody(nextBody);
        void view.plugin.saveSettings();
    }));
}
