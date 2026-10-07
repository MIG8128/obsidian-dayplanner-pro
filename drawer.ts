import { setIcon } from 'obsidian';
import type { TaskItem } from './types';
import type { DayPlannerCombinedView } from './views';
import { cleanTaskTextForDisplay, onEnterSubmit } from './utils';

/**
 * Desktop side drawer: a generic shell (header with title or panel tabs, close button, scrolling body) around one
 * pluggable panel. A new panel (Habits, Scratchpad, ...) is one more entry in SIDE_DRAWER_PANELS; the shell,
 * the header toggle, the `s` hotkey and the persisted open/active-panel state need no changes.
 */
export interface SideDrawerPanel {
    id: string;
    title: string;
    /** Lucide icon name */
    icon: string;
    /** Badge shown next to the title / tab; omit for panels without a meaningful count */
    count?(view: DayPlannerCombinedView): number;
    /** Fills the drawer body; called on every view render (the body starts empty) */
    render(body: HTMLElement, view: DayPlannerCombinedView): void;
}

const isOpen = (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-';

/** Active tasks without a date: the same set as the Board's Undated column */
export const isUndatedTask = (t: TaskItem) => t.date === null && isOpen(t);

/** Active tasks dated before today (the real calendar day, not the date the view is paged to) */
export const isOverdueTask = (t: TaskItem, todayStr: string) => t.date !== null && t.date < todayStr && isOpen(t);

const PRIORITY_RANK: Record<string, number> = { highest: 0, high: 1, medium: 2, normal: 3, low: 4, lowest: 5 };

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

/** Where a drawer card came from; the drag engine uses it to decide what a drop into the drawer means */
export type DrawerSectionId = 'overdue' | 'undated';

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
    action?: { label: string; tooltip: string; run: () => void }
) {
    const isEmpty = tasks.length === 0;
    if (view.drawerSectionOverrides.get(id)?.empty !== isEmpty) view.drawerSectionOverrides.delete(id);
    const collapsed = view.drawerSectionOverrides.get(id)?.collapsed ?? isEmpty;
    // Drawn in the previous render's state first, so a fold / unfold caused by data animates instead of jumping
    const wasCollapsed = view.drawerSectionState.get(id) ?? collapsed;
    view.drawerSectionState.set(id, collapsed);

    const section = body.createDiv({ cls: `dp-drawer-section${wasCollapsed ? ' is-collapsed' : ''}`, attr: { 'data-section': id } });
    // Header row: the fold toggle (chevron, title, count) plus an optional section action beside it (not inside:
    // a button cannot hold another button)
    const header = section.createDiv({ cls: 'dp-drawer-section-header' });
    const head = header.createEl('button', { cls: 'dp-drawer-section-toggle', attr: { 'aria-expanded': String(!collapsed) } });
    head.createSpan({ cls: 'dp-drawer-chevron', text: '▾' });
    head.createSpan({ cls: 'dp-drawer-section-title', text: title });
    head.createSpan({ cls: 'dp-drawer-count', text: String(tasks.length) });
    if (action && tasks.length > 0) {
        const actionBtn = header.createEl('button', { cls: 'dp-drawer-section-action', text: action.label, attr: { 'aria-label': action.tooltip } });
        actionBtn.addEventListener('click', () => action.run());
    }
    head.addEventListener('click', () => {
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
    if (tasks.length === 0) {
        inner.createDiv({ cls: 'dp-drawer-empty', text: empty });
        return;
    }
    const list = inner.createDiv({ cls: 'dp-drawer-list' });
    tasks.forEach(task => view.renderDrawerTaskCard(list, task, id));
}

/**
 * One-line capture at the top of the panel: Enter adds an undated task to the default task file (🔺 ⏫ 🔼 🔽 ⏬ set
 * its priority). The drawer is rebuilt on every render, so the draft and the focus are restored from the view.
 */
function renderQuickCapture(body: HTMLElement, view: DayPlannerCombinedView) {
    const input = body.createEl('input', {
        cls: 'dp-drawer-capture',
        attr: { type: 'text', placeholder: '+ Add an undated task (🔺 ⏫ for priority)', 'aria-label': 'Quick capture: add an undated task' }
    });
    input.value = view.drawerCaptureDraft;
    input.addEventListener('input', () => { view.drawerCaptureDraft = input.value; });
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
        void view.captureUndatedTask(raw);
    });
    if (view.drawerCaptureFocused) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }
}

