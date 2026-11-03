import { ItemView, Menu, Notice, setIcon, WorkspaceLeaf } from 'obsidian';
import { setFirstIcon } from '../../drawer';
import { syncAllTasksToGCal } from '../../gcalApi';
import { t } from '../../i18n';
import DayPlannerPlugin from '../../main';
import { AddChoiceModal, DeleteConfirmModal, GCalEventEditModal, ShortcutHelpModal, TaskEditModal, TaskSyncModal, TimelineHoursModal } from '../../modals';
import { GCAL_CACHE_TTL_MS, GCalEvent, MOTION, TaskItem } from '../../types';
import { cleanTaskTextForDisplay, fileNameTaskDate, formatMinutesNice, getHeaderDateInfo, getTargetTaskFilePath, openNoteForDate, openTaskInEditor, scanVaultTasks, scrollToTarget, searchTerms, taskListSignature, taskMatchesSearch, timeToMinutes, triggerHaptic } from '../../utils';
import type { DayPlannerCombinedView } from './combinedView';
import { finishAllPageSwipes, PAGE_SWIPE_MS } from './pageSwipe';
import { BOARD_MODES, BoardMode, createNewTaskInFile, CURRENT_TASK_TICK_MS, deletePlannerItems, eventTimesOnDate, FilterGroup, GCalDayIndex, getSpannedDates, greetNowLine, hasTouchScreen, isFilterGroup, isTypingContext, matchFilterGroup, matchGCalEventGroup, parseFilterGroup, PointerDragSource, setSyncSpin, updateTaskInFile } from './shared';

