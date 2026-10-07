import { ItemView, WorkspaceLeaf, TFile, Notice, App, Menu, MarkdownRenderChild, Platform, setIcon } from 'obsidian';
import { TaskItem, GCalEvent, GCAL_CACHE_TTL_MS } from './types';
import { 
    cleanTaskTextForDisplay, 
    compareTasks, 
    createCustomCheckbox, 
    openNoteForDate,
    getHeaderDateInfo,
    scrollToTarget,
    parseTaskLine, 
    scanVaultTasks, 
    updateTaskInFile as rawUpdateTaskInFile, 
    createNewTaskInFile as rawCreateNewTaskInFile, 
    openTaskInEditor, 
    calculateClusteredLayout,
    formatMinutesNice,
    getTargetTaskFilePath,
    isSyncConflictPath,
    addMinutesToTime,
    triggerHaptic,
    isExcludedPath,
    taskListSignature,
    fileNameTaskDate,
    getDefaultTaskFilePath,
    attachPathSuggest,
    onEnterSubmit
} from './utils';
import { patchGoogleCalendarEvent, updateGoogleCalendarEvent, syncAllTasksToGCal, syncEditedTaskToGCal } from './gcalApi';
import { TaskEditModal, GCalEventEditModal, AddChoiceModal, TaskSyncModal, ShortcutHelpModal } from './modals';
import { renderSideDrawer, SIDE_DRAWER_TABS, setFirstIcon, DrawerSectionId } from './drawer';
import DayPlannerPlugin from './main';

type TabPillMemo = { key: string; left: number; width: number };

const PRIORITY_EMOJI: Record<string, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };

/** Done or cancelled tasks are history: no drag, resize or drop moves them */
const isLockedTask = (task?: TaskItem | null): boolean =>
    !!task && (task.completed || task.statusChar === 'x' || task.statusChar === '-');

/**
 * How far below a timeline card's top edge the pointer grabbed it, from layout (offsetTop in its column) rather than
 * getBoundingClientRect: the hover (scale 1.01) and selected (scale 0.97) transforms scale around the card's centre,
 * moving a tall card's painted top by up to 1.5% of its height. That error carried into every snapped preview
 * position as a gap between the cursor and the dragged card.
 */
function grabOffsetIn(card: HTMLElement, clientY: number): number {
    const col = card.offsetParent as HTMLElement | null;
    if (!col) return clientY - card.getBoundingClientRect().top;
    return clientY - (col.getBoundingClientRect().top + col.clientTop + card.offsetTop);
}

/**
 * What a desktop pointer drag carries: timed timeline card(s) being moved (with the multi-selection), or one task
 * picked up from the side drawer (Undated or Overdue section), an all-day row (dated, untimed) or a monthly cell
 */
type PointerDragSource =
    | { kind: 'timeline'; refId: string; isGCal: boolean; previewRoot: HTMLElement }
    | { kind: 'task'; task: TaskItem; origin: 'undated' | 'overdue' | 'allday' | 'month' };

/** Where a pointer drag would land: a timeline column (date + time), a monthly day cell (date only), the side drawer
 *  (unschedule), or a Weekly / N-day day header ("fit it in": first free slot of that day) */
type PointerDropTarget = { kind: 'timeline' | 'day' | 'drawer' | 'fit'; el: HTMLElement; dateStr: string };

/** Weekend tint class for a day (by real weekday, so any N-day window or week start is tagged correctly). */
function weekendCls(day: any): string {
    const dow = day.day();
    return dow === 0 ? ' is-sunday' : dow === 6 ? ' is-saturday' : '';
}

/**
 * The header is rebuilt on every tab switch, so a CSS transition has nothing to transition from.
 * Instead, remember the previous active tab's geometry and let the new pill play a FLIP slide from there.
 */