const tasksPanel: SideDrawerPanel = {
    id: 'tasks',
    title: 'Tasks',
    icon: 'list-checks',
    render(body, view) {
        const todayStr = (window as any).moment().format('YYYY-MM-DD');
        renderQuickCapture(body, view);
        const overdue = sortByPriorityThenTitle(view.tasks.filter(t => isOverdueTask(t, todayStr)), true);
        renderDrawerSection(body, view, 'overdue', '🚨 Overdue Tasks', overdue, 'All caught up! 🎉', {
            label: 'Roll to today',
            tooltip: 'Roll all overdue tasks to today (times are kept)',
            run: () => void view.moveTasksToDate(overdue, todayStr)
        });
        renderDrawerSection(body, view, 'undated', '📂 Undated Tasks',
            sortByPriorityThenTitle(view.tasks.filter(isUndatedTask)), 'No undated tasks. Drag a scheduled task here to unschedule it.');
    }
};

export const SIDE_DRAWER_PANELS: SideDrawerPanel[] = [tasksPanel];

/** Tabs that show the drawer: the date-based views a task can be dropped onto */
export const SIDE_DRAWER_TABS: ReadonlyArray<string> = ['daily', 'multiDay', 'weekly', 'monthly'];

/** Lucide renamed sidebar-* to panel-*; older Obsidian builds only know the former */
export function setFirstIcon(el: HTMLElement, names: string[]) {
    for (const name of names) {
        setIcon(el, name);
        if (el.querySelector('svg')) return;
    }
}

/** Builds the drawer into `rootEl` (absolutely positioned under the header; see .dp-side-drawer in styles.ts). */
export function renderSideDrawer(rootEl: HTMLElement, view: DayPlannerCombinedView): HTMLElement {
    const settings = view.plugin.settings;
    const panel = SIDE_DRAWER_PANELS.find(p => p.id === settings.sideDrawerPanel) ?? SIDE_DRAWER_PANELS[0];

    const drawer = rootEl.createDiv({ cls: 'dp-side-drawer' });
    drawer.toggleClass('is-open', view.isSideDrawerOpen());
    drawer.setAttr('aria-label', panel.title);

    const header = drawer.createDiv({ cls: 'dp-drawer-header' });
    if (SIDE_DRAWER_PANELS.length > 1) {
        const tabs = header.createDiv({ cls: 'dp-drawer-tabs' });
        SIDE_DRAWER_PANELS.forEach(p => {
            const tab = tabs.createEl('button', { cls: `dp-drawer-tab${p === panel ? ' is-active' : ''}`, attr: { 'aria-label': p.title } });
            setIcon(tab, p.icon);
            const count = p.count?.(view);
            if (count) tab.createSpan({ cls: 'dp-drawer-count', text: String(count) });
            tab.addEventListener('click', async () => {
                if (p === panel) return;
                settings.sideDrawerPanel = p.id;
                view.drawerScrollTop = 0;
                await view.plugin.saveSettings();
                view.render();
            });
        });
    }
    const title = header.createDiv({ cls: 'dp-drawer-title' });
    setIcon(title.createSpan({ cls: 'dp-drawer-title-icon' }), panel.icon);
    title.createSpan({ text: panel.title });
    const count = panel.count?.(view);
    if (count) title.createSpan({ cls: 'dp-drawer-count', text: String(count) });

    const closeBtn = header.createEl('button', { cls: 'clickable-icon dp-drawer-close', attr: { 'aria-label': 'Close side drawer (S)' } });
    setFirstIcon(closeBtn, ['panel-right-close', 'sidebar-close', 'x']);
    closeBtn.addEventListener('click', () => void view.toggleSideDrawer(false));

    const body = drawer.createDiv({ cls: 'dp-drawer-body' });
    panel.render(body, view);
    // The drawer is rebuilt with the header on every render: keep the reader's place in the list
    body.scrollTop = view.drawerScrollTop;
    body.addEventListener('scroll', () => { view.drawerScrollTop = body.scrollTop; }, { passive: true });
    return drawer;
}