/** Base of every planner view: state, data loading, render loop, nav header, selection, sync, shortcuts. */
export abstract class PlannerViewCore extends ItemView {
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
        const range = this.getGCalRange();
        let cache = this.plugin.settings.enableGoogleCalendar ? this.plugin.gcalRanges.get(range.cacheKey)?.events || [] : [];
        // Subscribed (.ics) calendars, read-only
        const subscribed = this.plugin.icsEventsBetween(range.timeMin, range.timeMax);
        if (subscribed.length > 0) cache = cache.concat(subscribed);
        const self = this as any;
        if (self.parentNoteType === 'daily' && self.parentNoteDate) {
            const targetDate = self.parentNoteDate;
            cache = cache.filter(e => {
                const spanned = this.getSpannedDatesForEvent(e);
                return spanned.includes(targetDate);
            });
        } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
            const moment = (window as any).moment;
            // Spanned dates are YYYY-MM-DD: compare lexically instead of parsing each one
            const startOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week').format('YYYY-MM-DD');
            const endOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week').format('YYYY-MM-DD');
            cache = cache.filter(e => this.getSpannedDatesForEvent(e).some(dateStr => dateStr >= startOfWeek && dateStr <= endOfWeek));
        }
        // Planner search: title, location, description or calendar name
        const terms = searchTerms((this as any).searchQuery ?? '');
        if (terms.length > 0) {
            cache = cache.filter(e => {
                const haystack = `${e.summary}\n${e.location ?? ''}\n${e.description ?? ''}\n${e.calendarName ?? ''}`.toLowerCase();
                return terms.every(term => haystack.includes(term));
            });
        }
        const filters = (this as any).filters;
        if (filters) {
            if (filters.children && filters.children.length > 0) {
                return cache.filter(e => matchGCalEventGroup(e, filters));
            } else if (filters.rules && filters.rules.length > 0) {
                const group = parseFilterGroup(filters); // once, not per event
                return cache.filter(e => matchGCalEventGroup(e, group));
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
                ...(this.plugin.hasCalendars() ? dateStrs.flatMap(d => this.getCalendarEventsForDate(d)) : []).map(e => toMin(e.startTimeStr))
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

    /**
     * Multi-day events of one row of days (a week): each takes one lane on every day it covers, so its bar stays level.
     * Lanes go A→Z by title, each event on the first lane free across all its days. `first` / `last` are day indexes
     * in `dates`; `left` / `right`: the event goes on before / after the row.
     */
    multiDayLanes(dates: string[], eventsByDate: Map<string, GCalEvent[]>, allDayOnly: boolean) {
        const spans = new Map<string, { e: GCalEvent; first: number; last: number; lane: number; left: boolean; right: boolean }>();
        dates.forEach((dateStr, i) => (eventsByDate.get(dateStr) || []).forEach(e => {
            if (allDayOnly && !e.isAllDay) return;
            const key = `${e.calendarId}:${e.id}`;
            const known = spans.get(key);
            if (known) {
                known.last = i;
                return;
            }
            const all = this.getSpannedDatesForEvent(e);
            if (all.length < 2) return;
            spans.set(key, { e, first: i, last: i, lane: 0, left: all[0] < dateStr, right: all[all.length - 1] > dates[dates.length - 1] });
        }));
        const lanesByDay: (GCalEvent | undefined)[][] = dates.map(() => []);
        const sorted = Array.from(spans.values())
            .sort((a, b) => (a.e.summary || '').localeCompare(b.e.summary || '') || a.first - b.first);
        let laneCount = 0;
        sorted.forEach(span => {
            const days = lanesByDay.slice(span.first, span.last + 1);
            while (days.some(day => day[span.lane])) span.lane++;
            days.forEach(day => { day[span.lane] = span.e; });
            laneCount = Math.max(laneCount, span.lane + 1);
        });
        return { spans: sorted, keys: new Set(spans.keys()), lanesByDay, laneCount };
    }

    /**
     * The view's events grouped by day. Weekly / Monthly ask once per visible day (42 on Monthly), and each call used
     * to re-filter every cached event and recompute its days. The index lives for the current synchronous pass only
     * (one render), so it never outlasts an await after which a drag or Undo edits cached events in place.
     */
    protected gcalDayIndex: GCalDayIndex | null = null;

    getCalendarEventsForDate(dateStr: string): GCalEvent[] {
        const self = this as any;
        const cacheKey = this.getGCalRange().cacheKey;
        const source = this.plugin.gcalRanges.get(cacheKey)?.events;
        const key = [cacheKey, self.parentNoteType, self.parentNoteDate, self.searchQuery ?? '', JSON.stringify(self.filters ?? null),
            this.plugin.icsVersion, !!this.plugin.settings.enableGoogleCalendar].join('\u0000');
        let index = self.gcalDayIndex as GCalDayIndex | null | undefined;
        if (!index || index.key !== key || index.events !== source) {
            const byDate = new Map<string, GCalEvent[]>();
            this.getCalendarEvents().forEach(e => {
                this.getSpannedDatesForEvent(e).forEach(d => {
                    const list = byDate.get(d);
                    if (list) list.push(e);
                    else byDate.set(d, [e]);
                });
            });
            const built: GCalDayIndex = { key, events: source, byDate };
            index = built;
            self.gcalDayIndex = built;
            void Promise.resolve().then(() => { if (self.gcalDayIndex === built) self.gcalDayIndex = null; });
        }
        // Fresh copies per call, as before: callers may annotate the objects they get
        return (index.byDate.get(dateStr) ?? []).map(e => ({ ...e, dateStr, ...eventTimesOnDate(e, dateStr) }));
    }

    savedScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }> = {};
    /** View kinds that already played their one-time smooth auto-scroll ('daily', 'weekly:7', 'list', …) */
    autoScrolledViews: Set<string> = new Set();
    /** Set by the Today button: the next render smooth-scrolls the active view to now / today's section */
    scrollToTodayRequested = false;

    /**
     * Scroll policy for timeline and list views:
     * Today button → glide to target; saved position (tab switch / re-render) → instant restore;
     * first mount of this view kind → glide once; arriving on today (current-time line shown) → glide to it;
     * other unseen dates/months → instant jump (no replayed motion). After a glide the current-time line greets.
     */
    applyAutoScroll(scroller: HTMLElement, scrollKey: string, viewKind: string, target: 'now' | 'today', fallbackTop: () => number = () => 0) {
        this.autoScrolledViews ??= new Set(); // code-block renderers get these methods via the prototype mixin
        const saved = this.savedScrollPositions[scrollKey];
        if (!this.scrollToTodayRequested && saved !== undefined) {
            scroller.scrollTop = saved.scrollTop;
            scroller.scrollLeft = saved.scrollLeft;
            return;
        }
        const nowLines = target === 'now'
            ? Array.from(scroller.querySelectorAll<HTMLElement>('.dp-timeline-current-indicator')).filter(line => line.style.display !== 'none')
            : [];
        const smooth = this.scrollToTodayRequested || !this.autoScrolledViews.has(viewKind) || nowLines.length > 0;
        this.autoScrolledViews.add(viewKind);
        // A date change slides the view in first (0.22s, styles.ts), then the glide starts
        const top = scrollToTarget(scroller, target, smooth ? 'smooth' : 'auto', fallbackTop,
            () => nowLines.forEach(greetNowLine), this.navDirection ? PAGE_SWIPE_MS : 0);
        this.savedScrollPositions[scrollKey] = { scrollTop: top, scrollLeft: saved?.scrollLeft ?? 0 };
    }

    selectedTaskIds: Set<string> = new Set();
    /** The view's tasks before the planner search narrowed them (Stats ignore the search) */
    unsearchedTasks: TaskItem[] = [];
    /** Planner search (floating search bar): task text and tags, note path; event title, location, calendar */
    searchQuery = '';
    /** A background refresh was skipped while this view was hidden (DayPlannerPlugin.refreshActiveViews) */
    staleWhileHidden = false;
    /**
     * Area the current selection lives in. Selections never mix areas: the timeline / board / month grid ('main'),
     * the all-day row ('allday') and the side drawer ('drawer'). Selecting in another area starts a new selection.
     */
    selectionZone: string | null = null;

    selectionZoneOf(el: Element): string {
        if (el.closest('.dp-side-drawer')) return 'drawer';
        if (el.closest('.dp-daily-allday, .dp-weekly-allday-grid')) return 'allday';
        return 'main';
    }

    /** Call before adding to the selection from `zone`: a selection from another area is dropped first */
    enterSelectionZone(zone: string) {
        if (this.selectionZone === zone) return;
        this.selectedTaskIds.clear();
        this.selectionZone = zone;
    }
    protected keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    /**
     * Tasks whose change must redraw this view on a background refresh (refreshTasks' skipIfUnchanged). The combined
     * view narrows it to what it can show, so typing in an unrelated note never rebuilds the planner.
     */
    relevantTasksForSignature(tasks: TaskItem[]): TaskItem[] {
        return tasks;
    }

    /**
     * Mirrors selectedTaskIds onto every selectable card: [data-task-id] (timeline, board) and [data-select-id]
     * (monthly items, all-day chips, list rows); leaf views also get the floating selection bar.
     */
    applySelectionState() {
        const root = this.containerEl.querySelector<HTMLElement>('.dp-container');
        if (!root) return;
        root.querySelectorAll<HTMLElement>('[data-task-id], [data-select-id], [data-drawer-task-id]').forEach(el => {
            const id = el.dataset.selectId ?? el.dataset.taskId ?? el.dataset.drawerTaskId;
            el.toggleClass('selected', !!id && this.selectedTaskIds.has(id));
        });
        root.querySelector(':scope > .dp-selection-bar')?.remove();
        const count = this.selectedTaskIds.size;
        if (count === 0 || !(this instanceof PlannerViewCore)) return;
        const bar = root.createDiv({ cls: 'dp-selection-bar' });
        bar.createSpan({ cls: 'dp-selection-count', text: t('selection.count', { n: count }) });
        const del = bar.createEl('button', { cls: 'dp-selection-delete', attr: { 'aria-label': t('selection.delete') } });
        setIcon(del.createSpan({ cls: 'dp-selection-icon' }), 'trash-2');
        del.createSpan({ text: t('common.delete') });
        del.addEventListener('click', () => this.deleteSelectedItems());
        const clear = bar.createEl('button', { cls: 'dp-selection-clear', attr: { 'aria-label': t('selection.clear') } });
        setIcon(clear, 'x');
        clear.addEventListener('click', () => this.dismissSelection());
    }

    /**
     * Back to the plain look: no selection, no touch-active card (its resize bars hide), no lifted / dragging card,
     * no selection bar. Esc and a press on empty space end here. Updates classes in place, no re-render.
     */
    dismissSelection() {
        this.clearTouchActive();
        this.selectedTaskIds.clear();
        this.selectionZone = null;
        this.containerEl.querySelectorAll('.dp-touch-lifted, .is-dragging').forEach(el => el.removeClass('dp-touch-lifted', 'is-dragging'));
        this.applySelectionState(); // drops every .selected and the selection bar
    }

    /** Delete / Backspace and the selection bar: confirm, then delete the selected tasks (their lines) and events */
    deleteSelectedItems() {
        const ids = this.selectedTaskIds;
        const tasks = (this.plugin.tasksCache ?? this.tasks).filter(task => ids.has(task.id));
        const events = new Map<string, GCalEvent>();
        // Subscribed (.ics) events are read-only: never offered for deletion
        this.plugin.gcalCache.forEach(e => { if (ids.has(e.id) && !e.readOnly) events.set(`${e.calendarId}::${e.id}`, e); });
        if (tasks.length === 0 && events.size === 0) {
            this.selectedTaskIds.clear(); // only stale ids left (their items are gone already)
            this.render();
            return;
        }
        const items = [
            ...tasks.map(task => ({ kind: 'task' as const, title: cleanTaskTextForDisplay(task.text) })),
            ...Array.from(events.values()).map(e => ({ kind: 'event' as const, title: e.summary || '—' }))
        ];
        new DeleteConfirmModal(this.app, items, () => void this.performDelete(tasks, Array.from(events.values()))).open();
    }

    protected async performDelete(tasks: TaskItem[], events: GCalEvent[]) {
        this.selectedTaskIds.clear(); // before the refresh deletePlannerItems ends with
        await deletePlannerItems(this.plugin, tasks, events);
    }

    kanbanViewMode: BoardMode = 'kanban';

    activeDragClickOffsetMin: number = 0;
    activePrimaryTaskId: string = '';
    activeDragItems: Array<{
        id: string;
        height: number;
        durationMin: number;
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

    /**
     * Touch position & resize mode (phones and tablets): a long-press makes one timeline card active. Its resize bars
     * appear (.is-touch-active; hidden on idle cards) and a touch on its body drags at once. Kept by item id, tab and
     * date so a data re-render keeps it, while another tab or date drops it. Ended by a press outside the card or a
     * finished move / resize.
     */
    touchActive: { refId: string; viewKey: string } | null = null;
    protected touchActiveDismiss: (() => void) | null = null;

    protected touchViewKey(): string {
        return `${this.getViewTabType()}|${this.currentDate ? this.currentDate.format('YYYY-MM-DD') : ''}`;
    }

    isTouchActive(refId: string): boolean {
        const active = this.touchActive;
        if (!active || active.refId !== refId) return false;
        if (active.viewKey === this.touchViewKey()) return true;
        this.clearTouchActive(); // switched tab or date since
        return false;
    }

    setTouchActive(card: HTMLElement, refId: string) {
        this.clearTouchActive();
        this.touchActive = { refId, viewKey: this.touchViewKey() };
        card.addClass('is-touch-active');
        const doc = card.ownerDocument;
        // A tap anywhere but on the active card (whichever copy a re-render left on screen) ends the mode and the
        // selection: on touch only a real tap (lifted within 10px), so scrolling to a spot to resize to keeps it.
        // The selection bar and modals (its Delete confirmation) act on the selection and leave it alone.
        const isOutside = (e: PointerEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest?.<HTMLElement>('.dp-timeline-event')?.dataset.taskId === refId) return false;
            return !target?.closest?.('.dp-selection-bar, .modal-container');
        };
        let tapStart: { id: number; x: number; y: number } | null = null;
        const onDown = (e: PointerEvent) => {
            tapStart = null;
            // Another finger tapping a tab or date arrow mid-drag must not drop the selection the drag is carrying
            if (this.activePointerDrag || this.touchDragActive || !isOutside(e)) return;
            if (e.pointerType === 'touch') tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY };
            else this.dismissSelection();
        };
        const onUp = (e: PointerEvent) => {
            const start = tapStart;
            tapStart = null;
            if (start && start.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 10) this.dismissSelection();
        };
        doc.addEventListener('pointerdown', onDown, true);
        doc.addEventListener('pointerup', onUp, true);
        this.touchActiveDismiss = () => {
            doc.removeEventListener('pointerdown', onDown, true);
            doc.removeEventListener('pointerup', onUp, true);
        };
    }

    clearTouchActive() {
        this.touchActiveDismiss?.();
        this.touchActiveDismiss = null;
        if (!this.touchActive) return;
        this.touchActive = null;
        this.containerEl.querySelectorAll('.dp-timeline-event.is-touch-active').forEach(el => el.removeClass('is-touch-active'));
    }
    /** Desktop pointer drag in progress (see beginPointerDrag): re-targeted after every render, cancelled by Esc */
    activePointerDrag: { refresh(): void; cancel(): void } | null = null;
    /** What each draggable card carries (registerMouseDrag): a card re-rendered between press and drag start hands
     *  its drag to its successor (liveDragCard) */
    protected dragSources = new WeakMap<HTMLElement, PointerDragSource>();
    /** Phone Board: the single column shown per board mode */
    phoneBoardColumn: Record<BoardMode, string> = { kanban: 'today', priority: 'highest', deadline: 'dueToday' };
    /** Column ids of the last compact Board render, in display order (swipe / j-k step through these) */
    phoneBoardColumnIds: string[] = [];
    boardSwitcherScroll: { tabScrollLeft?: number } = {};

    /** Compact shell (bottom tabs, date strip, swipes, long-press drag): the combined view on phones and the sidebar view. */
    useCompactLayout(): boolean {
        return false;
    }

    /** Compact shell List: a one-day agenda paged day by day (a month of rows is too long for a narrow pane) */
    isDayAgendaList(): boolean {
        return this.useCompactLayout() && this.getViewTabType() === 'list';
    }

    /** What one navigation step (arrows, swipe, Today) covers in the tab on screen */
    getNavUnit(): 'day' | 'week' | 'month' {
        const tab = this.getViewTabType();
        if (tab === 'weekly') return 'week';
        if (tab === 'monthly' || (tab === 'list' && !this.isDayAgendaList())) return 'month';
        return 'day';
    }

    /** Days shown by the N-day tab: fixed at 2 in the phone layout, otherwise the setting (2–14). */
    getNDayCount(): number {
        const own = (this as any).nDays as number | undefined; // a code block's own `days:`
        return this.useCompactLayout() ? 2 : Math.max(2, Math.min(14, own || this.plugin.settings.nDayViewDays || 4));
    }

    /** Opens one day picked from a calendar cell. Desktop: its daily note; the phone shell shows it in the Daily tab instead. */
    async focusDay(dateStr: string) {
        await this.handleDateClick(dateStr);
    }

    // ---- Inline task creation (double-click an empty timeline slot; leaf views on desktop) ----
    /** The open inline editor: kept across renders (data refreshes rebuild the columns) and re-mounted with its draft */
    inlineCreate: { dateStr: string; minutes: number; draft: string } | null = null;
    protected inlineCreateTeardown: (() => void) | null = null;

    /** Double-tap tracking on the view, not the render: a background redraw between the two taps keeps the first */
    protected timelineTapStart: { x: number; y: number; at: number } | null = null;
    protected lastTimelineTap: { x: number; y: number; at: number } | null = null;

    /** Same editor the timeline cards open on click */
    openTaskEditor(task: TaskItem) {
        new TaskEditModal(this.app, task, null, async (data) => {
            await updateTaskInFile(this.app, task, {
                text: data.text,
                statusChar: data.statusChar,
                priority: data.priority,
                // Placement date only (⏳ → 📅 → note name); the line gets the ⏳ / 📅 below as entered
                date: data.scheduledDate || data.dueDate || fileNameTaskDate(task.filePath),
                startTime: data.startTime,
                endTime: data.endTime,
                recurrence: data.recurrence,
                dueDate: data.dueDate,
                dueTime: data.dueTime,
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
    /** Pending save + redraw of the other views after a zoom slider move */
    protected zoomSettleTimer: number | undefined;
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

    /** Visible timeline hours: a code block's `hours:` range when it has one, otherwise the start / end hour settings */
    getTimelineHours(): { startHour: number; endHour: number } {
        const range = (this as any).timeRange as { startHour: number; endHour: number } | undefined;
        if (range) return range;
        return { startHour: this.plugin.settings.timelineStartHour ?? 0, endHour: this.plugin.settings.timelineEndHour ?? 24 };
    }

    /** Code block header: the settings' hours, a preset range, or Custom… (two hour lists); saved as the block's `hours:` */
    openTimelineHoursMenu(e: MouseEvent) {
        const block = this as any;
        const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
        const current = block.timeRange as { startHour: number; endHour: number } | undefined;
        const apply = (range: { startHour: number; endHour: number } | null) => {
            block.timeRange = range ?? undefined;
            block.timeRangeRaw = range ? `${fmt(range.startHour)}-${fmt(range.endHour)}` : undefined;
            this.render();
            void block.updateCodeBlockInFile(block.viewType, block.filters);
        };

        const settings = this.plugin.settings;
        const menu = new Menu();
        (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
        menu.addItem(item => item
            .setTitle(t('hours.useSettings', { range: `${fmt(settings.timelineStartHour ?? 0)}–${fmt(settings.timelineEndHour ?? 24)}` }))
            .setChecked(!current)
            .onClick(() => apply(null)));
        menu.addSeparator();
        for (const [startHour, endHour] of [[0, 24], [6, 22], [8, 18], [9, 18], [9, 17]]) {
            menu.addItem(item => item
                .setTitle(`${fmt(startHour)}–${fmt(endHour)}`)
                .setChecked(!!current && current.startHour === startHour && current.endHour === endHour)
                .onClick(() => apply({ startHour, endHour })));
        }
        menu.addSeparator();
        menu.addItem(item => item
            .setTitle(t('hours.custom'))
            .setIcon('clock')
            .onClick(() => new TimelineHoursModal(this.app, this.getTimelineHours(), apply).open()));
        menu.showAtMouseEvent(e);
    }

    async handleDateClick(dateStr: string) {
        await this.openNoteForDate(dateStr, 'daily');
    }

    /**
     * Weekly / N-day day header and Monthly day: that day in Daily. One handler for every planner: the Combined view
     * overrides it with its tab switch, and a code block switches its own view (saved in its source, like a tab click).
     */
    async openDayInDaily(dateStr: string) {
        await this.showDateInBlock(dateStr, 'daily');
    }

    /** Monthly week number: that week in Weekly (see openDayInDaily) */
    async openWeekInWeekly(weekStartStr: string) {
        await this.showDateInBlock(weekStartStr, 'weekly');
    }

    protected async showDateInBlock(dateStr: string, viewType: 'daily' | 'weekly') {
        const block = this as any;
        this.currentDate = (window as any).moment(dateStr, 'YYYY-MM-DD');
        block.viewType = viewType;
        await this.refreshTasks();
        block.updateCodeBlockInFile?.(viewType, block.filters);
    }

    /** Opens (creating from template if needed) the daily or weekly note for a date (moment or YYYY-MM-DD). */
    async openNoteForDate(date: any, type: 'daily' | 'weekly') {
        await openNoteForDate(this.app, date, type, this.plugin.settings);
    }

    async onOpen() {
        const container = this.contentEl;
        container.empty();

        const rootEl = container.createDiv({ cls: 'dp-container' });
        rootEl.toggleClass('dp-touch-screen', hasTouchScreen()); // touch styling (hidden idle resize bars) on touch laptops
        this.renderRoot(rootEl);
        this.registerScrollIdleClass(rootEl);

        // A press on empty space (no card, control or the selection bar) ends the selection: a click with the mouse, a
        // tap on touch (a scroll keeps it). Mouse presses on a timeline, the Board or the drawer reach the box selection
        // first, which clears a non-additive selection itself; touch has no box selection, so this is its only way out.
        let emptyTap: { id: number; x: number; y: number } | null = null;
        const isEmptySpace = (target: HTMLElement) => !target.closest('[data-task-id], [data-select-id], [data-drawer-task-id], '
            + '.dp-selection-bar, .dp-inline-create, button, input, textarea, select, a, [contenteditable], .dp-custom-cb, '
            + '.dp-task-link-btn, .dp-resize-handle, .dp-tab, .dp-day-pill, .dp-kanban-col-toggle, .dp-priority-trigger');
        rootEl.addEventListener('pointerdown', (e: PointerEvent) => {
            emptyTap = null;
            if (!e.isPrimary || (this.selectedTaskIds.size === 0 && !this.touchActive)) return;
            const target = e.target as HTMLElement;
            if (!isEmptySpace(target)) return;
            const scrolls = target.scrollHeight > target.clientHeight || target.scrollWidth > target.clientWidth;
            if (scrolls && (e.offsetX > target.clientWidth || e.offsetY > target.clientHeight)) return; // its scrollbar
            if (e.pointerType === 'touch') emptyTap = { id: e.pointerId, x: e.clientX, y: e.clientY };
            else if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) this.dismissSelection(); // modifiers add
        });
        rootEl.addEventListener('pointerup', (e: PointerEvent) => {
            const start = emptyTap;
            emptyTap = null;
            if (start && start.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 10) this.dismissSelection();
        });

        // Ctrl / Cmd + click toggles any card in or out of the selection instead of opening it (Delete removes it)
        rootEl.addEventListener('click', (e: MouseEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return;
            const card = (e.target as HTMLElement).closest<HTMLElement>('[data-task-id], [data-select-id]');
            if (!card || card.closest('.dp-side-drawer')) return;
            const id = card.dataset.selectId ?? card.dataset.taskId;
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            this.enterSelectionZone(this.selectionZoneOf(card));
            if (this.selectedTaskIds.has(id)) this.selectedTaskIds.delete(id);
            else this.selectedTaskIds.add(id);
            triggerHaptic('selection');
            this.applySelectionState();
        }, true);

        // Never await data here: Obsidian awaits onOpen of every visible leaf (10s cap) before firing onLayoutReady,
        // and the task scan itself waits for onLayoutReady. The shell above is the first paint; tasks fill in after.
        void this.refreshTasks(null, true);

        // 단축키 시스템 등록
        this.keydownHandler = async (e: KeyboardEvent) => {
            // Every keystroke in a note reaches this document listener: the O(1) active-view test turns it away before
            // any DOM work (the note, not this planner, is the active view)
            if (this.app.workspace.getActiveViewOfType(PlannerViewCore) !== this) return;
            if (isTypingContext(e)) return; // typing in search, quick capture, an editor…: no plugin hotkey fires
            // Sync: F5, or Ctrl+R (Windows / Linux) / Cmd+R (Mac), while a Dayloom view is the active one
            const syncKey = e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r');
            if (syncKey) {
                e.preventDefault();
                e.stopPropagation();
                if (!e.repeat) void this.runSync();
                return;
            }
            // Search: / or Ctrl/Cmd+F opens the planner's search bar
            const searchKey = (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey)
                || ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f');
            if (searchKey && this.isCombinedView()) {
                e.preventDefault();
                e.stopPropagation();
                this.openSearch();
                return;
            }
            // Plain keys only: Ctrl / Cmd / Alt chords (Cmd+P, Ctrl+J, ...) belong to Obsidian
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedTaskIds.size > 0) {
                e.preventDefault();
                this.deleteSelectedItems();
                return;
            }
            // Escape clears the selection and any touch-active card (a running card drag, resize or marquee handles
            // Escape itself, before this)
            if (e.key === 'Escape') {
                if (this.selectedTaskIds.size > 0 || this.touchActive
                    || this.containerEl.querySelector('.selected, .is-touch-active, .dp-selection-bar')) {
                    e.preventDefault();
                    this.dismissSelection();
                } else if (this.isCombinedView() && this.searchQuery) {
                    e.preventDefault();
                    this.closeSearch();
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
            } else if ((key === 'j' || key === 'k') && this.getViewTabType() === 'board') {
                // Desktop Board has no dates to page: j / k cycle Scheduled → Priority → Deadline
                e.preventDefault();
                const idx = BOARD_MODES.indexOf(this.kanbanViewMode);
                this.switchBoardMode(BOARD_MODES[(idx + (key === 'j' ? 1 : BOARD_MODES.length - 1)) % BOARD_MODES.length]);
            } else if (key === 'j' || key === 'k') {
                // Also mid-drag (pointer drags keep key events flowing): render() re-targets the drag afterwards
                e.preventDefault();
                await this.navigateWithSlide(key === 'j' ? 1 : -1);
            } else if (key === 's') {
                e.preventDefault();
                if (this.isCombinedView()) await this.toggleSideDrawer();
            } else if (key === 'd') {
                e.preventDefault();
                if (this.isCombinedView()) {
                    await this.switchTab('daily');
                } else {
                    this.plugin.activateView('day-planner-pro-daily');
                }
            } else if (key === 'w') {
                e.preventDefault();
                // The compact shell has no Weekly / N-day tab: those open in the main Dayloom view
                if (this.isCombinedView() && !this.useCompactLayout()) {
                    await this.switchTab('weekly');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'weekly');
                }
            } else if (key === 'm') {
                e.preventDefault();
                if (this.isCombinedView()) {
                    await this.switchTab('monthly');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'monthly');
                }
            } else if (key === 'b') {
                e.preventDefault();
                if (this.isCombinedView()) {
                    await this.switchTab('board');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'board');
                }
            } else if (key === 'x') {
                e.preventDefault();
                if (this.isCombinedView() && !this.useCompactLayout()) {
                    await this.switchTab('multiDay');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'multiDay');
                }
            } else if (key === 'l') {
                e.preventDefault();
                if (this.isCombinedView()) {
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
        this.clearTouchActive();
        return super.onClose();
    }

    /**
     * [성능 개선 버전] 로컬 파일 점진적 캐싱 업데이트 및 구글 캘린더 읽기 동기화
     */
    /** `rescan` 'force': rescan the whole vault first (Sync); null: the task cache, which the plugin keeps current per note */
    async refreshTasks(rescan: 'force' | null = null, forceFetchGCal: boolean = false, skipIfUnchanged: boolean = false) {
        try {
            const plugin = this.plugin as any;

            if (!plugin.tasksCache) {
                // Shared, layout-ready-gated scan: views restored at startup no longer scan during boot
                await plugin.ensureTasksCache();
            }
            if (rescan === 'force') plugin.tasksCache = await scanVaultTasks(this.app);

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
                    const group = parseFilterGroup(filters); // once, not per vault task
                    this.tasks = this.tasks.filter(task => matchFilterGroup(task, group));
                }
            }

            this.unsearchedTasks = this.tasks;
            const terms = searchTerms(self.searchQuery ?? '');
            if (terms.length > 0) this.tasks = this.tasks.filter(task => taskMatchesSearch(task, terms));

            // Background vault refresh: a note edit re-parses its tasks into equal copies (and a view edit already
            // redrew before its own 'modify' arrives), so skip the full redraw when nothing this view shows changed
            const signature = taskListSignature(this.relevantTasksForSignature(this.tasks));
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
            finishAllPageSwipes(this.containerEl);
            const contentOnly = !!(this as any).contentOnlyRender;
            const scrollPositions = new Map<string, { scrollTop: number; scrollLeft: number }>();
            const counts = new Map<string, number>();
            // Tab switches restore their own per-pane scroll; hidden (cached) panes never take part in index matching
            const isTabSwitch = !!(this as any).isTabSwitch;
            const isVisible = (el: Element) => !el.closest('.is-hidden, .dp-page-ghost');
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
                const { startHour, endHour } = this.getTimelineHours();
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

            let sliderContainer = this.containerEl.querySelector('.dp-zoom-slider-floating') as HTMLElement | null;
            if (showSlider) {
                sliderContainer ??= this.mountZoomSlider();
                if (sliderContainer) this.syncZoomSlider(sliderContainer);
            } else if (sliderContainer) {
                sliderContainer.style.display = 'none';
            }
            // A drag survives re-renders (j/k paging, data refresh): re-attach its preview to the new columns
            this.activePointerDrag?.refresh();
            this.applySelectionState();
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
     * Timeline zoom control: in the header toolbar, before Sync/Filter/+ (same slot as the Board mode toggle); in the
     * compact shell only in the More sheet's zoom row, so null while that sheet is closed.
     */
    mountZoomSlider(): HTMLElement | null {
        const sheetZoom = this.containerEl.querySelector<HTMLElement>('.dp-sheet-zoom');
        if (this.useCompactLayout() && !sheetZoom) return null;
        const headerActions = (this.containerEl.querySelector('.dp-header-tools') ?? this.containerEl.querySelector('.dp-header-actions')) as HTMLElement | null;
        const viewContent = this.contentEl || this.containerEl;
        const sliderContainer = (sheetZoom ?? headerActions ?? viewContent).createDiv({ cls: 'dp-zoom-slider-floating' });
        if (!sheetZoom) headerActions?.prepend(sliderContainer);

        const zoomToggle = sliderContainer.createSpan({ cls: 'dp-zoom-toggle', attr: { 'aria-label': t('header.zoom') } });
        setIcon(zoomToggle, 'zoom-in');
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
                if (newHeight !== oldHeight) triggerHaptic('selection'); // one tick per 5px step while dragging
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
                    this.rerenderForZoom(oldHeight); // this view follows the slider live
                    // The setting (data.json, shared through sync) and the other open planners follow once the slider
                    // rests: one write and one redraw per drag instead of one per 5px step
                    window.clearTimeout(this.zoomSettleTimer);
                    this.zoomSettleTimer = window.setTimeout(() => {
                        void this.plugin.saveSettings();
                        const targetTypes = separate ? [this.getViewType()] : ['day-planner-pro-view', 'day-planner-pro-daily'];
                        targetTypes.forEach(viewType => this.app.workspace.getLeavesOfType(viewType).forEach(leaf => {
                            const view = leaf.view as any;
                            if (view === this || typeof view?.render !== 'function') return; // this one is drawn already
                            try {
                                view.render();
                            } catch (err) {
                                console.error(`Failed to render leaf of type ${viewType}:`, err);
                            }
                        }));
                    }, 250);
                }
            } catch (err) {
                console.error("Day Planner Pro: Error in slider event listener:", err);
            }
        });
        return sliderContainer;
    }

    /** Puts the zoom slider and its px readout on the current hour height */
    syncZoomSlider(sliderContainer: HTMLElement) {
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
    }

    /**
     * 사이드바 너비를 고려한 완전 반응형 멀티레이아웃 렌더링 내비게이터 헤더
     */
    renderNavHeader(parent: HTMLDivElement, showTabs: boolean = false): { dateLabel: string } {
        // One row: [date pill] ... [🔍 zoom] [< 📅 Today >] [Sync] [+]. Zoom / Board mode toggle are prepended later.
        const headerTop = parent.createDiv({ cls: 'dp-header-top' });
        const compact = this.useCompactLayout();

        // Header date: text + note links come from the declarative getHeaderDateInfo() mapping
        // The compact List agenda shows one day: it gets the Daily header (that day, linked to its note)
        const info = getHeaderDateInfo(this.currentDate, this.isDayAgendaList() ? 'daily' : this.getViewTabType(), this.getNDayCount());
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

        // Decluttered: one pill for date navigation, one glass toolbar for every tool, the accent + on its own.
        // Board always shows today: no date navigation. Compact: [‹ Today ›] [+] only (icon-only Today); search, sync
        // and zoom live in the bottom bar's More sheet (see renderMoreSheet)
        const navGroup = compact ? null : headerActions.createDiv({ cls: 'dp-nav-buttons-group' });
        const tools = headerActions.createDiv({ cls: 'dp-header-tools' });
        headerTop.toggleClass('has-nav-arrows', compact && this.getViewTabType() !== 'board');
        if (this.getViewTabType() !== 'board') {
            const navHost = navGroup ?? tools;
            const prevBtn = navHost.createEl('button', { cls: 'dp-nav-arrow', attr: { 'aria-label': t('nav.previous') } });
            setIcon(prevBtn, 'chevron-left');
            prevBtn.addEventListener('click', async () => {
                triggerHaptic('selection');
                await this.navigateWithSlide(-1);
            });

            const todayBtn = navHost.createEl('button', { cls: 'dp-today-btn', attr: { 'aria-label': t('common.today') } });
            setIcon(todayBtn.createSpan({ cls: 'dp-btn-icon' }), 'calendar-check');
            todayBtn.createSpan({ cls: 'dp-btn-label', text: t('common.today') }); // hidden in the compact shell (icon-only)
            todayBtn.addEventListener('click', () => {
                triggerHaptic('selection');
                void this.goToToday();
            });

            const nextBtn = navHost.createEl('button', { cls: 'dp-nav-arrow', attr: { 'aria-label': t('nav.next') } });
            setIcon(nextBtn, 'chevron-right');
            nextBtn.addEventListener('click', async () => {
                triggerHaptic('selection');
                await this.navigateWithSlide(1);
            });
        }

        // Planner search (/ or Ctrl/Cmd+F): expands over this whole row (see openSearch)
        if (this.isCombinedView() && !compact) {
            const view = this; // keeps the narrowed type inside the listener
            const searchBtn = tools.createEl('button', {
                cls: `dp-search-btn${view.searchQuery ? ' is-active' : ''}`,
                attr: { 'aria-label': t('search.open') }
            });
            setIcon(searchBtn, 'search');
            searchBtn.addEventListener('click', () => view.openSearch());
        }

        if (this.plugin.settings.enableGoogleCalendar && !compact) {
            const syncBtn = tools.createEl('button', { cls: 'dp-sync-btn', attr: { 'aria-label': t('nav.sync') } });
            setIcon(syncBtn.createSpan({ cls: 'dp-btn-icon' }), 'refresh-cw');
            this.markSyncing(syncBtn);
            syncBtn.addEventListener('click', () => void this.runSync());
            syncBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.openSyncOptions();
            });
        }


        // Code block timelines: the visible hours, picked from a menu and saved as `hours:` in the block
        if ((this as any).updateCodeBlockInFile !== undefined && ['daily', 'multiDay', 'weekly'].includes(this.getViewTabType())) {
            const { startHour, endHour } = this.getTimelineHours();
            const pad = (h: number) => String(h).padStart(2, '0');
            const hoursBtn = tools.createEl('button', {
                cls: 'dp-hours-btn',
                text: `🕗 ${pad(startHour)}–${pad(endHour)}`,
                attr: { 'aria-label': t('hours.button'), title: t('hours.button') }
            });
            hoursBtn.addEventListener('click', (e) => this.openTimelineHoursMenu(e));
        }

        if ((this as any).filters !== undefined) {
            // Active rule count on the button: with the panel closed, it is the only sign that a filter is applied
            const countRules = (g: FilterGroup): number => (g.children ?? []).reduce((n, c) => n + (isFilterGroup(c) ? countRules(c) : 1), 0);
            const ruleCount = countRules((this as any).filters as FilterGroup);
            const filterBtn = tools.createEl('button', {
                text: ruleCount > 0 ? `🔍 ${t('nav.filter')} · ${ruleCount}` : `🔍 ${t('nav.filter')}`
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

        // The one accent control: add a task (or, with Google Calendar, a task or an event)
        const addBtn = headerActions.createEl('button', { cls: 'dp-add-btn', attr: { 'aria-label': t('header.add') } });
        setIcon(addBtn, 'plus');
        addBtn.addEventListener('click', () => {
            const defaultDateStr = this.currentDate.format('YYYY-MM-DD');

            const openTaskModal = () => {
                const modal = new TaskEditModal(this.app, null, defaultDateStr, async (data) => {
                    const targetFilePath = getTargetTaskFilePath(this.app, this.plugin.settings, data.date || defaultDateStr);
                    await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority,
                        null, { date: data.dueDate, time: data.dueTime });
                    new Notice(t('notice.taskAdded'));
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
        if (this instanceof PlannerViewCore && !this.useCompactLayout() && this.plugin.settings.showShortcutButton !== false) {
            const helpBtn = tools.createEl('button', {
                cls: 'dp-help-btn',
                attr: { 'aria-label': t('nav.shortcuts') }
            });
            setFirstIcon(helpBtn, ['circle-help', 'help-circle']);
            if (!helpBtn.querySelector('svg')) helpBtn.setText('?');
            helpBtn.addEventListener('click', () => ShortcutHelpModal.toggle(this.app, this.plugin));
        }

        // Side drawer toggle sits at the trailing edge, next to the drawer it opens (desktop date-based tabs only)
        if (this.isCombinedView() && this.hasSideDrawer()) {
            const view = this; // keeps the narrowed type inside the listener
            const drawerBtn = tools.createEl('button', {
                cls: `dp-drawer-toggle${view.isSideDrawerOpen() ? ' is-active' : ''}`,
                attr: { 'aria-label': t('nav.toggleDrawer') }
            });
            setFirstIcon(drawerBtn, ['panel-right', 'sidebar-right', 'layout-sidebar-right']);
            drawerBtn.addEventListener('click', () => void view.toggleSideDrawer());
        }

        return { dateLabel };
    }

    /** Sync button's right-click / long-press: the batch sync options */
    openSyncOptions() {
        new TaskSyncModal(this.app, this.plugin, async () => {
            await this.refreshTasks(null, true);
        }).open();
    }

    /** A sync is running: repeated F5 / Ctrl+R (key auto-repeat) or button clicks don't stack another one */
    syncInProgress = false;
    /** When the running sync started: a sync button redrawn mid-sync joins the spin in phase */
    syncStartedAt = 0;

    /** Marks a freshly rendered sync button as spinning while a sync runs */
    markSyncing(btn: HTMLElement) {
        if (!this.syncInProgress) return;
        btn.style.setProperty('--dp-sync-phase', `-${(Date.now() - this.syncStartedAt) % MOTION.spinTurnMs}ms`);
        setSyncSpin(btn, true);
    }

    /**
     * Sync button, F5 and Ctrl/Cmd+R: rescans the vault's tasks and, with Google Calendar on, refetches this view's
     * events and pushes tasks to the sync calendar, with progress and result notices. The sync icons spin meanwhile;
     * resolves once they have settled.
     */
    async runSync() {
        if (this.syncInProgress) return;
        this.syncInProgress = true;
        this.syncStartedAt = Date.now();
        this.containerEl.querySelectorAll<HTMLElement>('.dp-sync-btn').forEach(btn => setSyncSpin(btn, true));
        let settled: Promise<unknown> = Promise.resolve();
        try {
            await this.syncNow();
        } finally {
            this.syncInProgress = false;
            settled = Promise.all(Array.from(this.containerEl.querySelectorAll<HTMLElement>('.dp-sync-btn'))
                .map(btn => new Promise<void>(resolve => setSyncSpin(btn, false, resolve))));
        }
        await settled;
    }

    protected async syncNow() {
        await this.plugin.refreshIcsCalendars(true); // subscribed calendars: always fetched again on Sync
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
        const unit = this.getNavUnit();
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

    /** Mini calendar (side drawer): show `dateStr`, sliding toward it like a real navigation unless it is on screen */
    async goToDate(dateStr: string) {
        const target = (window as any).moment(dateStr, 'YYYY-MM-DD');
        if (target.isSame(this.currentDate, 'day')) return;
        const unit = this.getNavUnit();
        this.navDirection = target.isSame(this.currentDate, unit) ? null
            : target.isAfter(this.currentDate, unit) ? 'next' : 'prev';
        this.currentDate = target;
        triggerHaptic('selection');
        try {
            await this.refreshTasks();
        } finally {
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

    /** Ticker of the in-progress tracker (one per view); see renderCurrentTaskTracker */
    trackerTimer: number | null = null;

    /**
     * Live tracker of the task in progress (Daily): title, time range, time left and a progress track. It ticks on its
     * own (no view re-render needed), touches the DOM only when the minute or the task changes, and appears / leaves by
     * itself when a task starts or ends while the view stays open. The status bar keeps the same minute arithmetic.
     */
    renderCurrentTaskTracker(parent: HTMLDivElement) {
        this.stopCurrentTaskTracker();
        let lastKey = this.syncCurrentTaskTracker(parent, '', true);
        const id = window.setInterval(() => {
            if (!parent.isConnected) this.stopCurrentTaskTracker();
            else lastKey = this.syncCurrentTaskTracker(parent, lastKey, false);
        }, CURRENT_TASK_TICK_MS);
        this.trackerTimer = id;
        this.registerInterval(id);
    }

    /** Tabs without the tracker stop its ticker, or it would bring the bar back over them */
    stopCurrentTaskTracker() {
        if (this.trackerTimer != null) window.clearInterval(this.trackerTimer);
        this.trackerTimer = null;
    }

    /** One tracker tick: returns the key of what it now shows ('' = no task in progress, no bar) */
    syncCurrentTaskTracker(parent: HTMLDivElement, lastKey: string, initial: boolean): string {
        const now = (window as any).moment();
        const todayStr = now.format('YYYY-MM-DD');
        const currentMinutes = now.hour() * 60 + now.minute();

        let activeTask: TaskItem | null = null;
        for (const task of this.tasks) {
            if (task.date !== todayStr || !task.startTime || !task.endTime) continue;
            if (currentMinutes >= timeToMinutes(task.startTime) && currentMinutes < timeToMinutes(task.endTime)) {
                activeTask = task;
                break;
            }
        }

        let bar = parent.querySelector<HTMLElement>(':scope > .dp-current-task-bar');
        if (!activeTask) {
            bar?.remove();
            return '';
        }
        const identity = `${activeTask.id}|${activeTask.text}|${activeTask.startTime}|${activeTask.endTime}|${activeTask.statusChar}`;
        const key = `${identity}|${currentMinutes}`;
        if (bar && key === lastKey) return key;

        if (!bar || bar.dataset.trackerId !== identity) {
            bar?.remove();
            bar = this.buildCurrentTaskBar(activeTask, identity);
            // First render: appended like before (the compact shell moves its bottom nav below afterwards).
            // Later ticks: the panes and the bottom nav are in place, so the bar goes right above the nav.
            const nav = initial ? null : parent.querySelector(':scope > .dp-bottom-bar');
            if (nav) parent.insertBefore(bar, nav);
            else parent.appendChild(bar);
        }

        const startMin = timeToMinutes(activeTask.startTime!);
        const endMin = timeToMinutes(activeTask.endTime!);
        const percent = Math.min(100, Math.max(0, Math.round(((currentMinutes - startMin) / (endMin - startMin)) * 100)));
        bar.querySelector('.dp-ct-remaining')!.setText(`${formatMinutesNice(endMin - currentMinutes)} remaining`);
        bar.querySelector('.dp-ct-percent')!.setText(`${percent}%`);
        bar.style.setProperty('--dp-ct-progress', String(percent / 100));
        bar.setAttribute('aria-valuenow', String(percent));
        return key;
    }

    protected buildCurrentTaskBar(task: TaskItem, identity: string): HTMLElement {
        const bar = createDiv({ cls: 'dp-current-task-bar', attr: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' } });
        bar.dataset.trackerId = identity;
        const title = cleanTaskTextForDisplay(task.text);
        bar.setAttribute('aria-label', title);
        bar.createSpan({ cls: 'dp-ct-pulse' });
        const info = bar.createDiv({ cls: 'dp-ct-info' });
        info.createDiv({ cls: 'dp-ct-title', text: title });
        const meta = info.createDiv({ cls: 'dp-ct-time' });
        meta.createSpan({ cls: 'dp-ct-range', text: `${task.startTime} – ${task.endTime}` });
        meta.createSpan({ cls: 'dp-ct-remaining' });
        bar.createSpan({ cls: 'dp-ct-percent' });
        const openBtn = bar.createEl('button', { cls: 'dp-ct-open', attr: { 'aria-label': 'Open task in its note' } });
        setIcon(openBtn, 'arrow-up-right');
        openBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openTaskInEditor(this.app, task);
        });
        bar.createDiv({ cls: 'dp-ct-progress' }).createDiv({ cls: 'dp-ct-progress-fill' });
        return bar;
    }

    /** True on the tabbed Dayloom view (DayPlannerCombinedView), which overrides this; a type guard without importing it */
    isCombinedView(): this is DayPlannerCombinedView {
        return false;
    }

    // Implemented in a later layer (see src/views/baseView.ts)
    abstract mountInlineCreate(): void;
    abstract navigateBoardTab(step: 1 | -1): boolean;
    abstract switchBoardMode(mode: BoardMode): void;
}