function animateActiveTabPill(tabsContainer: HTMLElement, owner: { tabPillMemo?: TabPillMemo }, activeKey: string) {
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
function keepActiveTabInView(tabsContainer: HTMLElement, owner: { tabScrollLeft?: number }) {
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

export type SlideDirection = 'next' | 'prev' | 'forward' | 'backward';
const SLIDE_CLASSES = ['dp-slide-from-right', 'dp-slide-from-left'];
const REVEAL_CLASS = 'dp-view-reveal';

function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Adds an animation class for one playback and removes it (plus any extra cleanup) when that animation ends. */
function playOnce(el: HTMLElement, cls: string, onDone?: () => void) {
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
 * Directional slide for date pagination, Today and the Board mode switch.
 * next/forward = enters from the right; prev/backward = enters from the left.
 * scrollHost (optional) clips horizontal overflow during the slide, but only when it has no horizontal
 * scrollbar of its own, so a real scrollbar never flickers away.
 */
function applySlideTransition(el: HTMLElement, direction: SlideDirection, scrollHost?: HTMLElement): void {
    if (prefersReducedMotion()) return;
    if (SLIDE_CLASSES.some(c => el.hasClass(c))) {
        el.removeClass(...SLIDE_CLASSES);
        void el.offsetWidth; // restart the keyframe when the same element is slid again mid-animation
    }
    const cls = direction === 'next' || direction === 'forward' ? SLIDE_CLASSES[0] : SLIDE_CLASSES[1];
    const clip = !!scrollHost && scrollHost.scrollWidth <= scrollHost.clientWidth;
    if (clip) scrollHost!.addClass('dp-slide-host');
    playOnce(el, cls, () => { if (clip) scrollHost!.removeClass('dp-slide-host'); });
}

/**
 * Top-level view switch: shows the target keep-alive pane, hides and deactivates every sibling pane,
 * and plays the 150ms reveal only when the target was not already the visible pane.
 */
function applyViewReveal(targetPaneEl: HTMLElement): void {
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
const getPlannerPlugin = (app: App): DayPlannerPlugin | undefined => (app as any).plugins?.getPlugin('obsidian-day-planner-pro');
const isTimedTask = (task: TaskItem) => !!(task.date && task.startTime && task.endTime);

function showTaskUndoNotice(
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
    messageEl.createSpan({ text: `Updated "${displayText}". ` });
    const undoBtn = messageEl.createEl('button', { text: 'Undo' });
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
    messageEl.createSpan({ text: `Updated "${displayText}". ` });
    const undoBtn = messageEl.createEl('button', { text: 'Undo' });
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

type TaskUpdates = Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>>;

/** The editable fields an Undo restores */
const snapshotTask = (task: TaskItem): TaskUpdates => ({
    text: task.text,
    statusChar: task.statusChar,
    priority: task.priority,
    date: task.date,
    startTime: task.startTime,
    endTime: task.endTime,
    recurrence: task.recurrence,
    dueDate: task.dueDate,
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
async function updateTasksInFile(app: App, tasks: TaskItem[], updates: TaskUpdates, summary: (count: number) => string): Promise<number> {
    if (tasks.length === 1) return (await updateTaskInFile(app, tasks[0], updates)) ? 1 : 0;
    const plugin = getPlannerPlugin(app);
    const done: Array<{ task: TaskItem; previous: TaskUpdates }> = [];
    for (const task of tasks) {
        const previous = snapshotTask(task);
        const wasTimed = isTimedTask(task);
        if (await rawUpdateTaskInFile(app, task, updates)) {
            if (plugin) syncEditedTaskToGCal(plugin, task, wasTimed);
            done.push({ task, previous });
        }
    }
    if (done.length === 0) return 0;

    const notice = new Notice('', 8000);
    const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
    if (!messageEl) return done.length;
    messageEl.empty();
    messageEl.createSpan({ text: `${summary(done.length)} ` });
    const undoBtn = messageEl.createEl('button', { text: 'Undo' });
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

const EMOJI_PRIORITY: Record<string, TaskItem['priority']> = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };

/** Quick-entry text → task text + priority: a Tasks priority emoji anywhere in the text sets the priority */
function parseQuickEntry(raw: string): { text: string; priority: TaskItem['priority'] } {
    let priority: TaskItem['priority'] = 'normal';
    const text = raw
        .replace(/(🔺|⏫|🔼|🔽|⏬)️?/gu, (_m: string, emoji: string) => { priority = EMOJI_PRIORITY[emoji]; return ' '; })
        .replace(/\s+/g, ' ')
        .trim();
    return { text, priority };
}

async function updateTaskInFile(
    app: App,
    task: TaskItem,
    updates: TaskUpdates
): Promise<boolean> {
    const previous = snapshotTask(task);
    const wasTimed = isTimedTask(task);
    const success = await rawUpdateTaskInFile(app, task, updates);
    if (success) {
        // This one task only, in the background; the Sync button remains the full vault ↔ calendar reconciliation
        const plugin = getPlannerPlugin(app);
        if (plugin) syncEditedTaskToGCal(plugin, task, wasTimed);
        showTaskUndoNotice(app, task, previous);
    }
    return success;
}

async function createNewTaskInFile(
    app: App,
    filePath: string,
    text: string,
    date: string | null,
    startTime: string | null,
    endTime: string | null,
    statusChar: string = ' ',
    priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest' = 'normal',
    gcalEventId: string | null = null
): Promise<void> {
    const task = await rawCreateNewTaskInFile(app, filePath, text, date, startTime, endTime, statusChar, priority, gcalEventId);
    const plugin = getPlannerPlugin(app);
    if (task && plugin) syncEditedTaskToGCal(plugin, task, false);
}

interface FilterRule {
    kind?: 'rule';
    id?: string;
    type: 'folder' | 'file' | 'tag' | 'status' | 'priority' | 'text' | 'itemType' | 'date';
    operator: 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'isHigher' | 'isLower' | 'isBefore' | 'isAfter' | 'isEmpty' | 'isNotEmpty';
    value: string;
}

interface FilterGroup {
    kind?: 'group';
    id?: string;
    mode: 'all' | 'any' | 'none';
    rules?: FilterRule[];
    children?: (FilterRule | FilterGroup)[];
}

const randomFilterId = () => Math.random().toString(36).substring(2, 9);

/** Chip / editor vocabulary for the inline filter bar (the stored rule keeps its type / operator / value) */
const FILTER_TYPES: Array<{ type: FilterRule['type']; label: string; icons: string[] }> = [
    { type: 'folder', label: 'Folder', icons: ['folder'] },
    { type: 'file', label: 'File', icons: ['file-text'] },
    { type: 'tag', label: 'Tag', icons: ['hash'] },
    { type: 'status', label: 'Status', icons: ['circle-check', 'check-circle', 'check'] },
    { type: 'priority', label: 'Priority', icons: ['flag'] },
    { type: 'date', label: 'Date', icons: ['calendar'] },
    { type: 'text', label: 'Text', icons: ['type', 'text'] },
    { type: 'itemType', label: 'Item type', icons: ['layers'] }
];

const FILTER_OP_LABEL: Record<FilterRule['operator'], string> = {
    contains: 'contains', notContains: 'does not contain', equals: 'is', notEquals: 'is not',
    startsWith: 'starts with', endsWith: 'ends with', isHigher: 'above', isLower: 'below',
    isBefore: 'before', isAfter: 'after', isEmpty: 'is empty', isNotEmpty: 'is set'
};

/** One-line chip text for a rule, e.g. "Folder in Work", "Tag contains #urgent", "Date before today" */
function describeFilterRule(rule: FilterRule): string {
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
function newFilterRule(type: FilterRule['type']): FilterRule {
    const defaults: Partial<Record<FilterRule['type'], [FilterRule['operator'], string]>> = {
        status: ['equals', 'todo'], priority: ['equals', 'normal'], itemType: ['equals', 'task'], date: ['equals', 'today']
    };
    const [operator, value] = defaults[type] ?? ['contains', ''];
    return { kind: 'rule', id: randomFilterId(), type, operator, value };
}

function parseFilterGroup(obj: any, isRoot = true): FilterGroup {
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

function isFilterGroup(node: FilterRule | FilterGroup): node is FilterGroup {
    const n = node as FilterGroup;
    return n.kind === 'group' || (n.children !== undefined && n.rules === undefined);
}

function serializeFilterNode(node: FilterRule | FilterGroup, indent: string): string[] {
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

function debounce(func: Function, wait: number) {
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

function matchFilterRule(task: TaskItem, rule: FilterRule): boolean {
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
        const moment = (window as any).moment;
        
        if (op === 'isEmpty') {
            return !itemDate;
        }
        if (op === 'isNotEmpty') {
            return !!itemDate;
        }
        if (!itemDate) {
            return false;
        }

        if (val === 'today' || val === 'yesterday' || val === 'tomorrow' || val === 'this week' || val === 'this month' || val === 'this year') {
            const refDate = moment();
            if (val === 'yesterday') refDate.subtract(1, 'day');
            if (val === 'tomorrow') refDate.add(1, 'day');

            const itemMoment = moment(itemDate, 'YYYY-MM-DD', true);
            if (!itemMoment.isValid()) return false;

            if (val === 'this week') {
                if (op === 'equals') return itemMoment.isSame(moment(), 'week');
                if (op === 'notEquals') return !itemMoment.isSame(moment(), 'week');
                if (op === 'isBefore') return itemDate < moment().startOf('week').format('YYYY-MM-DD');
                if (op === 'isAfter') return itemDate > moment().endOf('week').format('YYYY-MM-DD');
            } else if (val === 'this month') {
                if (op === 'equals') return itemMoment.isSame(moment(), 'month');
                if (op === 'notEquals') return !itemMoment.isSame(moment(), 'month');
                if (op === 'isBefore') return itemDate < moment().startOf('month').format('YYYY-MM-DD');
                if (op === 'isAfter') return itemDate > moment().endOf('month').format('YYYY-MM-DD');
            } else if (val === 'this year') {
                if (op === 'equals') return itemMoment.isSame(moment(), 'year');
                if (op === 'notEquals') return !itemMoment.isSame(moment(), 'year');
                if (op === 'isBefore') return itemDate < moment().startOf('year').format('YYYY-MM-DD');
                if (op === 'isAfter') return itemDate > moment().endOf('year').format('YYYY-MM-DD');
            } else {
                const targetStr = refDate.format('YYYY-MM-DD');
                if (op === 'equals') return itemDate === targetStr;
                if (op === 'notEquals') return itemDate !== targetStr;
                if (op === 'isBefore') return itemDate < targetStr;
                if (op === 'isAfter') return itemDate > targetStr;
            }
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

function matchFilterGroup(task: TaskItem, group: FilterGroup): boolean {
    if (group.children) {
        if (group.children.length === 0) return true;
        const matches = group.children.map(child => {
            if (child.kind === 'group' || (child as any).children !== undefined) {
                return matchFilterGroup(task, child as FilterGroup);
            } else {
                return matchFilterRule(task, child as FilterRule);
            }
        });
        if (group.mode === 'all') return matches.every(m => m === true);
        if (group.mode === 'any') return matches.some(m => m === true);
        if (group.mode === 'none') return !matches.some(m => m === true);
        return true;
    } else if (group.rules) {
        if (group.rules.length === 0) return true;
        if (group.mode === 'all') {
            return group.rules.every(rule => matchFilterRule(task, rule));
        } else if (group.mode === 'any') {
            return group.rules.some(rule => matchFilterRule(task, rule));
        } else if (group.mode === 'none') {
            return !group.rules.some(rule => matchFilterRule(task, rule));
        }
    }
    return true;
}

export function getSpannedDates(e: GCalEvent): string[] {
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

function matchGCalEventRule(event: GCalEvent, rule: FilterRule): boolean {
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
        const moment = (window as any).moment;
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

        if (val === 'today' || val === 'yesterday' || val === 'tomorrow' || val === 'this week' || val === 'this month' || val === 'this year') {
            let startRange: string;
            let endRange: string;

            if (val === 'yesterday') {
                const d = moment().subtract(1, 'day').format('YYYY-MM-DD');
                startRange = d;
                endRange = d;
            } else if (val === 'tomorrow') {
                const d = moment().add(1, 'day').format('YYYY-MM-DD');
                startRange = d;
                endRange = d;
            } else if (val === 'this week') {
                startRange = moment().startOf('week').format('YYYY-MM-DD');
                endRange = moment().endOf('week').format('YYYY-MM-DD');
            } else if (val === 'this month') {
                startRange = moment().startOf('month').format('YYYY-MM-DD');
                endRange = moment().endOf('month').format('YYYY-MM-DD');
            } else if (val === 'this year') {
                startRange = moment().startOf('year').format('YYYY-MM-DD');
                endRange = moment().endOf('year').format('YYYY-MM-DD');
            } else { // today
                const d = moment().format('YYYY-MM-DD');
                startRange = d;
                endRange = d;
            }

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

function matchGCalEventGroup(event: GCalEvent, group: FilterGroup): boolean {
    if (group.children) {
        if (group.children.length === 0) return true;
        const matches = group.children.map(child => {
            if (child.kind === 'group' || (child as any).children !== undefined) {
                return matchGCalEventGroup(event, child as FilterGroup);
            } else {
                return matchGCalEventRule(event, child as FilterRule);
            }
        });
        if (group.mode === 'all') return matches.every(m => m === true);
        if (group.mode === 'any') return matches.some(m => m === true);
        if (group.mode === 'none') return !matches.some(m => m === true);
        return true;
    } else if (group.rules) {
        if (group.rules.length === 0) return true;
        if (group.mode === 'all') {
            return group.rules.every(rule => matchGCalEventRule(event, rule));
        } else if (group.mode === 'any') {
            return group.rules.some(rule => matchGCalEventRule(event, rule));
        } else if (group.mode === 'none') {
            return !group.rules.some(rule => matchGCalEventRule(event, rule));
        }
    }
    return true;
}

export abstract class DayPlannerBaseView extends ItemView {
    plugin: DayPlannerPlugin;
    tasks: TaskItem[] = [];
    currentDate: any;
    collapsedColumns: Set<string> = new Set();

    /**
     * Visible range widened to whole months: every tab and every day of a month shares one cached fetch, so moving
     * between days/weeks/tabs is served from cache instead of a new request per view.
     */
    getGCalRange(): { cacheKey: string; timeMin: Date; timeMax: Date } {
        const center = this.currentDate;
        const tabType = this.getViewTabType();
        let start = center.clone(), end = center.clone();
        if (tabType === 'multiDay') {
            end = center.clone().add(this.getNDayCount() - 1, 'days');
        } else if (tabType === 'weekly') {
            start = center.clone().startOf('week');
            end = center.clone().endOf('week');
        } else if (tabType === 'board') {
            start = center.clone().subtract(7, 'days');
            end = center.clone().add(7, 'days');
        }
        return this.getMonthRange(start, end);
    }

    getMonthRange(start: any, end: any): { cacheKey: string; timeMin: Date; timeMax: Date } {
        const from = start.clone().startOf('month');
        const to = end.clone().endOf('month');
        return { cacheKey: `months_${from.format('YYYY-MM')}_${to.format('YYYY-MM')}`, timeMin: from.toDate(), timeMax: to.toDate() };
    }

    getCalendarEvents(): GCalEvent[] {
        let cache = this.plugin.gcalRanges.get(this.getGCalRange().cacheKey)?.events || [];
        const self = this as any;
        if (self.parentNoteType === 'daily' && self.parentNoteDate) {
            const targetDate = self.parentNoteDate;
            cache = cache.filter(e => {
                const spanned = this.getSpannedDatesForEvent(e);
                return spanned.includes(targetDate);
            });
        } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
            const moment = (window as any).moment;
            const startOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week');
            const endOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week');
            cache = cache.filter(e => {
                const spanned = this.getSpannedDatesForEvent(e);
                return spanned.some(dateStr => {
                    const d = moment(dateStr, 'YYYY-MM-DD');
                    return d.isSameOrAfter(startOfWeek, 'day') && d.isSameOrBefore(endOfWeek, 'day');
                });
            });
        }
        const filters = (this as any).filters;
        if (filters) {
            if (filters.children && filters.children.length > 0) {
                return cache.filter(e => matchGCalEventGroup(e, filters));
            } else if (filters.rules && filters.rules.length > 0) {
                return cache.filter(e => matchGCalEventGroup(e, parseFilterGroup(filters)));
            }
        }
        return cache;
    }

    /** Initial timeline scroll: the current time when today is visible, otherwise the earliest timed task/event. */
    getAutoScrollY(dateStrs: string[], startHour: number, hourHeight: number): number {
        const moment = (window as any).moment;
        const toMin = (t: string | null | undefined) => {
            if (!t) return NaN;
            const [h, m] = t.split(':').map(Number);
            return h * 60 + m;
        };
        let targetMin = NaN;
        if (dateStrs.includes(moment().format('YYYY-MM-DD'))) {
            const now = moment();
            targetMin = now.hour() * 60 + now.minute();
        } else {
            const starts = [
                ...this.tasks.filter(t => t.date && dateStrs.includes(t.date)).map(t => toMin(t.startTime)),
                ...(this.plugin.settings.enableGoogleCalendar ? dateStrs.flatMap(d => this.getCalendarEventsForDate(d)) : []).map(e => toMin(e.startTimeStr))
            ].filter(m => !isNaN(m));
            if (starts.length > 0) targetMin = Math.min(...starts);
        }
        if (isNaN(targetMin)) return 0;
        // Keep one hour of context above the target
        return Math.max(0, (targetMin / 60 - startHour - 1) * hourHeight);
    }

    getSpannedDatesForEvent(e: GCalEvent): string[] {
        return getSpannedDates(e);
    }

    getCalendarEventsForDate(dateStr: string): GCalEvent[] {
        const events: GCalEvent[] = [];
        const moment = (window as any).moment;
        
        this.getCalendarEvents().forEach(e => {
            const spanned = this.getSpannedDatesForEvent(e);
            if (spanned.includes(dateStr)) {
                let effStartTimeStr = e.startTimeStr;
                let effEndTimeStr = e.endTimeStr;
                
                if (!e.isAllDay) {
                    const startMom = moment(e.start).startOf('day');
                    const endMom = moment(e.end).startOf('day');
                    const targetMom = moment(dateStr, 'YYYY-MM-DD').startOf('day');
                    const isStartDay = targetMom.isSame(startMom, 'day');
                    const isEndDay = targetMom.isSame(endMom, 'day');
                    
                    if (!isStartDay) effStartTimeStr = '00:00';
                    if (!isEndDay) effEndTimeStr = '24:00';
                }
                
                events.push({
                    ...e,
                    dateStr: dateStr,
                    startTimeStr: effStartTimeStr,
                    endTimeStr: effEndTimeStr
                });
            }
        });
        
        return events;
    }
    
    savedScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }> = {};
    /** View kinds that already played their one-time smooth auto-scroll ('daily', 'weekly:7', 'list', …) */
    autoScrolledViews: Set<string> = new Set();
    /** Set by the Today button: the next render smooth-scrolls the active view to now / today's section */
    scrollToTodayRequested = false;

    /**
     * Scroll policy for timeline and list views:
     * Today button → smooth scroll to target; saved position (tab switch / re-render) → instant restore;
     * first mount of this view kind → smooth scroll once; later unseen dates/months → instant jump (no replayed motion).
     */
    applyAutoScroll(scroller: HTMLElement, scrollKey: string, viewKind: string, target: 'now' | 'today', fallbackTop: () => number = () => 0) {
        this.autoScrolledViews ??= new Set(); // code-block renderers get these methods via the prototype mixin
        const saved = this.savedScrollPositions[scrollKey];
        if (!this.scrollToTodayRequested && saved !== undefined) {
            scroller.scrollTop = saved.scrollTop;
            scroller.scrollLeft = saved.scrollLeft;
            return;
        }
        const smooth = this.scrollToTodayRequested || !this.autoScrolledViews.has(viewKind);
        this.autoScrolledViews.add(viewKind);
        const top = scrollToTarget(scroller, target, smooth ? 'smooth' : 'auto', fallbackTop);
        this.savedScrollPositions[scrollKey] = { scrollTop: top, scrollLeft: saved?.scrollLeft ?? 0 };
    }

    selectedTaskIds: Set<string> = new Set();
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    kanbanViewMode: 'kanban' | 'priority' = 'kanban';

    activeDragClickOffsetMin: number = 0;
    dragPreviewContainer: HTMLDivElement | null = null;
    activePrimaryTaskId: string = '';
    activeDragItems: Array<{
        id: string;
        height: number;
        offsetY: number;
        itemDateStr: string;
        title: string;
        classes: string;
        bgStyle: string;
        borderStyle: string;
        priorityBadge: string;
        previewContainerEl?: HTMLDivElement;
    }> = [];

    /** Last slot the drag preview snapped to, so haptics fire once per slot change */
    lastDragSnapKey = '';
    /** A phone long-press drag owns the current touch (swipe paging stands down) */
    touchDragActive = false;
    /** Desktop pointer drag in progress (see beginPointerDrag): re-targeted after every render, cancelled by Esc */
    activePointerDrag: { refresh(): void; cancel(): void } | null = null;
    /** Phone Board: the single column shown per board mode */
    phoneBoardColumn: Record<'kanban' | 'priority', string> = { kanban: 'today', priority: 'highest' };
    /** Column ids of the last compact Board render, in display order (swipe / j-k step through these) */
    phoneBoardColumnIds: string[] = [];
    boardSwitcherScroll: { tabScrollLeft?: number } = {};

    /** Compact shell (bottom tabs, date strip, swipes, long-press drag): the combined view on phones and the sidebar view. */
    useCompactLayout(): boolean {
        return false;
    }

    /** Days shown by the N-day tab: fixed at 2 in the phone layout, otherwise the setting (2–14). */
    getNDayCount(): number {
        return this.useCompactLayout() ? 2 : Math.max(2, Math.min(14, this.plugin.settings.nDayViewDays || 4));
    }

    /** Opens one day picked from a calendar cell. Desktop: its daily note; the phone shell shows it in the Daily tab instead. */
    async focusDay(dateStr: string) {
        await this.handleDateClick(dateStr);
    }

    /**
     * Minutes at `y` px below the top of a timeline column, snapped to 15 minutes. A new block (drawer / all-day task,
     * inline create) is clamped to the visible hours; moving an existing item (`wholeDay`) only to the day itself, so
     * one that starts before the first visible hour is not pushed down the moment it is picked up.
     */
    snapTimelineMinutes(y: number, wholeDay = false): number {
        const ratio = this.getHourHeight() / 60;
        const startHour = this.plugin.settings.timelineStartHour ?? 0;
        const endHour = this.plugin.settings.timelineEndHour ?? 24;
        const snapped = Math.round((y / ratio) / 15) * 15 + startHour * 60;
        return wholeDay
            ? Math.min(Math.max(snapped, 0), 24 * 60 - 15)
            : Math.min(Math.max(snapped, startHour * 60), endHour * 60 - 30);
    }

    /**
     * Pointer distance below a timeline item's true start line, from its data-start-min (set at render) rather than
     * the card's visible top: a card that starts before the first visible hour is drawn clipped at that hour, and
     * measuring from there shifted the item on pick-up. Falls back to the card's layout top.
     */
    timelineGrabOffset(card: HTMLElement, clientY: number): number {
        const col = card.offsetParent as HTMLElement | null;
        const startMin = Number(card.dataset.startMin);
        if (!col || card.dataset.startMin === undefined || !Number.isFinite(startMin)) return grabOffsetIn(card, clientY);
        const ratio = this.getHourHeight() / 60;
        const startLine = col.getBoundingClientRect().top + col.clientTop + (startMin - (this.plugin.settings.timelineStartHour ?? 0) * 60) * ratio;
        return clientY - startLine;
    }

    /** `e` is null for touch drags (no native drag image to hide). */
    initDragPreview(e: DragEvent | null, primaryTaskId: string, clickOffsetMin: number, parentElement: HTMLElement) {
        if (e && !e.dataTransfer) return;

        // Set transparent drag image to hide native ghost preview
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e?.dataTransfer?.setDragImage(img, 0, 0);

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60;

        let primaryStartMin = 0;
        let primaryDateStr = '';

        const primaryTask = this.tasks.find(t => t.id === primaryTaskId);
        if (primaryTask && primaryTask.startTime) {
            const [sh, sm] = primaryTask.startTime.split(':').map(Number);
            primaryStartMin = sh * 60 + sm;
            primaryDateStr = primaryTask.date || '';
        } else {
            const primaryGCal = this.plugin.gcalCache.find(ev => ev.id === primaryTaskId);
            if (primaryGCal && primaryGCal.startTimeStr) {
                const [sh, sm] = primaryGCal.startTimeStr.split(':').map(Number);
                primaryStartMin = sh * 60 + sm;
                primaryDateStr = primaryGCal.dateStr || '';
            }
        }

        this.clearDragPreview(parentElement);
        this.activePrimaryTaskId = primaryTaskId;
        this.activeDragItems = [];
        this.lastDragSnapKey = '';
        triggerHaptic('light'); // drag start

        const rootSearchContainer = this.containerEl || parentElement;

        this.selectedTaskIds.forEach(id => {
            let startMin = 0;
            // Untimed items (drawer tasks) preview the block they will get on drop
            let durationMin = this.plugin.settings.defaultTaskDuration || 60;
            let itemDateStr = primaryDateStr;
            let title = '';
            let priorityBadge = '';

            const task = this.tasks.find(t => t.id === id);
            if (isLockedTask(task)) return; // done / cancelled tasks never move (see moveSelectedTimelineItems)
            if (task) {
                if (task.startTime && task.endTime) {
                    const [sh, sm] = task.startTime.split(':').map(Number);
                    const [eh, em] = task.endTime.split(':').map(Number);
                    startMin = sh * 60 + sm;
                    durationMin = Math.max(15, (eh * 60 + em) - startMin);
                }
                if (task.date) itemDateStr = task.date;
                title = cleanTaskTextForDisplay(task.text);
                if (task.priority && task.priority !== 'normal') {
                    priorityBadge = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[task.priority] || '';
                }
            } else {
                const gcal = this.plugin.gcalCache.find(ev => ev.id === id);
                if (gcal) {
                    if (gcal.startTimeStr && gcal.endTimeStr) {
                        const [sh, sm] = gcal.startTimeStr.split(':').map(Number);
                        const [eh, em] = gcal.endTimeStr.split(':').map(Number);
                        startMin = sh * 60 + sm;
                        durationMin = Math.max(15, (eh * 60 + em) - startMin);
                    }
                    if (gcal.dateStr) itemDateStr = gcal.dateStr;
                    title = gcal.summary || 'Google Event';
                }
            }

            // The visible card only: a cached pane's twin would be dimmed instead, and measuring it forces that hidden pane's layout
            const originalEl = Array.from(rootSearchContainer.querySelectorAll<HTMLElement>(`[data-task-id="${id}"]`))
                .find(el => !el.closest('.is-hidden'));

            // The rendered card's own range (data-start-min / data-end-min) is the item's real duration on that day, also
            // for multi-day events; its offsetHeight is not: cards are clipped to the visible hours
            if (originalEl?.dataset.startMin !== undefined && originalEl.dataset.endMin !== undefined) {
                durationMin = Math.max(15, Number(originalEl.dataset.endMin) - Number(originalEl.dataset.startMin));
            }

            const deltaMin = startMin - primaryStartMin;
            const offsetY = deltaMin * ratio;

            const cardHeight = Math.max(15, Math.round(durationMin * ratio)); // full duration, never the clipped height
            let cardClasses = 'dp-timeline-event selected';
            let bgStyle = '';
            let borderStyle = '';

            if (originalEl) {
                cardClasses = originalEl.className;
                bgStyle = originalEl.style.backgroundImage || ''; // GCal tint is painted as a gradient layer
                borderStyle = originalEl.style.border || '';
                const titleEl = originalEl.querySelector('span.dp-task-text') || originalEl.querySelector('span');
                if (titleEl && titleEl.textContent) title = titleEl.textContent;
                const priorityEl = originalEl.querySelector('.dp-badge-priority');
                if (priorityEl && priorityEl.textContent) priorityBadge = priorityEl.textContent;

                originalEl.style.opacity = '0.35';
            }

            this.activeDragItems.push({
                id: id,
                height: cardHeight,
                offsetY: offsetY,
                itemDateStr: itemDateStr,
                title: title,
                classes: cardClasses,
                bgStyle: bgStyle,
                borderStyle: borderStyle,
                priorityBadge: priorityBadge
            });
        });
    }

    /** `wholeDay`: an existing item is being moved (see snapTimelineMinutes); the drop must use the same value */
    updateDragPreview(e: { clientY: number }, currentColumn: HTMLElement, clickOffsetMin: number, wholeDay = false) {
        if (!this.activeDragItems || this.activeDragItems.length === 0) return;

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60;
        const startHour = this.plugin.settings.timelineStartHour ?? 0;

        const rect = currentColumn.getBoundingClientRect();
        // Top = the snapped grab point minus how far below the item's start it was grabbed: no jump on pick-up
        const snappedMinutes = this.snapTimelineMinutes(e.clientY - rect.top - clickOffsetMin, wholeDay);

        const primarySnappedY = (snappedMinutes - (startHour * 60)) * ratio;

        const currentDateStr = currentColumn.getAttribute('data-date') || '';
        // One tick per 15-minute slot (or day column) crossed, not per dragover event
        const snapKey = `${currentDateStr}@${snappedMinutes}`;
        if (snapKey !== this.lastDragSnapKey) {
            if (this.lastDragSnapKey) triggerHaptic('light');
            this.lastDragSnapKey = snapKey;
        }
        const primaryItem = this.activeDragItems.find(it => it.id === this.activePrimaryTaskId) || this.activeDragItems[0];
        const primaryDateStr = primaryItem ? (primaryItem.itemDateStr || currentDateStr) : currentDateStr;

        const moment = (window as any).moment;
        const primaryMom = moment(primaryDateStr, 'YYYY-MM-DD');
        const targetMom = moment(currentDateStr, 'YYYY-MM-DD');
        const dayDelta = (targetMom.isValid() && primaryMom.isValid()) ? targetMom.diff(primaryMom, 'days') : 0;

        const daysWrapper = currentColumn.closest('.dp-weekly-days-wrapper') || 
                           (this.containerEl ? this.containerEl.querySelector('.dp-weekly-days-wrapper') : null);

        this.activeDragItems.forEach(item => {
            let targetCol: HTMLElement = currentColumn;
            if (daysWrapper && item.itemDateStr && primaryMom.isValid() && targetMom.isValid()) {
                const itemTargetDateStr = moment(item.itemDateStr, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                const foundCol = daysWrapper.querySelector(`[data-date="${itemTargetDateStr}"]`) as HTMLElement;
                if (foundCol) {
                    targetCol = foundCol;
                }
            }

            let cardContainer = item.previewContainerEl;
            if (!cardContainer || !cardContainer.parentElement) {
                cardContainer = document.createElement('div');
                cardContainer.addClass('dp-drag-preview'); // sized to the hovered column (styles.ts)
                
                // Same classes as the card (look 1:1); .dp-drag-preview strips the .selected scale (styles.ts)
                const previewCard = cardContainer.createDiv({ cls: item.classes });
                previewCard.style.cssText = `
                    position: absolute !important;
                    top: 0px !important;
                    height: ${item.height}px !important;
                    width: 100% !important;
                    left: 0 !important;
                    box-sizing: border-box !important;
                    opacity: 0.9 !important;
                    border: 2px dashed var(--interactive-accent) !important;
                `;
                if (item.bgStyle) previewCard.style.setProperty('background-image', item.bgStyle, 'important');

                const mainRow = previewCard.createDiv();
                mainRow.style.cssText = 'display: flex; align-items: center; width: 100%; height: 100%; gap: 6px; overflow: hidden; min-width: 0; padding: 2px 4px;';
                // The primary card reads out the slot it would land on
                if (item.id === primaryItem?.id) mainRow.createSpan({ cls: 'dp-drag-time' });
                const titleSpan = mainRow.createEl('span', { text: item.title });
                titleSpan.style.cssText = 'flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85em; font-weight: bold;';
                if (item.priorityBadge) {
                    const badge = mainRow.createSpan({ cls: 'dp-badge dp-badge-priority', text: item.priorityBadge });
                    badge.style.cssText = 'border:none; background:none; margin:0;';
                }

                item.previewContainerEl = cardContainer;
            }

            if (cardContainer.parentElement !== targetCol) {
                targetCol.appendChild(cardContainer);
            }

            const itemTop = primarySnappedY + item.offsetY;
            cardContainer.style.top = `${itemTop}px`;
            cardContainer.style.display = 'block';
            const timeEl = cardContainer.querySelector('.dp-drag-time');
            if (timeEl) timeEl.textContent = `${String(Math.floor(snappedMinutes / 60)).padStart(2, '0')}:${String(snappedMinutes % 60).padStart(2, '0')}`;
        });
    }

    clearDragPreview(parentWrapper: HTMLElement) {
        this.activeDragItems.forEach(item => {
            if (item.previewContainerEl) {
                item.previewContainerEl.remove();
                item.previewContainerEl = undefined;
            }
        });
        this.activeDragItems = [];
        this.activePrimaryTaskId = '';

        if (this.dragPreviewContainer) {
            this.dragPreviewContainer.remove();
            this.dragPreviewContainer = null;
        }

        const rootSearchContainer = this.containerEl || parentWrapper;
        rootSearchContainer.querySelectorAll<HTMLElement>('.dp-timeline-event').forEach((el) => {
            el.style.opacity = '0.98';
        });
    }

    /**
     * Leaf views on desktop drag with pointer events instead of native HTML5 drag-and-drop: Chromium delivers no key
     * events during a native drag, so j/k could not page dates mid-drag. Code blocks (inside the editor, whose own
     * mouse handling must keep working) and mobile (long-press drag) keep their existing paths.
     */
    usesPointerMouseDrag(): boolean {
        return this instanceof DayPlannerBaseView && !Platform.isMobile;
    }

    /** Mouse / pen drag on a timeline card or drawer card: starts after 4px of travel, so clicks still open the editor. */
    registerMouseDrag(card: HTMLElement, source: PointerDragSource) {
        if (!this.usesPointerMouseDrag()) return;
        card.setAttribute('draggable', 'false'); // the pointer engine replaces native drag-and-drop here
        card.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.pointerType === 'touch' || e.button !== 0 || this.activePointerDrag) return;
            if ((e.target as HTMLElement).closest('.dp-custom-cb, .dp-task-link-btn, .dp-resize-handle, .dp-drawer-card-actions')) return;
            const doc = card.ownerDocument;
            const { pointerId, clientX: startX, clientY: startY } = e;
            const stop = () => {
                doc.removeEventListener('pointermove', onMove);
                doc.removeEventListener('pointerup', stop);
                doc.removeEventListener('pointercancel', stop);
            };
            const onMove = (ev: PointerEvent) => {
                if (ev.pointerId !== pointerId) return;
                if ((ev.buttons & 1) === 0) { stop(); return; } // released outside the window: no pointerup came
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
                stop();
                this.beginPointerDrag(card, source, startY, ev);
            };
            doc.addEventListener('pointermove', onMove);
            doc.addEventListener('pointerup', stop);
            doc.addEventListener('pointercancel', stop);
        });
    }

    /**
     * One desktop drag session. Listens on the document (the source card may be re-rendered away mid-drag), hit-tests
     * the pointer each frame, shows the 15-minute snap preview over timeline columns, a dashed outline on monthly day
     * cells (single tasks) and on the side drawer (unschedule), auto-scrolls near the timeline's top / bottom edge,
     * and drops on release. j/k re-render the view under the drag; render() calls refresh() so it re-targets.
     */
    private beginPointerDrag(card: HTMLElement, source: PointerDragSource, startY: number, ev: PointerEvent) {
        const doc = card.ownerDocument;
        const win = doc.defaultView ?? window;
        const pointerId = ev.pointerId;
        let x = ev.clientX;
        let y = ev.clientY;
        let grabOffset: number;
        let previewRoot: HTMLElement;

        if (source.kind === 'timeline') {
            if (!this.selectedTaskIds.has(source.refId)) {
                this.selectedTaskIds.clear();
                this.selectedTaskIds.add(source.refId);
                source.previewRoot.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                card.addClass('selected');
            }
            // Done / cancelled tasks swept into a marquee selection ride along nowhere: drop them from this drag
            this.tasks.forEach(t => { if (isLockedTask(t) && this.selectedTaskIds.has(t.id)) this.selectedTaskIds.delete(t.id); });
            grabOffset = this.timelineGrabOffset(card, startY); // from the item's true start line, scale-free
            previewRoot = source.previewRoot;
            this.initDragPreview(null, source.refId, grabOffset, previewRoot);
        } else {
            this.selectedTaskIds.clear();
            this.selectedTaskIds.add(source.task.id);
            grabOffset = 10; // the new block's top sits just above the pointer
            previewRoot = this.containerEl;
            this.initDragPreview(null, source.task.id, grabOffset, previewRoot);
            card.addClass('is-dragging');
        }
        // Floating title chip wherever no snap preview is drawn (over the drawer, a day cell, or nothing)
        const ghostText = this.selectedTaskIds.size > 1 ? `${this.selectedTaskIds.size} items` : (this.activeDragItems[0]?.title ?? '');
        const ghost = doc.body.createDiv({ cls: 'dp-drag-ghost', text: ghostText });
        this.activeDragClickOffsetMin = grabOffset;
        doc.body.addClass('dp-pointer-dragging');

        // Undated drawer cards have no date to clear; everything else can be dropped back into the drawer
        const canUnschedule = source.kind === 'timeline' || source.origin !== 'undated';
        // Overdue cards start inside the drawer: only the Undated section clears their date, so a short slip
        // inside the drawer never unschedules anything. Drags from the timeline / calendar may land anywhere on it.
        const undatedOnly = source.kind === 'task' && source.origin === 'overdue';
        let target: PointerDropTarget | null = null;
        let scroller: HTMLElement | null = null;
        let frame = 0;
        let scrollFrame = 0;

        const locate = (): PointerDropTarget | null => {
            const hit = doc.elementFromPoint(x, y) as HTMLElement | null;
            if (!hit || !this.containerEl.contains(hit)) return null;
            const drawer = hit.closest<HTMLElement>('.dp-side-drawer.is-open');
            if (drawer) {
                if (!canUnschedule) return null;
                const undatedSection = drawer.querySelector<HTMLElement>('.dp-drawer-section[data-section="undated"]');
                if (undatedOnly && !(undatedSection && undatedSection.contains(hit))) return null;
                // The Undated section lights up as the destination, wherever over the drawer the task is held
                return { kind: 'drawer', el: undatedSection ?? drawer, dateStr: '' };
            }
            const dayHeader = source.kind === 'task' ? hit.closest<HTMLElement>('.dp-grid-header[data-date]') : null;
            if (dayHeader) return { kind: 'fit', el: dayHeader, dateStr: dayHeader.dataset.date! };
            const col = hit.closest<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events');
            // The Daily column carries no data-date (see renderDailyTimeline): it always shows the current date
            if (col) return { kind: 'timeline', el: col, dateStr: col.dataset.date || this.currentDate.format('YYYY-MM-DD') };
            const cell = source.kind === 'task' ? hit.closest<HTMLElement>('.dp-grid-cell[data-date]') : null;
            return cell ? { kind: 'day', el: cell, dateStr: cell.dataset.date! } : null;
        };
        const update = () => {
            frame = 0;
            const next = locate();
            if (target && target.kind !== 'timeline' && target.el !== next?.el) target.el.removeClass('dp-drop-target');
            target = next;
            if (next?.kind === 'timeline') {
                scroller = next.el.closest<HTMLElement>('.dp-content');
                this.updateDragPreview({ clientY: y }, next.el, grabOffset, source.kind === 'timeline');
            } else {
                this.activeDragItems.forEach(item => { if (item.previewContainerEl) item.previewContainerEl.style.display = 'none'; });
                next?.el.addClass('dp-drop-target');
            }
            ghost.toggleClass('is-over-timeline', next?.kind === 'timeline'); // the snap preview takes over there
            if (next?.kind !== 'timeline') placeGhost();
        };
        // The chip follows the cursor but stays inside the box it is over: the open drawer (it used to hang past the
        // drawer's / window's right edge near it) or else the view; narrower boxes also narrow the chip
        const placeGhost = () => {
            const drawerRect = this.containerEl.querySelector<HTMLElement>('.dp-side-drawer.is-open')?.getBoundingClientRect();
            const overDrawer = !!drawerRect && x >= drawerRect.left && x <= drawerRect.right && y >= drawerRect.top && y <= drawerRect.bottom;
            // Over the unschedule drop zone the chip stays inside its dashed outline, not just inside the drawer
            const box = target?.kind === 'drawer' ? target.el.getBoundingClientRect()
                : overDrawer ? drawerRect! : this.containerEl.getBoundingClientRect();
            ghost.style.maxWidth = `${Math.max(48, Math.min(220, box.width - 8))}px`;
            const gx = Math.max(box.left + 4, Math.min(x + 14, box.right - ghost.offsetWidth - 4));
            const gy = Math.max(box.top + 4, Math.min(y + 14, box.bottom - ghost.offsetHeight - 4));
            ghost.style.transform = `translate(${gx}px, ${gy}px)`;
        };
        const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };

        const EDGE = 48; // px band at the timeline scroller's top / bottom that auto-scrolls
        const autoScroll = () => {
            scrollFrame = win.requestAnimationFrame(autoScroll);
            if (!scroller?.isConnected) return;
            const r = scroller.getBoundingClientRect();
            if (x < r.left || x > r.right || y < r.top - EDGE || y > r.bottom + EDGE) return;
            const step = y < r.top + EDGE ? -10 : y > r.bottom - EDGE ? 10 : 0;
            if (step) {
                scroller.scrollTop += step;
                schedule();
            }
        };

        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            if ((e.buttons & 1) === 0) { void finish(false); return; } // released outside the window: cancel, don't drop
            x = e.clientX;
            y = e.clientY;
            schedule();
        };
        const onUp = (e: PointerEvent) => { if (e.pointerId === pointerId) void finish(true); };
        const onCancel = (e: PointerEvent) => { if (e.pointerId === pointerId) void finish(false); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            void finish(false);
        };
        const teardown = () => {
            this.activePointerDrag = null;
            doc.removeEventListener('pointermove', onMove);
            doc.removeEventListener('pointerup', onUp);
            doc.removeEventListener('pointercancel', onCancel);
            doc.removeEventListener('keydown', onKey, true);
            doc.removeEventListener('scroll', schedule, true);
            if (frame) win.cancelAnimationFrame(frame);
            win.cancelAnimationFrame(scrollFrame);
            doc.body.removeClass('dp-pointer-dragging');
            ghost.remove();
            card.removeClass('is-dragging');
        };
        const finish = async (drop: boolean) => {
            if (frame) {
                win.cancelAnimationFrame(frame);
                update(); // land where the pointer is now, not where the last frame left it
            }
            const landing = drop ? target : null;
            teardown();
            (target as PointerDropTarget | null)?.el.removeClass('dp-drop-target');
            this.clearDragPreview(previewRoot);
            // The release would click whatever it ends on (a card opens its editor, a column clears the selection)
            const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
            doc.addEventListener('click', swallow, { capture: true, once: true });
            win.setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);

            // Tasks being dragged, resolved before the selection is cleared (a timeline drag may carry GCal events too)
            const draggedTasks = source.kind === 'task'
                ? [source.task]
                : this.tasks.filter(t => this.selectedTaskIds.has(t.id));
            if (source.kind === 'task') this.selectedTaskIds.delete(source.task.id);
            if (!landing) return;

            if (landing.kind === 'drawer') {
                if (source.kind === 'timeline') {
                    if (this.selectedTaskIds.size > draggedTasks.length) {
                        new Notice('Google Calendar events stay on the calendar; only tasks return to Undated.');
                    }
                    this.selectedTaskIds.clear();
                }
                await this.unscheduleTasks(draggedTasks);
                return;
            }
            if (landing.kind === 'fit') {
                if (source.kind === 'task') await this.fitTaskIn(source.task, [landing.dateStr]);
                return;
            }
            const minutes = landing.kind === 'timeline'
                ? this.snapTimelineMinutes(y - landing.el.getBoundingClientRect().top - grabOffset, source.kind === 'timeline')
                : null;
            if (source.kind === 'timeline') {
                if (minutes !== null) await this.moveSelectedTimelineItems(source.refId, source.isGCal, minutes, landing.dateStr);
            } else {
                await this.scheduleTask(source.task, landing.dateStr, minutes);
            }
        };

        doc.addEventListener('pointermove', onMove);
        doc.addEventListener('pointerup', onUp);
        doc.addEventListener('pointercancel', onCancel);
        doc.addEventListener('keydown', onKey, true);
        doc.addEventListener('scroll', schedule, true); // wheel-scrolling under a still pointer moves the target slot
        this.activePointerDrag = {
            refresh: () => { scroller = null; schedule(); },
            cancel: () => void finish(false)
        };
        update();
        scrollFrame = win.requestAnimationFrame(autoScroll);
    }

    /**
     * Drop of a single task: a timeline slot gives it that date and a block of settings.defaultTaskDuration minutes
     * (untimed tasks from the drawer or an all-day row); a calendar day changes only the date (any time is kept).
     * The block stays on its day: it ends at 23:59 at the latest (no wrap past midnight).
     */
    async scheduleTask(task: TaskItem, dateStr: string, startMin: number | null) {
        if (startMin === null && task.date === dateStr) return; // dropped back on its own day
        const updates: Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>> = { date: dateStr };
        if (startMin !== null) {
            const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
            const endMin = Math.min(startMin + (this.plugin.settings.defaultTaskDuration || 60), 24 * 60 - 1);
            updates.startTime = toTime(startMin);
            updates.endTime = toTime(endMin);
        }
        // Undo notice + background calendar sync come with the view-level updateTaskInFile
        if (await updateTaskInFile(this.app, task, updates)) await this.refreshTasks();
    }

    /**
     * Drop into the side drawer: strips the time and both the scheduled and the due date, so the task is Undated again
     * (its date falls back scheduled -> due -> note name). A task in a dated note (a daily note) inherits the note's
     * date from the file name, which no edit to the line can remove: those are left as they are, with a notice.
     */
    async unscheduleTasks(tasks: TaskItem[]) {
        const movable = tasks.filter(t => !fileNameTaskDate(t.filePath));
        const pinned = tasks.length - movable.length;
        const changed = await updateTasksInFile(this.app, movable,
            { date: null, scheduledDate: null, dueDate: null, startTime: null, endTime: null },
            n => `Moved ${n} tasks to Undated.`);
        if (pinned > 0) {
            new Notice(`${pinned} task(s) kept their date: they live in a dated note (e.g. a daily note), whose file name sets it.`);
        }
        if (changed > 0) await this.refreshTasks();
        else this.render(); // nothing moved: still drop the selection highlight
    }

    /** Overdue triage: give tasks a new date (their times are kept). One Undo for the whole batch. */
    async moveTasksToDate(tasks: TaskItem[], dateStr: string) {
        const label = (window as any).moment(dateStr, 'YYYY-MM-DD').format('ddd, MMM D');
        if (await updateTasksInFile(this.app, tasks, { date: dateStr }, n => `Moved ${n} tasks to ${label}.`)) await this.refreshTasks();
    }

    /**
     * First free start (minutes) for a block of settings.defaultTaskDuration on `dateStr`, inside the timeline's
     * working hours (start / end hour settings) and, for today, not before now. Timed tasks (except cancelled ones
     * and `exclude`) and timed Google Calendar events count as busy; all-day items do not. Null when nothing fits.
     */
    findFreeSlot(dateStr: string, exclude?: TaskItem): number | null {
        const settings = this.plugin.settings;
        const duration = settings.defaultTaskDuration || 60;
        const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const busy: Array<[number, number]> = [];
        this.tasks.forEach(t => {
            if (t === exclude || t.date !== dateStr || !t.startTime || !t.endTime || t.statusChar === '-') return;
            busy.push([toMin(t.startTime), toMin(t.endTime)]);
        });
        if (settings.enableGoogleCalendar) {
            this.getCalendarEventsForDate(dateStr).forEach(e => {
                if (!e.isAllDay && e.startTimeStr && e.endTimeStr) busy.push([toMin(e.startTimeStr), toMin(e.endTimeStr)]);
            });
        }
        busy.sort((a, b) => a[0] - b[0]);

        const now = (window as any).moment();
        const todayStr = now.format('YYYY-MM-DD');
        if (dateStr < todayStr) return null; // no free time left in the past
        const align = (m: number) => Math.ceil(m / 15) * 15;
        let cursor = (settings.timelineStartHour ?? 0) * 60;
        if (dateStr === todayStr) cursor = Math.max(cursor, now.hour() * 60 + now.minute());
        cursor = align(cursor);
        for (const [start, end] of busy) {
            if (end <= cursor) continue;
            if (start - cursor >= duration) break; // the gap before this item fits
            cursor = align(Math.max(cursor, end));
        }
        const dayEnd = Math.min((settings.timelineEndHour ?? 24) * 60, 24 * 60 - 1);
        return cursor + duration <= dayEnd ? cursor : null;
    }

    /** "Fit it in": schedule `task` into the first free slot of the first day in `dates` that has one */
    async fitTaskIn(task: TaskItem, dates: string[]) {
        const title = cleanTaskTextForDisplay(task.text);
        for (const dateStr of dates) {
            const start = this.findFreeSlot(dateStr, task);
            if (start === null) continue;
            await this.scheduleTask(task, dateStr, start);
            const when = (window as any).moment(dateStr, 'YYYY-MM-DD').add(start, 'minutes').format('ddd, MMM D [at] HH:mm');
            new Notice(`Fitted "${title}" into ${when}.`);
            return;
        }
        const duration = this.plugin.settings.defaultTaskDuration || 60;
        new Notice(`No free ${duration}-minute slot within working hours ${dates.length > 1 ? `in the next ${dates.length} days` : 'on that day'}.`);
    }

    // ---- Inline task creation (double-click an empty timeline slot; leaf views on desktop) ----
    /** The open inline editor: kept across renders (data refreshes rebuild the columns) and re-mounted with its draft */
    inlineCreate: { dateStr: string; minutes: number; draft: string } | null = null;
    private inlineCreateTeardown: (() => void) | null = null;

    openInlineCreate(e: MouseEvent) {
        if (!this.usesPointerMouseDrag()) return;
        const target = e.target as HTMLElement;
        if (target.closest('.dp-timeline-event, .dp-resize-handle')) return;
        const col = target.closest<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events');
        if (!col) return;
        e.preventDefault();
        const ratio = this.getHourHeight() / 60;
        // The 15-minute slot under the pointer (half a slot up, then the usual nearest-slot snap)
        const minutes = this.snapTimelineMinutes(e.clientY - col.getBoundingClientRect().top - 7.5 * ratio);
        this.inlineCreate = { dateStr: col.dataset.date || this.currentDate.format('YYYY-MM-DD'), minutes, draft: '' };
        this.mountInlineCreate();
    }

    /** (Re)builds the editor card in the visible column of its day; drops the state when that day is off screen. */
    mountInlineCreate() {
        this.inlineCreateTeardown?.();
        this.inlineCreateTeardown = null;
        const state = this.inlineCreate;
        if (!state) return;
        const col = Array.from(this.containerEl.querySelectorAll<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events'))
            .find(c => !c.closest('.is-hidden') && (c.dataset.date || this.currentDate.format('YYYY-MM-DD')) === state.dateStr);
        if (!col) {
            this.inlineCreate = null;
            return;
        }

        const settings = this.plugin.settings;
        const ratio = this.getHourHeight() / 60;
        const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
        const startTime = toTime(state.minutes);
        const endTime = toTime(Math.min(state.minutes + (settings.defaultTaskDuration || 60), 24 * 60 - 1));

        const card = col.createDiv({ cls: 'dp-timeline-event dp-inline-create' });
        card.style.cssText = `top: ${(state.minutes - (settings.timelineStartHour ?? 0) * 60) * ratio}px; height: ${Math.max(30, (settings.defaultTaskDuration || 60) * ratio)}px; left: 2px; width: calc(100% - 4px);`;
        card.createDiv({ cls: 'dp-inline-create-time', text: `${startTime}–${endTime}` });
        const input = card.createEl('input', { cls: 'dp-inline-create-input', attr: { type: 'text', placeholder: 'New task', 'aria-label': `New task at ${startTime}` } });
        input.value = state.draft;

        const doc = card.ownerDocument;
        const discard = () => {
            this.inlineCreate = null;
            this.inlineCreateTeardown?.();
            this.inlineCreateTeardown = null;
        };
        // Any press outside the editor dismisses it (the marquee's preventDefault means focus may never move)
        const onOutside = (pe: PointerEvent) => { if (!card.contains(pe.target as Node)) discard(); };
        doc.addEventListener('pointerdown', onOutside, true);
        this.inlineCreateTeardown = () => {
            doc.removeEventListener('pointerdown', onOutside, true);
            card.remove();
        };

        card.addEventListener('pointerdown', ev => ev.stopPropagation()); // no marquee or drag from inside the editor
        card.addEventListener('dblclick', ev => ev.stopPropagation());
        input.addEventListener('input', () => { state.draft = input.value; });
        input.addEventListener('keydown', (ke: KeyboardEvent) => {
            if (ke.key !== 'Escape') return;
            ke.preventDefault();
            discard();
        });
        // Enter (IME-safe: a Hangul syllable still composing is committed first, then submitted)
        onEnterSubmit(input, () => {
            const { text, priority } = parseQuickEntry(input.value);
            input.value = ''; // a second Enter from the IME sequence finds nothing to submit
            discard();
            if (!text) return;
            // Into the default task file like every quick entry, dated and timed by the slot (⏳ date, ⏰ start-end)
            const filePath = getDefaultTaskFilePath(settings);
            void (async () => {
                try {
                    await createNewTaskInFile(this.app, filePath, text, state.dateStr, startTime, endTime, ' ', priority);
                } catch (err) {
                    console.error('Day Planner Pro: inline task creation failed', err);
                    new Notice(`⚠️ Could not create the task in "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
                    return;
                }
                await this.refreshTasks();
            })();
        });
        input.addEventListener('blur', () => {
            // Tabbing away discards; a re-render detaches the card instead (it comes back via render → mountInlineCreate)
            window.setTimeout(() => { if (card.isConnected && this.inlineCreate === state && doc.activeElement !== input) discard(); }, 0);
        });
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    /** Same editor the timeline cards open on click */
    openTaskEditor(task: TaskItem) {
        new TaskEditModal(this.app, task, null, async (data) => {
            await updateTaskInFile(this.app, task, {
                text: data.text,
                statusChar: data.statusChar,
                priority: data.priority,
                date: data.date,
                startTime: data.startTime,
                endTime: data.endTime,
                recurrence: data.recurrence,
                dueDate: data.dueDate,
                scheduledDate: data.scheduledDate,
                startDate: data.startDate,
                completionDate: data.completionDate,
                cancelledDate: data.cancelledDate
            });
            await this.refreshTasks();
        }).open();
    }

    constructor(leaf: WorkspaceLeaf, plugin: DayPlannerPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentDate = (window as any).moment();
        if (this.plugin.settings.collapsedColumns) {
            this.collapsedColumns = new Set(this.plugin.settings.collapsedColumns);
        } else {
            this.collapsedColumns = new Set();
        }
    }

    /**
     * Marks the moving scroller with .dp-is-scrolling. Wheel-scrolling slides cards under a stationary cursor, and each
     * hover flip restyles and repaints a card mid-scroll; CSS suspends card hit-testing until the scroll settles.
     * One capture-phase passive listener covers every scroller, including re-rendered ones. Tagging the scroller rather
     * than the root keeps each start/stop restyle off the header and the cached panes (whose kept layout it would dirty).
     */
    registerScrollIdleClass(rootEl: HTMLElement) {
        let idleTimer: number | undefined;
        let scroller: HTMLElement | null = null;
        this.registerDomEvent(rootEl, 'scroll', (e: Event) => {
            if (this.touchDragActive) return; // a long-press drag auto-scrolls; its card must keep receiving pointer events
            if (e.target !== scroller) {
                scroller?.removeClass('dp-is-scrolling');
                scroller = e.target as HTMLElement;
                scroller.addClass('dp-is-scrolling');
            }
            window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(() => {
                scroller?.removeClass('dp-is-scrolling');
                scroller = null;
            }, 150);
        }, { capture: true, passive: true });
    }

    /** Zoom slider popover open (tap toggle); kept on the view so header rebuilds don't close it */
    zoomPopoverOpen = false;
    zoomOutsideBound = false;

    /**
     * Zoom drag: redraws only the timeline content at the new hour height. The header, and with it the slider
     * under the finger, stays mounted (a full render() would rebuild it and end the drag after one step).
     */
    rerenderForZoom(oldHeight: number) {
        const rootEl = this.containerEl.querySelector('.dp-container') as HTMLDivElement | null;
        if (!rootEl) return;
        const newHeight = this.getHourHeight();
        const selector = '.dp-content, .dp-weekly-scroll-wrapper';
        const visible = () => Array.from(rootEl.querySelectorAll<HTMLElement>(selector)).filter(el => !el.closest('.is-hidden'));
        const tops = visible().map(el => el.scrollTop);
        rootEl.style.setProperty('--dp-hour-height', `${newHeight}px`);

        const self = this as any;
        if (self.panes) {
            // Combined / Sidebar: re-render the active pane only; other cached panes become stale
            self.dataVersion++;
            const pane = self.panes.get(self.activeTab);
            if (pane) {
                pane.version = self.dataVersion;
                self.renderPaneContent(pane.el);
            }
        } else {
            // Code block: its content-only path keeps the header and filter panel mounted
            self.contentOnlyRender = true;
            try {
                this.render();
            } finally {
                self.contentOnlyRender = false;
            }
        }
        // Keep the same hour at the top of the viewport while zooming
        const ratio = newHeight / (oldHeight || newHeight);
        visible().forEach((el, i) => {
            if (tops[i] !== undefined) el.scrollTop = tops[i] * ratio;
        });
    }

    getHourHeight(): number {
        if ((this as any).hourHeight !== undefined) {
            return (this as any).hourHeight;
        }
        const settings = this.plugin.settings;
        if (settings.separateViewHeights && this.getViewType() === 'day-planner-pro-daily') {
            return settings.timelineHourHeightDaily || 60;
        }
        return settings.timelineHourHeight || 60;
    }

    async handleDateClick(dateStr: string) {
        await this.openNoteForDate(dateStr, 'daily');
    }

    /** Opens (creating from template if needed) the daily or weekly note for a date (moment or YYYY-MM-DD). */
    async openNoteForDate(date: any, type: 'daily' | 'weekly') {
        await openNoteForDate(this.app, date, type, this.plugin.settings);
    }

    /**
     * One all-day task chip, identical in Daily, Weekly and N-day:
     * status checkbox · priority + title · ↗ jump to source; clicking the chip opens the edit modal.
     */
    renderAllDayTaskChip(task: TaskItem, containerEl: HTMLElement): HTMLElement {
        let cls = 'dp-grid-task-item dp-allday-item';
        if (task.statusChar === 'x') cls += ' completed';
        else if (task.statusChar === '-') cls += ' cancelled';
        const chip = containerEl.createDiv({ cls });

        createCustomCheckbox(chip, task, async (newStatus) => {
            await updateTaskInFile(this.app, task, { statusChar: newStatus });
            await this.refreshTasks();
        });

        const priorityPrefix = task.priority !== 'normal'
            ? { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[task.priority] + ' ' : '';
        chip.createSpan({ cls: 'dp-task-text', text: `${priorityPrefix}${cleanTaskTextForDisplay(task.text)}` });

        const linkBtn = chip.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
        linkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openTaskInEditor(this.app, task);
        });

        chip.addEventListener('click', (e) => {
            if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
            e.stopPropagation();
            new TaskEditModal(this.app, task, null, async (data) => {
                await updateTaskInFile(this.app, task, {
                    text: data.text,
                    statusChar: data.statusChar,
                    priority: data.priority,
                    date: data.date,
                    startTime: data.startTime,
                    endTime: data.endTime,
                    recurrence: data.recurrence,
                    dueDate: data.dueDate,
                    scheduledDate: data.scheduledDate,
                    startDate: data.startDate,
                    completionDate: data.completionDate,
                    cancelledDate: data.cancelledDate
                });
                await this.refreshTasks();
            }).open();
        });
        // Desktop: drag onto a time slot (gets defaultTaskDuration) or back into the side drawer (unschedule)
        if (!isLockedTask(task)) this.registerMouseDrag(chip, { kind: 'task', task, origin: 'allday' });
        return chip;
    }

    /** All-day Google Calendar chip, the event counterpart of renderAllDayTaskChip (same size, calendar colour stripe). */
    renderAllDayEventChip(event: GCalEvent, dateStr: string, containerEl: HTMLElement): HTMLElement {
        const chip = containerEl.createDiv({
            cls: 'dp-grid-task-item dp-gcal-event dp-allday-item',
            text: `🗓️ ${event.summary}${event.location ? ` (📍 ${event.location})` : ''}`
        });
        if (event.color) {
            chip.style.cssText = `background-color: ${event.color}1c !important; border-left: 3px solid ${event.color} !important;`;
        }
        chip.addEventListener('click', () => {
            new GCalEventEditModal(this.app, this.plugin, event, dateStr, async () => {
                await this.refreshTasks(null, true);
            }).open();
        });
        return chip;
    }

    async onOpen() {
        const container = this.contentEl;
        container.empty();

        const rootEl = container.createDiv({ cls: 'dp-container' });
        this.renderRoot(rootEl);
        this.registerScrollIdleClass(rootEl);

        // Never await data here: Obsidian awaits onOpen of every visible leaf (10s cap) before firing onLayoutReady,
        // and the task scan itself waits for onLayoutReady. The shell above is the first paint; tasks fill in after.
        void this.refreshTasks(null, true);

        // 단축키 시스템 등록
        this.keydownHandler = async (e: KeyboardEvent) => {
            const activeEl = document.activeElement;
            if (activeEl && (
                activeEl.tagName === 'INPUT' || 
                activeEl.tagName === 'TEXTAREA' || 
                activeEl.getAttribute('contenteditable') === 'true'
            )) {
                return;
            }

            const activeView = this.app.workspace.getActiveViewOfType(DayPlannerBaseView);
            if (activeView !== this) {
                return;
            }
            // Sync: F5, or Ctrl+R (Windows / Linux) / Cmd+R (Mac), while a Dayloom view is the active one
            const syncKey = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r');
            if (syncKey) {
                e.preventDefault();
                e.stopPropagation();
                if (!e.repeat) void this.runSync();
                return;
            }
            // Plain keys only: Ctrl / Cmd / Alt chords (Cmd+P, Ctrl+J, ...) belong to Obsidian
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            // Escape clears the selection (a running card drag or marquee handles Escape itself, before this)
            if (e.key === 'Escape') {
                if (this.selectedTaskIds.size > 0) {
                    e.preventDefault();
                    this.selectedTaskIds.clear();
                    this.render();
                }
                return;
            }

            const key = e.key.toLowerCase();

            if (key === '?' || key === 'h') {
                e.preventDefault();
                ShortcutHelpModal.toggle(this.app, this.plugin); // a second press closes it instead of stacking another
            } else if (key === 't') {
                e.preventDefault();
                await this.goToToday();
            } else if ((key === 'j' || key === 'k') && this.useCompactLayout() && this.getViewTabType() === 'board') {
                e.preventDefault();
                this.navigateBoardTab(key === 'j' ? 1 : -1);
            } else if (key === 'j' || key === 'k') {
                // Also mid-drag (pointer drags keep key events flowing): render() re-targets the drag afterwards
                e.preventDefault();
                await this.navigateWithSlide(key === 'j' ? 1 : -1);
            } else if (key === 's') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) await this.toggleSideDrawer();
            } else if (key === 'd') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('daily');
                } else {
                    this.plugin.activateView('day-planner-pro-daily');
                }
            } else if (key === 'w') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('weekly');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'weekly');
                }
            } else if (key === 'm') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('monthly');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'monthly');
                }
            } else if (key === 'b') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('board');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'board');
                }
            } else if (key === 'x') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('multiDay');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'multiDay');
                }
            } else if (key === 'l') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('list');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'list');
                }
            }
        };
        document.addEventListener('keydown', this.keydownHandler);
    }

    async onClose() {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
        }
        this.activePointerDrag?.cancel();
        return super.onClose();
    }

    /**
     * [성능 개선 버전] 로컬 파일 점진적 캐싱 업데이트 및 구글 캘린더 읽기 동기화
     */
    async refreshTasks(targetFile?: any, forceFetchGCal: boolean = false, skipIfUnchanged: boolean = false) {
        try {
            const plugin = this.plugin as any;
            
            if (!plugin.tasksCache) {
                // Shared, layout-ready-gated scan: views restored at startup no longer scan during boot
                await plugin.ensureTasksCache();
                plugin.lastScanTime = Date.now();
            }

            if (targetFile instanceof TFile && targetFile.extension === 'md') {
                const lines = isExcludedPath(targetFile.path) ? [] : (await this.app.vault.read(targetFile)).split('\n');
                const fileTasks: TaskItem[] = [];
                for (let i = 0; i < lines.length; i++) {
                    const parsed = parseTaskLine(lines[i], targetFile.path, i, plugin.settings.dailyNotesFormat);
                    if (parsed) {
                        fileTasks.push(parsed);
                    }
                }
                plugin.tasksCache = plugin.tasksCache.filter((t: any) => t.filePath !== targetFile.path).concat(fileTasks);
            } else if (targetFile === 'force') {
                plugin.tasksCache = await scanVaultTasks(this.app);
                plugin.lastScanTime = Date.now();
            }

            this.tasks = plugin.tasksCache;
            const self = this as any;
            if (self.parentNoteType === 'daily' && self.parentNoteDate) {
                const targetDate = self.parentNoteDate;
                this.tasks = this.tasks.filter(t => t.date === targetDate);
            } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
                const moment = (window as any).moment;
                // YYYY-MM-DD compares lexically: no moment parse per vault task on every refresh
                const startOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week').format('YYYY-MM-DD');
                const endOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week').format('YYYY-MM-DD');
                this.tasks = this.tasks.filter(t => !!t.date && t.date >= startOfWeek && t.date <= endOfWeek);
            }
            const filters = (this as any).filters;
            if (filters) {
                if (filters.children && filters.children.length > 0) {
                    this.tasks = this.tasks.filter(task => matchFilterGroup(task, filters));
                } else if (filters.rules && filters.rules.length > 0) {
                    this.tasks = this.tasks.filter(task => matchFilterGroup(task, parseFilterGroup(filters)));
                }
            }

            // Background vault refresh: a note edit re-parses its tasks into equal copies (and a view edit already
            // redrew before its own 'modify' arrives), so skip the full redraw when nothing this view shows changed
            const signature = taskListSignature(this.tasks);
            if (skipIfUnchanged && signature === self.renderedTaskSignature) return;
            self.renderedTaskSignature = signature;

            await this.syncGCalRange(forceFetchGCal);

            this.plugin.updateStatusBar();
            this.render();
        } catch (error) {
            console.error("Day Planner Pro: Error in refreshTasks:", error);
            new Notice("Error refreshing tasks: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * Cache-first GCal loading: never blocks rendering on the network. Cached events (in memory, or restored from disk
     * at startup) paint immediately; a missing, stale or force-refreshed range is fetched in the background and
     * re-rendered only if it changed. The neighbouring months are prefetched so paging stays instant.
     */
    async syncGCalRange(forceFetch: boolean) {
        if (!this.plugin.settings.enableGoogleCalendar ||
            !this.plugin.settings.googleCalendars ||
            this.plugin.settings.googleCalendars.length === 0) return;

        const { cacheKey, timeMin, timeMax } = this.getGCalRange();
        const entry = this.plugin.gcalRanges.get(cacheKey);
        const rerenderOnChange = (changed: boolean) => {
            if (!changed) return;
            const self = this as any;
            if (typeof self.refreshContentOnly === 'function') self.refreshContentOnly();
            else this.render();
        };

        if (forceFetch || !entry || Date.now() - entry.fetchedAt > GCAL_CACHE_TTL_MS) {
            this.plugin.fetchGCalRange(cacheKey, timeMin, timeMax).then(rerenderOnChange);
        }
        const moment = (window as any).moment;
        for (const offset of [-1, 1]) {
            const month = moment(timeMin).add(offset, 'month');
            const neighbour = this.getMonthRange(month, month);
            if (!this.plugin.gcalRanges.has(neighbour.cacheKey)) {
                this.plugin.fetchGCalRange(neighbour.cacheKey, neighbour.timeMin, neighbour.timeMax);
            }
        }
    }

    render() {
        try {
            const contentOnly = !!(this as any).contentOnlyRender;
            if (!contentOnly) document.querySelectorAll('.dp-sugg-container').forEach(el => el.remove());
            const scrollPositions = new Map<string, { scrollTop: number; scrollLeft: number }>();
            const counts = new Map<string, number>();
            // Tab switches restore their own per-pane scroll; hidden (cached) panes never take part in index matching
            const isTabSwitch = !!(this as any).isTabSwitch;
            const isVisible = (el: Element) => !el.closest('.is-hidden');
            if (!isTabSwitch) this.containerEl.querySelectorAll('.dp-content, .dp-weekly-scroll-wrapper, .dp-monthly-scroll-wrapper, .dp-kanban-cards, .dp-kanban-board').forEach((el) => {
                if (!isVisible(el)) return;
                const htmlEl = el as HTMLElement;
                const structuralClasses = Array.from(htmlEl.classList)
                    .filter(c => ['dp-content', 'dp-weekly-scroll-wrapper', 'dp-monthly-scroll-wrapper', 'dp-kanban-cards', 'dp-kanban-board'].includes(c));
                if (structuralClasses.length === 0) return;
                const selector = structuralClasses.map(c => '.' + c).join('');
                const count = counts.get(selector) ?? 0;
                counts.set(selector, count + 1);
                scrollPositions.set(`${selector}_${count}`, {
                    scrollTop: htmlEl.scrollTop,
                    scrollLeft: htmlEl.scrollLeft
                });
            });

            const rootEl = this.containerEl.querySelector('.dp-container');
            if (rootEl) {
                const oldContent = contentOnly ? rootEl.querySelector(':scope > .dp-content') as HTMLElement | null : null;
                if (oldContent) {
                    // Filter-driven update: keep header and filter panel mounted, redraw only the task area
                    (this as any).renderContentArea(rootEl, oldContent);
                } else {
                    this.rebuildRoot(rootEl as HTMLDivElement);
                }
                // Dynamic Spacing 및 노출 시간대 설정값을 CSS 변수에 바인딩
                const hourHeight = this.getHourHeight();
                const startHour = this.plugin.settings.timelineStartHour ?? 0;
                const endHour = this.plugin.settings.timelineEndHour ?? 24;
                const hoursCount = endHour - startHour;
                const rootHtml = rootEl as HTMLElement;
                rootHtml.style.setProperty('--dp-hour-height', `${hourHeight}px`);
                rootHtml.style.setProperty('--dp-start-hour', `${startHour}`);
                rootHtml.style.setProperty('--dp-end-hour', `${endHour}`);
                rootHtml.style.setProperty('--dp-hours-count', `${hoursCount}`);
            }

            scrollPositions.forEach((pos, key) => {
                const lastUnderscore = key.lastIndexOf('_');
                const selector = key.substring(0, lastUnderscore);
                const idx = parseInt(key.substring(lastUnderscore + 1));
                const els = Array.from(this.containerEl.querySelectorAll(selector)).filter(isVisible);
                if (els[idx]) {
                    const htmlEl = els[idx] as HTMLElement;
                    htmlEl.scrollTop = pos.scrollTop;
                    htmlEl.scrollLeft = pos.scrollLeft;
                }
            });

            // Render the floating zoom slider at the bottom right corner
            const tabType = this.getViewTabType();
            const showSlider = (tabType === 'daily' || tabType === 'weekly' || tabType === 'multiDay');
            
            let sliderContainer = this.containerEl.querySelector('.dp-zoom-slider-floating') as HTMLElement;
            if (showSlider) {
                if (!sliderContainer) {
                    // Contextual slot in the header actions, before Sync/Filter/+ (same slot as the Board mode toggle)
                    const headerActions = this.containerEl.querySelector('.dp-header-actions') as HTMLElement | null;
                    const viewContent = this.contentEl || this.containerEl;
                    sliderContainer = (headerActions ?? viewContent).createDiv({ cls: 'dp-zoom-slider-floating' });
                    headerActions?.prepend(sliderContainer);
                    
                    const zoomToggle = sliderContainer.createSpan({
                        text: '🔍',
                        title: 'Timeline Zoom'
                    });
                    // Touch has no hover: a tap toggles the slider open/closed (state survives header rebuilds)
                    const container = sliderContainer;
                    zoomToggle.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.zoomPopoverOpen = !this.zoomPopoverOpen;
                        container.toggleClass('is-open', this.zoomPopoverOpen);
                        triggerHaptic('selection');
                    });
                    if (!this.zoomOutsideBound) {
                        this.zoomOutsideBound = true;
                        this.registerDomEvent(document, 'pointerdown', (e: PointerEvent) => {
                            if (!this.zoomPopoverOpen) return;
                            const own = this.containerEl.querySelector('.dp-zoom-slider-floating');
                            if (own?.contains(e.target as Node)) return;
                            this.zoomPopoverOpen = false;
                            own?.removeClass('is-open');
                        });
                    }
                    const popover = sliderContainer.createDiv({ cls: 'dp-zoom-popover' });

                    const slider = popover.createEl('input', {
                        type: 'range',
                        cls: 'dp-zoom-slider'
                    });
                    slider.min = '30';
                    slider.max = '180';
                    slider.step = '5';

                    slider.addEventListener('change', () => {
                        slider.blur();
                    });
                    slider.addEventListener('pointerup', () => {
                        slider.blur();
                    });
                    // Keep Obsidian's drawer/back-swipe gestures from claiming a horizontal slider drag
                    slider.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
                    slider.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });

                    const valueSpan = popover.createSpan({
                        cls: 'dp-zoom-value',
                        text: `${this.getHourHeight()}px`
                    });

                    slider.addEventListener('input', async () => {
                        try {
                            const oldHeight = this.getHourHeight();
                            const newHeight = parseInt(slider.value, 10);
                            valueSpan.setText(`${newHeight}px`);

                            const isCodeBlock = (this as any).updateCodeBlockInFile !== undefined;

                            if (isCodeBlock) {
                                (this as any).hourHeight = newHeight;
                                this.rerenderForZoom(oldHeight);
                                // Debounced: rewriting the source remounts the block, which would end the drag
                                (this as any).debouncedUpdateCodeBlock((this as any).viewType, (this as any).filters);
                            } else {
                                const isDaily = this.getViewType() === 'day-planner-pro-daily';
                                const separate = this.plugin.settings.separateViewHeights;
                                
                                if (separate) {
                                    if (isDaily) {
                                        this.plugin.settings.timelineHourHeightDaily = newHeight;
                                    } else {
                                        this.plugin.settings.timelineHourHeight = newHeight;
                                    }
                                } else {
                                    this.plugin.settings.timelineHourHeight = newHeight;
                                    this.plugin.settings.timelineHourHeightDaily = newHeight;
                                }
                                this.rerenderForZoom(oldHeight);
                                await this.plugin.saveSettings();
                                
                                const targetTypes = separate 
                                    ? [this.getViewType()] 
                                    : ['day-planner-pro-view', 'day-planner-pro-daily'];
                                    
                                targetTypes.forEach(viewType => {
                                    this.app.workspace.getLeavesOfType(viewType).forEach(leaf => {
                                        const view = leaf.view as any;
                                        if (view === this) return; // already redrawn above, header untouched
                                        if (view && typeof view.render === 'function') {
                                            try {
                                                view.render();
                                            } catch (err) {
                                                console.error(`Failed to render leaf of type ${viewType}:`, err);
                                            }
                                        }
                                    });
                                });
                            }
                        } catch (err) {
                            console.error("Day Planner Pro: Error in slider event listener:", err);
                        }
                    });
                }
                
                const slider = sliderContainer.querySelector('input') as HTMLInputElement;
                if (slider) {
                    slider.value = String(this.getHourHeight());
                }
                const valueSpan = sliderContainer.querySelector('.dp-zoom-value');
                if (valueSpan) {
                    valueSpan.setText(`${this.getHourHeight()}px`);
                }
                sliderContainer.toggleClass('is-open', !!this.zoomPopoverOpen);
                sliderContainer.style.display = 'flex';
            } else {
                if (sliderContainer) {
                    sliderContainer.style.display = 'none';
                }
            }
            // A drag survives re-renders (j/k paging, data refresh): re-attach its preview to the new columns
            this.activePointerDrag?.refresh();
            if (this.inlineCreate) this.mountInlineCreate(); // re-mount an open inline editor with its draft
        } catch (error) {
            console.error("Day Planner Pro: Error in render:", error);
            new Notice("Error rendering view: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    abstract renderRoot(rootEl: HTMLDivElement): void;

    /** Full rebuild of header + content. The combined view overrides this to keep its cached panes mounted. */
    rebuildRoot(rootEl: HTMLDivElement) {
        rootEl.empty();
        this.renderRoot(rootEl);
    }

    /**
     * 사이드바 너비를 고려한 완전 반응형 멀티레이아웃 렌더링 내비게이터 헤더
     */
    renderNavHeader(parent: HTMLDivElement, showTabs: boolean = false): { dateLabel: string } {
        // One row: [date pill] ... [🔍 zoom] [< 📅 Today >] [Sync] [+]. Zoom / Board mode toggle are prepended later.
        const headerTop = parent.createDiv({ cls: 'dp-header-top' });
        const compact = this.useCompactLayout();

        // Header date: text + note links come from the declarative getHeaderDateInfo() mapping
        const info = getHeaderDateInfo(this.currentDate, this.getViewTabType(), this.getNDayCount());
        const dateEl = headerTop.createDiv({ cls: 'dp-nav-date' });
        if (compact) dateEl.addClass('dp-header-date-compact');
        setIcon(dateEl.createSpan({ cls: 'dp-nav-date-icon' }), 'calendar');
        const addSegment = (text: string, noteType?: 'daily' | 'weekly') => {
            const seg = dateEl.createSpan({ cls: noteType ? 'dp-nav-date-link' : 'dp-nav-date-static' });
            // A trailing "(Wk 41)" / "(4 days)" is secondary: same segment (same note link), muted span
            const [, primary, secondary] = text.match(/^(.*?)\s*(\([^()]*\))?$/) ?? [, text];
            if (primary) seg.createSpan({ cls: 'dp-nav-date-main', text: primary });
            if (secondary) seg.createSpan({ cls: 'dp-nav-date-sub', text: secondary });
            if (noteType) {
                seg.title = `Open ${noteType} note`;
                seg.addEventListener('click', () => this.openNoteForDate(info.noteDate, noteType));
            }
        };
        addSegment(info.mainText, info.isClickable ? info.noteType : undefined);
        if (info.subText) addSegment(info.subText, info.subNoteType);
        if (info.isClickable && info.noteType) {
            // The whole pill is the hit target: padding and icon open the main note, segments handle their own clicks
            dateEl.addClass('is-clickable');
            dateEl.addEventListener('click', (e) => {
                if (!(e.target as HTMLElement).closest('.dp-nav-date-link')) this.openNoteForDate(info.noteDate, info.noteType!);
            });
        }
        const dateLabel = info.subText ? `${info.mainText} ${info.subText}` : info.mainText;

        const headerActions = headerTop.createDiv({ cls: 'dp-header-actions' });

        // Board always shows today: no date navigation. Compact keeps only the icon-only 📅 (swipe and j/k page dates)
        if (this.getViewTabType() !== 'board') {
            const navHost = compact ? headerActions : headerActions.createDiv({ cls: 'dp-nav-buttons-group' });
            if (!compact) {
                const prevBtn = navHost.createEl('button', { text: '<', cls: 'dp-nav-arrow', attr: { 'aria-label': 'Previous' } });
                prevBtn.addEventListener('click', async () => {
                    triggerHaptic('selection');
                    await this.navigateWithSlide(-1);
                });
            }

            const todayBtn = navHost.createEl('button', { attr: { 'aria-label': 'Today' } });
            todayBtn.createSpan({ cls: 'dp-btn-icon', text: '📅' });
            todayBtn.createSpan({ cls: 'dp-btn-label', text: ' Today' }); // hidden in the compact shell (icon-only)
            todayBtn.addEventListener('click', () => {
                triggerHaptic('selection');
                void this.goToToday();
            });

            if (!compact) {
                const nextBtn = navHost.createEl('button', { text: '>', cls: 'dp-nav-arrow', attr: { 'aria-label': 'Next' } });
                nextBtn.addEventListener('click', async () => {
                    triggerHaptic('selection');
                    await this.navigateWithSlide(1);
                });
            }
        }

        if (this.plugin.settings.enableGoogleCalendar) {
            const syncBtn = headerActions.createEl('button', { attr: { 'aria-label': 'Sync' } });
            syncBtn.createSpan({ cls: 'dp-btn-icon', text: '🔄' });
            syncBtn.createSpan({ cls: 'dp-btn-label', text: ' Sync' }); // hidden in the compact shell (icon-only)
            syncBtn.addEventListener('click', () => void this.runSync());

            syncBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const modal = new TaskSyncModal(this.app, this.plugin, async () => {
                    await this.refreshTasks(null, true);
                });
                modal.open();
            });
        }

        if ((this as any).filters !== undefined) {
            // Active rule count on the button: with the panel closed, it is the only sign that a filter is applied
            const countRules = (g: FilterGroup): number => (g.children ?? []).reduce((n, c) => n + (isFilterGroup(c) ? countRules(c) : 1), 0);
            const ruleCount = countRules((this as any).filters as FilterGroup);
            const filterBtn = headerActions.createEl('button', {
                text: ruleCount > 0 ? `🔍 Filter · ${ruleCount}` : '🔍 Filter'
            });
            if ((this as any).showFilterPanel) {
                filterBtn.style.backgroundColor = 'var(--background-modifier-border-hover)';
                filterBtn.style.borderColor = 'var(--interactive-accent)';
            }
            filterBtn.addEventListener('click', () => {
                const self = this as any;
                if (self.showFilterPanel && self.closeFilterPanel) {
                    self.closeFilterPanel();
                    return;
                }
                const isShown = !self.showFilterPanel;
                self.showFilterPanel = isShown;
                if (self.ctx && self.ctx.getSectionInfo) {
                    const section = self.ctx.getSectionInfo(self.containerEl);
                    const lineStart = section ? section.lineStart : 0;
                    const blockKey = `${self.ctx.sourcePath}:${lineStart}`;
                    if (!self.plugin.codeblockShowFiltersState) {
                        self.plugin.codeblockShowFiltersState = new Map<string, boolean>();
                    }
                    self.plugin.codeblockShowFiltersState.set(blockKey, isShown);
                }
                this.render();
            });
        }

        // Consolidate into a single '➕' button
        const addBtn = headerActions.createEl('button', { 
            text: '➕', 
            cls: 'mod-cta' 
        });
        addBtn.addEventListener('click', () => {
            const defaultDateStr = this.currentDate.format('YYYY-MM-DD');

            const openTaskModal = () => {
                const modal = new TaskEditModal(this.app, null, defaultDateStr, async (data) => {
                    const targetFilePath = getTargetTaskFilePath(this.app, this.plugin.settings, data.date || defaultDateStr);
                    await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                    new Notice('New task added successfully.');
                    await this.refreshTasks();
                });
                modal.open();
            };

            if (this.plugin.settings.enableGoogleCalendar) {
                const choiceModal = new AddChoiceModal(this.app, (choice) => {
                    if (choice === 'task') {
                        openTaskModal();
                    } else {
                        const modal = new GCalEventEditModal(this.app, this.plugin, null, defaultDateStr, async () => {
                            await this.refreshTasks(null, true);
                        });
                        modal.open();
                    }
                });
                choiceModal.open();
            } else {
                openTaskModal();
            }
        });

        // Shortcut help for mouse users (leaf views on desktop layouts; hideable in settings, ? and h keep working)
        if (this instanceof DayPlannerBaseView && !this.useCompactLayout() && this.plugin.settings.showShortcutButton !== false) {
            const helpBtn = headerActions.createEl('button', {
                cls: 'dp-help-btn',
                attr: { 'aria-label': 'Keyboard Shortcuts (?)' }
            });
            setFirstIcon(helpBtn, ['circle-help', 'help-circle']);
            if (!helpBtn.querySelector('svg')) helpBtn.setText('?');
            helpBtn.addEventListener('click', () => ShortcutHelpModal.toggle(this.app, this.plugin));
        }

        // Side drawer toggle sits at the trailing edge, next to the drawer it opens (desktop date-based tabs only)
        if (this instanceof DayPlannerCombinedView && this.hasSideDrawer()) {
            const view = this; // keeps the narrowed type inside the listener
            const drawerBtn = headerActions.createEl('button', {
                cls: `dp-drawer-toggle${view.isSideDrawerOpen() ? ' is-active' : ''}`,
                attr: { 'aria-label': 'Toggle side drawer (S)' }
            });
            setFirstIcon(drawerBtn, ['panel-right', 'sidebar-right', 'layout-sidebar-right']);
            drawerBtn.addEventListener('click', () => void view.toggleSideDrawer());
        }

        return { dateLabel };
    }

    /** A sync is running: repeated F5 / Ctrl+R (key auto-repeat) or button clicks don't stack another one */
    syncInProgress = false;

    /**
     * Sync button, F5 and Ctrl/Cmd+R: rescans the vault's tasks and, with Google Calendar on, refetches this view's
     * events and pushes tasks to the sync calendar, with progress and result notices.
     */
    async runSync() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;
        try {
            if (!this.plugin.settings.enableGoogleCalendar) {
                new Notice('🔄 Rescanning vault tasks...');
                await this.refreshTasks('force');
                new Notice('✅ Tasks refreshed.');
                return;
            }
            new Notice('🔄 Syncing Google Calendar events & Tasks...');
            const { cacheKey, timeMin, timeMax } = this.getGCalRange();
            await this.plugin.fetchGCalRange(cacheKey, timeMin, timeMax);

            // Sync tasks to Google Calendar if target calendar is configured
            const targetCalendarId = this.plugin.settings.taskSyncCalendarId || this.plugin.settings.googleCalendars.find(c => c.enabled && c.id)?.id;
            if (targetCalendarId) {
                try {
                    const syncRes = await syncAllTasksToGCal(this.plugin, targetCalendarId);
                    new Notice(`✅ Sync complete! GCal events updated. Tasks (Created: ${syncRes.created}, Updated: ${syncRes.updated}, Repaired: ${syncRes.repaired}, Removed: ${syncRes.removed}, Up to date: ${syncRes.upToDate})`);
                } catch (err) {
                    console.error('Task sync error:', err);
                    new Notice(`⚠️ GCal events updated, but task sync encountered an error.`);
                }
            } else {
                new Notice('✅ Google Calendar events refreshed!');
            }

            await this.refreshTasks('force');
        } finally {
            this.syncInProgress = false;
        }
    }

    abstract getViewTabType(): 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list';
    abstract navigateDate(direction: number): void;

    /** Direction of the date navigation being rendered right now; timeline renderers read it to play the slide */
    navDirection: 'next' | 'prev' | null = null;

    /**
     * Single entry point for "go to today": toolbar button, T hotkey and the command palette.
     * Slides toward today like a real navigation (forward from the past, backward from the future);
     * already on today's period (day; week in Weekly; month in Monthly/List) → no slide, just the smooth scroll.
     */
    async goToToday() {
        const today = (window as any).moment();
        const tab = this.getViewTabType();
        const unit = tab === 'weekly' ? 'week' : (tab === 'monthly' || tab === 'list') ? 'month' : 'day';
        this.navDirection = this.currentDate.isSame(today, unit) ? null
            : this.currentDate.isBefore(today, unit) ? 'next' : 'prev';
        this.currentDate = today;
        this.scrollToTodayRequested = true;
        try {
            await this.refreshTasks(null, true);
        } finally {
            this.scrollToTodayRequested = false;
            this.navDirection = null;
        }
    }

    async navigateWithSlide(direction: number) {
        this.navigateDate(direction);
        this.navDirection = direction > 0 ? 'next' : 'prev';
        try {
            await this.refreshTasks(null, true);
        } finally {
            this.navDirection = null; // stale panes re-rendered later must not replay it
        }
    }

    /** Slides a freshly rendered view in when this render was caused by a directional navigation. */
    playNavSlide(el: HTMLElement, host: HTMLElement) {
        if (this.navDirection) applySlideTransition(el, this.navDirection, host);
    }

    /**
     * 현재 실행 중인 실시간 업무 트래킹 상태 바 렌더러
     */
    renderCurrentTaskTracker(parent: HTMLDivElement) {
        const now = (window as any).moment();
        const todayStr = now.format('YYYY-MM-DD');
        const currentMinutes = now.hour() * 60 + now.minute();

        const todayTasks = this.tasks.filter(t => t.date === todayStr && t.startTime && t.endTime);
        let activeTask: TaskItem | null = null;
        let progressPercent = 0;
        let minsRemaining = 0;

        for (const task of todayTasks) {
            const [sh, sm] = task.startTime!.split(':').map(Number);
            const [eh, em] = task.endTime!.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;

            if (currentMinutes >= startMin && currentMinutes < endMin) {
                activeTask = task;
                const duration = endMin - startMin;
                const elapsed = currentMinutes - startMin;
                progressPercent = Math.min(100, Math.max(0, (elapsed / duration) * 100));
                minsRemaining = endMin - currentMinutes;
                break;
            }
        }

        if (activeTask) {
            const trackerBar = parent.createDiv({ cls: 'dp-current-task-bar' });
            
            trackerBar.createDiv({ cls: 'dp-ct-status-icon', text: '▶' });

            const infoContainer = trackerBar.createDiv({ cls: 'dp-ct-info' });
            const titleText = cleanTaskTextForDisplay(activeTask.text);
            infoContainer.createDiv({ cls: 'dp-ct-title', text: titleText });
            infoContainer.createDiv({ 
                cls: 'dp-ct-time', 
                text: `⏰ ${activeTask.startTime}~${activeTask.endTime} (${formatMinutesNice(minsRemaining)} remaining)` 
            });


            const linkBtn = trackerBar.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
            linkBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (activeTask) {
                    await openTaskInEditor(this.app, activeTask);
                }
            });
        }
    }

    /**
     * Timeline interaction map (mouse / pen; touch keeps native scrolling and the phone long-press drag):
     *   - press on a card            → card drag (registerMouseDrag; the multi-selection moves along)
     *   - press on empty space       → this marquee: a drag selects every card the box touches (Ctrl / Cmd / Shift add
     *                                  to the selection), a plain click clears the selection
     *   - double-click empty space   → inline task creation (openInlineCreate, a dblclick on the pane)
     *   - Escape                     → cancels a card drag (beginPointerDrag) or the marquee, else clears the selection
     * The marquee owns every press on empty space, so the columns have no click handlers of their own: one used to
     * receive the click that ends a marquee drag (the box has pointer-events: none) and wipe the fresh selection.
     * Tasks and Google Calendar events are selected alike.
     */
    registerMarqueeSelection(eventsCol: HTMLElement, getTimedEvents: () => HTMLElement[]) {
        let marquee: HTMLElement | null = null;
        let startX = 0;
        let startY = 0;
        let moved = false;
        let hadSelection = false;
        const doc = eventsCol.ownerDocument;

        const onDown = (e: PointerEvent) => {
            if (e.button !== 0 || e.pointerType === 'touch') return;
            const target = e.target as HTMLElement;
            if (target.closest('.dp-timeline-event, button, input, .dp-custom-cb, .dp-task-link-btn, .dp-resize-handle')) return;
            e.preventDefault();

            moved = false;
            hadSelection = this.selectedTaskIds.size > 0;
            const rect = eventsCol.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;
            marquee = eventsCol.createDiv({ cls: 'dp-selection-marquee' });
            marquee.style.left = `${startX}px`;
            marquee.style.top = `${startY}px`;
            marquee.style.width = '0px';
            marquee.style.height = '0px';

            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) this.selectedTaskIds.clear();

            doc.addEventListener('pointermove', onMove);
            doc.addEventListener('pointerup', onUp);
            doc.addEventListener('pointercancel', onUp);
            doc.addEventListener('keydown', onKey, true);
        };

        const onMove = (e: PointerEvent) => {
            if (!marquee) return;
            const rect = eventsCol.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;
            const width = Math.abs(startX - currentX);
            const height = Math.abs(startY - currentY);
            if (width > 2 || height > 2) moved = true;
            marquee.style.left = `${Math.min(startX, currentX)}px`;
            marquee.style.top = `${Math.min(startY, currentY)}px`;
            marquee.style.width = `${width}px`;
            marquee.style.height = `${height}px`;

            const box = marquee.getBoundingClientRect();
            const additive = e.ctrlKey || e.metaKey || e.shiftKey;
            getTimedEvents().forEach(el => {
                const taskId = el.getAttribute('data-task-id');
                if (!taskId) return;
                const r = el.getBoundingClientRect();
                const overlaps = !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom);
                if (overlaps) {
                    this.selectedTaskIds.add(taskId);
                    el.addClass('selected');
                } else if (!additive) {
                    this.selectedTaskIds.delete(taskId);
                    el.removeClass('selected');
                }
            });
        };

        const end = () => {
            marquee?.remove();
            marquee = null;
            doc.removeEventListener('pointermove', onMove);
            doc.removeEventListener('pointerup', onUp);
            doc.removeEventListener('pointercancel', onUp);
            doc.removeEventListener('keydown', onKey, true);
        };

        const onUp = () => {
            end();
            if (moved) {
                // The release still produces a click (the box ignores the pointer): it must not reach anything else
                const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
                doc.addEventListener('click', swallow, { capture: true, once: true });
                window.setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);
            }
            // Repaint only when the selection changed, and on the next tick: re-rendering inside pointerup detached the
            // column before its click / dblclick fired, so a double-click to create never arrived
            if (moved || hadSelection) window.setTimeout(() => this.render(), 0);
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            end();
            this.selectedTaskIds.clear();
            this.render();
        };

        eventsCol.addEventListener('pointerdown', onDown);
    }

    /**
     * 태스크 및 구글 캘린더 일정 길이 조절 드래그 마우스 제어 인터페이스 (높이 조절 비율 대응 완료)
     */
    addResizeListeners(
        eventCard: HTMLElement, 
        item: { type: 'task' | 'gcal'; refId: string; taskRef?: TaskItem; calendarId?: string; text: string; startTime: string; endTime: string }, 
        direction: 'top' | 'bottom'
    ) {
        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60; // pixel / minute
        
        let duration = 0;
        try {
            const [sh, sm] = item.startTime.split(':').map(Number);
            const [eh, em] = item.endTime.split(':').map(Number);
            duration = (eh * 60 + em) - (sh * 60 + sm);
        } catch (e) {
            duration = 30;
        }
        const cardHeight = duration * ratio;

        let handleCls = `dp-resize-handle ${direction}`;
        if (cardHeight < 35) {
            handleCls += ' dp-small-handle';
        }

        const handle = eventCard.createDiv({ cls: handleCls });
        
        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);

            const hourHeight = this.getHourHeight();
            const startHour = this.plugin.settings.timelineStartHour ?? 0;
            const endHour = this.plugin.settings.timelineEndHour ?? 24;
            const ratio = hourHeight / 60; // pixel / minute
            const startMinOffset = startHour * 60;

            const startY = e.clientY;
            const [sh, sm] = item.startTime.split(':').map(Number);
            const [eh, em] = item.endTime.split(':').map(Number);
            const originalStartMin = sh * 60 + sm;
            const originalEndMin = eh * 60 + em;
            let lastDeltaMin = 0;
            triggerHaptic('light'); // resize start

            const onPointerMove = (moveEvent: PointerEvent) => {
                moveEvent.preventDefault();
                const deltaY = moveEvent.clientY - startY;
                const deltaMin = Math.round((deltaY / ratio) / 15) * 15; // ratio 기반 환산
                if (deltaMin !== lastDeltaMin) {
                    lastDeltaMin = deltaMin;
                    triggerHaptic('light'); // snapped to a new 15-minute slot
                }

                let newStartMin = originalStartMin;
                let newEndMin = originalEndMin;

                if (direction === 'top') {
                    newStartMin = Math.max(startMinOffset, Math.min(originalEndMin - 15, originalStartMin + deltaMin));
                } else {
                    newEndMin = Math.min(endHour * 60, Math.max(originalStartMin + 15, originalEndMin + deltaMin));
                }

                const formatMin = (totalMin: number) => {
                    const h = Math.floor(totalMin / 60);
                    const m = totalMin % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                };

                const tempStart = formatMin(newStartMin);
                const tempEnd = formatMin(newEndMin);

                eventCard.style.top = `${(newStartMin - startMinOffset) * ratio}px`;
                eventCard.style.height = `${(newEndMin - newStartMin) * ratio}px`;
                const label = eventCard.querySelector('span');
                if (label) {
                    const displayTitle = cleanTaskTextForDisplay(item.text);
                    label.setText(`${displayTitle} (${tempStart}-${tempEnd})`);
                }
            };

            const onPointerUp = async (upEvent: PointerEvent) => {
                handle.releasePointerCapture(upEvent.pointerId);
                handle.removeEventListener('pointermove', onPointerMove);
                handle.removeEventListener('pointerup', onPointerUp);
                handle.removeEventListener('pointercancel', onPointerUp);

                const deltaY = upEvent.clientY - startY;
                const deltaMin = Math.round((deltaY / ratio) / 15) * 15;

                let newStartMin = originalStartMin;
                let newEndMin = originalEndMin;

                if (direction === 'top') {
                    newStartMin = Math.max(startMinOffset, Math.min(originalEndMin - 15, originalStartMin + deltaMin));
                } else {
                    newEndMin = Math.min(endHour * 60, Math.max(originalStartMin + 15, originalEndMin + deltaMin));
                }

                const formatMin = (totalMin: number) => {
                    const h = Math.floor(totalMin / 60);
                    const m = totalMin % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                };

                const finalStart = formatMin(newStartMin);
                const finalEnd = formatMin(newEndMin);

                if (item.type === 'gcal') {
                    const cached = this.plugin.gcalCache.find(ev => ev.id === item.refId);
                    if (cached) {
                        const previousState = {
                            summary: cached.summary,
                            description: cached.description || '',
                            location: cached.location || '',
                            dateStr: cached.dateStr,
                            startTimeStr: cached.startTimeStr,
                            endTimeStr: cached.endTimeStr,
                            isAllDay: cached.isAllDay
                        };
                        const success = await patchGoogleCalendarEvent(
                            this.plugin,
                            item.calendarId!,
                            item.refId,
                            this.currentDate.format('YYYY-MM-DD'),
                            finalStart,
                            finalEnd
                        );
                        if (success) {
                            new Notice(`📅 구글 일정이 성공적으로 변경되었습니다: ${finalStart} ~ ${finalEnd}`);
                            cached.startTimeStr = finalStart;
                            cached.endTimeStr = finalEnd;
                            showGCalEventUndoNotice(this.plugin, item.calendarId!, item.refId, previousState);
                        }
                    }
                } else {
                    await updateTaskInFile(this.plugin.app, item.taskRef!, {
                        startTime: finalStart,
                        endTime: finalEnd
                    });
                    new Notice(`Task rescheduled to: ${finalStart} ~ ${finalEnd}`);
                }
                
                await this.refreshTasks();
            };

            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', onPointerUp);
            handle.addEventListener('pointercancel', onPointerUp);
        });
    }

    /**
     * Moves every selected timeline item (tasks and Google events) so the primary item starts at `snappedMinutes`
     * on `targetDateStr`; the others keep their time and day offsets. Shared by mouse drops and phone long-press drags.
     */
    async moveSelectedTimelineItems(primaryTaskId: string, isGCal: boolean, snappedMinutes: number, targetDateStr: string) {
        // [통합 동시 드래그 시스템]: 구글 캘린더와 마크다운 Task 구분 없이 모두 동시 이동 처리 (상대적 날짜 유지)
        let primaryItemStartMin = 0;
        let primaryDateStr = targetDateStr;
        if (isGCal) {
            const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === primaryTaskId);
            if (gcalEvent && gcalEvent.startTimeStr) {
                const [sh, sm] = gcalEvent.startTimeStr.split(':').map(Number);
                primaryItemStartMin = sh * 60 + sm;
                if (gcalEvent.dateStr) primaryDateStr = gcalEvent.dateStr;
            }
        } else {
            const primaryItem = this.tasks.find(t => t.id === primaryTaskId);
            if (primaryItem && primaryItem.startTime) {
                const [sh, sm] = primaryItem.startTime.split(':').map(Number);
                primaryItemStartMin = sh * 60 + sm;
                if (primaryItem.date) primaryDateStr = primaryItem.date;
            }
        }

        const deltaMin = snappedMinutes - primaryItemStartMin;
        const moment = (window as any).moment;
        const primaryMom = moment(primaryDateStr, 'YYYY-MM-DD');
        const targetMom = moment(targetDateStr, 'YYYY-MM-DD');
        const dayDelta = (targetMom.isValid() && primaryMom.isValid()) ? targetMom.diff(primaryMom, 'days') : 0;

        let taskUpdateCount = 0;
        let gcalUpdateCount = 0;

        for (const taskId of this.selectedTaskIds) {
            const task = this.tasks.find(t => t.id === taskId);
            if (isLockedTask(task)) continue; // a marquee may have swept done / cancelled tasks in: they stay put
            if (task && task.startTime && task.endTime) {
                const [tsh, tsm] = task.startTime.split(':').map(Number);
                const [teh, tem] = task.endTime.split(':').map(Number);

                const newStartTotal = (tsh * 60 + tsm) + deltaMin;
                const newEndTotal = (teh * 60 + tem) + deltaMin;

                const nsh = Math.max(0, Math.min(23, Math.floor(newStartTotal / 60)));
                const nsm = Math.max(0, Math.min(59, newStartTotal % 60));
                const neh = Math.max(0, Math.min(24, Math.floor(newEndTotal / 60)));
                const nem = Math.max(0, Math.min(59, newEndTotal % 60));

                const newStartTime = `${String(nsh).padStart(2, '0')}:${String(nsm).padStart(2, '0')}`;
                const newEndTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;

                let taskTargetDate = targetDateStr;
                if (task.date) {
                    taskTargetDate = moment(task.date, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                }

                const success = await updateTaskInFile(this.app, task, {
                    startTime: newStartTime,
                    endTime: newEndTime,
                    date: taskTargetDate
                });
                if (success) taskUpdateCount++;
            } else {
                // 선택된 ID가 구글 일정 캐시에 존재하는 경우 동시 이동 API 전송
                const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === taskId);
                if (gcalEvent && gcalEvent.startTimeStr && gcalEvent.endTimeStr && !gcalEvent.isAllDay) {
                    const previousState = {
                        summary: gcalEvent.summary,
                        description: gcalEvent.description || '',
                        location: gcalEvent.location || '',
                        dateStr: gcalEvent.dateStr,
                        startTimeStr: gcalEvent.startTimeStr,
                        endTimeStr: gcalEvent.endTimeStr,
                        isAllDay: gcalEvent.isAllDay
                    };
                    const [sh, sm] = gcalEvent.startTimeStr.split(':').map(Number);
                    const [eh, em] = gcalEvent.endTimeStr.split(':').map(Number);

                    const newStartTotal = (sh * 60 + sm) + deltaMin;
                    const newEndTotal = (eh * 60 + em) + deltaMin;

                    const nsh = Math.max(0, Math.min(23, Math.floor(newStartTotal / 60)));
                    const nsm = Math.max(0, Math.min(59, newStartTotal % 60));
                    const neh = Math.max(0, Math.min(24, Math.floor(newEndTotal / 60)));
                    const nem = Math.max(0, Math.min(59, newEndTotal % 60));

                    const newStartTime = `${String(nsh).padStart(2, '0')}:${String(nsm).padStart(2, '0')}`;
                    const newEndTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;

                    let gcalTargetDate = targetDateStr;
                    if (gcalEvent.dateStr) {
                        gcalTargetDate = moment(gcalEvent.dateStr, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                    }

                    const success = await patchGoogleCalendarEvent(
                        this.plugin,
                        gcalEvent.calendarId,
                        gcalEvent.id,
                        gcalTargetDate,
                        newStartTime,
                        newEndTime
                    );
                    if (success) {
                        gcalEvent.dateStr = gcalTargetDate;
                        gcalEvent.startTimeStr = newStartTime;
                        gcalEvent.endTimeStr = newEndTime;
                        gcalUpdateCount++;
                        showGCalEventUndoNotice(this.plugin, gcalEvent.calendarId, gcalEvent.id, previousState);
                    }
                }
            }
        }

        if (taskUpdateCount > 0 || gcalUpdateCount > 0) {
            new Notice(`🔄 Rescheduled ${taskUpdateCount} task(s) and ${gcalUpdateCount} Google event(s)`);
            this.selectedTaskIds.clear();
            await this.refreshTasks(null, gcalUpdateCount > 0);
        }
    }

    /**
     * Phone timeline drag (Daily / 2-Day): holding a card for 350ms lifts it with a light haptic, the finger then moves it
     * through the same 15-minute snap preview as mouse dragging, and lifting the finger drops it.
     * Until the hold completes the touch is left alone, so a normal swipe still scrolls or pages the timeline.
     */
    registerLongPressDrag(card: HTMLElement, refId: string, isGCal: boolean, previewRoot: HTMLElement) {
        const HOLD_MS = 350;
        const SLOP = 8;  // px of finger jitter tolerated during the hold
        const EDGE = 48; // px band at the scroller's top/bottom that auto-scrolls while dragging
        // Native touch drag-and-drop would compete with the long-press; desktop (sidebar) keeps mouse dragging
        if (Platform.isMobile) card.setAttribute('draggable', 'false');
        const scroller = card.closest<HTMLElement>('.dp-content');
        let holdTimer = 0, frame = 0, pointerId = -1;
        let startX = 0, startY = 0, lastX = 0, lastY = 0, grabOffset = 0;
        let dragging = false, moved = false, suppressClick = false;
        let column: HTMLElement | null = null;

        const updatePreview = () => {
            const hit = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
            column = hit?.closest<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events') ?? column;
            if (column) this.updateDragPreview({ clientY: lastY }, column, grabOffset, true);
        };
        const autoScroll = () => {
            if (!dragging) return;
            if (scroller) {
                const r = scroller.getBoundingClientRect();
                const step = lastY < r.top + EDGE ? -8 : lastY > r.bottom - EDGE ? 8 : 0;
                if (step) {
                    scroller.scrollTop += step;
                    updatePreview();
                }
            }
            frame = requestAnimationFrame(autoScroll);
        };
        const detach = () => {
            window.clearTimeout(holdTimer);
            holdTimer = 0;
            card.removeEventListener('pointermove', onMove);
            card.removeEventListener('pointerup', onUp);
            card.removeEventListener('pointercancel', onCancel);
        };
        const endDrag = () => {
            dragging = false;
            this.touchDragActive = false;
            cancelAnimationFrame(frame);
            this.clearDragPreview(previewRoot);
        };
        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            lastX = e.clientX;
            lastY = e.clientY;
            const dist = Math.hypot(lastX - startX, lastY - startY);
            if (!dragging) {
                if (dist > SLOP) detach(); // moved before the hold completed: a scroll or swipe, not a drag
                return;
            }
            moved = moved || dist > SLOP;
            updatePreview();
        };
        const onCancel = () => {
            detach();
            if (dragging) endDrag();
        };
        const onUp = async (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            detach();
            if (!dragging) return;
            // The lift may still produce a click on this card: swallow it instead of opening the edit modal
            suppressClick = true;
            window.setTimeout(() => { suppressClick = false; }, 400);
            const target = column;
            endDrag();
            if (!moved || !target) return;
            const rect = target.getBoundingClientRect();
            const dateStr = target.getAttribute('data-date') || this.currentDate.format('YYYY-MM-DD');
            await this.moveSelectedTimelineItems(refId, isGCal, this.snapTimelineMinutes(lastY - rect.top - grabOffset, true), dateStr);
        };

        card.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.pointerType !== 'touch' || !e.isPrimary || dragging) return;
            if ((e.target as HTMLElement).closest('.dp-custom-cb, .dp-task-link-btn, .dp-resize-handle, .dp-drawer-card-actions')) return;
            pointerId = e.pointerId;
            startX = lastX = e.clientX;
            startY = lastY = e.clientY;
            moved = false;
            column = null;
            card.addEventListener('pointermove', onMove);
            card.addEventListener('pointerup', onUp);
            card.addEventListener('pointercancel', onCancel);
            holdTimer = window.setTimeout(() => {
                holdTimer = 0;
                dragging = true;
                this.touchDragActive = true;
                if (!this.selectedTaskIds.has(refId)) {
                    this.selectedTaskIds.clear();
                    this.selectedTaskIds.add(refId);
                    previewRoot.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                    card.addClass('selected');
                }
                grabOffset = this.timelineGrabOffset(card, startY);
                this.initDragPreview(null, refId, grabOffset, previewRoot); // light haptic
                updatePreview();
                frame = requestAnimationFrame(autoScroll);
            }, HOLD_MS);
        });
        // Once lifted, finger moves drive the drag: keep the browser from turning them into a scroll
        card.addEventListener('touchmove', (e) => { if (dragging && e.cancelable) e.preventDefault(); }, { passive: false });
        card.addEventListener('contextmenu', (e) => { if (holdTimer || dragging) e.preventDefault(); });
        card.addEventListener('click', (e) => {
            if (!suppressClick) return;
            suppressClick = false;
            e.stopImmediatePropagation();
        }, true);
    }

    /**
     * 1. 일간 타임라인 그리기 구현
     */
    renderDailyTimeline(parent: HTMLDivElement) {
        const dateStr = this.currentDate.format('YYYY-MM-DD');
        const dayTasks = this.tasks.filter(t => t.date === dateStr);
        const dayGCal = this.plugin.settings.enableGoogleCalendar 
            ? this.getCalendarEventsForDate(dateStr) 
            : [];

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60; // pixel / minute 비율

        const scrollKey = `${this.getViewType()}:${dateStr}:daily`;
        // Property handler: the pane outlives its re-renders, so addEventListener stacked one more listener per render,
        // all of them running on every scroll frame (and writing this offset into earlier dates' keys)
        parent.ondblclick = (e) => this.openInlineCreate(e); // property, not addEventListener: the pane outlives renders
        parent.onscroll = () => {
            this.savedScrollPositions[scrollKey] = {
                scrollTop: parent.scrollTop,
                scrollLeft: parent.scrollLeft
            };
        };

        const startHour = this.plugin.settings.timelineStartHour ?? 0;
        const endHour = this.plugin.settings.timelineEndHour ?? 24;
        const hoursCount = endHour - startHour;

        const timelineWrapper = parent.createDiv({ cls: 'dp-timeline-wrapper' });
        timelineWrapper.style.minHeight = `${hoursCount * hourHeight}px`;

        const hoursCol = timelineWrapper.createDiv({ cls: 'dp-timeline-hours' });
        for (let h = startHour; h < endHour; h++) {
            const hourMark = hoursCol.createDiv({ 
                cls: 'dp-timeline-hour-mark', 
                text: `${String(h).padStart(2, '0')}:00` 
            });
            hourMark.style.height = `${hourHeight}px`;
        }

        const eventsCol = timelineWrapper.createDiv({ cls: 'dp-timeline-events' });
        eventsCol.style.backgroundSize = `100% ${hourHeight}px`;

        // 마키 다중 선택 타겟을 .dp-timeline-event 전체로 확장 (구글 일정 포괄 선택 가능)
        this.registerMarqueeSelection(eventsCol, () => {
            return Array.from(eventsCol.querySelectorAll('.dp-timeline-event')) as HTMLElement[];
        });

        eventsCol.addEventListener('contextmenu', (e: MouseEvent) => {
            const targetEl = e.target as HTMLElement;
            if (targetEl.closest('.dp-timeline-event') || targetEl.closest('.dp-grid-task-item') || targetEl.closest('.dp-task-link-btn') || targetEl.closest('.dp-custom-cb')) {
                return;
            }
            e.preventDefault();

            const rect = eventsCol.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            let clickedMinutes = Math.round((clickY / ratio) / 15) * 15 + (startHour * 60);
            if (clickedMinutes < startHour * 60) clickedMinutes = startHour * 60;
            if (clickedMinutes > (endHour * 60) - 30) clickedMinutes = (endHour * 60) - 30;

            const hourStr = String(Math.floor(clickedMinutes / 60)).padStart(2, '0');
            const minStr = String(clickedMinutes % 60).padStart(2, '0');
            const startTimeStr = `${hourStr}:${minStr}`;
            const endTimeStr = addMinutesToTime(startTimeStr, 30);

            const menu = new Menu();
            (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
            menu.addItem((item) =>
                item
                    .setTitle(`Add Task at ${startTimeStr}`)
                    .setIcon("pencil")
                    .onClick(async () => {
                        const activeFile = this.app.workspace.getActiveFile();
                        const targetFilePath = (activeFile && activeFile.extension === 'md') ? activeFile.path : this.plugin.settings.defaultTaskFile;
                        
                        const modal = new TaskEditModal(this.app, null, dateStr, async (data) => {
                            await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                            new Notice('New task added successfully.');
                            await this.refreshTasks();
                        }, startTimeStr, endTimeStr);
                        modal.open();
                    })
            );

            if (this.plugin.settings.enableGoogleCalendar) {
                menu.addItem((item) =>
                    item
                        .setTitle(`Add Appointment at ${startTimeStr}`)
                        .setIcon("calendar")
                        .onClick(() => {
                            const modal = new GCalEventEditModal(this.app, this.plugin, null, dateStr, async () => {
                                await this.refreshTasks(null, true);
                            }, startTimeStr, endTimeStr);
                            modal.open();
                        })
                );
            }

            menu.showAtMouseEvent(e);
        });

        const isToday = this.currentDate.isSame((window as any).moment(), 'day');
        if (isToday) {
            const indicator = eventsCol.createDiv({ cls: 'dp-timeline-current-indicator' });
            const updateIndicator = () => {
                const now = (window as any).moment();
                const mins = now.hour() * 60 + now.minute();
                const startMin = startHour * 60;
                const endMin = endHour * 60;
                if (mins < startMin || mins >= endMin) {
                    indicator.style.display = 'none';
                } else {
                    indicator.style.display = 'block';
                    indicator.style.top = `${(mins - startMin) * ratio}px`; // 높이 비율 및 오프셋 적용
                }
            };
            updateIndicator();
            // Every render mounts a new indicator: stop this timer once its line is gone, or one leaks per render
            const intervalId = window.setInterval(() => {
                if (!indicator.isConnected) window.clearInterval(intervalId);
                else updateIndicator();
            }, 60000);
            this.registerInterval(intervalId);
        }

        const timedItems: Array<{
            type: 'task' | 'gcal';
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
            colIdx?: number;
            maxCols?: number;
            startTime: string;
            endTime: string;
        }> = [];

        dayTasks.filter(t => t.startTime && t.endTime).forEach(t => {
            const [sh, sm] = t.startTime!.split(':').map(Number);
            const [eh, em] = t.endTime!.split(':').map(Number);
            timedItems.push({
                type: 'task',
                refId: t.id,
                text: t.text,
                startMin: sh * 60 + sm,
                endMin: eh * 60 + em,
                completed: t.completed,
                taskRef: t,
                startTime: t.startTime!,
                endTime: t.endTime!
            });
        });

        dayGCal.filter(e => !e.isAllDay && e.startTimeStr && e.endTimeStr).forEach(e => {
            const [sh, sm] = e.startTimeStr!.split(':').map(Number);
            const [eh, em] = e.endTimeStr!.split(':').map(Number);
            timedItems.push({
                type: 'gcal',
                refId: e.id,
                calendarId: e.calendarId,
                text: e.summary,
                startMin: sh * 60 + sm,
                endMin: eh * 60 + em,
                color: e.color,
                location: e.location,
                description: e.description,
                startTime: e.startTimeStr!,
                endTime: e.endTimeStr!
            });
        });

        calculateClusteredLayout(timedItems);

        const timelineStartMin = startHour * 60;
        const timelineEndMin = endHour * 60;

        timedItems.forEach(item => {
            // 노출 범위 밖의 일정은 렌더링 제외
            if (item.endMin <= timelineStartMin || item.startMin >= timelineEndMin) {
                return;
            }

            const visibleStartMin = Math.max(timelineStartMin, item.startMin);
            const visibleEndMin = Math.min(timelineEndMin, item.endMin);
            const visibleDuration = visibleEndMin - visibleStartMin;

            const totalCols = item.maxCols || 1;
            const colIdx = item.colIdx || 0;
            const widthPct = 100 / totalCols;
            const leftPct = colIdx * widthPct;
            
            // 높이 비율(ratio) 및 시작 시간 오프셋 적용된 포지셔닝 수식 적용
            let cardCls = 'dp-timeline-event';
            const topPx = (visibleStartMin - timelineStartMin) * ratio;
            const heightPx = Math.max(15, visibleDuration * ratio); // 최소 높이 보장
            let customStyle = `top: ${topPx}px; height: ${heightPx}px; left: calc(${leftPct}% + 4px); width: calc(${widthPct}% - 8px);`;

            if (item.type === 'gcal') {
                cardCls += ' dp-gcal-event';
                if (item.color) {
                    customStyle += ` background-image: linear-gradient(${item.color}24, ${item.color}24) !important; border-left: 4px solid ${item.color} !important;`;
                }
                if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected'; // 구글 일정도 다중 선택 비주얼 적용
            } else {
                if (item.taskRef) {
                    if (item.taskRef.statusChar === 'x') cardCls += ' completed';
                    else if (item.taskRef.statusChar === '-') cardCls += ' cancelled';
                }
                if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected';
            }

            const eventCard = eventsCol.createDiv({ cls: cardCls });
            eventCard.style.cssText = customStyle;
            eventCard.setAttribute('data-task-id', item.refId);
            // The item's real range on this day (the card itself is clipped to the visible hours): drag previews use it
            eventCard.dataset.startMin = String(item.startMin);
            eventCard.dataset.endMin = String(item.endMin);
            const locked = isLockedTask(item.taskRef); // done / cancelled: no drag, resize or long-press

            if (item.type === 'gcal') {
                eventCard.setAttribute('draggable', 'true');
                
                this.addResizeListeners(eventCard, item as any, 'top');
                this.addResizeListeners(eventCard, item as any, 'bottom');

                const summaryDiv = eventCard.createDiv({ cls: 'dp-event-title' });
                summaryDiv.setText(item.text);
                
                if (item.location) {
                    const locDiv = eventCard.createDiv({ cls: 'dp-event-meta' });
                    locDiv.setText(`📍 ${item.location}`);
                }
                if (item.description) {
                    const descDiv = eventCard.createDiv({ cls: 'dp-event-meta' });
                    descDiv.setText(item.description);
                }

                const cachedEvent = this.plugin.gcalCache.find(e => e.id === item.refId);
                if (cachedEvent) {
                    eventCard.addEventListener('click', (ev) => {
                        if (ev.target instanceof HTMLElement && ev.target.classList.contains('dp-resize-handle')) return;
                        new GCalEventEditModal(this.app, this.plugin, cachedEvent, this.currentDate.format('YYYY-MM-DD'), async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                }

                eventCard.addEventListener('dragstart', (e) => {
                    if (!e.dataTransfer) return;
                    if (!this.selectedTaskIds.has(item.refId)) {
                        this.selectedTaskIds.clear();
                        this.selectedTaskIds.add(item.refId);
                        
                        eventsCol.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                        eventCard.addClass('selected');
                    }

                    const clickOffsetMin = this.timelineGrabOffset(eventCard, e.clientY);
                    this.activeDragClickOffsetMin = clickOffsetMin;

                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        primaryTaskId: item.refId,
                        clickOffsetMin: clickOffsetMin,
                        sourceTab: this.getViewTabType(),
                        isGCal: true,
                        calendarId: item.calendarId
                    }));
                    
                    this.initDragPreview(e, item.refId, clickOffsetMin, eventsCol);
                });

                eventCard.addEventListener('dragend', () => {
                    this.clearDragPreview(eventsCol);
                });
            } else {
                eventCard.setAttribute('draggable', String(!locked));

                if (item.taskRef && !locked) {
                    this.addResizeListeners(eventCard, item as any, 'top');
                    this.addResizeListeners(eventCard, item as any, 'bottom');
                }

                const mainRow = eventCard.createDiv({ cls: 'dp-event-main' });

                if (item.taskRef) {
                    createCustomCheckbox(mainRow, item.taskRef, async (newStatus) => {
                        if (item.taskRef) {
                            await updateTaskInFile(this.app, item.taskRef, { statusChar: newStatus });
                            await this.refreshTasks();
                        }
                    });
                }

                const displayTitle = cleanTaskTextForDisplay(item.text);
                const labelSpan = mainRow.createEl('span', {
                    cls: 'dp-task-text',
                    text: `${displayTitle}` 
                });

                if (item.taskRef && item.taskRef.priority !== 'normal') {
                    const priorityEmojis = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };
                    mainRow.createSpan({ 
                        cls: 'dp-badge dp-badge-priority', 
                        text: priorityEmojis[item.taskRef.priority]
                    });
                }

                const linkBtn = mainRow.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                linkBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (item.taskRef) {
                        await openTaskInEditor(this.app, item.taskRef);
                    }
                });

                let clickStartX = 0;
                let clickStartY = 0;
                let clickDragged = false;

                eventCard.addEventListener('pointerdown', (e) => {
                    clickStartX = e.clientX;
                    clickStartY = e.clientY;
                    clickDragged = false;
                });

                eventCard.addEventListener('click', (e) => {
                    if (e.target instanceof HTMLElement && (
                        e.target.classList.contains('dp-custom-cb') || 
                        e.target.classList.contains('dp-task-link-btn') || 
                        e.target.classList.contains('dp-resize-handle')
                    )) return;
                    e.stopPropagation();

                    const diffX = Math.abs(e.clientX - clickStartX);
                    const diffY = Math.abs(e.clientY - clickStartY);

                    if (diffX > 5 || diffY > 5 || clickDragged) {
                        return;
                    }

                    if (item.taskRef) {
                        const modal = new TaskEditModal(this.app, item.taskRef, null, async (data) => {
                            await updateTaskInFile(this.app, item.taskRef!, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    }
                });

                eventCard.addEventListener('dragstart', (e) => {
                    clickDragged = true;
                    if (!e.dataTransfer) return;
                    if (!this.selectedTaskIds.has(item.refId)) {
                        this.selectedTaskIds.clear();
                        this.selectedTaskIds.add(item.refId);
                        
                        eventsCol.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                        eventCard.addClass('selected');
                    }

                    const clickOffsetMin = this.timelineGrabOffset(eventCard, e.clientY);
                    this.activeDragClickOffsetMin = clickOffsetMin;

                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        primaryTaskId: item.refId,
                        clickOffsetMin: clickOffsetMin,
                        sourceTab: this.getViewTabType(),
                        isGCal: false
                    }));

                    this.initDragPreview(e, item.refId, clickOffsetMin, eventsCol);
                });

                eventCard.addEventListener('dragend', () => {
                    this.clearDragPreview(eventsCol);
                });
            }
            if (this.useCompactLayout() && !locked) this.registerLongPressDrag(eventCard, item.refId, item.type === 'gcal', eventsCol);
            if (!locked) this.registerMouseDrag(eventCard, { kind: 'timeline', refId: item.refId, isGCal: item.type === 'gcal', previewRoot: eventsCol });
        });

        eventsCol.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.updateDragPreview(e, eventsCol, this.activeDragClickOffsetMin, true);
        });
        eventsCol.addEventListener('drop', async (e) => {
            e.preventDefault();
            const dataStr = e.dataTransfer?.getData('text/plain');
            if (!dataStr) return;

            try {
                const { primaryTaskId, clickOffsetMin, isGCal } = JSON.parse(dataStr);
                const gridRect = eventsCol.getBoundingClientRect();
                await this.moveSelectedTimelineItems(primaryTaskId, isGCal, this.snapTimelineMinutes(e.clientY - gridRect.top - clickOffsetMin, true), dateStr);
            } catch (err) {
                console.error('Daily drop error:', err);
            }
        });

        const untimedTasks = dayTasks.filter(t => !t.startTime || !t.endTime);
        const untimedAllDayGCal = dayGCal.filter(e => e.isAllDay);

        if (untimedTasks.length > 0 || untimedAllDayGCal.length > 0) {
            // Same row as the Weekly/N-day all-day grid ([All Day | cell], same item classes), pinned above the hourly grid
            const allDaySection = parent.createDiv({ cls: 'dp-daily-allday' });
            parent.insertBefore(allDaySection, timelineWrapper);

            allDaySection.createDiv({ cls: 'dp-allday-label', text: 'All Day' });
            const listEl = allDaySection.createDiv({ cls: 'dp-allday-cell' });

            untimedAllDayGCal.forEach(e => this.renderAllDayEventChip(e, dateStr, listEl));
            untimedTasks.sort((a, b) => a.text.localeCompare(b.text));
            untimedTasks.forEach(task => this.renderAllDayTaskChip(task, listEl));
        }

        // 'now' line when today is shown; otherwise the earliest timed item of the day
        this.applyAutoScroll(parent, scrollKey, 'daily', 'now', () => this.getAutoScrollY([dateStr], startHour, hourHeight));
        this.playNavSlide(timelineWrapper, parent);
    }

    /**
     * 2. 주간 캘린더 뷰 구현
     */
    renderWeeklyView(parent: HTMLDivElement, daysCount: number = 7, startFromCurrentDate: boolean = false) {
        parent.empty();
        
        parent.ondblclick = (e) => this.openInlineCreate(e); // property, not addEventListener: the pane outlives renders
        const scrollWrapper = parent.createDiv({ cls: 'dp-weekly-scroll-wrapper' });
        const container = scrollWrapper.createDiv({ cls: 'dp-weekly-container' });
        // 84px day columns: a 7-day week fits ~640px, so it keeps fitting beside the open side drawer. Narrow cards
        // collapse to a single bold title line (container query on .dp-timeline-event in styles.ts)
        const DAY_COL_MIN = 84;
        const dayColumnTemplate = `48px repeat(${daysCount}, minmax(${DAY_COL_MIN}px, 1fr))`;
        container.style.minWidth = `${Math.max(360, DAY_COL_MIN * daysCount + 48)}px`;

        const headerGrid = container.createDiv({ cls: 'dp-weekly-header-grid' });
        headerGrid.style.gridTemplateColumns = dayColumnTemplate;
        const paddingCell = headerGrid.createDiv();
        paddingCell.style.cssText = 'background: none; border: none;';

        const startOfWeek = startFromCurrentDate ? this.currentDate.clone().startOf('day') : this.currentDate.clone().startOf('week');

        const wrapperScrollKey = `${this.getViewType()}:${startOfWeek.format('YYYY-MM-DD')}:${daysCount}:weekly-wrapper`;
        scrollWrapper.addEventListener('scroll', () => {
            this.savedScrollPositions[wrapperScrollKey] = {
                scrollTop: scrollWrapper.scrollTop,
                scrollLeft: scrollWrapper.scrollLeft
            };
        });
        const savedWrapperScroll = this.savedScrollPositions[wrapperScrollKey];
        if (savedWrapperScroll !== undefined) {
            scrollWrapper.scrollTop = savedWrapperScroll.scrollTop;
            scrollWrapper.scrollLeft = savedWrapperScroll.scrollLeft;
        }

        const hourHeight = this.getHourHeight();
        const startHour = this.plugin.settings.timelineStartHour ?? 0;
        const endHour = this.plugin.settings.timelineEndHour ?? 24;
        const hoursCount = endHour - startHour;
        const ratio = hourHeight / 60; // pixel / minute 비율

        // [최적화 시스템]: O(1) 날짜 기반 신속 매핑 구조 구축
        const tasksByDate = new Map<string, TaskItem[]>();
        this.tasks.forEach(t => {
            if (t.date) {
                if (!tasksByDate.has(t.date)) {
                    tasksByDate.set(t.date, []);
                }
                tasksByDate.get(t.date)!.push(t);
            }
        });

        const gcalByDate = new Map<string, GCalEvent[]>();
        if (this.plugin.settings.enableGoogleCalendar) {
            for (let i = 0; i < daysCount; i++) {
                const loopDayStr = startOfWeek.clone().add(i, 'days').format('YYYY-MM-DD');
                gcalByDate.set(loopDayStr, this.getCalendarEventsForDate(loopDayStr));
            }
        }

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            const isToday = loopDay.isSame((window as any).moment(), 'day');
            
            const cellHeader = headerGrid.createDiv({ 
                cls: `dp-grid-header ${isToday ? 'today' : ''}${weekendCls(loopDay)}`, 
                text: `${loopDay.format('ddd')} (${loopDay.format('M/D')})`
            });
            
            cellHeader.style.cssText = 'cursor: pointer; text-decoration: underline;';
            if (isToday) {
                cellHeader.style.cssText += ' border: 2px solid var(--interactive-accent); font-weight: bold;';
            }
            cellHeader.dataset.date = loopDayStr; // "Fit it in" drop target for a dragged task
            cellHeader.addEventListener('click', () => {
                this.handleDateClick(loopDayStr);
            });
        }

        const allDayGrid = container.createDiv({ cls: 'dp-weekly-allday-grid' });
        allDayGrid.style.gridTemplateColumns = dayColumnTemplate;
        allDayGrid.createDiv({ cls: 'dp-allday-label', text: 'All Day' });

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            
            const dayTasks = tasksByDate.get(loopDayStr) || [];
            const dayGCal = gcalByDate.get(loopDayStr) || [];

            const untimedTasks = dayTasks.filter(t => !t.startTime || !t.endTime);
            const untimedAllDayGCal = dayGCal.filter(e => e.isAllDay);

            const cell = allDayGrid.createDiv({ cls: `dp-allday-cell${weekendCls(loopDay)}` });

            untimedAllDayGCal.forEach(e => this.renderAllDayEventChip(e, loopDayStr, cell));
            untimedTasks.sort((a, b) => a.text.localeCompare(b.text));
            untimedTasks.forEach(task => this.renderAllDayTaskChip(task, cell));
        }

        const timelineScroll = container.createDiv({ cls: 'dp-content' });
        timelineScroll.style.cssText = 'flex-grow: 1; overflow-y: auto; padding: 0; position: relative;';

        const scrollKey = `${this.getViewType()}:${startOfWeek.format('YYYY-MM-DD')}:${daysCount}:weekly`;
        timelineScroll.addEventListener('scroll', () => {
            this.savedScrollPositions[scrollKey] = {
                scrollTop: timelineScroll.scrollTop,
                scrollLeft: timelineScroll.scrollLeft
            };
        });

        const timelineWrapper = timelineScroll.createDiv({ cls: 'dp-timeline-wrapper' });
        timelineWrapper.style.cssText = `min-height: calc(${hoursCount} * ${hourHeight}px);`;

        const hoursCol = timelineWrapper.createDiv({ cls: 'dp-timeline-hours' });
        for (let h = startHour; h < endHour; h++) {
            const hourMark = hoursCol.createDiv({ 
                cls: 'dp-timeline-hour-mark', 
                text: `${String(h).padStart(2, '0')}:00` 
            });
            hourMark.style.height = `${hourHeight}px`;
        }

        const daysWrapper = timelineWrapper.createDiv({ cls: 'dp-weekly-days-wrapper' });

        // 주간 뷰에서도 Task + 구글 일정을 동시 다중 선택하도록 필터링 해제
        this.registerMarqueeSelection(daysWrapper, () => {
            return Array.from(daysWrapper.querySelectorAll('.dp-timeline-event')) as HTMLElement[];
        });

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            
            const dayTasks = tasksByDate.get(loopDayStr) || [];
            const dayGCal = gcalByDate.get(loopDayStr) || [];

            const isToday = loopDay.isSame((window as any).moment(), 'day');

            const dayCol = daysWrapper.createDiv({ cls: `dp-weekly-day-col ${isToday ? 'today' : ''}${weekendCls(loopDay)}` });
            dayCol.style.cssText = 'flex: 1; position: relative; border-right: 1px solid var(--background-modifier-border); box-sizing: border-box;';
            dayCol.setAttribute('data-date', loopDayStr);

            dayCol.addEventListener('contextmenu', (e: MouseEvent) => {
                const targetEl = e.target as HTMLElement;
                if (targetEl.closest('.dp-timeline-event') || targetEl.closest('.dp-grid-task-item') || targetEl.closest('.dp-task-link-btn') || targetEl.closest('.dp-custom-cb')) {
                    return;
                }
                e.preventDefault();

                const rect = dayCol.getBoundingClientRect();
                const clickY = e.clientY - rect.top;
                let clickedMinutes = Math.round((clickY / ratio) / 15) * 15 + (startHour * 60);
                if (clickedMinutes < startHour * 60) clickedMinutes = startHour * 60;
                if (clickedMinutes > (endHour * 60) - 30) clickedMinutes = (endHour * 60) - 30;

                const hourStr = String(Math.floor(clickedMinutes / 60)).padStart(2, '0');
                const minStr = String(clickedMinutes % 60).padStart(2, '0');
                const startTimeStr = `${hourStr}:${minStr}`;
                const endTimeStr = addMinutesToTime(startTimeStr, 30);

                const menu = new Menu();
                (menu as any).dom?.addClass('dp-glass-menu');
                menu.addItem((item) =>
                    item
                        .setTitle(`Add Task at ${startTimeStr}`)
                        .setIcon("pencil")
                        .onClick(async () => {
                            const modal = new TaskEditModal(this.app, null, loopDayStr, async (data) => {
                                const targetFilePath = getTargetTaskFilePath(this.app, this.plugin.settings, data.date || loopDayStr);
                                await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                                new Notice('New task added successfully.');
                                await this.refreshTasks();
                            }, startTimeStr, endTimeStr);
                            modal.open();
                        })
                );

                if (this.plugin.settings.enableGoogleCalendar) {
                    menu.addItem((item) =>
                        item
                            .setTitle(`Add Appointment at ${startTimeStr}`)
                            .setIcon("calendar")
                            .onClick(() => {
                                const modal = new GCalEventEditModal(this.app, this.plugin, null, loopDayStr, async () => {
                                    await this.refreshTasks(null, true);
                                }, startTimeStr, endTimeStr);
                                modal.open();
                            })
                    );
                }

                menu.showAtMouseEvent(e);
            });

            dayCol.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.updateDragPreview(e, dayCol, this.activeDragClickOffsetMin, true);
            });
            dayCol.addEventListener('drop', async (e) => {
                e.preventDefault();
                const dataStr = e.dataTransfer?.getData('text/plain');
                if (!dataStr) return;

                try {
                    const { primaryTaskId, clickOffsetMin, isGCal } = JSON.parse(dataStr);
                    const rect = dayCol.getBoundingClientRect();
                    await this.moveSelectedTimelineItems(primaryTaskId, isGCal, this.snapTimelineMinutes(e.clientY - rect.top - clickOffsetMin, true), loopDayStr);
                } catch (err) {
                    console.error('Weekly drop error:', err);
                }
            });

            if (isToday) {
                const indicator = dayCol.createDiv({ cls: 'dp-timeline-current-indicator' });
                indicator.style.cssText = 'left: 0; right: 0;';
                const updateIndicator = () => {
                    const now = (window as any).moment();
                    const mins = now.hour() * 60 + now.minute();
                    const startMin = startHour * 60;
                    const endMin = endHour * 60;
                    if (mins < startMin || mins >= endMin) {
                        indicator.style.display = 'none';
                    } else {
                        indicator.style.display = 'block';
                        indicator.style.top = `${(mins - startMin) * ratio}px`; // 높이 비율 및 오프셋 적용
                    }
                };
                updateIndicator();
                const intervalId = window.setInterval(() => {
                    if (!indicator.isConnected) window.clearInterval(intervalId);
                    else updateIndicator();
                }, 60000);
                this.registerInterval(intervalId);
            }

            const timedItems: Array<{ 
                type: 'task' | 'gcal'; 
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
                colIdx?: number;
                maxCols?: number;
                startTime: string;
                endTime: string;
            }> = [];

            dayTasks.filter(t => t.startTime && t.endTime).forEach(t => {
                const [sh, sm] = t.startTime!.split(':').map(Number);
                const [eh, em] = t.endTime!.split(':').map(Number);
                timedItems.push({
                    type: 'task',
                    refId: t.id,
                    text: t.text,
                    startMin: sh * 60 + sm,
                    endMin: eh * 60 + em,
                    completed: t.completed,
                    taskRef: t,
                    startTime: t.startTime!,
                    endTime: t.endTime!
                });
            });

            dayGCal.filter(e => !e.isAllDay && e.startTimeStr && e.endTimeStr).forEach(e => {
                const [sh, sm] = e.startTimeStr!.split(':').map(Number);
                const [eh, em] = e.endTimeStr!.split(':').map(Number);
                timedItems.push({
                    type: 'gcal',
                    refId: e.id,
                    calendarId: e.calendarId,
                    text: e.summary,
                    startMin: sh * 60 + sm,
                    endMin: eh * 60 + em,
                    color: e.color,
                    location: e.location,
                    description: e.description,
                    startTime: e.startTimeStr!,
                    endTime: e.endTimeStr!
                });
            });

            calculateClusteredLayout(timedItems);

            const timelineStartMin = startHour * 60;
            const timelineEndMin = endHour * 60;

            timedItems.forEach(item => {
                // 노출 범위 밖의 일정은 렌더링 제외
                if (item.endMin <= timelineStartMin || item.startMin >= timelineEndMin) {
                    return;
                }

                const visibleStartMin = Math.max(timelineStartMin, item.startMin);
                const visibleEndMin = Math.min(timelineEndMin, item.endMin);
                const visibleDuration = visibleEndMin - visibleStartMin;

                const totalCols = item.maxCols || 1;
                const colIdx = item.colIdx || 0;
                const widthPct = 100 / totalCols;
                const leftPct = colIdx * widthPct;
                
                // 높이 조절 비율(ratio) 및 시작 시간 오프셋 적용된 주간 뷰 개별 카드 배치
                let cardCls = 'dp-timeline-event';
                const topPx = (visibleStartMin - timelineStartMin) * ratio;
                const heightPx = Math.max(15, visibleDuration * ratio); // 최소 높이 보장
                let customStyle = `top: ${topPx}px; height: ${heightPx}px; left: calc(${leftPct}% + 1px); width: calc(${widthPct}% - 2px);`;

                if (item.type === 'gcal') {
                    cardCls += ' dp-gcal-event';
                    if (item.color) {
                        customStyle += ` background-image: linear-gradient(${item.color}24, ${item.color}24) !important; border-left: 3px solid ${item.color} !important;`;
                    }
                    if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected'; // 다중 선택 visual 피드백 바인딩
                } else {
                    if (item.taskRef) {
                        if (item.taskRef.statusChar === 'x') cardCls += ' completed';
                        else if (item.taskRef.statusChar === '-') cardCls += ' cancelled';
                    }
                    if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected';
                }

                const eventCard = dayCol.createDiv({ cls: cardCls });
                eventCard.style.cssText = customStyle;
                eventCard.setAttribute('data-task-id', item.refId);
                // The item's real range on this day (the card itself is clipped to the visible hours): drag previews use it
                eventCard.dataset.startMin = String(item.startMin);
                eventCard.dataset.endMin = String(item.endMin);
                const locked = isLockedTask(item.taskRef); // done / cancelled: no drag, resize or long-press
                eventCard.style.fontSize = '0.75em';
                eventCard.style.padding = '4px';

                if (item.type === 'gcal') {
                    eventCard.setAttribute('draggable', 'true');
                    
                    this.addResizeListeners(eventCard, item as any, 'top');
                    this.addResizeListeners(eventCard, item as any, 'bottom');

                    const summaryDiv = eventCard.createDiv({ cls: 'dp-event-title' });
                    summaryDiv.setText(item.text);
                    
                    if (item.location) {
                        const locDiv = eventCard.createDiv({ cls: 'dp-event-meta' });
                        locDiv.setText(`📍 ${item.location}`);
                    }
                    if (item.description) {
                        const descDiv = eventCard.createDiv({ cls: 'dp-event-meta' });
                        descDiv.setText(item.description);
                    }

                    const cachedEvent = this.plugin.gcalCache.find(e => e.id === item.refId);
                    if (cachedEvent) {
                        eventCard.addEventListener('click', (ev) => {
                            if (ev.target instanceof HTMLElement && ev.target.classList.contains('dp-resize-handle')) return;
                            new GCalEventEditModal(this.app, this.plugin, cachedEvent, this.currentDate.format('YYYY-MM-DD'), async () => {
                                await this.refreshTasks(null, true);
                            }).open();
                        });
                    }

                    eventCard.addEventListener('dragstart', (e) => {
                        if (!e.dataTransfer) return;
                        if (!this.selectedTaskIds.has(item.refId)) {
                            this.selectedTaskIds.clear();
                            this.selectedTaskIds.add(item.refId);
                            
                            daysWrapper.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                            eventCard.addClass('selected');
                        }

                        const clickOffsetMin = this.timelineGrabOffset(eventCard, e.clientY);
                        this.activeDragClickOffsetMin = clickOffsetMin;

                        e.dataTransfer.setData('text/plain', JSON.stringify({
                            primaryTaskId: item.refId,
                            clickOffsetMin: clickOffsetMin,
                            sourceTab: this.getViewTabType(),
                            isGCal: true,
                            calendarId: item.calendarId
                        }));
                        
                        this.initDragPreview(e, item.refId, clickOffsetMin, daysWrapper);
                    });

                    eventCard.addEventListener('dragend', () => {
                        this.clearDragPreview(daysWrapper);
                    });
                } else {
                    eventCard.setAttribute('draggable', String(!locked));

                    if (item.taskRef && !locked) {
                        this.addResizeListeners(eventCard, item as any, 'top');
                        this.addResizeListeners(eventCard, item as any, 'bottom');
                    }

                    const mainRow = eventCard.createDiv({ cls: 'dp-event-main' });

                    if (item.taskRef) {
                        createCustomCheckbox(mainRow, item.taskRef, async (newStatus) => {
                            if (item.taskRef) {
                                await updateTaskInFile(this.app, item.taskRef, { statusChar: newStatus });
                                await this.refreshTasks();
                            }
                        });
                    }

                    const displayTitle = cleanTaskTextForDisplay(item.text);
                    const priorityPrefix = (item.taskRef && item.taskRef.priority !== 'normal') ? { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[item.taskRef.priority] + ' ' : '';
                    const textSpan = mainRow.createEl('span', {
                        cls: 'dp-task-text',
                        text: ` ${priorityPrefix}${displayTitle}` 
                    });

                    const linkBtn = mainRow.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (item.taskRef) {
                            await openTaskInEditor(this.app, item.taskRef);
                        }
                    });

                    let clickStartX = 0;
                    let clickStartY = 0;
                    let clickDragged = false;

                    eventCard.addEventListener('pointerdown', (e) => {
                        clickStartX = e.clientX;
                        clickStartY = e.clientY;
                        clickDragged = false;
                    });

                    eventCard.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (
                            e.target.classList.contains('dp-custom-cb') || 
                            e.target.classList.contains('dp-task-link-btn') || 
                            e.target.classList.contains('dp-resize-handle')
                        )) return;
                        e.stopPropagation();

                        const diffX = Math.abs(e.clientX - clickStartX);
                        const diffY = Math.abs(e.clientY - clickStartY);

                        if (diffX > 5 || diffY > 5 || clickDragged) {
                            return;
                        }

                        if (item.taskRef) {
                            const modal = new TaskEditModal(this.app, item.taskRef, null, async (data) => {
                                await updateTaskInFile(this.app, item.taskRef!, {
                                    text: data.text,
                                    statusChar: data.statusChar,
                                    priority: data.priority,
                                    date: data.date,
                                    startTime: data.startTime,
                                    endTime: data.endTime,
                                    recurrence: data.recurrence,
                                    dueDate: data.dueDate,
                                    scheduledDate: data.scheduledDate,
                                    startDate: data.startDate,
                                    completionDate: data.completionDate,
                                    cancelledDate: data.cancelledDate
                                });
                                await this.refreshTasks();
                            });
                            modal.open();
                        }
                    });

                    eventCard.addEventListener('dragstart', (e) => {
                        clickDragged = true;
                        if (!e.dataTransfer) return;
                        if (!this.selectedTaskIds.has(item.refId)) {
                            this.selectedTaskIds.clear();
                            this.selectedTaskIds.add(item.refId);
                            
                            daysWrapper.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                            eventCard.addClass('selected');
                        }

                        const clickOffsetMin = this.timelineGrabOffset(eventCard, e.clientY);
                        this.activeDragClickOffsetMin = clickOffsetMin;

                        e.dataTransfer.setData('text/plain', JSON.stringify({
                            primaryTaskId: item.refId,
                            clickOffsetMin: clickOffsetMin,
                            sourceTab: this.getViewTabType(),
                            isGCal: false
                        }));

                        this.initDragPreview(e, item.refId, clickOffsetMin, daysWrapper);
                    });

                    eventCard.addEventListener('dragend', () => {
                        this.clearDragPreview(daysWrapper);
                    });
                }
                if (this.useCompactLayout() && !locked) this.registerLongPressDrag(eventCard, item.refId, item.type === 'gcal', daysWrapper);
                if (!locked) this.registerMouseDrag(eventCard, { kind: 'timeline', refId: item.refId, isGCal: item.type === 'gcal', previewRoot: daysWrapper });
            });
        }

        const visibleDates = Array.from({ length: daysCount }, (_, i) => startOfWeek.clone().add(i, 'days').format('YYYY-MM-DD'));
        this.applyAutoScroll(timelineScroll, scrollKey, `weekly:${daysCount}`, 'now', () => this.getAutoScrollY(visibleDates, startHour, hourHeight));
        this.playNavSlide(container, scrollWrapper);
    }

    /**
     * 3. 월간 달력 그리기 구현 (요일 헤더 분리 및 셀 높이 160px 균등 고정 설계)
     */
    renderMonthlyCalendar(parent: HTMLDivElement) {
        parent.empty();
        
        // Phone: 7 columns only (no week numbers), chips fitted to the cell height (+N), a tap opens the day in Daily
        const phone = this.useCompactLayout();
        const scrollWrapper = parent.createDiv({ cls: 'dp-monthly-scroll-wrapper' });
        const container = scrollWrapper.createDiv({ cls: `dp-monthly-container${phone ? ' dp-monthly-compact' : ''}` });

        const monthlyScrollKey = `${this.getViewType()}:${this.currentDate.format('YYYY-MM')}:monthly`;
        scrollWrapper.addEventListener('scroll', () => {
            this.savedScrollPositions[monthlyScrollKey] = {
                scrollTop: scrollWrapper.scrollTop,
                scrollLeft: scrollWrapper.scrollLeft
            };
        });

        const savedMonthlyScroll = this.savedScrollPositions[monthlyScrollKey];
        if (savedMonthlyScroll !== undefined) {
            scrollWrapper.scrollTop = savedMonthlyScroll.scrollTop;
            scrollWrapper.scrollLeft = savedMonthlyScroll.scrollLeft;
        }

        const headerGrid = container.createDiv({ cls: 'dp-monthly-header-grid' });
        if (!phone) headerGrid.createDiv({ 
            cls: 'dp-grid-header', 
            text: 'Wk' 
        });

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let i = 0; i < 7; i++) {
            headerGrid.createDiv({ cls: `dp-grid-header${i === 0 ? ' is-sunday' : i === 6 ? ' is-saturday' : ''}`, text: weekdays[i] });
        }

        const grid = container.createDiv({ cls: 'dp-grid-calendar' });

        const startOfMonth = this.currentDate.clone().startOf('month');
        const endOfMonth = this.currentDate.clone().endOf('month');
        const startDayOfWeek = startOfMonth.day(); 
        const daysInMonth = endOfMonth.date();
        const totalGridCells = startDayOfWeek + daysInMonth;
        const totalWeeks = Math.ceil(totalGridCells / 7);
        const gridStartDate = startOfMonth.clone().subtract(startDayOfWeek, 'days');
        grid.style.setProperty('--dp-week-count', String(totalWeeks)); // rows split the available height evenly

        const tasksByDate = new Map<string, TaskItem[]>();
        this.tasks.forEach(t => {
            if (t.date) {
                if (!tasksByDate.has(t.date)) {
                    tasksByDate.set(t.date, []);
                }
                tasksByDate.get(t.date)!.push(t);
            }
        });

        const gcalByDate = new Map<string, GCalEvent[]>();
        if (this.plugin.settings.enableGoogleCalendar) {
            const totalDays = totalWeeks * 7;
            for (let i = 0; i < totalDays; i++) {
                const loopDayStr = gridStartDate.clone().add(i, 'days').format('YYYY-MM-DD');
                gcalByDate.set(loopDayStr, this.getCalendarEventsForDate(loopDayStr));
            }
        }

        // All week/day cells are built off-DOM and attached to the grid in one append (no per-cell layout work)
        const cells = document.createDocumentFragment();
        for (let w = 0; w < totalWeeks; w++) {
            const weekStartDate = gridStartDate.clone().add(w * 7, 'days');
            const weekNum = weekStartDate.week();

            if (!phone) {
                const weekCell = cells.createDiv({ cls: 'dp-grid-week-cell' });
                weekCell.createDiv({ 
                    text: `Wk ${weekNum}` 
                });
                weekCell.createDiv({ 
                    text: 'W' 
                });

                weekCell.addEventListener('click', () => {
                    this.openNoteForDate(weekStartDate, 'weekly');
                });
            }

            for (let d = 0; d < 7; d++) {
                const loopDay = weekStartDate.clone().add(d, 'days');
                const loopDayStr = loopDay.format('YYYY-MM-DD');
                const isCurrentMonth = loopDay.month() === startOfMonth.month();
                const isToday = loopDay.isSame((window as any).moment(), 'day');
                const cell = cells.createDiv({ cls: `dp-grid-cell ${isToday ? 'today' : ''}${weekendCls(loopDay)}` });
                cell.dataset.date = loopDayStr; // drop target for drawer tasks (date only)

                if (!isCurrentMonth) cell.style.opacity = '0.3';

                const cellNum = cell.createDiv({ cls: 'dp-grid-cell-num', text: String(loopDay.date()) });
                cellNum.style.cssText = 'cursor: pointer; text-decoration: underline; color: var(--text-accent); font-weight: bold;';
                cellNum.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (phone) void this.focusDay(loopDayStr);
                    else this.handleDateClick(loopDayStr);
                });
                if (phone) cell.addEventListener('click', () => this.focusDay(loopDayStr));

                const listWrapper = cell.createDiv({ cls: 'dp-grid-task-list' });

                const dayTasks = [...(tasksByDate.get(loopDayStr) || [])];
                dayTasks.sort((a, b) => {
                    const timeA = a.startTime || '23:59';
                    const timeB = b.startTime || '23:59';
                    return timeA.localeCompare(timeB);
                });

                const dayGCal = gcalByDate.get(loopDayStr) || [];
                dayGCal.forEach(e => {
                    let customStyle = '';
                    if (e.color) {
                        customStyle = `background-color: ${e.color}1c !important; border-left: 3px solid ${e.color} !important;`;
                    }
                    // Compact cells are ~45px wide: the time would leave room for only 1–2 title characters
                    const timePrefix = e.startTimeStr && !phone ? `${e.startTimeStr} ` : '';
                    const locationSuffix = e.location ? ` (📍 ${e.location})` : '';
                    const displayText = `${timePrefix}${e.summary}${locationSuffix}`;

                    const gcalItem = listWrapper.createDiv({ 
                        cls: 'dp-grid-task-item dp-gcal-event',
                        text: displayText
                    });
                    if (customStyle) gcalItem.style.cssText = customStyle;
                    
                    gcalItem.addEventListener('click', () => {
                        new GCalEventEditModal(this.app, this.plugin, e, loopDayStr, async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                });

                dayTasks.forEach(task => {
                    let itemClass = 'dp-grid-task-item';
                    if (task.statusChar === 'x') itemClass += ' completed';
                    else if (task.statusChar === '-') itemClass += ' cancelled';

                    const item = listWrapper.createDiv({ cls: itemClass });
                    const displayTitle = cleanTaskTextForDisplay(task.text);
                    const priorityPrefix = task.priority !== 'normal' ? { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[task.priority] + ' ' : '';
                    const textSpan = item.createSpan({
                        cls: 'dp-task-text',
                        text: `${task.startTime && !phone ? `${task.startTime} ` : ''}${priorityPrefix}${displayTitle}`
                    });

                    const taskColor = this.plugin.settings.taskColor || '#ff9f1c';
                    if (task.statusChar === '-') {
                        item.style.cssText = `opacity: 0.55; border-left: 3px solid var(--text-error) !important; background-color: rgba(235, 87, 87, 0.05) !important;`;
                    } else if (task.statusChar === 'x') {
                        item.style.cssText = `opacity: 0.5; border-left: 3px solid var(--text-muted) !important; background-color: var(--background-secondary) !important;`;
                    } else {
                        item.style.cssText = `border-left: 3px solid ${taskColor} !important; background-color: ${taskColor}15 !important;`;
                    }

                    const linkBtn = item.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, task);
                    });

                    item.addEventListener('click', (e) => {
                        if (e.target === linkBtn) return;
                        e.stopPropagation();
                        const modal = new TaskEditModal(this.app, task, null, async (data) => {
                            await updateTaskInFile(this.app, task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });
                    // Desktop: drag onto another day (date only) or back into the side drawer (unschedule)
                    if (!isLockedTask(task)) this.registerMouseDrag(item, { kind: 'task', task, origin: 'month' });
                });

                cell.addEventListener('dblclick', (e) => {
                    if (e.target !== cell && e.target !== listWrapper) return;
                    const modal = new TaskEditModal(this.app, null, loopDayStr, async (data) => {
                        const activeFile = this.app.workspace.getActiveFile();
                        const targetFilePath = (activeFile && activeFile.extension === 'md') ? activeFile.path : this.plugin.settings.defaultTaskFile;
                        await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                        await this.refreshTasks();
                    });
                    modal.open();
                });
            }
        }
        grid.appendChild(cells);
        if (phone) this.fitMonthlyChips(grid);
        this.playNavSlide(container, scrollWrapper); // month pagination / Today slide
    }

    /**
     * Compact Monthly: each cell shows as many chips as its list height fits (cells never scroll), the rest as +N.
     * Refits whenever the grid resizes (rotation, keyboard, pane shown again); a hidden pane (height 0) keeps its fit.
     */
    fitMonthlyChips(grid: HTMLElement) {
        const CHIP = 16, GAP = 2, MORE = 12; // compact chip height, list gap and +N line (styles.ts, .dp-monthly-compact)
        const fit = () => {
            const lists = Array.from(grid.querySelectorAll<HTMLElement>('.dp-grid-task-list'));
            const heights = lists.map(list => list.clientHeight); // all reads first: one layout pass, then only writes
            lists.forEach((list, i) => {
                if (heights[i] === 0) return;
                list.querySelector(':scope > .dp-grid-more')?.remove();
                const chips = Array.from(list.querySelectorAll<HTMLElement>(':scope > .dp-grid-task-item'));
                let shown = Math.floor((heights[i] + GAP) / (CHIP + GAP));
                if (shown < chips.length) shown = Math.max(0, Math.floor((heights[i] - MORE) / (CHIP + GAP))); // room for +N
                chips.forEach((chip, j) => chip.toggleClass('dp-chip-overflow', j >= shown));
                if (shown < chips.length) list.createDiv({ cls: 'dp-grid-more', text: `+${chips.length - shown}` });
            });
        };
        // Fires once after the first layout, then on every size change; stops with the grid it measures
        const observer = new ResizeObserver(() => {
            if (!grid.isConnected) observer.disconnect();
            else fit();
        });
        observer.observe(grid);
    }

    /**
     * 4. 칸반 보드 (Board) 뷰 이원화 통합 컨트롤러
     */
    renderKanbanBoard(parent: HTMLDivElement) {
        parent.empty();
        this.mountBoardModeToggle(parent.parentElement);

        const board = parent.createDiv({ cls: 'dp-kanban-board' });
        // Mode toggle sets navDirection: the fresh board slides in from the side of the tab that was clicked
        this.playNavSlide(board, parent);

        const boardScrollKey = `${this.getViewType()}:kanban-board`;
        board.addEventListener('scroll', () => {
            this.savedScrollPositions[boardScrollKey] = {
                scrollTop: board.scrollTop,
                scrollLeft: board.scrollLeft
            };
        });

        const savedBoardScroll = this.savedScrollPositions[boardScrollKey];
        if (savedBoardScroll !== undefined) {
            board.scrollTop = savedBoardScroll.scrollTop;
            board.scrollLeft = savedBoardScroll.scrollLeft;
        }

        if (this.kanbanViewMode === 'priority') {
            this.renderPriorityFocusBoard(board);
        } else {
            this.renderStandardKanbanBoard(board);
        }
    }

    /**
     * Board mode switch lives in the header toolbar (no dedicated row). Called on every board render and
     * whenever the combined view rebuilds its header over a cached board pane; replaces any previous copy.
     */
    mountBoardModeToggle(rootEl: HTMLElement | null) {
        const headerActions = rootEl?.querySelector(':scope > .dp-header .dp-header-actions') as HTMLElement | null;
        if (!headerActions) return;
        headerActions.querySelector(':scope > .dp-board-toggle')?.remove();
        const toggleRow = headerActions.createDiv({ cls: 'dp-board-toggle' });
        headerActions.prepend(toggleRow);
        const kanbanToggle = toggleRow.createEl('button', {
            cls: `dp-board-toggle-btn ${this.kanbanViewMode === 'kanban' ? 'active' : ''}`,
            attr: { title: 'Standard Kanban', 'aria-label': 'Kanban' }
        });
        kanbanToggle.createSpan({ cls: 'dp-btn-icon', text: '🗂️' });
        kanbanToggle.createSpan({ cls: 'dp-btn-label', text: ' Kanban' });
        const priorityToggle = toggleRow.createEl('button', {
            cls: `dp-board-toggle-btn ${this.kanbanViewMode === 'priority' ? 'active' : ''}`,
            attr: { title: 'Priority Focus', 'aria-label': 'Priority' }
        });
        priorityToggle.createSpan({ cls: 'dp-btn-icon', text: '🎯' });
        priorityToggle.createSpan({ cls: 'dp-btn-label', text: ' Priority' });

        const switchMode = (mode: 'kanban' | 'priority') => {
            if (this.kanbanViewMode === mode) return;
            triggerHaptic('selection');
            this.kanbanViewMode = mode;
            // Priority is the right-hand tab → slide in from the right; Kanban (left tab) → from the left
            this.navDirection = mode === 'priority' ? 'next' : 'prev';
            try {
                this.render();
            } finally {
                this.navDirection = null; // only this render animates, not later data refreshes
            }
        };
        kanbanToggle.addEventListener('click', () => switchMode('kanban'));
        priorityToggle.addEventListener('click', () => switchMode('priority'));
    }

    /**
     * Phone Board: one full-width column at a time, picked from a scrollable switcher above the board.
     * Returns the columns to render (all of them outside the phone layout).
     */
    pickPhoneBoardColumns<T extends { id: string; title: string }>(board: HTMLDivElement, columns: T[], countOf: (col: T) => number): T[] {
        if (!this.useCompactLayout()) return columns;
        const mode = this.kanbanViewMode;
        const activeId = columns.some(c => c.id === this.phoneBoardColumn[mode]) ? this.phoneBoardColumn[mode] : columns[0].id;
        const activeIdx = columns.findIndex(c => c.id === activeId);
        this.phoneBoardColumnIds = columns.map(c => c.id);

        const switcher = createDiv({ cls: 'dp-board-col-switcher' });
        board.before(switcher);
        columns.forEach((col, idx) => {
            const btn = switcher.createEl('button', { cls: `dp-tab dp-board-col-tab ${col.id === activeId ? 'active' : ''}` });
            btn.createSpan({ text: col.title });
            btn.createSpan({ cls: 'dp-board-col-tab-count', text: String(countOf(col)) });
            btn.addEventListener('click', () => {
                if (idx === activeIdx) return;
                triggerHaptic('selection');
                this.phoneBoardColumn[mode] = col.id;
                this.navDirection = idx > activeIdx ? 'next' : 'prev';
                try {
                    this.render();
                } finally {
                    this.navDirection = null;
                }
            });
        });
        keepActiveTabInView(switcher, this.boardSwitcherScroll);
        // Column changed (tap, swipe, j/k): center the new pill. Scrolls only the switcher, unlike scrollIntoView,
        // which would also nudge the overflow-hidden ancestors of the view.
        const activeBtn = switcher.querySelector<HTMLElement>(':scope > .dp-tab.active');
        if (this.navDirection && activeBtn && switcher.clientWidth > 0) {
            const left = activeBtn.offsetLeft - (switcher.clientWidth - activeBtn.offsetWidth) / 2;
            switcher.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
        }
        return columns.filter(c => c.id === activeId);
    }

    /** Compact Board: step to the neighbouring column (stops at both ends). Returns false when nothing changed. */
    navigateBoardTab(step: 1 | -1): boolean {
        if (!this.useCompactLayout() || this.getViewTabType() !== 'board') return false;
        const ids = this.phoneBoardColumnIds;
        const mode = this.kanbanViewMode;
        const idx = Math.max(0, ids.indexOf(this.phoneBoardColumn[mode]));
        const next = idx + step;
        if (next < 0 || next >= ids.length) return false;
        triggerHaptic('selection');
        this.phoneBoardColumn[mode] = ids[next];
        this.navDirection = step > 0 ? 'next' : 'prev';
        try {
            this.render();
        } finally {
            this.navDirection = null;
        }
        return true;
    }

    /**
     * 4-A. 기본 스탠다드 칸반 보드 뷰 그리기
     */
    renderStandardKanbanBoard(board: HTMLDivElement) {
        // Columns are relative to the real calendar day, not the date the other tabs are paged to
        const referenceDate = (window as any).moment().startOf('day');
        const todayStr = referenceDate.format('YYYY-MM-DD');
        const tomorrowStr = referenceDate.clone().add(1, 'day').format('YYYY-MM-DD');

        const columns = [
            {
                id: 'undated',
                title: 'Undated',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date === null
            },
            {
                id: 'overdue',
                title: 'Overdue',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date !== null && t.date < todayStr
            },
            {
                id: 'today',
                title: 'Today',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date === todayStr
            },
            {
                id: 'tomorrow',
                title: 'Tomorrow',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date === tomorrowStr
            },
            {
                id: 'future',
                title: 'Future',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date !== null && t.date > tomorrowStr
            },
            {
                id: 'completed',
                title: 'Completed',
                filter: (t: TaskItem) => t.statusChar === 'x' || t.statusChar === '-'
            }
        ];

          if (!this.collapsedColumns) {
            this.collapsedColumns = new Set<string>();
        }

        const phone = this.useCompactLayout();
        this.pickPhoneBoardColumns(board, columns, col => this.tasks.filter(col.filter).length).forEach(col => {
            const colTasks = this.tasks.filter(col.filter);
            colTasks.sort(compareTasks);

            const colEl = board.createDiv({ cls: 'dp-kanban-column' });
            colEl.setAttribute('data-col-id', col.id);

            const isCollapsed = !phone && this.collapsedColumns.has(col.id);
            if (isCollapsed) {
                colEl.addClass('collapsed');
                colEl.style.minWidth = '44px';
                colEl.style.maxWidth = '44px';
                colEl.style.padding = '12px 6px';
                colEl.style.alignItems = 'center';
            }

            const header = colEl.createDiv({ cls: 'dp-kanban-col-header' });
            if (isCollapsed) {
                header.style.flexDirection = 'column';
                header.style.borderBottom = 'none';
                header.style.height = 'auto';
                header.style.justifyContent = 'flex-start';
                header.style.marginBottom = '0';
                header.style.paddingBottom = '0';
                header.style.gap = '8px';
            }

            const titleSpan = header.createSpan({ text: col.title });
            if (isCollapsed) {
                titleSpan.style.writingMode = 'vertical-lr';
                titleSpan.style.textOrientation = 'mixed';
                titleSpan.style.transform = 'rotate(180deg)';
                titleSpan.style.whiteSpace = 'nowrap';
            }

            header.createSpan({ cls: 'dp-kanban-col-count', text: String(colTasks.length) });

            const toggleBtn = header.createSpan({ 
                text: isCollapsed ? '▶' : '◀', 
                cls: 'dp-kanban-col-toggle'
            });
            toggleBtn.addEventListener('mouseenter', () => toggleBtn.style.opacity = '1');
            toggleBtn.addEventListener('mouseleave', () => toggleBtn.style.opacity = '0.6');
            toggleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedColumns.delete(col.id);
                } else {
                    this.collapsedColumns.add(col.id);
                }
                if ((this as any).updateCodeBlockInFile) {
                    if ((this as any).debouncedUpdateCodeBlock) {
                        (this as any).debouncedUpdateCodeBlock((this as any).viewType, (this as any).filters);
                    }
                } else {
                    this.plugin.settings.collapsedColumns = Array.from(this.collapsedColumns);
                    await this.plugin.saveSettings();
                }
                this.render();
            });

            if (!isCollapsed) {
                const cardsWrapper = colEl.createDiv({ cls: 'dp-kanban-cards' });

                const colScrollKey = `${this.getViewType()}:kanban-column:${this.kanbanViewMode}:${col.id}`;
                cardsWrapper.addEventListener('scroll', () => {
                    this.savedScrollPositions[colScrollKey] = {
                        scrollTop: cardsWrapper.scrollTop,
                        scrollLeft: cardsWrapper.scrollLeft
                    };
                });
                const savedColScroll = this.savedScrollPositions[colScrollKey];
                if (savedColScroll !== undefined) {
                    cardsWrapper.scrollTop = savedColScroll.scrollTop;
                    cardsWrapper.scrollLeft = savedColScroll.scrollLeft;
                }

                colTasks.forEach(task => {
                    let cardClass = 'dp-kanban-card';
                    if (task.statusChar === 'x') cardClass += ' completed';
                    else if (task.statusChar === '-') cardClass += ' cancelled';

                    const card = cardsWrapper.createDiv({ cls: cardClass });
                    card.setAttribute('draggable', 'true');
                    card.setAttribute('data-task-id', task.id);

                    const titleWrapper = card.createDiv({ cls: 'dp-kanban-card-title' });
                    const leftPart = titleWrapper.createSpan();
                    leftPart.style.cssText = 'display: flex; align-items: center; flex-grow: 1; overflow: hidden; gap: 6px;';
                    
                    createCustomCheckbox(leftPart, task, async (newStatus) => {
                        await updateTaskInFile(this.app, task, { statusChar: newStatus });
                        await this.refreshTasks();
                    });

                    const displayTitle = cleanTaskTextForDisplay(task.text);
                    const titleSpan = leftPart.createSpan({ text: `${displayTitle}` });
                    titleSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                    const linkBtn = titleWrapper.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, task);
                    });

                    const meta = card.createDiv({ cls: 'dp-kanban-card-meta' });
                    meta.createDiv({ cls: 'dp-kanban-card-file', text: task.filePath });
                    if (task.startTime) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-time', text: `⏰ ${task.startTime}-${task.endTime}` });
                    }
                    if (task.date) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-date', text: `⏳ ${task.date}` });
                    }
                    
                    if (task.priority !== 'normal') {
                        const priorityEmojis = { highest: 'Highest 🔺', high: 'High ⏫', medium: 'Medium 🔼', low: 'Low 🔽', lowest: 'Lowest ⏬' };
                        meta.createDiv({ 
                            cls: 'dp-badge dp-badge-priority', 
                            text: priorityEmojis[task.priority]
                        });
                    }
                    if (task.statusChar !== ' ' && task.statusChar !== 'x') {
                        const statusLabels = { '/': 'In Progress', '-': 'Cancelled' };
                        meta.createDiv({
                            cls: 'dp-badge',
                            text: (statusLabels as any)[task.statusChar] || task.statusChar
                        });
                    }

                    card.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
                        const modal = new TaskEditModal(this.app, task, null, async (data) => {
                            await updateTaskInFile(this.app, task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });

                    card.addEventListener('dragstart', (e) => {
                        if (e.dataTransfer) {
                            e.dataTransfer.setData('text/plain', task.id);
                            card.style.opacity = '0.4';
                        }
                    });

                    card.addEventListener('dragend', () => {
                        card.style.opacity = '1';
                    });
                });
            }

            colEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                colEl.addClass('drag-over');
            });

            colEl.addEventListener('dragleave', () => {
                colEl.removeClass('drag-over');
            });

            colEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                colEl.classList.remove('drag-over');
                
                const taskId = e.dataTransfer?.getData('text/plain');
                if (!taskId) return;

                const targetTask = this.tasks.find(t => t.id === taskId);
                if (!targetTask) return;

                let dateUpdate: string | null = targetTask.date;
                let statusCharUpdate: string = targetTask.statusChar;

                switch (col.id) {
                    case 'undated':
                        dateUpdate = null;
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'overdue':
                        dateUpdate = referenceDate.clone().subtract(1, 'day').format('YYYY-MM-DD');
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'today':
                        dateUpdate = todayStr;
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'tomorrow':
                        dateUpdate = tomorrowStr;
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'future':
                        dateUpdate = referenceDate.clone().add(3, 'days').format('YYYY-MM-DD');
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'completed':
                        statusCharUpdate = 'x';
                        break;
                }

                const updated = await updateTaskInFile(this.app, targetTask, {
                    date: dateUpdate,
                    statusChar: statusCharUpdate
                });

                if (updated) {
                    new Notice(`Moved task to '${col.title}' column.`);
                    await this.refreshTasks();
                }
            });
        });
    }

    /**
     * 4-B. 우선순위 포커스 보드 뷰
     */
    renderPriorityFocusBoard(board: HTMLDivElement) {
        const columns = [
            { id: 'highest', title: 'Highest 🔺', priority: 'highest' as const },
            { id: 'high', title: 'High ⏫', priority: 'high' as const },
            { id: 'medium', title: 'Medium 🔼', priority: 'medium' as const },
            { id: 'normal', title: 'Normal 🟢', priority: 'normal' as const },
            { id: 'low', title: 'Low 🔽', priority: 'low' as const },
            { id: 'lowest', title: 'Lowest ⏬', priority: 'lowest' as const }
        ];

        const phone = this.useCompactLayout();
        const openTasksOf = (col: typeof columns[number]) =>
            this.tasks.filter(t => (t.statusChar === ' ' || t.statusChar === '/') && t.priority === col.priority);
        this.pickPhoneBoardColumns(board, columns, col => openTasksOf(col).length).forEach(col => {
            const colTasks = openTasksOf(col);
            colTasks.sort(compareTasks);

            const colEl = board.createDiv({ cls: 'dp-kanban-column' });
            colEl.setAttribute('data-col-id', col.id);

            const isCollapsed = !phone && this.collapsedColumns.has(col.id);
            if (isCollapsed) {
                colEl.addClass('collapsed');
                colEl.style.minWidth = '44px';
                colEl.style.maxWidth = '44px';
                colEl.style.padding = '12px 6px';
                colEl.style.alignItems = 'center';
            }

            const header = colEl.createDiv({ cls: 'dp-kanban-col-header' });
            if (isCollapsed) {
                header.style.flexDirection = 'column';
                header.style.borderBottom = 'none';
                header.style.height = 'auto';
                header.style.justifyContent = 'flex-start';
                header.style.marginBottom = '0';
                header.style.paddingBottom = '0';
                header.style.gap = '8px';
            }

            const titleSpan = header.createSpan({ text: col.title });
            if (isCollapsed) {
                titleSpan.style.writingMode = 'vertical-lr';
                titleSpan.style.textOrientation = 'mixed';
                titleSpan.style.transform = 'rotate(180deg)';
                titleSpan.style.whiteSpace = 'nowrap';
            }

            header.createSpan({ cls: 'dp-kanban-col-count', text: String(colTasks.length) });

            const toggleBtn = header.createSpan({ 
                text: isCollapsed ? '▶' : '◀', 
                cls: 'dp-kanban-col-toggle'
            });
            toggleBtn.addEventListener('mouseenter', () => toggleBtn.style.opacity = '1');
            toggleBtn.addEventListener('mouseleave', () => toggleBtn.style.opacity = '0.6');
            toggleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedColumns.delete(col.id);
                } else {
                    this.collapsedColumns.add(col.id);
                }
                if ((this as any).updateCodeBlockInFile) {
                    if ((this as any).debouncedUpdateCodeBlock) {
                        (this as any).debouncedUpdateCodeBlock((this as any).viewType, (this as any).filters);
                    }
                } else {
                    this.plugin.settings.collapsedColumns = Array.from(this.collapsedColumns);
                    await this.plugin.saveSettings();
                }
                this.render();
            });

            if (!isCollapsed) {
                const cardsWrapper = colEl.createDiv({ cls: 'dp-kanban-cards' });

                const colScrollKey = `${this.getViewType()}:kanban-column:${this.kanbanViewMode}:${col.id}`;
                cardsWrapper.addEventListener('scroll', () => {
                    this.savedScrollPositions[colScrollKey] = {
                        scrollTop: cardsWrapper.scrollTop,
                        scrollLeft: cardsWrapper.scrollLeft
                    };
                });
                const savedColScroll = this.savedScrollPositions[colScrollKey];
                if (savedColScroll !== undefined) {
                    cardsWrapper.scrollTop = savedColScroll.scrollTop;
                    cardsWrapper.scrollLeft = savedColScroll.scrollLeft;
                }

                colTasks.forEach(task => {
                    let cardClass = 'dp-kanban-card';
                    if (task.statusChar === '/') cardClass += ' in-progress';

                    const card = cardsWrapper.createDiv({ cls: cardClass });
                    card.setAttribute('draggable', 'true');
                    card.setAttribute('data-task-id', task.id);

                    const titleWrapper = card.createDiv({ cls: 'dp-kanban-card-title' });
                    const leftPart = titleWrapper.createSpan();
                    leftPart.style.cssText = 'display: flex; align-items: center; flex-grow: 1; overflow: hidden; gap: 6px;';
                    
                    createCustomCheckbox(leftPart, task, async (newStatus) => {
                        await updateTaskInFile(this.app, task, { statusChar: newStatus });
                        await this.refreshTasks();
                    });

                    const displayTitle = cleanTaskTextForDisplay(task.text);
                    const titleSpan = leftPart.createSpan({ text: displayTitle });
                    titleSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                    const linkBtn = titleWrapper.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, task);
                    });

                    const meta = card.createDiv({ cls: 'dp-kanban-card-meta' });
                    meta.createDiv({ cls: 'dp-kanban-card-file', text: task.filePath });
                    if (task.startTime) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-time', text: `⏰ ${task.startTime}-${task.endTime}` });
                    }
                    if (task.date) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-date', text: `⏳ ${task.date}` });
                    }
                    if (task.statusChar === '/') {
                        meta.createDiv({
                            cls: 'dp-badge',
                            text: 'In Progress ⚡'
                        });
                    }

                    card.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
                        const modal = new TaskEditModal(this.app, task, null, async (data) => {
                            await updateTaskInFile(this.app, task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });

                    card.addEventListener('dragstart', (e) => {
                        if (e.dataTransfer) {
                            e.dataTransfer.setData('text/plain', task.id);
                            card.style.opacity = '0.4';
                        }
                    });

                    card.addEventListener('dragend', () => {
                        card.style.opacity = '1';
                    });
                });
            }

            colEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                colEl.addClass('drag-over');
            });

            colEl.addEventListener('dragleave', () => {
                colEl.removeClass('drag-over');
            });

            colEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                colEl.classList.remove('drag-over');
                
                const taskId = e.dataTransfer?.getData('text/plain');
                if (!taskId) return;

                const targetTask = this.tasks.find(t => t.id === taskId);
                if (!targetTask) return;
                const updated = await updateTaskInFile(this.app, targetTask, {
                    priority: col.priority
                });

                if (updated) {
                    new Notice(`Priority re-assigned to '${col.title}'`);
                    await this.refreshTasks();
                }
            });
        });
    }

    renderListView(parent: HTMLDivElement) {
        parent.empty();

        if (!(this as any).listSearchQuery) (this as any).listSearchQuery = '';

        const self = this as any;

        const container = parent.createDiv({ cls: 'dp-gc-list-container' });

        // Header with search bar
        const header = container.createDiv({ cls: 'dp-gc-list-header' });
        let searchPlaceholder = "🔍 Search this month's agenda...";
        if (self.parentNoteType === 'daily') {
            searchPlaceholder = "🔍 Search today's agenda...";
        } else if (self.parentNoteType === 'weekly') {
            searchPlaceholder = "🔍 Search this week's agenda...";
        }
        const searchInput = header.createEl('input', {
            type: 'text',
            value: self.listSearchQuery,
            placeholder: searchPlaceholder,
            cls: 'dp-gc-search'
        });
        searchInput.addEventListener('input', async () => {
            self.listSearchQuery = searchInput.value.toLowerCase().trim();
            await this.refreshTasks();
        });

        // Date limits: only this month (or today/this week if in daily/weekly notes)!
        let startDate = this.currentDate.clone().startOf('month');
        let endDate = this.currentDate.clone().endOf('month');

        if (self.parentNoteType === 'daily' && self.parentNoteDate) {
            startDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('day');
            endDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('day');
        } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
            startDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week');
            endDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week');
        }

        const startStr = startDate.format('YYYY-MM-DD');
        const endStr = endDate.format('YYYY-MM-DD');

        const todayMoment = (window as any).moment();
        const todayStr = todayMoment.format('YYYY-MM-DD');

        // Apply filters to tasks
        let filteredTasks = this.tasks;
        if (self.filters && self.filters.rules && self.filters.rules.length > 0) {
            filteredTasks = filteredTasks.filter(task => matchFilterGroup(task, self.filters));
        }

        // Search filter tasks
        if (self.listSearchQuery) {
            filteredTasks = filteredTasks.filter(t => 
                t.text.toLowerCase().includes(self.listSearchQuery) || 
                t.filePath.toLowerCase().includes(self.listSearchQuery)
            );
        }

        // Fetch GCal events
        let filteredEvents = this.getCalendarEvents();
        if (self.listSearchQuery) {
            filteredEvents = filteredEvents.filter(e => 
                e.summary.toLowerCase().includes(self.listSearchQuery) || 
                (e.description && e.description.toLowerCase().includes(self.listSearchQuery))
            );
        }

        // Grouping items by day (only days with items!)
        const daysMap: Map<string, any[]> = new Map();

        filteredTasks.forEach(task => {
            if (task.date !== null && task.date >= startStr && task.date <= endStr) {
                if (!daysMap.has(task.date)) daysMap.set(task.date, []);
                daysMap.get(task.date)!.push({ type: 'task', task });
            }
        });

        filteredEvents.forEach(event => {
            const spannedDates = this.getSpannedDatesForEvent(event);
            spannedDates.forEach(dateStr => {
                if (dateStr >= startStr && dateStr <= endStr) {
                    if (!daysMap.has(dateStr)) daysMap.set(dateStr, []);
                    
                    let effStartTimeStr = event.startTimeStr;
                    let effEndTimeStr = event.endTimeStr;
                    if (!event.isAllDay) {
                        const moment = (window as any).moment;
                        const startMom = moment(event.start).startOf('day');
                        const endMom = moment(event.end).startOf('day');
                        const targetMom = moment(dateStr, 'YYYY-MM-DD').startOf('day');
                        const isStartDay = targetMom.isSame(startMom, 'day');
                        const isEndDay = targetMom.isSame(endMom, 'day');
                        if (!isStartDay) effStartTimeStr = '00:00';
                        if (!isEndDay) effEndTimeStr = '24:00';
                    }
                    
                    daysMap.get(dateStr)!.push({ 
                        type: 'event', 
                        event: {
                            ...event,
                            dateStr,
                            startTimeStr: effStartTimeStr,
                            endTimeStr: effEndTimeStr
                        } 
                    });
                }
            });
        });

        const listScroll = container.createDiv({ cls: 'dp-gc-list-scroll' });
        this.playNavSlide(listScroll, container); // month pagination / Today slide (before the empty-month early return)
        const listScrollKey = `${this.getViewType()}:${this.currentDate.format('YYYY-MM')}:list-scroll`;
        listScroll.addEventListener('scroll', () => {
            this.savedScrollPositions[listScrollKey] = {
                scrollTop: listScroll.scrollTop,
                scrollLeft: listScroll.scrollLeft
            };
        });

        if (daysMap.size === 0) {
            let emptyText = 'No tasks or events found in this month.';
            if (self.parentNoteType === 'daily') {
                emptyText = 'No tasks or events found for today.';
            } else if (self.parentNoteType === 'weekly') {
                emptyText = 'No tasks or events found for this week.';
            }
            listScroll.createDiv({ 
                text: emptyText 
            });
            return;
        }

        // Sort dates chronologically
        const sortedDates = Array.from(daysMap.keys()).sort();

        // Helper function to format time str nicely
        const formatTimeStr = (time: string) => {
            const moment = (window as any).moment;
            const isKorean = moment.locale() === 'ko';
            const parsed = moment(time, 'HH:mm');
            if (!parsed.isValid()) return time;
            if (isKorean) {
                return parsed.minute() === 0 ? parsed.format('a h시') : parsed.format('a h:mm');
            } else {
                return parsed.format('h:mm A');
            }
        };

        // Helper function to format range
        const formatTimeRange = (start: string, end: string | null) => {
            if (!end) return formatTimeStr(start);
            const moment = (window as any).moment;
            const isKorean = moment.locale() === 'ko';
            const s = moment(start, 'HH:mm');
            const e = moment(end, 'HH:mm');
            if (!s.isValid() || !e.isValid()) return `${start} - ${end}`;

            if (isKorean) {
                const sAmpm = s.format('a');
                const eAmpm = e.format('a');
                const sTime = s.minute() === 0 ? s.format('h시') : s.format('h:mm');
                const eTime = e.minute() === 0 ? e.format('h시') : e.format('h:mm');
                if (sAmpm === eAmpm) {
                    return `${sAmpm} ${sTime} - ${eTime}`;
                } else {
                    return `${sAmpm} ${sTime} - ${eAmpm} ${eTime}`;
                }
            } else {
                return `${s.format('h:mm A')} - ${e.format('h:mm A')}`;
            }
        };

        sortedDates.forEach(dateStr => {
            const items = daysMap.get(dateStr)!;
            const loopDay = (window as any).moment(dateStr);
            const isToday = dateStr === todayStr;

            // Separate all-day vs timed
            const allDayItems = items.filter(item => {
                if (item.type === 'task') return !item.task.startTime;
                return item.event.isAllDay;
            });
            const timedItems = items.filter(item => {
                if (item.type === 'task') return !!item.task.startTime;
                return !item.event.isAllDay;
            });

            // Sort timed items chronologically
            timedItems.sort((a, b) => {
                const timeA = a.type === 'task' ? a.task.startTime! : a.event.startTimeStr!;
                const timeB = b.type === 'task' ? b.task.startTime! : b.event.startTimeStr!;
                return timeA.localeCompare(timeB);
            });

            const dayRow = listScroll.createDiv({
                cls: `dp-gc-day-row ${isToday ? 'is-today' : ''}`,
                attr: { 'data-date': dateStr }
            });

            // Left Sidebar: the day heading links to that day's daily note
            const sidebar = dayRow.createDiv({ cls: 'dp-gc-day-sidebar dp-gc-day-link' });
            sidebar.title = 'Open daily note';
            sidebar.addEventListener('click', () => this.handleDateClick(dateStr));
            
            const numberDiv = sidebar.createDiv({ 
                cls: 'dp-gc-day-number',
                text: loopDay.format('D')
            });
            
            const isKorean = (window as any).moment.locale() === 'ko';
            const metaText = isKorean ? loopDay.format('M월, ddd') : loopDay.format('MMM, ddd');
            sidebar.createDiv({ 
                cls: 'dp-gc-day-meta', 
                text: metaText 
            });

            // Right Content
            const contentDiv = dayRow.createDiv({ cls: 'dp-gc-day-content' });

            // Determine if we need to insert current time indicator line
            let timeLineInserted = false;
            const nowMinutes = todayMoment.hours() * 60 + todayMoment.minutes();
            const nowStr = todayMoment.format('HH:mm');

            const renderItem = (item: any) => {
                const isTask = item.type === 'task';
                let cardClass = 'dp-gc-item';
                if (isTask) {
                    if (item.task.completed) cardClass += ' completed';
                    else if (item.task.statusChar === '-') cardClass += ' cancelled';
                }

                const card = contentDiv.createDiv({ cls: cardClass });

                if (isTask) {
                    createCustomCheckbox(card, item.task, async (newStatus) => {
                        await updateTaskInFile(this.app, item.task, { statusChar: newStatus });
                        await this.refreshTasks();
                    });
                } else {
                    let color = 'var(--text-accent)';
                    if (item.event.color) {
                        color = item.event.color;
                    }
                    const dot = card.createDiv({ cls: 'dp-gc-item-dot' });
                    dot.style.backgroundColor = color;
                }

                // Time
                let timeText = isKorean ? '종일' : 'All day';
                if (isTask && item.task.startTime) {
                    timeText = formatTimeRange(item.task.startTime, item.task.endTime);
                } else if (!isTask && !item.event.isAllDay) {
                    timeText = formatTimeRange(item.event.startTimeStr!, item.event.endTimeStr);
                }
                card.createDiv({ 
                    cls: 'dp-gc-item-time', 
                    text: timeText 
                });

                // Title
                const displayTitle = isTask ? cleanTaskTextForDisplay(item.task.text) : item.event.summary;
                card.createDiv({ 
                    cls: 'dp-gc-item-title', 
                    text: displayTitle 
                });

                // File (Only for tasks)
                if (isTask) {
                    const fileBase = item.task.filePath.split(/[/\\]/).pop() || item.task.filePath;
                    const fileBadge = card.createDiv({ 
                        cls: 'dp-gc-item-file', 
                        text: `📄 ${fileBase}` 
                    });
                    fileBadge.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, item.task);
                    });

                    card.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target.classList.contains('dp-gc-item-file'))) return;
                        const modal = new TaskEditModal(this.app, item.task, null, async (data) => {
                            await updateTaskInFile(this.app, item.task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });
                } else {
                    card.addEventListener('click', () => {
                        new GCalEventEditModal(this.app, this.plugin, item.event, item.event.dateStr, async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                }
            };

            const renderTimeLine = () => {
                const tl = contentDiv.createDiv({ cls: 'dp-gc-time-line' });
                tl.createDiv({ cls: 'dp-gc-time-dot' });
                tl.createDiv({ cls: 'dp-gc-time-rule' });
                timeLineInserted = true;
            };

            // Render all-day items first
            allDayItems.forEach(item => renderItem(item));

            // Render timed items and insert timeline red line if today
            if (isToday && timedItems.length > 0) {
                timedItems.forEach((item, idx) => {
                    const itemTime = item.type === 'task' ? item.task.startTime! : item.event.startTimeStr!;
                    
                    if (!timeLineInserted && itemTime > nowStr) {
                        renderTimeLine();
                    }
                    renderItem(item);
                });
                
                if (!timeLineInserted) {
                    renderTimeLine();
                }
            } else {
                // Not today or no timed items, just render all timed items
                timedItems.forEach(item => renderItem(item));
            }
        });

        // Today's section, else the earliest upcoming day; top of list if every day is past
        this.applyAutoScroll(listScroll, listScrollKey, 'list', 'today');
    }
}

/**
 * 1. Day Planner 통합 뷰 (모든 주간, 월간, 보드 레이아웃을 탭 컨트롤러 형태로 포괄)
 */
export class DayPlannerCombinedView extends DayPlannerBaseView {
    activeTab: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list' = 'daily';

    getViewType(): string { return 'day-planner-pro-view'; }
    getDisplayText(): string { return 'Dayloom'; }
    getIcon(): string { return 'calendar-glyph'; }
    getViewTabType() { return this.activeTab; }
    useCompactLayout() { return Platform.isPhone; }

    navigateDate(direction: number) {
        if (this.activeTab === 'daily') this.currentDate.add(direction, 'day');
        // Phone 2-Day pages one day at a time; elsewhere a whole N-day block
        if (this.activeTab === 'multiDay') this.currentDate.add(direction * (this.useCompactLayout() ? 1 : (this.plugin.settings.nDayViewDays || 4)), 'day');
        if (this.activeTab === 'weekly') this.currentDate.add(direction, 'week');
        if (this.activeTab === 'monthly') this.currentDate.add(direction, 'month');
        if (this.activeTab === 'list') {
            this.currentDate.add(direction, 'month');
        }
    }

    renderRoot(rootEl: HTMLDivElement) {
        const phone = this.useCompactLayout();
        rootEl.toggleClass('dp-compact-shell', phone);
        rootEl.toggleClass('dp-phone-shell', phone && Platform.isPhone); // phone-only extras (clearance for Obsidian's toolbar)
        const header = rootEl.createDiv({ cls: 'dp-header' });
        rootEl.prepend(header); // cached panes may still be mounted below
        this.renderNavHeader(header, true);
        if (phone && (this.activeTab === 'daily' || this.activeTab === 'multiDay')) this.renderPhoneDateStrip(header);

        // Phones: thumb-reach bottom navigation (5 tabs, no Weekly); elsewhere the segmented control in the header
        const tabsContainer = phone
            ? rootEl.createDiv({ cls: 'dp-tabs dp-bottom-nav' })
            : header.createDiv({ cls: 'dp-tabs' });
        const tabs: { key: typeof DayPlannerCombinedView.prototype.activeTab; label: string; icon?: string }[] = phone ? [
            { key: 'daily', label: 'Daily', icon: 'calendar-clock' },
            { key: 'multiDay', label: '2-Day View', icon: 'calendar-range' },
            { key: 'monthly', label: 'Monthly', icon: 'calendar-days' },
            { key: 'board', label: 'Board', icon: 'layout-dashboard' },
            { key: 'list', label: 'List', icon: 'list' }
        ] : [
            { key: 'daily', label: 'Daily Timeline' },
            { key: 'multiDay', label: `${this.plugin.settings.nDayViewDays || 4}-day View` },
            { key: 'weekly', label: 'Weekly View' },
            { key: 'monthly', label: 'Monthly Calendar' },
            { key: 'board', label: 'Board' },
            { key: 'list', label: 'List View' }
        ];

        tabs.forEach(tab => {
            if (tab.key === 'multiDay' && !phone) {
                const tabEl = tabsContainer.createEl('div', {
                    cls: `dp-tab dp-tab-nday ${this.activeTab === 'multiDay' ? 'active' : ''}`
                });
                
                tabEl.addEventListener('click', async (e) => {
                    if (e.target instanceof HTMLSelectElement) return;
                    await this.switchTab('multiDay');
                });

                const select = tabEl.createEl('select', {
                    cls: 'dp-tab-select'
                });
                
                for (let i = 2; i <= 14; i++) {
                    const opt = select.createEl('option', { value: String(i), text: String(i) });
                    opt.style.backgroundColor = 'var(--background-primary)';
                    opt.style.color = 'var(--text-normal)';
                    if (i === (this.plugin.settings.nDayViewDays || 4)) {
                        opt.selected = true;
                    }
                }

                tabEl.createSpan({ text: '-day View' });

                select.addEventListener('change', async (e) => {
                    const val = parseInt(select.value, 10);
                    this.plugin.settings.nDayViewDays = val;
                    await this.plugin.saveSettings();
                    this.activeTab = 'multiDay';
                    this.plugin.refreshActiveViews();
                });
            } else {
                const btn = tabsContainer.createEl('button', {
                    cls: `dp-tab ${this.activeTab === tab.key ? 'active' : ''}`,
                    text: tab.icon ? '' : tab.label
                });
                if (tab.icon) {
                    setIcon(btn.createSpan({ cls: 'dp-bottom-nav-icon' }), tab.icon);
                    btn.createSpan({ cls: 'dp-bottom-nav-label', text: tab.label });
                }
                btn.addEventListener('click', async () => {
                    await this.switchTab(tab.key);
                });
            }
        });
        animateActiveTabPill(tabsContainer, this as any, this.activeTab);
        keepActiveTabInView(tabsContainer, this as any);

        this.mountActivePane(rootEl);
        if (this.activeTab === 'daily') this.renderCurrentTaskTracker(rootEl);
        if (phone) {
            rootEl.appendChild(tabsContainer); // bottom bar stays the last row, below panes created after it
            this.registerSwipeNavigation(rootEl);
        }

        rootEl.toggleClass('dp-drawer-open', this.isSideDrawerOpen());
        if (this.hasSideDrawer()) {
            renderSideDrawer(rootEl, this);
            this.trackHeaderHeight(rootEl, header);
        } else {
            this.headerResizeObserver?.disconnect();
        }
    }

    // ---- Desktop side drawer (shell and panel registry: drawer.ts) ----
    drawerScrollTop = 0;
    /** Drawer section folding (Overdue / Undated), kept here because the drawer is rebuilt on every render:
     *  manual overrides (valid while the section stays empty / non-empty) and the state last drawn */
    drawerSectionOverrides = new Map<string, { collapsed: boolean; empty: boolean }>();
    drawerSectionState = new Map<string, boolean>();
    private headerResizeObserver: ResizeObserver | null = null;

    /** Desktop combined view only, beside the date-based tabs a task can be dropped onto */
    hasSideDrawer(): boolean {
        return !this.useCompactLayout() && !Platform.isMobile && SIDE_DRAWER_TABS.includes(this.activeTab);
    }

    isSideDrawerOpen(): boolean {
        return this.hasSideDrawer() && this.plugin.settings.sideDrawerOpen !== false;
    }

    /** Header button, `s`, and the command. Flips classes only: the drawer slides, the panes reflow once, nothing re-renders. */
    async toggleSideDrawer(open = !this.isSideDrawerOpen()) {
        if (!this.hasSideDrawer()) {
            new Notice('The side drawer is available in the Daily, N-day, Weekly and Monthly views of Dayloom on desktop.');
            return;
        }
        this.plugin.settings.sideDrawerOpen = open;
        const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
        rootEl?.toggleClass('dp-drawer-open', open);
        rootEl?.querySelector(':scope > .dp-side-drawer')?.toggleClass('is-open', open);
        rootEl?.querySelector('.dp-drawer-toggle')?.toggleClass('is-active', open);
        await this.plugin.saveSettings();
    }

    /** The drawer hangs below the header, whose height changes with wrapping and zoom: mirror it into --dp-header-h */
    private trackHeaderHeight(rootEl: HTMLElement, header: HTMLElement) {
        this.headerResizeObserver?.disconnect();
        this.headerResizeObserver = new ResizeObserver(() => rootEl.style.setProperty('--dp-header-h', `${header.offsetHeight}px`));
        this.headerResizeObserver.observe(header);
    }

    /**
     * Compact drawer card: checkbox, title, priority (+ the missed date for Overdue). Click edits; drag schedules,
     * and an Overdue card dropped on the Undated section loses its date (see beginPointerDrag).
     */
    renderDrawerTaskCard(list: HTMLElement, task: TaskItem, section: DrawerSectionId) {
        const card = list.createDiv({ cls: 'dp-drawer-card' });
        card.dataset.drawerTaskId = task.id; // not data-task-id: drag previews copy the styling of [data-task-id] cards
        card.title = task.filePath;
        createCustomCheckbox(card, task, async (newStatus) => {
            await updateTaskInFile(this.app, task, { statusChar: newStatus });
            await this.refreshTasks();
        });
        card.createSpan({ cls: 'dp-drawer-card-title', text: cleanTaskTextForDisplay(task.text) });
        if (section === 'overdue' && task.date) {
            card.createSpan({ cls: 'dp-drawer-card-date', text: (window as any).moment(task.date, 'YYYY-MM-DD').format('MMM D') });
        }
        if (task.priority !== 'normal') card.createSpan({ cls: 'dp-badge dp-badge-priority', text: PRIORITY_EMOJI[task.priority] });
        card.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.dp-custom-cb, .dp-drawer-card-actions')) return;
            this.openTaskEditor(task);
        });

        // Keyboard: Tab to a card, Enter edits, f fits it into the first free slot of the next two weeks
        card.tabIndex = 0;
        card.addEventListener('keydown', (e) => {
            if (e.target !== card || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                this.openTaskEditor(task);
            } else if (e.key.toLowerCase() === 'f') {
                e.preventDefault();
                e.stopPropagation();
                void this.fitTaskIn(task, this.upcomingDates(14));
            }
        });

        if (section === 'overdue') {
            // Triage on hover: new date (time kept) or back to Undated
            const moment = (window as any).moment;
            const actions = card.createDiv({ cls: 'dp-drawer-card-actions' });
            const addAction = (label: string, tooltip: string, run: () => Promise<void>) => {
                const btn = actions.createEl('button', { cls: 'dp-drawer-card-action', text: label, attr: { 'aria-label': tooltip } });
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    void run();
                });
            };
            const day = (offset: number) => moment().add(offset, 'days').format('YYYY-MM-DD');
            const label = (offset: number) => moment().add(offset, 'days').format('ddd, MMM D');
            addAction('Today', `Move to today (${label(0)})`, () => this.moveTasksToDate([task], day(0)));
            addAction('Tmrw', `Move to tomorrow (${label(1)})`, () => this.moveTasksToDate([task], day(1)));
            addAction('+1 wk', `Move to next week (${label(7)})`, () => this.moveTasksToDate([task], day(7)));
            addAction('Undate', 'Clear the date (move to Undated)', () => this.unscheduleTasks([task]));
        }
        this.registerMouseDrag(card, { kind: 'task', task, origin: section });
    }

    /** `count` dates starting today (Fit-it-in search window) */
    upcomingDates(count: number): string[] {
        const today = (window as any).moment();
        return Array.from({ length: count }, (_, i) => today.clone().add(i, 'days').format('YYYY-MM-DD'));
    }

    // ---- Drawer quick capture: draft and focus survive the drawer being rebuilt on each render ----
    drawerCaptureDraft = '';
    drawerCaptureFocused = false;

    /** Creates an undated task in the default task file from a quick-capture line (priority emoji → priority) */
    async captureUndatedTask(raw: string) {
        const { text, priority } = parseQuickEntry(raw);
        if (!text) return;
        const filePath = getDefaultTaskFilePath(this.plugin.settings);
        try {
            await createNewTaskInFile(this.app, filePath, text, null, null, null, ' ', priority);
        } catch (err) {
            console.error('Day Planner Pro: quick capture failed', err);
            new Notice(`⚠️ Could not create the task in "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        new Notice(fileNameTaskDate(filePath)
            ? `Task created in "${filePath}". Its file name gives it a date, so it shows on that day, not under Undated.`
            : `Task created in "${filePath}".`);
        await this.refreshTasks();
    }

    async onClose() {
        this.headerResizeObserver?.disconnect();
        return super.onClose();
    }

    /** Phone Daily / 2-Day: the current week as M/D pills; the day(s) on screen are highlighted, a tap shows that day. */
    renderPhoneDateStrip(parent: HTMLElement) {
        const moment = (window as any).moment;
        const shownDays = this.activeTab === 'multiDay' ? this.getNDayCount() : 1;
        const shown = new Set(Array.from({ length: shownDays }, (_, i) => this.currentDate.clone().add(i, 'days').format('YYYY-MM-DD')));
        const todayStr = moment().format('YYYY-MM-DD');
        const weekStart = this.currentDate.clone().startOf('week');

        const strip = parent.createDiv({ cls: 'dp-date-strip' });
        for (let i = 0; i < 7; i++) {
            const day = weekStart.clone().add(i, 'days');
            const dateStr = day.format('YYYY-MM-DD');
            const pill = strip.createEl('button', { cls: `dp-date-pill${weekendCls(day)}` });
            pill.toggleClass('is-shown', shown.has(dateStr));
            pill.toggleClass('is-today', dateStr === todayStr);
            pill.createSpan({ cls: 'dp-date-pill-dow', text: day.format('ddd') });
            pill.createSpan({ cls: 'dp-date-pill-date', text: day.format('M/D') });
            pill.addEventListener('click', () => this.focusDay(dateStr));
        }
    }

    /** Phone: date pills and Monthly cells show that day in the Daily tab (never its note). */
    async focusDay(dateStr: string) {
        if (!this.useCompactLayout()) return super.focusDay(dateStr);
        const target = (window as any).moment(dateStr, 'YYYY-MM-DD');
        // Daily and 2-Day own the date strip: a tap moves the day / the 2-day window's start, staying in that tab.
        // Only other tabs (Monthly cells) hand the day over to the Daily tab.
        if (this.activeTab !== 'daily' && this.activeTab !== 'multiDay') {
            const fromMonthly = this.activeTab === 'monthly';
            this.currentDate = target;
            this.dataVersion++; // new date: every cached pane is stale
            await this.switchTab('daily');
            // Monthly cell → Daily: the day "opens up" from the grid instead of the plain pane reveal
            const pane = this.panes.get('daily')?.el;
            if (fromMonthly && pane && !prefersReducedMotion()) {
                pane.removeClass(REVEAL_CLASS);
                playOnce(pane, 'dp-zoom-in');
            }
            return;
        }
        if (target.isSame(this.currentDate, 'day')) return;
        triggerHaptic('selection');
        this.navDirection = target.isAfter(this.currentDate, 'day') ? 'next' : 'prev';
        this.currentDate = target;
        try {
            await this.refreshTasks();
        } finally {
            this.navDirection = null;
        }
    }

    private swipeBound = false;

    /**
     * Phone: a horizontal swipe on the active view pages dates (Daily / 2-Day: 1 day, Monthly / List: 1 month) through
     * navigateWithSlide. The touch is only claimed once it is clearly horizontal, so vertical scrolling stays native;
     * touches inside horizontally scrollable children are left alone. Edge swipes belong to the planner too: listeners
     * run in the capture phase and the horizontal moves of a claimed swipe never reach Obsidian's sidebar gestures.
     */
    registerSwipeNavigation(rootEl: HTMLElement) {
        if (this.swipeBound) return;
        this.swipeBound = true;
        const LOCK = 10;     // px of travel before the gesture axis is decided
        const MIN_DIST = 60; // px of horizontal travel that pages
        let start: { x: number; y: number } | null = null;
        let axis: 'x' | 'y' | null = null;
        let dx = 0;
        const claim = (e: TouchEvent) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
        };

        this.registerDomEvent(rootEl, 'touchstart', (e: TouchEvent) => {
            start = null;
            if (e.touches.length !== 1 || !['daily', 'multiDay', 'monthly', 'list', 'board'].includes(this.activeTab)) return;
            const touch = e.touches[0];
            const target = e.target as HTMLElement;
            if (!target.closest('.day-planner-view-pane') || target.closest('input, textarea, select, .dp-resize-handle')) return;
            for (let el: HTMLElement | null = target; el && el !== rootEl; el = el.parentElement) {
                if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return;
            }
            start = { x: touch.clientX, y: touch.clientY };
            axis = null;
            dx = 0;
        }, { passive: true, capture: true });

        this.registerDomEvent(rootEl, 'touchmove', (e: TouchEvent) => {
            if (!start) return;
            if (this.touchDragActive) { start = null; return; }
            const touch = e.touches[0];
            dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (!axis && Math.hypot(dx, dy) > LOCK) axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
            if (axis === 'y') { start = null; return; } // vertical scroll: hands off
            if (axis === 'x') {
                if (e.cancelable) e.preventDefault(); // no diagonal scroll drift while paging
                claim(e);                             // Obsidian's sidebar / back-swipe gestures never see it
            }
        }, { passive: false, capture: true });

        // touchend / touchcancel always propagate: the end of a touch sequence must reach every listener. Swallowing it
        // left Obsidian's gesture recognizer mid-gesture (it saw touchstart, never the end), and it then blocked the
        // next vertical scroll. Withholding the horizontal touchmoves alone already keeps the sidebars shut.
        this.registerDomEvent(rootEl, 'touchend', () => {
            const page = !!start && axis === 'x' && Math.abs(dx) >= MIN_DIST && !this.touchDragActive;
            start = null;
            if (!page) return;
            // Board pages columns (haptic fired inside, only when the column actually changes)
            if (this.activeTab === 'board') { this.navigateBoardTab(dx < 0 ? 1 : -1); return; }
            triggerHaptic('selection');
            void this.navigateWithSlide(dx < 0 ? 1 : -1); // swipe left → next
        }, { capture: true });
        this.registerDomEvent(rootEl, 'touchcancel', () => { start = null; }, { capture: true });
    }

    /** Keep-alive view panes: each tab renders once, then is only shown/hidden until its data goes stale. */
    panes = new Map<string, { el: HTMLDivElement; version: number; scroll: [HTMLElement, number, number][] }>();
    paneRoot: HTMLDivElement | null = null;
    /** Bumped by every data-driven render (tasks, date, settings, GCal); panes rendered at an older version are dirty. */
    dataVersion = 0;
    isTabSwitch = false;

    render() {
        if (this.useCompactLayout() && this.activeTab === 'weekly') this.activeTab = 'multiDay'; // no Weekly tab on phones
        if (!this.isTabSwitch) this.dataVersion++;
        super.render();
    }

    /** Instant tab change: no vault scan, no blocking GCal fetch, and no rebuild of an up-to-date pane. */
    async switchTab(tab: typeof this.activeTab) {
        if (tab === this.activeTab) return;
        triggerHaptic('selection');
        const current = this.panes.get(this.activeTab);
        if (current) {
            // display:none drops scroll offsets, so remember them for when this pane is shown again
            const scrollers = [current.el, ...Array.from(current.el.querySelectorAll<HTMLElement>(
                '.dp-content, .dp-weekly-scroll-wrapper, .dp-monthly-scroll-wrapper, .dp-kanban-board, .dp-kanban-cards, .dp-gc-list-scroll'))];
            current.scroll = scrollers.map(el => [el, el.scrollTop, el.scrollLeft] as [HTMLElement, number, number]);
        }
        this.activeTab = tab;
        await this.syncGCalRange(false);
        this.isTabSwitch = true;
        try {
            this.render();
        } finally {
            this.isTabSwitch = false;
        }
        await this.paneActivation; // callers (e.g. focusDay's zoom-in) act on the pane once it is actually shown
    }

    /** Settles when the pane of the latest tab switch is shown and rendered (see mountActivePane). */
    paneActivation: Promise<void> = Promise.resolve();
    private paneActivationToken = 0;

    /** Only the header chrome and tracker bar are rebuilt; cached panes stay mounted. */
    rebuildRoot(rootEl: HTMLDivElement) {
        Array.from(rootEl.children).forEach(child => {
            if (!child.classList.contains('day-planner-view-pane')) child.remove();
        });
        this.renderRoot(rootEl);
    }

    mountActivePane(rootEl: HTMLDivElement) {
        if (this.paneRoot !== rootEl) {
            this.panes.clear();
            this.paneRoot = rootEl;
        }
        const token = ++this.paneActivationToken;
        if (!this.isTabSwitch) {
            this.activatePane(rootEl);
            return;
        }
        // Tab switch: showing a pane means laying it out (and rendering it when stale), which on Weekly is hundreds of
        // nodes. Doing that before the first paint delayed the pill slide; the header and pill commit first, and the
        // pane follows right after that paint while the compositor already runs the slide.
        this.paneActivation = new Promise<void>(resolve => {
            requestAnimationFrame(() => window.setTimeout(() => {
                // Superseded by a newer switch or a data render, which activated its own pane
                if (token === this.paneActivationToken && this.paneRoot === rootEl && rootEl.isConnected) this.activatePane(rootEl);
                resolve();
            }, 0));
        });
    }

    private activatePane(rootEl: HTMLDivElement) {
        let pane = this.panes.get(this.activeTab);
        if (!pane) {
            const el = rootEl.createDiv({ cls: `dp-content day-planner-view-pane day-planner-pane-${this.activeTab}` });
            // Created after the tracker / bottom nav when deferred: keep those as the trailing rows
            rootEl.insertBefore(el, rootEl.querySelector(':scope > .dp-current-task-bar, :scope > .dp-bottom-nav'));
            pane = { el, version: -1, scroll: [] };
            this.panes.set(this.activeTab, pane);
        }
        // Strict mutual exclusion: exactly one pane is shown (with the reveal if it was hidden), every other one hidden
        applyViewReveal(pane.el);

        if (pane.version !== this.dataVersion) {
            pane.version = this.dataVersion;
            pane.scroll = [];
            this.renderPaneContent(pane.el);
        } else {
            pane.scroll.forEach(([el, top, left]) => {
                el.scrollTop = top;
                el.scrollLeft = left;
            });
            if (this.activeTab === 'board') this.mountBoardModeToggle(rootEl);
        }
    }

    renderPaneContent(content: HTMLDivElement) {
        content.empty();
        if (this.activeTab === 'daily') {
            this.renderDailyTimeline(content);
        } else if (this.activeTab === 'multiDay') {
            this.renderWeeklyView(content, this.getNDayCount(), true);
        } else if (this.activeTab === 'weekly') {
            this.renderWeeklyView(content);
        } else if (this.activeTab === 'monthly') {
            this.renderMonthlyCalendar(content);
        } else if (this.activeTab === 'board') {
            this.renderKanbanBoard(content);
        } else if (this.activeTab === 'list') {
            this.renderListView(content);
        }
    }
}

/**
 * 2. Dayloom Compact: the combined view's compact shell (5 bottom tabs, date strip, one-column Board,
 * compact Monthly) in a narrow sidebar leaf, on every platform.
 */
export class DayPlannerDailyView extends DayPlannerCombinedView {
    getViewType(): string { return 'day-planner-pro-daily'; }
    getDisplayText(): string { return 'Dayloom Compact'; }
    getIcon(): string { return 'calendar-clock'; }
    useCompactLayout() { return true; }
}

export class DayPlannerCodeBlockRenderer extends MarkdownRenderChild {
    plugin: DayPlannerPlugin;
    app: App;
    tasks: TaskItem[] = [];
    currentDate: any;
    viewType: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list';
    heightStr: string;
    selectedTaskIds: Set<string> = new Set();
    savedScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }> = {};
    activeDragClickOffsetMin: number = 0;
    dragPreviewContainer: HTMLDivElement | null = null;
    activeDragItems: any[] = [];
    kanbanViewMode: 'kanban' | 'priority' = 'kanban';
    ctx: any;
    filters: any;
    showFilterPanel: boolean = false;
    collapsedColumns: Set<string> = new Set();
    hourHeight: number | undefined;
    debouncedUpdateCodeBlock: any;
    parentNoteType: 'daily' | 'weekly' | null = null;
    parentNoteDate: string | null = null;
    contentOnlyRender: boolean = false;
    filtersDirty: boolean = false;
    filterPanelEl: HTMLElement | null = null;
    filterRefreshTimer: number | undefined;
    filterDismissCleanup: (() => void) | null = null;

    constructor(
        containerEl: HTMLElement,
        plugin: DayPlannerPlugin, 
        viewType: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list', 
        dateStr?: string,
        heightStr?: string,
        ctx?: any,
        config?: any
    ) {
        super(containerEl);
        this.plugin = plugin;
        this.app = plugin.app;
        this.viewType = viewType;
        this.heightStr = heightStr || '500px';
        this.ctx = ctx;

        if (!(plugin as any).codeblockShowFiltersState) {
            (plugin as any).codeblockShowFiltersState = new Map<string, boolean>();
        }
        const sectionInfo = ctx && ctx.getSectionInfo && ctx.getSectionInfo(containerEl);
        const lineStartVal = sectionInfo ? sectionInfo.lineStart : 0;
        const blockKeyStr = ctx ? `${ctx.sourcePath}:${lineStartVal}` : '';

        this.showFilterPanel = false;
        if (blockKeyStr && (plugin as any).codeblockShowFiltersState.has(blockKeyStr)) {
            this.showFilterPanel = (plugin as any).codeblockShowFiltersState.get(blockKeyStr)!;
        } else if (config && config.showFilters === true) {
            this.showFilterPanel = true;
        }
        this.hourHeight = config && (config.hourHeight !== undefined ? parseInt(config.hourHeight, 10) : (config.hourheight !== undefined ? parseInt(config.hourheight, 10) : undefined));

        // Parse parent file's daily/weekly note date
        const fileName = ctx?.sourcePath?.split(/[/\\]/).pop()?.replace(/\.md$/, '') || '';
        const moment = (window as any).moment;
        
        let parsedDaily = moment(fileName, plugin.settings.dailyNotesFormat, true);
        if (!parsedDaily.isValid()) {
            const formats = ['YYYY-MM-DD', 'YYYY.MM.DD', 'YYYYMMDD', 'YYYY년 MM월 DD일', 'YYYY_MM_DD'];
            for (const fmt of formats) {
                const p = moment(fileName, fmt, true);
                if (p.isValid()) { parsedDaily = p; break; }
            }
        }
        if (!parsedDaily.isValid()) {
            const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
            if (match) parsedDaily = moment(match[1], 'YYYY-MM-DD', true);
        }

        let parsedWeekly = moment(fileName, plugin.settings.weeklyNotesFormat, true);
        if (!parsedWeekly.isValid()) {
            const weeklyFormats = ['YYYY-[W]WW', 'YYYY-[W]ww', 'gggg-[W]ww', 'gggg-[W]WW', 'YYYY-Www', 'YYYY-Wwww'];
            for (const fmt of weeklyFormats) {
                const p = moment(fileName, fmt, true);
                if (p.isValid()) { parsedWeekly = p; break; }
            }
        }

        if (parsedWeekly.isValid()) {
            this.parentNoteType = 'weekly';
            this.parentNoteDate = parsedWeekly.startOf('week').format('YYYY-MM-DD');
        } else if (parsedDaily.isValid()) {
            this.parentNoteType = 'daily';
            this.parentNoteDate = parsedDaily.format('YYYY-MM-DD');
        } else {
            this.parentNoteType = null;
            this.parentNoteDate = null;
        }

        if (config && config.filters) {
            this.filters = parseFilterGroup(config.filters);
        } else {
            this.filters = { kind: 'group', id: 'root', mode: 'all', children: [] };
        }
        
        let momentDate = (window as any).moment();
        if (this.parentNoteDate) {
            momentDate = (window as any).moment(this.parentNoteDate, 'YYYY-MM-DD');
        }
        if (dateStr && dateStr.toLowerCase() !== 'today') {
            const parsed = (window as any).moment(dateStr, 'YYYY-MM-DD', true);
            if (parsed.isValid()) {
                momentDate = parsed;
            }
        }
        this.currentDate = momentDate;

        const rawCollapsed = config && (config.collapsedColumns !== undefined ? config.collapsedColumns : config.collapsedcolumns);
        if (rawCollapsed) {
            let cols: string[] = [];
            if (Array.isArray(rawCollapsed)) {
                cols = rawCollapsed;
            } else if (typeof rawCollapsed === 'string') {
                const cleanStr = rawCollapsed.replace(/[\[\]]/g, '');
                cols = cleanStr.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
            this.collapsedColumns = new Set(cols);
        } else {
            this.collapsedColumns = new Set();
        }

        this.debouncedUpdateCodeBlock = debounce(async (newViewType: string, newFilters: FilterGroup) => {
            await this.updateCodeBlockInFile(newViewType, newFilters);
        }, 1500);
    }

    onload() {
        this.containerEl.empty();
        const rootEl = this.containerEl.createDiv({ cls: 'dp-container dp-codeblock-container' });
        this.registerScrollIdleClass(rootEl);

        this.containerEl.style.height = this.heightStr;
        this.containerEl.style.position = 'relative';
        this.containerEl.style.overflow = 'hidden';
        this.containerEl.style.resize = 'vertical';
        this.containerEl.style.border = '1px solid var(--background-modifier-border)';
        this.containerEl.style.borderRadius = '8px';
        this.containerEl.style.margin = '12px 0';

        this.registerDomEvent(this.containerEl, 'mouseup', () => {
            const newHeight = this.containerEl.style.height;
            if (newHeight && newHeight !== this.heightStr) {
                this.heightStr = newHeight;
                this.updateCodeBlockInFile(this.viewType, this.filters);
            }
        });

        // Vault edits arrive through the plugin's coalesced refresh (after the task cache is updated), not on every
        // metadataCache 'resolved', which fired a full redraw of each block per indexing pass while typing
        this.plugin.codeBlockRenderers.add(this);

        this.refreshTasks();
    }

    onunload() {
        this.plugin.codeBlockRenderers.delete(this);
        window.clearTimeout(this.filterRefreshTimer);
        this.detachFilterDismissListeners();
        if (this.filtersDirty && this.app.workspace.getActiveFile()?.path === this.ctx?.sourcePath) {
            this.flushFilterWrite();
        }
        this.filterPanelEl = null;
        super.onunload();
    }

    async refreshContentOnly(skipIfUnchanged = false) {
        this.contentOnlyRender = true;
        try {
            await this.refreshTasks(null, false, skipIfUnchanged);
        } finally {
            this.contentOnlyRender = false;
        }
    }

    // Filter edits update the task area in place; the codeblock source is only rewritten
    // once the panel closes, since rewriting it makes Obsidian remount the whole block.
    onFilterChanged(structural: boolean = false) {
        this.filtersDirty = true;
        if (structural) this.rebuildFilterPanel();
        if (!this.showFilterPanel) this.flushFilterWrite();
        window.clearTimeout(this.filterRefreshTimer);
        this.filterRefreshTimer = window.setTimeout(() => {
            this.filterRefreshTimer = undefined;
            this.refreshContentOnly();
        }, 120);
    }

    flushFilterWrite() {
        if (!this.filtersDirty) return;
        this.filtersDirty = false;
        this.updateCodeBlockInFile(this.viewType, this.filters);
    }

    // While the panel is open it stays up for any interaction inside the codeblock and closes
    // on a click / keypress outside it, Escape, or focus moving out of the block.
    attachFilterDismissListeners() {
        if (this.filterDismissCleanup) return;
        const doc = this.containerEl.ownerDocument;
        // Modals/menus opened from inside the block are rendered outside it in the DOM.
        // ... and so is Obsidian's suggestion popover (path suggestions in the filter editor)
        const inPopup = (t: EventTarget | null) => t instanceof Element && !!t.closest('.modal-container, .menu, .suggestion-container');
        const inBlock = (t: EventTarget | null) => t instanceof Node && this.containerEl.contains(t);

        const onPointerDown = (e: PointerEvent) => {
            if (!inBlock(e.target) && !inPopup(e.target)) this.closeFilterPanel();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (inPopup(e.target) || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
            if (e.key === 'Escape' || !inBlock(e.target)) this.closeFilterPanel();
        };
        const onFocusOut = (e: FocusEvent) => {
            // relatedTarget is null for clicks on non-focusable areas and window blur; only
            // react when focus actually lands somewhere outside the block.
            if (e.relatedTarget && !inBlock(e.relatedTarget) && !inPopup(e.relatedTarget)) this.closeFilterPanel();
        };

        doc.addEventListener('pointerdown', onPointerDown, true);
        doc.addEventListener('keydown', onKeyDown, true);
        this.containerEl.addEventListener('focusout', onFocusOut);
        this.filterDismissCleanup = () => {
            doc.removeEventListener('pointerdown', onPointerDown, true);
            doc.removeEventListener('keydown', onKeyDown, true);
            this.containerEl.removeEventListener('focusout', onFocusOut);
        };
    }

    detachFilterDismissListeners() {
        if (this.filterDismissCleanup) this.filterDismissCleanup();
        this.filterDismissCleanup = null;
    }

    closeFilterPanel() {
        this.detachFilterDismissListeners();
        if (!this.showFilterPanel) return;
        this.showFilterPanel = false;
        this.filterPanelEl = null;
        if (this.ctx && this.ctx.getSectionInfo) {
            const section = this.ctx.getSectionInfo(this.containerEl);
            const blockKey = `${this.ctx.sourcePath}:${section ? section.lineStart : 0}`;
            (this.plugin as any).codeblockShowFiltersState.set(blockKey, false);
        }
        this.render();
        this.flushFilterWrite();
    }

    rebuildFilterPanel() {
        const oldPanel = this.filterPanelEl;
        if (!oldPanel || !oldPanel.isConnected) return;
        const newPanel = this.renderFilterPanel(createDiv());
        if (newPanel) oldPanel.replaceWith(newPanel);
    }

    getViewType(): string {
        return `day-planner-pro-codeblock-${this.viewType}`;
    }

    getViewTabType() {
        return this.viewType;
    }

    async updateCodeBlockInFile(newViewType: string, newFilters: FilterGroup) {
        if (!this.app.workspace.getActiveFile()) return;
        const activeFile = this.app.workspace.getActiveFile()!;
        if (!this.ctx) return;
        const section = this.ctx.getSectionInfo(this.containerEl);
        if (!section) return;

        try {
            const fileContent = await this.app.vault.read(activeFile);
            const lines = fileContent.split('\n');
            
            let lineStart = section.lineStart;
            // Verify and adjust the start line if it shifted
            if (lineStart >= lines.length || !lines[lineStart].trim().startsWith('```')) {
                let found = false;
                for (let offset = 0; offset <= 5; offset++) {
                    if (lineStart - offset >= 0 && lines[lineStart - offset].trim().startsWith('```')) {
                        lineStart = lineStart - offset;
                        found = true;
                        break;
                    }
                    if (lineStart + offset < lines.length && lines[lineStart + offset].trim().startsWith('```')) {
                        lineStart = lineStart + offset;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.warn('Could not locate codeblock start line in file');
                    return;
                }
            }

            const startLine = lines[lineStart];

            // Scan down to find the exact closing backticks
            let lineEnd = -1;
            for (let i = lineStart + 1; i < lines.length; i++) {
                if (lines[i].trim().startsWith('```')) {
                    lineEnd = i;
                    break;
                }
            }
            if (lineEnd === -1) {
                console.warn('Could not locate codeblock end line in file');
                return;
            }

            const yamlLines = [];
            yamlLines.push(`type: ${newViewType}`);
            
            const origLines = fileContent.split('\n').slice(lineStart + 1, lineEnd);
            for (const origLine of origLines) {
                const parts = origLine.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim().toLowerCase();
                    const val = parts.slice(1).join(':').trim();
                    if (key === 'date') {
                        yamlLines.push(`date: ${val}`);
                    }
                }
            }

            if (this.heightStr) {
                yamlLines.push(`height: ${this.heightStr}`);
            }

            if (this.hourHeight !== undefined) {
                yamlLines.push(`hourHeight: ${this.hourHeight}`);
            }
            if (this.collapsedColumns && this.collapsedColumns.size > 0) {
                yamlLines.push(`collapsedColumns: [${Array.from(this.collapsedColumns).join(', ')}]`);
            }

            if (newFilters.children && newFilters.children.length > 0) {
                yamlLines.push('filters:');
                yamlLines.push(`  kind: group`);
                yamlLines.push(`  mode: ${newFilters.mode}`);
                yamlLines.push('  children:');
                for (const child of newFilters.children) {
                    yamlLines.push(...serializeFilterNode(child, '    '));
                }
            }

            const newCodeBlock = [startLine, ...yamlLines, '```'].join('\n');
            const beforeBlock = lines.slice(0, lineStart).join('\n');
            const afterBlock = lines.slice(lineEnd + 1).join('\n');
            
            const newFileContent = [beforeBlock, newCodeBlock, afterBlock].filter(x => x !== '').join('\n');
            await this.app.vault.modify(activeFile, newFileContent);
        } catch (e) {
            console.error('Error updating codeblock in file:', e);
        }
    }

    /** Rule whose editor row is open under the filter bar (null: none) */
    filterEditingId: string | null = null;

    /**
     * Inline filter panel, in the shape of Obsidian's own filters: one wrapping bar (match mode, a chip per rule,
     * "+ Filter") and, for the chip being edited, a single editor row below it. Nested groups (older notes, or
     * "+ Filter → Group") render inline as bracketed chip groups instead of stacked boxes. It edits the same
     * FilterGroup tree as before, so the YAML written into the note (updateCodeBlockInFile) is unchanged.
     */
    renderFilterPanel(parent: HTMLElement): HTMLElement | null {
        if (!this.showFilterPanel) return null;

        const panel = parent.createDiv({ cls: 'dp-filter-panel' });
        this.filterPanelEl = panel;
        this.attachFilterDismissListeners();

        this.renderFilterBar(panel, this.filters, null);
        const editing = this.filterEditingId ? this.findFilterRule(this.filters, this.filterEditingId) : null;
        if (editing) this.renderFilterRuleEditor(panel, editing.rule);
        else this.filterEditingId = null;
        return panel;
    }

    findFilterRule(group: FilterGroup, id: string): { rule: FilterRule; parent: FilterGroup } | null {
        for (const child of group.children ?? []) {
            if (isFilterGroup(child)) {
                const found = this.findFilterRule(child, id);
                if (found) return found;
            } else if (child.id === id) {
                return { rule: child, parent: group };
            }
        }
        return null;
    }

    /** The root bar, or (with `parentGroup`) a nested group drawn inline as a bracketed chip group */
    renderFilterBar(container: HTMLElement, group: FilterGroup, parentGroup: FilterGroup | null) {
        const nested = parentGroup !== null;
        const bar = container.createDiv({ cls: nested ? 'dp-filter-chip-group' : 'dp-filter-bar' });

        const mode = bar.createEl('select', { cls: 'dropdown dp-filter-mode', attr: { 'aria-label': 'Match mode' } });
        ([['all', nested ? 'all of' : 'Match all'], ['any', nested ? 'any of' : 'Match any'], ['none', nested ? 'none of' : 'Match none']] as const)
            .forEach(([value, label]) => {
                const opt = mode.createEl('option', { value, text: label });
                if (value === group.mode) opt.selected = true;
            });
        mode.addEventListener('change', () => {
            group.mode = mode.value as FilterGroup['mode'];
            this.onFilterChanged();
        });

        (group.children ?? []).forEach(child => {
            if (isFilterGroup(child)) this.renderFilterBar(bar, child, group);
            else this.renderFilterChip(bar, child, group);
        });

        const add = bar.createEl('button', {
            cls: 'dp-filter-add',
            text: nested ? '+' : '+ Filter',
            attr: { 'aria-label': nested ? 'Add a filter to this group' : 'Add a filter' }
        });
        add.addEventListener('click', (e) => this.openAddFilterMenu(e, group));

        if (nested) {
            const remove = bar.createEl('button', { cls: 'dp-filter-chip-remove', attr: { 'aria-label': 'Remove this group' } });
            setIcon(remove, 'x');
            remove.addEventListener('click', () => {
                this.removeNodeFromGroup(this.filters, group.id!);
                this.onFilterChanged(true);
            });
        } else if (!(group.children?.length)) {
            bar.createSpan({ cls: 'dp-filter-empty', text: 'No filters: every item is shown.' });
        }
    }

    renderFilterChip(bar: HTMLElement, rule: FilterRule, group: FilterGroup) {
        rule.id ??= randomFilterId();
        const chip = bar.createDiv({
            cls: `dp-filter-chip${this.filterEditingId === rule.id ? ' is-editing' : ''}`,
            attr: { 'data-rule-id': rule.id, role: 'button', tabindex: '0', 'aria-label': `${describeFilterRule(rule)} (click to edit)` }
        });
        setFirstIcon(chip.createSpan({ cls: 'dp-filter-chip-icon' }), FILTER_TYPES.find(t => t.type === rule.type)?.icons ?? ['filter']);
        chip.createSpan({ cls: 'dp-filter-chip-label', text: describeFilterRule(rule) });
        const toggleEditor = () => {
            this.filterEditingId = this.filterEditingId === rule.id ? null : rule.id!;
            this.rebuildFilterPanel();
        };
        chip.addEventListener('click', toggleEditor);
        chip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleEditor();
            }
        });

        const remove = chip.createEl('button', { cls: 'dp-filter-chip-remove', attr: { 'aria-label': 'Remove this filter' } });
        setIcon(remove, 'x');
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = group.children?.indexOf(rule) ?? -1;
            if (index !== -1) group.children!.splice(index, 1);
            if (this.filterEditingId === rule.id) this.filterEditingId = null;
            this.onFilterChanged(true);
        });
    }

    /** "+ Filter": pick what to filter by (opens that rule's editor), or add a nested group */
    openAddFilterMenu(e: MouseEvent, group: FilterGroup) {
        const menu = new Menu();
        (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
        const add = (node: FilterRule | FilterGroup) => {
            (group.children ??= []).push(node);
            if (!isFilterGroup(node)) this.filterEditingId = node.id!;
            this.onFilterChanged(true);
        };
        FILTER_TYPES.forEach(t => menu.addItem(item => item.setTitle(t.label).setIcon(t.icons[0]).onClick(() => add(newFilterRule(t.type)))));
        menu.addSeparator();
        menu.addItem(item => item.setTitle('Group (match any of…)').setIcon('list').onClick(() =>
            add({ kind: 'group', id: randomFilterId(), mode: 'any', children: [] })));
        menu.showAtMouseEvent(e);
    }

    /** Keeps the chip of the rule being edited in step with its editor row (label and type icon) */
    refreshFilterChip(rule: FilterRule) {
        const chip = this.filterPanelEl?.querySelector<HTMLElement>(`[data-rule-id="${rule.id}"]`);
        if (!chip) return;
        chip.querySelector('.dp-filter-chip-label')?.setText(describeFilterRule(rule));
        const icon = chip.querySelector<HTMLElement>('.dp-filter-chip-icon');
        if (icon) {
            icon.empty();
            setFirstIcon(icon, FILTER_TYPES.find(t => t.type === rule.type)?.icons ?? ['filter']);
        }
        chip.setAttr('aria-label', `${describeFilterRule(rule)} (click to edit)`);
    }

    /** One row: [type] [operator] [value] [Done]. Every change filters live; the chip follows. */
    renderFilterRuleEditor(panel: HTMLElement, rule: FilterRule) {
        const row = panel.createDiv({ cls: 'dp-filter-editor' });
        const changed = () => {
            this.refreshFilterChip(rule);
            this.onFilterChanged();
        };

        const typeSelect = row.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Filter by' } });
        FILTER_TYPES.forEach(t => {
            const opt = typeSelect.createEl('option', { value: t.type, text: t.label });
            if (t.type === rule.type) opt.selected = true;
        });

        const opSelect = row.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Condition' } });
        const operatorsFor = (type: FilterRule['type']): FilterRule['operator'][] => {
            if (type === 'priority') return ['equals', 'notEquals', 'isHigher', 'isLower'];
            if (type === 'status' || type === 'itemType') return ['equals', 'notEquals'];
            if (type === 'date') return ['equals', 'notEquals', 'isBefore', 'isAfter', 'isEmpty', 'isNotEmpty'];
            if (type === 'folder' || type === 'file') return ['contains', 'notContains'];
            return ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith'];
        };
        const opLabel = (op: FilterRule['operator']) => {
            if (rule.type === 'folder') return op === 'notContains' ? 'not in' : 'in';
            if (rule.type === 'file') return op === 'notContains' ? 'does not match' : 'matches';
            return FILTER_OP_LABEL[op];
        };
        const renderOperators = () => {
            opSelect.empty();
            const ops = operatorsFor(rule.type);
            if (!ops.includes(rule.operator)) rule.operator = ops[0];
            ops.forEach(op => {
                const opt = opSelect.createEl('option', { value: op, text: opLabel(op) });
                if (op === rule.operator) opt.selected = true;
            });
        };

        const valueSlot = row.createDiv({ cls: 'dp-filter-editor-value' });
        const selectValue = (options: Array<[string, string]>) => {
            const select = valueSlot.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Value' } });
            options.forEach(([value, label]) => {
                const opt = select.createEl('option', { value, text: label });
                if (value === rule.value) opt.selected = true;
            });
            select.addEventListener('change', () => { rule.value = select.value; changed(); });
        };
        const renderValue = () => {
            valueSlot.empty();
            if (rule.type === 'status') {
                selectValue([['todo', 'To do'], ['in-progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']]);
            } else if (rule.type === 'priority') {
                selectValue([['highest', 'Highest 🔺'], ['high', 'High ⏫'], ['medium', 'Medium 🔼'], ['normal', 'Normal'], ['low', 'Low 🔽'], ['lowest', 'Lowest ⏬']]);
            } else if (rule.type === 'itemType') {
                selectValue([['task', 'Task'], ['gcal', 'Google Calendar appointment']]);
            } else if (rule.type === 'date') {
                if (rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty') return;
                const presets = ['today', 'yesterday', 'tomorrow', 'this week', 'this month', 'this year'];
                const select = valueSlot.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Date' } });
                [['today', 'Today'], ['yesterday', 'Yesterday'], ['tomorrow', 'Tomorrow'], ['this week', 'This week'],
                    ['this month', 'This month'], ['this year', 'This year'], ['custom', 'Specific date…']].forEach(([value, label]) => {
                    const opt = select.createEl('option', { value, text: label });
                    if (value === (presets.includes(rule.value) ? rule.value : 'custom')) opt.selected = true;
                });
                const picker = valueSlot.createEl('input', { type: 'date', attr: { 'aria-label': 'Specific date' } });
                const showPicker = !presets.includes(rule.value);
                picker.toggleClass('dp-hidden', !showPicker);
                picker.value = /^\d{4}-\d{2}-\d{2}$/.test(rule.value) ? rule.value : (window as any).moment().format('YYYY-MM-DD');
                select.addEventListener('change', () => {
                    const custom = select.value === 'custom';
                    picker.toggleClass('dp-hidden', !custom);
                    rule.value = custom ? picker.value : select.value;
                    changed();
                });
                picker.addEventListener('change', () => { rule.value = picker.value; changed(); });
            } else {
                const input = valueSlot.createEl('input', {
                    type: 'text',
                    attr: {
                        'aria-label': 'Value',
                        placeholder: rule.type === 'tag' ? 'e.g. urgent' : rule.type === 'folder' ? 'Folder…' : rule.type === 'file' ? 'Note name…' : 'Text…'
                    }
                });
                input.value = rule.value;
                // Filters live while typing: the content refresh keeps this panel (and the caret) mounted
                input.addEventListener('input', () => { rule.value = input.value; changed(); });
                onEnterSubmit(input, () => closeEditor()); // IME-safe: a composing Hangul syllable is committed first
                if (rule.type === 'folder' || rule.type === 'file') {
                    attachPathSuggest(this.app, input, rule.type, path => {
                        // Folder rules compare the folder path; file rules the note name (filename, ".md" optional)
                        input.value = rule.type === 'file' ? (path.split('/').pop() ?? path).replace(/\.md$/i, '') : path;
                        rule.value = input.value;
                        changed();
                    });
                }
                if (!rule.value) window.setTimeout(() => input.focus(), 0); // a fresh rule is ready to type into
            }
        };

        const closeEditor = () => {
            this.filterEditingId = null;
            this.rebuildFilterPanel();
        };

        renderOperators();
        renderValue();
        typeSelect.addEventListener('change', () => {
            const fresh = newFilterRule(typeSelect.value as FilterRule['type']);
            rule.type = fresh.type;
            rule.operator = fresh.operator;
            rule.value = fresh.value;
            renderOperators();
            renderValue();
            changed();
        });
        opSelect.addEventListener('change', () => {
            rule.operator = opSelect.value as FilterRule['operator'];
            renderValue();
            changed();
        });

        const done = row.createEl('button', { cls: 'dp-filter-editor-done', text: 'Done' });
        done.addEventListener('click', closeEditor);
    }

    removeNodeFromGroup(group: FilterGroup, targetId: string): boolean {
        if (!group.children) return false;
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if (child.id === targetId) {
                group.children.splice(i, 1);
                return true;
            }
            if (child.kind === 'group' || (child as any).children !== undefined) {
                const found = this.removeNodeFromGroup(child as FilterGroup, targetId);
                if (found) return true;
            }
        }
        return false;
    }

    navigateDate(direction: number) {
        if (this.viewType === 'daily') this.currentDate.add(direction, 'day');
        if (this.viewType === 'multiDay') this.currentDate.add(direction * (this.plugin.settings.nDayViewDays || 4), 'day');
        if (this.viewType === 'weekly') this.currentDate.add(direction, 'week');
        if (this.viewType === 'monthly') this.currentDate.add(direction, 'month');
        if (this.viewType === 'list') {
            this.currentDate.add(direction, 'month');
        }
    }

    renderRoot(rootEl: HTMLDivElement) {
        const header = rootEl.createDiv({ cls: 'dp-header' });
        this.renderNavHeader(header, false);

        const tabsContainer = header.createDiv({ cls: 'dp-tabs' });
        const tabs: { key: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list'; label: string }[] = [
            { key: 'daily', label: 'Daily Timeline' },
            { key: 'multiDay', label: `${this.plugin.settings.nDayViewDays || 4}-day View` },
            { key: 'weekly', label: 'Weekly View' },
            { key: 'monthly', label: 'Monthly Calendar' },
            { key: 'board', label: 'Board' },
            { key: 'list', label: 'List View' }
        ];

        tabs.forEach(tab => {
            if (tab.key === 'multiDay') {
                const tabEl = tabsContainer.createEl('div', {
                    cls: `dp-tab dp-tab-nday ${this.viewType === 'multiDay' ? 'active' : ''}`
                });
                
                tabEl.addEventListener('click', async (e) => {
                    if (e.target instanceof HTMLSelectElement) return;
                    this.viewType = 'multiDay';
                    await this.refreshTasks(); // tab change: cached GCal ranges only, no forced fetch
                    this.updateCodeBlockInFile(this.viewType, this.filters);
                });

                const select = tabEl.createEl('select', {
                    cls: 'dp-tab-select'
                });
                
                for (let i = 2; i <= 14; i++) {
                    const opt = select.createEl('option', { value: String(i), text: String(i) });
                    opt.style.backgroundColor = 'var(--background-primary)';
                    opt.style.color = 'var(--text-normal)';
                    if (i === (this.plugin.settings.nDayViewDays || 4)) {
                        opt.selected = true;
                    }
                }

                tabEl.createSpan({ text: '-day View' });

                select.addEventListener('change', async (e) => {
                    const val = parseInt(select.value, 10);
                    this.plugin.settings.nDayViewDays = val;
                    await this.plugin.saveSettings();
                    triggerHaptic('selection');
                    this.viewType = 'multiDay';
                    this.plugin.refreshActiveViews();
                });
            } else {
                const btn = tabsContainer.createEl('button', {
                    cls: `dp-tab ${this.viewType === tab.key ? 'active' : ''}`,
                    text: tab.label
                });
                btn.addEventListener('click', async () => {
                    if (this.viewType !== tab.key) triggerHaptic('selection');
                    this.viewType = tab.key;
                    await this.refreshTasks(); // tab change: cached GCal ranges only, no forced fetch
                    this.updateCodeBlockInFile(this.viewType, this.filters);
                });
            }
        });
        animateActiveTabPill(tabsContainer, this as any, this.viewType);
        keepActiveTabInView(tabsContainer, this as any);

        this.renderFilterPanel(rootEl);

        const content = rootEl.createDiv({ cls: 'dp-content' });
        content.style.cssText = 'flex-grow: 1; overflow-y: auto; padding: 0; position: relative;';
        this.renderContentArea(rootEl, content);
    }

    renderContentArea(rootEl: HTMLDivElement, content: HTMLDivElement) {
        content.empty();
        rootEl.querySelector(':scope > .dp-current-task-bar')?.remove();

        if (this.viewType === 'daily') {
            this.renderDailyTimeline(content);
            this.renderCurrentTaskTracker(rootEl);
        } else if (this.viewType === 'weekly') {
            this.renderWeeklyView(content);
        } else if (this.viewType === 'multiDay') {
            this.renderWeeklyView(content, Math.max(2, Math.min(14, this.plugin.settings.nDayViewDays || 4)), true);
        } else if (this.viewType === 'monthly') {
            this.renderMonthlyCalendar(content);
        } else if (this.viewType === 'board') {
            this.renderKanbanBoard(content);
        } else if (this.viewType === 'list') {
            this.renderListView(content);
        }
    }
}

// Type-side view of the runtime mixin below: the renderer really has these base-view methods on its prototype
export interface DayPlannerCodeBlockRenderer extends Pick<DayPlannerBaseView,
    'refreshTasks' | 'render' | 'renderNavHeader' | 'renderDailyTimeline' | 'renderCurrentTaskTracker' |
    'renderWeeklyView' | 'renderMonthlyCalendar' | 'renderKanbanBoard' | 'renderListView' | 'registerScrollIdleClass'> {}

// Copy all methods from DayPlannerBaseView's prototype to DayPlannerCodeBlockRenderer's prototype dynamically
for (const key of Object.getOwnPropertyNames(DayPlannerBaseView.prototype)) {
    if (
        key === 'constructor' || 
        key === 'onload' || 
        key === 'onunload' || 
        key === 'renderRoot' || 
        key === 'getViewType' || 
        key === 'getViewTabType' || 
        key === 'navigateDate'
    ) {
        continue;
    }
    
    const descriptor = Object.getOwnPropertyDescriptor(DayPlannerBaseView.prototype, key);
    if (descriptor) {
        Object.defineProperty(DayPlannerCodeBlockRenderer.prototype, key, descriptor);
    }
}
