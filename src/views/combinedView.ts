// The tabbed Dayloom view (DayPlannerCombinedView) and its compact variant (DayPlannerDailyView).
import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { DrawerSectionId, dueChip, formatDuration, overdueMoveTarget, renderDrawerPanelContent, renderPriorityTrigger, renderSideDrawer, setFirstIcon, SIDE_DRAWER_TABS, togglePriorityPicker } from '../../drawer';
import { t } from '../../i18n';
import { describeSmartEntry, parseSmartEntry } from '../../smartEntry';
import { OVERDUE_MOVE_OPTIONS, TaskItem } from '../../types';
import { cleanTaskTextForDisplay, createCustomCheckbox, fileNameTaskDate, getDefaultTaskFilePath, openTaskInEditor, triggerHaptic } from '../../utils';
import { DayPlannerBaseView } from './baseView';
import { capturePage, pullPage, PageDirection, playPageSwipe, springBackPage } from './pageSwipe';
import { animateActiveTabPill, createNewTaskInFile, isStylusTouch, keepActiveTabInView, openDayReview, prefersReducedMotion, renderLateBadge, updateTaskInFile, weekendCls } from './shared';
import { switchViewPane, viewSwitchMotion } from './viewSwitch';

/**
 * 1. Day Planner 통합 뷰 (모든 주간, 월간, 보드 레이아웃을 탭 컨트롤러 형태로 포괄)
 */
export class DayPlannerCombinedView extends DayPlannerBaseView {
    isCombinedView(): this is DayPlannerCombinedView {
        return true;
    }
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
            this.currentDate.add(direction, this.isDayAgendaList() ? 'day' : 'month'); // compact List: one day per step
        }
    }

    renderRoot(rootEl: HTMLDivElement) {
        const phone = this.useCompactLayout();
        rootEl.toggleClass('dp-compact-shell', phone);
        rootEl.toggleClass('dp-phone-shell', phone && Platform.isPhone); // phone-only extras (clearance for Obsidian's toolbar)
        const header = rootEl.createDiv({ cls: 'dp-header' });
        rootEl.prepend(header); // cached panes may still be mounted below
        this.renderNavHeader(header, true);
        // The day-based compact tabs (Daily, the List agenda) page through the week's date pills
        if (phone && (this.activeTab === 'daily' || this.activeTab === 'list')) this.renderPhoneDateStrip(header);

        // Compact shell: a nav bar of two islands, the 4 view tabs (no Weekly / N-day) and More, shown above the header
        // (styles.ts flex order; clear of Obsidian's mobile toolbar); elsewhere the segmented control in the header
        const bottomBar = phone ? rootEl.createDiv({ cls: 'dp-bottom-bar' }) : null;
        const tabsContainer = bottomBar
            ? bottomBar.createDiv({ cls: 'dp-tabs dp-bottom-nav' })
            : header.createDiv({ cls: 'dp-tabs' });
        if (!bottomBar) {
            // Desktop / tablet: one header row [date] [tabs] [actions]; a narrow pane drops the tabs to a slim second row
            // (container query on .dp-header, see styles.ts)
            const headerTop = header.querySelector<HTMLElement>(':scope > .dp-header-top');
            if (headerTop) {
                headerTop.addClass('has-inline-tabs');
                headerTop.insertBefore(tabsContainer, headerTop.querySelector(':scope > .dp-header-actions'));
            }
        }
        const tabs: { key: typeof DayPlannerCombinedView.prototype.activeTab; label: string; icon?: string }[] = phone ? [
            { key: 'daily', label: t('view.daily'), icon: 'calendar-clock' },
            { key: 'list', label: t('view.list'), icon: 'list' },
            { key: 'monthly', label: t('view.monthly'), icon: 'calendar-days' },
            { key: 'board', label: t('view.board'), icon: 'layout-dashboard' }
        ] : [
            { key: 'daily', label: t('view.dailyTimeline') },
            { key: 'multiDay', label: t('view.nDay', { n: this.plugin.settings.nDayViewDays || 4 }) },
            { key: 'weekly', label: t('view.weekly') },
            { key: 'monthly', label: t('view.monthlyCalendar') },
            { key: 'board', label: t('view.board') },
            { key: 'list', label: t('view.listView') }
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

                tabEl.createSpan({ text: t('view.nDaySuffix') });

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
        if (bottomBar) {
            // Own island: not a view tab, it opens the More sheet (utilities + the desktop drawer's panels)
            const moreIsland = bottomBar.createDiv({ cls: 'dp-tabs dp-bottom-nav dp-bottom-more' });
            const moreBtn = moreIsland.createEl('button', {
                cls: `dp-tab dp-bottom-nav-more${this.moreSheetOpen ? ' is-active' : ''}`,
                attr: { 'aria-label': t('header.more'), 'aria-haspopup': 'dialog', 'aria-expanded': String(this.moreSheetOpen) }
            });
            setFirstIcon(moreBtn.createSpan({ cls: 'dp-bottom-nav-icon' }), ['ellipsis', 'more-horizontal']);
            moreBtn.createSpan({ cls: 'dp-bottom-nav-label', text: t('header.more') });
            moreBtn.addEventListener('click', () => {
                triggerHaptic('selection');
                if (this.moreSheetOpen) this.closeMoreSheet();
                else this.openMoreSheet();
            });
        }
        this.tabOrder = tabs.map(tab => tab.key); // view switches slide in this order (viewSwitchMotion)
        animateActiveTabPill(tabsContainer, this as any, this.activeTab);
        keepActiveTabInView(tabsContainer, this as any);

        this.mountActivePane(rootEl);
        if (this.activeTab === 'daily') this.renderCurrentTaskTracker(rootEl);
        else this.stopCurrentTaskTracker();
        if (bottomBar) rootEl.appendChild(bottomBar); // bottom bar stays the last row, below panes created after it
        this.registerSwipeNavigation(rootEl);

        rootEl.toggleClass('dp-drawer-open', this.isSideDrawerOpen());
        if (this.hasSideDrawer()) renderSideDrawer(rootEl, this);
        if (phone && this.moreSheetOpen) {
            this.renderMoreSheet(rootEl, false);
        } else {
            this.moreSheetOpen = false;
            rootEl.removeClass('dp-more-open');
        }
        this.trackHeaderHeight(rootEl, header); // the drawer and the search bar hang below the header
        this.syncSearchBar(rootEl);
    }

    // ---- Desktop side drawer (shell and panel registry: drawer.ts) ----
    drawerScrollTop = 0;
    /** Drawer section folding (Overdue / Undated), kept here because the drawer is rebuilt on every render:
     *  manual overrides (valid while the section stays empty / non-empty) and the state last drawn */
    drawerSectionOverrides = new Map<string, { collapsed: boolean; empty: boolean }>();
    drawerSectionState = new Map<string, boolean>();
    /** Month (week, folded) the mini calendar was paged to; null = follow the view's date */
    drawerCalendarAnchor: string | null = null;
    /** Stats ring value last drawn, so the next render animates from it */
    drawerStatsPct = 0;
    /** Stats panel range; null until first read from this device's local storage (drawer.ts statsRange) */
    drawerStatsRange: 'day' | 'week' | null = null;
    private headerResizeObserver: ResizeObserver | null = null;

    /** Desktop and tablet combined view (not the phone shell), beside the date-based tabs a task can be dropped onto */
    hasSideDrawer(): boolean {
        return !this.useCompactLayout() && SIDE_DRAWER_TABS.includes(this.activeTab);
    }

    isSideDrawerOpen(): boolean {
        return this.hasSideDrawer() && this.plugin.settings.sideDrawerOpen !== false;
    }

    /** Header button, `s`, and the command. Flips classes only: the drawer slides, the panes reflow once, nothing re-renders. */
    async toggleSideDrawer(open = !this.isSideDrawerOpen()) {
        if (!this.hasSideDrawer()) {
            new Notice('The side drawer is available in Dayloom on desktop and tablet.');
            return;
        }
        this.plugin.settings.sideDrawerOpen = open;
        const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
        rootEl?.toggleClass('dp-drawer-open', open);
        rootEl?.querySelector(':scope > .dp-side-drawer')?.toggleClass('is-open', open);
        rootEl?.querySelector('.dp-drawer-toggle')?.toggleClass('is-active', open);
        await this.plugin.saveSettings();
    }

    // ---- Compact More sheet (bottom bar's 5th slot): search, sync, zoom, and the desktop drawer's panels ----
    moreSheetOpen = false;
    private moreSheetKeysBound = false;

    openMoreSheet() {
        const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
        if (!rootEl || !this.useCompactLayout()) return;
        this.moreSheetOpen = true;
        this.renderMoreSheet(rootEl, true);
    }

    /** Slides the sheet down, then removes it. The bottom bar's More button reflects the state at once. */
    closeMoreSheet() {
        this.moreSheetOpen = false;
        const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
        rootEl?.removeClass('dp-more-open');
        const more = rootEl?.querySelector('.dp-bottom-nav-more');
        more?.removeClass('is-active');
        more?.setAttr('aria-expanded', 'false');
        const parts = rootEl?.querySelectorAll<HTMLElement>(':scope > .dp-more-sheet, :scope > .dp-more-sheet-backdrop');
        parts?.forEach(el => {
            el.removeClass('is-entering');
            el.addClass('is-closing');
            el.style.removeProperty('transform');
            window.setTimeout(() => el.remove(), 220);
        });
    }

    /**
     * Builds the sheet into the root. Rebuilt on every render while open (the task lists change), so only an explicit
     * open plays the slide-up. The panels sit in a .dp-side-drawer, which brings along every drawer card style.
     */
    renderMoreSheet(rootEl: HTMLElement, animate: boolean) {
        rootEl.querySelectorAll(':scope > .dp-more-sheet, :scope > .dp-more-sheet-backdrop').forEach(el => el.remove());
        rootEl.addClass('dp-more-open'); // fades the current-task bar out from under the sheet
        const more = rootEl.querySelector('.dp-bottom-nav-more');
        more?.addClass('is-active');
        more?.setAttr('aria-expanded', 'true');

        const backdrop = rootEl.createDiv({ cls: `dp-more-sheet-backdrop${animate ? ' is-entering' : ''}` });
        backdrop.addEventListener('click', () => this.closeMoreSheet());
        const sheet = rootEl.createDiv({
            cls: `dp-more-sheet${animate ? ' is-entering' : ''}`,
            attr: { role: 'dialog', 'aria-label': t('header.more') }
        });
        const handle = sheet.createDiv({ cls: 'dp-sheet-handle' });
        handle.createDiv({ cls: 'dp-sheet-grabber' });

        // Section A: quick utilities. Search closes the sheet first, then runs; Sync runs with the sheet up
        const actions = sheet.createDiv({ cls: 'dp-sheet-actions' });
        const addAction = (icon: string, label: string, cls: string, run: () => void, keepOpen = false) => {
            const btn = actions.createEl('button', { cls: `dp-sheet-action ${cls}` });
            setIcon(btn.createSpan({ cls: 'dp-btn-icon' }), icon);
            btn.createSpan({ cls: 'dp-btn-label', text: label });
            btn.addEventListener('click', () => {
                triggerHaptic('selection');
                if (!keepOpen) this.closeMoreSheet();
                run();
            });
            return btn;
        };
        addAction('search', t('header.search'), `dp-search-btn${this.searchQuery ? ' is-active' : ''}`, () => this.openSearch());
        if (this.plugin.settings.enableGoogleCalendar) {
            // Sync keeps the sheet up so its icon can be seen spinning; the sheet closes once the icon has settled
            const syncBtn = addAction('refresh-cw', t('nav.sync'), 'dp-sync-btn', () => void this.runSync().then(() => {
                if (this.moreSheetOpen) this.closeMoreSheet();
            }), true);
            this.markSyncing(syncBtn);
            syncBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.closeMoreSheet();
                this.openSyncOptions();
            });
        }
        const tabType = this.getViewTabType();
        if (tabType === 'daily' || tabType === 'weekly' || tabType === 'multiDay') {
            const zoomRow = sheet.createDiv({ cls: 'dp-sheet-zoom' });
            const label = zoomRow.createDiv({ cls: 'dp-sheet-zoom-label' });
            setIcon(label.createSpan({ cls: 'dp-btn-icon' }), 'zoom-in');
            label.createSpan({ cls: 'dp-btn-label', text: t('header.zoom') });
            const slider = this.mountZoomSlider();
            if (slider) this.syncZoomSlider(slider);
        }

        // Section B: the shared drawer content (Tasks: capture, Focus, Today, Overdue, Undated · Stats), without the
        // mini calendar or header so the actionable lists come first
        const panels = sheet.createDiv({ cls: 'dp-side-drawer dp-sheet-drawer is-open' });
        renderDrawerPanelContent(panels, this, { showMiniCalendar: false, showHeader: false });

        this.registerSheetDrag(handle, sheet);
        if (!this.moreSheetKeysBound) {
            this.moreSheetKeysBound = true;
            this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
                if (e.key !== 'Escape' || !this.moreSheetOpen || e.isComposing) return;
                if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return; // quick capture's own Esc
                e.preventDefault();
                e.stopPropagation();
                this.closeMoreSheet();
            }, { capture: true });
        }
    }

    /** Drag the grabber down: the sheet follows the finger; released past 80px (or flicked) it closes, else snaps back */
    private registerSheetDrag(handle: HTMLElement, sheet: HTMLElement) {
        let startY = 0, startT = 0, dy = 0, pointerId: number | null = null;
        handle.addEventListener('pointerdown', (e) => {
            pointerId = e.pointerId;
            startY = e.clientY;
            startT = performance.now();
            dy = 0;
            handle.setPointerCapture(e.pointerId);
            sheet.addClass('is-dragging');
        });
        handle.addEventListener('pointermove', (e) => {
            if (e.pointerId !== pointerId) return;
            dy = Math.max(0, e.clientY - startY);
            sheet.style.transform = `translateY(${dy}px)`;
        });
        const end = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            pointerId = null;
            sheet.removeClass('is-dragging');
            const velocity = dy / Math.max(1, performance.now() - startT);
            if (dy > 80 || (dy > 20 && velocity > 0.5)) {
                this.closeMoreSheet();
            } else {
                sheet.style.removeProperty('transform');
            }
        };
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
        // Obsidian's own edge swipes must not claim the drag
        handle.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
        handle.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    }

    /** The drawer hangs below the header, whose height changes with wrapping and zoom: mirror it into --dp-header-h */
    private trackHeaderHeight(rootEl: HTMLElement, header: HTMLElement) {
        this.headerResizeObserver?.disconnect();
        this.headerResizeObserver = new ResizeObserver(() => {
            rootEl.style.setProperty('--dp-header-h', `${header.offsetHeight}px`);
            this.reserveHeaderSides(rootEl, header);
        });
        this.headerResizeObserver.observe(header);
        // The date pill and the actions also change width without the header doing so (zoom mounted, Board toggle)
        header.querySelectorAll(':scope > .dp-header-top.has-inline-tabs > :is(.dp-nav-date, .dp-header-actions)')
            .forEach(el => this.headerResizeObserver!.observe(el));
    }

    /** Widest date pill / actions group drawn so far (px): the one-row header's side columns never get narrower */
    private headerSideWidths = { left: 0, right: 0 };

    /** Touch layout switched on or off (main.ts applyTouchLayout): the header's controls changed size, measure afresh */
    resetHeaderSides() {
        const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
        const header = rootEl?.querySelector<HTMLElement>(':scope > .dp-header');
        if (!rootEl || !header) return;
        this.headerSideWidths = { left: 0, right: 0 };
        rootEl.style.removeProperty('--dp-head-l');
        rootEl.style.removeProperty('--dp-head-r');
        this.reserveHeaderSides(rootEl, header);
    }

    /**
     * Desktop one-row header: keeps --dp-head-l / --dp-head-r (styles.ts, .has-inline-tabs) at the widest date pill and
     * actions group seen, so the view tabs between them hold their place and width across view switches instead of
     * filling whatever space each view's date text and buttons leave. Set on the root: a rebuilt header inherits it.
     */
    private reserveHeaderSides(rootEl: HTMLElement, header: HTMLElement) {
        const row = header.querySelector<HTMLElement>(':scope > .dp-header-top.has-inline-tabs');
        if (!row) return;
        const sides = this.headerSideWidths;
        const left = Math.ceil(row.querySelector<HTMLElement>(':scope > .dp-nav-date')?.getBoundingClientRect().width ?? 0);
        const right = Math.ceil(row.querySelector<HTMLElement>(':scope > .dp-header-actions')?.getBoundingClientRect().width ?? 0);
        if (left > sides.left) {
            sides.left = left;
            rootEl.style.setProperty('--dp-head-l', `${left}px`);
        }
        if (right > sides.right) {
            sides.right = right;
            rootEl.style.setProperty('--dp-head-r', `${right}px`);
        }
    }

    /**
     * Compact drawer card: checkbox, title, priority (+ the missed date for Overdue). Click edits; drag schedules,
     * and an Overdue card dropped on the Undated section loses its date (see beginPointerDrag).
     */
    renderDrawerTaskCard(list: HTMLElement, task: TaskItem, section: DrawerSectionId) {
        const card = list.createDiv({ cls: `dp-drawer-card${task.priority === 'highest' ? ' is-mit' : task.priority === 'high' ? ' is-high' : ''}` });
        card.toggleClass('is-done', task.statusChar === 'x'); // Today's Tasks keeps done ones (undo in place)
        card.dataset.drawerTaskId = task.id; // not data-task-id: drag previews copy the styling of [data-task-id] cards
        card.title = task.filePath;
        // Same path as the timeline's checkbox: the note is rewritten, then every view, the drawer and the status bar refresh
        createCustomCheckbox(card, task, async (newStatus) => {
            await updateTaskInFile(this.app, task, { statusChar: newStatus });
            await this.refreshTasks();
        });
        card.createSpan({ cls: 'dp-drawer-card-title', text: cleanTaskTextForDisplay(task.text) });
        if (section === 'focus') {
            // Hero card (Today's Tasks' top slot): the Focus mark rides inside the card, beside its time
            card.addClass('is-focus-hero');
            card.createSpan({ cls: 'dp-focus-pill', text: `🎯 ${t('drawer.focusBadge')}` });
        }
        renderLateBadge(card, task);
        // Deadlines, and an Unscheduled task's own deadline (it has no other date)
        const due = section === 'deadline' || (section === 'undated' && task.dueDate)
            ? dueChip(task, (window as any).moment().format('YYYY-MM-DD')) : null;
        if (due) {
            card.createSpan({ cls: `dp-drawer-card-date dp-due-chip${due.urgent ? ' is-urgent' : ''}`, text: due.text, attr: { title: due.tooltip } });
        } else if (section === 'overdue' && task.date) {
            card.createSpan({ cls: 'dp-drawer-card-date', text: (window as any).moment(task.date, 'YYYY-MM-DD').format('MMM D') });
        } else if ((section === 'focus' || section === 'today') && task.startTime) {
            const time = task.endTime && section === 'today' ? `${task.startTime}–${task.endTime}` : task.startTime;
            card.createSpan({ cls: 'dp-drawer-card-date is-time', text: time });
        }
        if (!task.startTime && task.estimateMinutes) {
            card.createSpan({
                cls: 'dp-drawer-card-estimate',
                text: formatDuration(task.estimateMinutes),
                attr: { 'aria-label': t('drawer.card.estimate', { time: formatDuration(task.estimateMinutes) }) }
            });
        }
        const priorityTrigger = renderPriorityTrigger(card, task, this);
        if (section === 'today') {
            // ↗ jumps to the task's line in its note
            const linkBtn = card.createEl('button', { cls: 'dp-task-link-btn dp-drawer-card-link', text: '↗', attr: { 'aria-label': t('drawer.openInNote') } });
            linkBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                triggerHaptic('selection');
                void openTaskInEditor(this.app, task);
            });
        }
        card.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.dp-custom-cb, .dp-drawer-card-actions, .dp-priority-trigger, .dp-task-link-btn')) return;
            if (e.ctrlKey || e.metaKey) {
                // Multi-select in the drawer: drag the selection onto a timeline to schedule it back to back
                this.enterSelectionZone('drawer');
                if (this.selectedTaskIds.has(task.id)) this.selectedTaskIds.delete(task.id);
                else this.selectedTaskIds.add(task.id);
                triggerHaptic('selection');
                this.applySelectionState();
                return;
            }
            this.openTaskEditor(task);
        });

        // Keyboard: Tab to a card, Enter edits, f fits it into the first free slot of the next two weeks, p sets the priority
        card.tabIndex = 0;
        card.addEventListener('keydown', (e) => {
            if (e.target !== card || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                this.openTaskEditor(task);
            } else if (e.key.toLowerCase() === 'f') {
                e.preventDefault();
                e.stopPropagation();
                void this.fitTaskIn(task, this.fitDatesFor(task));
            } else if (e.key.toLowerCase() === 'p') {
                e.preventDefault();
                e.stopPropagation();
                togglePriorityPicker(priorityTrigger, task, this, true);
            }
        });

        const addAction = (label: string, tooltip: string, run: (e: MouseEvent) => Promise<void> | void) => {
            const actions = card.querySelector<HTMLElement>(':scope > .dp-drawer-card-actions') ?? card.createDiv({ cls: 'dp-drawer-card-actions' });
            const btn = actions.createEl('button', { cls: 'dp-drawer-card-action', text: label, attr: { 'aria-label': tooltip } });
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                triggerHaptic('selection');
                void run(e);
            });
        };
        // Fit It In (also `f`): the first free slot of the next two weeks, before the deadline when there is one
        if (section === 'overdue' || section === 'undated') {
            addAction(t('fit.one'), t('fit.oneTooltip'), () => this.fitTaskIn(task, this.fitDatesFor(task)));
        }
        if (section === 'overdue') {
            // Triage on hover: Move opens a menu of new dates (time kept; its choices are a setting), or back to Unscheduled
            const chosen = this.plugin.settings.overdueMoveOptions ?? [];
            const options = OVERDUE_MOVE_OPTIONS.filter(o => chosen.includes(o));
            if (options.length > 0) addAction(t('drawer.card.move'), t('drawer.card.moveTooltip'), (e) => {
                const btn = e.currentTarget as HTMLElement;
                const menu = new Menu();
                (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
                options.forEach(option => {
                    const target = overdueMoveTarget(option);
                    menu.addItem(item => item.setTitle(target.label).setIcon(target.date ? 'calendar' : 'calendar-plus')
                        .onClick(() => target.date ? void this.rescheduleOverdueTasks([task], { date: target.date }) : this.pickTaskDate(task, btn)));
                });
                menu.showAtMouseEvent(e);
            });
            addAction(t('drawer.card.undate'), t('drawer.card.undateOverdueTooltip'), () => this.rescheduleOverdueTasks([task], { date: null }));
        }
        // In the compact More sheet the timelines are covered: tap to edit, the triage pills to reschedule, no drag
        if (!this.useCompactLayout()) this.registerMouseDrag(card, { kind: 'task', task, origin: section });
    }

    /** Move menu "Pick a date…": the system date picker at `anchor`; the chosen day reschedules the task (rescheduleOverdueTasks).
     *  Where the picker cannot open on its own (older iOS), the task editor opens instead. */
    pickTaskDate(task: TaskItem, anchor: HTMLElement) {
        const doc = anchor.ownerDocument;
        // A proxy left by a picker closed without a choice (older browsers fire no `cancel`)
        doc.querySelectorAll('.dp-date-pick-proxy').forEach(el => el.remove());
        const rect = anchor.getBoundingClientRect();
        const input = doc.body.createEl('input', { type: 'date', cls: 'dp-date-pick-proxy', attr: { 'aria-hidden': 'true', tabindex: '-1' } });
        input.style.left = `${rect.left}px`;
        input.style.top = `${rect.bottom}px`;
        input.value = (window as any).moment().format('YYYY-MM-DD');
        const done = () => window.setTimeout(() => input.remove(), 0);
        input.addEventListener('change', () => {
            if (input.value) void this.rescheduleOverdueTasks([task], { date: input.value });
            done();
        });
        input.addEventListener('cancel', done);
        try {
            if (typeof (input as any).showPicker !== 'function') throw new Error('no showPicker');
            input.focus();
            (input as any).showPicker();
        } catch {
            input.remove();
            this.openTaskEditor(task);
        }
    }

    /** Drawer priority picker: rewrites the task's Obsidian Tasks priority emoji (with Undo, like any edit) */
    async setTaskPriority(task: TaskItem, priority: TaskItem['priority']) {
        if (await updateTaskInFile(this.app, task, { priority })) await this.refreshTasks();
    }

    /** Background refresh check: the dates on screen (Monthly with its spill-over weeks), today, and with the drawer
     *  open the undated, overdue and 📅 deadline tasks it lists. Board and List show everything. */
    relevantTasksForSignature(tasks: TaskItem[]): TaskItem[] {
        const tab = this.activeTab;
        if (tab === 'board' || tab === 'list') return tasks;
        const d = this.currentDate;
        const from = tab === 'monthly' ? d.clone().startOf('month').subtract(7, 'days')
            : tab === 'weekly' ? d.clone().startOf('week') : d.clone();
        const to = tab === 'monthly' ? d.clone().endOf('month').add(7, 'days')
            : tab === 'weekly' ? d.clone().endOf('week') : d.clone().add(tab === 'multiDay' ? this.getNDayCount() - 1 : 0, 'days');
        const fromStr = from.format('YYYY-MM-DD');
        const toStr = to.format('YYYY-MM-DD');
        const todayStr = (window as any).moment().format('YYYY-MM-DD');
        const drawer = this.isSideDrawerOpen() || this.moreSheetOpen;
        // A 📅 on screen draws a deadline marker even when the task itself sits on another day
        return tasks.filter(task => (task.dueDate !== null && (drawer || (task.dueDate >= fromStr && task.dueDate <= toStr))) || (task.date === null ? drawer
            : (task.date >= fromStr && task.date <= toStr) || task.date === todayStr || (drawer && task.date < todayStr)));
    }

    /** Mini calendar: the Board always shows today, so a date picked there opens that day in Daily */
    async goToDate(dateStr: string) {
        if (this.activeTab === 'board') return this.openDayInDaily(dateStr);
        return super.goToDate(dateStr);
    }

    /** Weekly / N-day day header (and the Board's mini calendar): that day in the Daily tab */
    async openDayInDaily(dateStr: string) {
        this.currentDate = (window as any).moment(dateStr, 'YYYY-MM-DD');
        this.dataVersion++; // every cached pane shows another date now
        if (this.activeTab === 'daily') await this.refreshTasks();
        else await this.switchTab('daily');
    }

    /** Monthly week number: that week in the Weekly tab */
    async openWeekInWeekly(weekStartStr: string) {
        this.currentDate = (window as any).moment(weekStartStr, 'YYYY-MM-DD');
        this.dataVersion++;
        await this.switchTab('weekly');
    }

    // ---- Planner search: a floating glass bar under the header, kept mounted across renders (see rebuildRoot) ----
    private searchTimer: number | null = null;

    private getSearchBar(): HTMLElement | null {
        return this.containerEl.querySelector<HTMLElement>('.dp-container > .dp-search-float');
    }

    /**
     * Search mode (search button, / or Ctrl/Cmd+F): the header's top row steps aside and the search field expands over
     * its full width. Typing filters live; Enter shows every match in List; Esc or × leaves search mode and clears it.
     */
    openSearch() {
        const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
        if (!rootEl) return;
        const bar = this.getSearchBar() ?? this.createSearchBar(rootEl);
        rootEl.addClass('dp-search-mode');
        bar.removeClass('is-closing'); // reopened mid-close: grows out again
        bar.addClass('is-open');
        this.placeSearchBar(rootEl);
        this.setSearchOrigin(rootEl, bar);
        this.bindSearchViewport();
        const input = bar.querySelector('input')!;
        // No scroll-into-view: the bar is already on screen, and a scroll here would shift the whole planner
        input.focus({ preventScroll: true });
        input.select();
    }

    /**
     * Mobile keyboard: it shrinks the viewport, and the browser then scrolls the focused field into view. The planner
     * root is overflow: hidden, yet still scrollable by the browser, so the whole planner slid up under its header and
     * the bar (placed once, on open) no longer matched the row it covers. While searching, every viewport change undoes
     * that scroll inside this leaf and re-lays the bar over the header row. Bound once per view.
     */
    private searchViewportBound = false;
    private bindSearchViewport() {
        if (this.searchViewportBound) return;
        this.searchViewportBound = true;
        let frame = 0;
        const onChange = () => {
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
                if (!rootEl?.hasClass('dp-search-mode')) return;
                this.resetLeafScroll(rootEl);
                this.placeSearchBar(rootEl);
            });
        };
        const vv = window.visualViewport;
        vv?.addEventListener('resize', onChange);
        vv?.addEventListener('scroll', onChange);
        this.registerDomEvent(window, 'resize', onChange);
        this.register(() => {
            vv?.removeEventListener('resize', onChange);
            vv?.removeEventListener('scroll', onChange);
            if (frame) cancelAnimationFrame(frame);
        });
    }

    /** Undoes a browser scroll-into-view on the planner root and its leaf ancestors (none of them scroll by design) */
    private resetLeafScroll(rootEl: HTMLElement) {
        for (let el: HTMLElement | null = rootEl; el; el = el.parentElement) {
            if (el.scrollTop !== 0) el.scrollTop = 0;
            if (el === this.containerEl) break;
        }
    }

    /** Lays the search field exactly over the header's top row (the header is rebuilt on every render) */
    private placeSearchBar(rootEl: HTMLElement) {
        const bar = rootEl.querySelector<HTMLElement>(':scope > .dp-search-float');
        const row = rootEl.querySelector<HTMLElement>(':scope > .dp-header .dp-header-top');
        if (!bar || !row || !bar.hasClass('is-open')) return;
        const rootRect = rootEl.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        // Only the first line when the desktop view tabs have wrapped onto a second one (they stay visible below)
        const actions = row.querySelector<HTMLElement>(':scope > .dp-header-actions');
        const lineHeight = row.hasClass('has-inline-tabs') && actions ? actions.getBoundingClientRect().height : rowRect.height;
        bar.style.top = `${rowRect.top - rootRect.top}px`;
        bar.style.left = `${rowRect.left - rootRect.left}px`;
        bar.style.width = `${rowRect.width}px`;
        bar.style.height = `${Math.max(32, lineHeight)}px`;
    }

    /**
     * The search button's span inside the bar (styles.ts --dp-search-from-l / -r, --dp-search-origin-x): the bar grows
     * out of it and closes back into it. No header button (the compact shell searches from its More sheet): the
     * stylesheet's default, the row's right end.
     */
    private setSearchOrigin(rootEl: HTMLElement, bar: HTMLElement) {
        const btn = rootEl.querySelector<HTMLElement>(':scope > .dp-header .dp-search-btn')?.getBoundingClientRect();
        const box = bar.getBoundingClientRect();
        const props = ['--dp-search-from-l', '--dp-search-from-r', '--dp-search-origin-x'];
        if (!btn?.width || !box.width) {
            props.forEach(prop => bar.style.removeProperty(prop));
            return;
        }
        bar.style.setProperty(props[0], `${Math.max(0, btn.left - box.left)}px`);
        bar.style.setProperty(props[1], `${Math.max(0, box.right - btn.right)}px`);
        bar.style.setProperty(props[2], `${btn.left + btn.width / 2 - box.left}px`);
    }

    /** Leaves search mode: clears the query (redrawing the full planner) and gives the header row back */
    closeSearch() {
        const rootEl = this.containerEl.querySelector<HTMLElement>('.dp-container');
        rootEl?.removeClass('dp-search-mode'); // the header row shows again under the bar shrinking into its button
        const bar = this.getSearchBar();
        if (bar) {
            if (!bar.hasClass('is-open') || prefersReducedMotion()) {
                bar.removeClass('is-open');
            } else if (!bar.hasClass('is-closing')) {
                if (rootEl) this.setSearchOrigin(rootEl, bar); // the button may have moved while searching
                bar.addClass('is-closing');
                const done = (e: AnimationEvent) => {
                    if (e.target !== bar) return;
                    bar.removeEventListener('animationend', done);
                    if (bar.hasClass('is-closing')) bar.removeClass('is-open', 'is-closing'); // not reopened meanwhile
                };
                bar.addEventListener('animationend', done);
            }
            const input = bar.querySelector('input')!;
            input.value = '';
            if (input.ownerDocument.activeElement === input) input.blur(); // dismisses the mobile keyboard
        }
        if (rootEl) this.resetLeafScroll(rootEl); // no scroll offset left behind by the keyboard
        if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
        this.searchTimer = null;
        if (this.searchQuery) void this.setSearchQuery('');
    }

    async setSearchQuery(query: string) {
        if (query === this.searchQuery) return;
        this.searchQuery = query;
        this.dataVersion++; // every cached pane shows other items now
        await this.refreshTasks();
    }

    private createSearchBar(rootEl: HTMLElement): HTMLElement {
        const bar = rootEl.createDiv({ cls: 'dp-search-float', attr: { role: 'search' } });
        setIcon(bar.createSpan({ cls: 'dp-search-icon' }), 'search');
        const input = bar.createEl('input', {
            cls: 'dp-search-input',
            attr: { type: 'search', placeholder: t('search.placeholder'), 'aria-label': t('search.placeholder'), spellcheck: 'false' }
        });
        bar.createSpan({ cls: 'dp-search-count' });
        const clear = bar.createEl('button', { cls: 'dp-search-clear', attr: { 'aria-label': t('search.close') } });
        setIcon(clear, 'x');

        const apply = (delay: number, thenList = false) => {
            if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
            this.searchTimer = window.setTimeout(async () => {
                this.searchTimer = null;
                await this.setSearchQuery(input.value.trim());
                if (thenList && this.searchQuery && this.activeTab !== 'list') await this.switchTab('list');
                // The redraw must never leave the typist without focus (a stray key would then hit the planner)
                const doc = input.ownerDocument;
                if (bar.hasClass('is-open') && (!doc.activeElement || doc.activeElement === doc.body)) input.focus({ preventScroll: true });
            }, delay);
        };
        // Real-time, but never mid-composition (a Hangul syllable still being typed) and not on every keystroke
        input.addEventListener('input', (e) => { if (!(e as InputEvent).isComposing) apply(140); });
        input.addEventListener('compositionend', () => apply(140));
        input.addEventListener('keydown', (e) => {
            if (e.isComposing) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closeSearch();
                (this.containerEl.querySelector('.dp-container') as HTMLElement | null)?.focus();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                apply(0, true); // every match, in List
            }
        });
        clear.addEventListener('click', () => this.closeSearch());
        return bar;
    }

    /** After each render: match count, and the empty-result state */
    private syncSearchBar(rootEl: HTMLElement) {
        const bar = rootEl.querySelector<HTMLElement>(':scope > .dp-search-float');
        rootEl.toggleClass('dp-searching', !!this.searchQuery);
        if (!bar) return;
        this.placeSearchBar(rootEl);
        const count = this.searchQuery
            ? this.tasks.length + (this.plugin.hasCalendars() ? this.getCalendarEvents().length : 0)
            : 0;
        bar.toggleClass('has-query', !!this.searchQuery);
        bar.toggleClass('is-empty', !!this.searchQuery && count === 0);
        bar.querySelector('.dp-search-count')!.setText(!this.searchQuery ? '' : count === 0 ? t('search.noMatches') : t('search.matches', { n: count }));
    }

    /** `count` dates starting today (Fit-it-in search window) */
    upcomingDates(count: number): string[] {
        const today = (window as any).moment();
        return Array.from({ length: count }, (_, i) => today.clone().add(i, 'days').format('YYYY-MM-DD'));
    }

    /** Today's Tasks header: Review today */
    reviewToday() {
        void openDayReview(this.plugin);
    }

    // ---- Drawer quick capture: draft and focus survive the drawer being rebuilt on each render ----
    drawerCaptureDraft = '';
    drawerCaptureFocused = false;

    /** Drawer quick capture: the words give the date, time, length, deadline and priority (smartEntry.ts) */
    async captureTask(raw: string) {
        const entry = parseSmartEntry(raw, { defaultDuration: this.plugin.settings.defaultTaskDuration || 60 });
        if (!entry.text) return;
        const filePath = getDefaultTaskFilePath(this.plugin.settings);
        try {
            await createNewTaskInFile(this.app, filePath, entry.text, entry.date, entry.startTime, entry.endTime, ' ', entry.priority,
                null, entry.dueDate ? { date: entry.dueDate, time: entry.dueTime } : null);
        } catch (err) {
            console.error('Day Planner Pro: quick capture failed', err);
            new Notice(`⚠️ Could not create the task in "${filePath}": ${err instanceof Error ? err.message : String(err)}`);
            return;
        }
        const chips = describeSmartEntry(entry);
        if (chips.length > 0) new Notice(t('smart.added', { when: chips.join(' · ') }));
        else new Notice(fileNameTaskDate(filePath)
            ? `Task created in "${filePath}". Its file name gives it a date, so it shows on that day, not under Undated.`
            : `Task created in "${filePath}".`);
        await this.refreshTasks();
    }

    async onClose() {
        this.headerResizeObserver?.disconnect();
        return super.onClose();
    }

    /** Compact Daily / List agenda: the current week as M/D pills; the day on screen is highlighted, a tap shows that day. */
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
        // Daily and the List agenda own the date strip: a tap moves the day, staying in that tab.
        // Only other tabs (Monthly cells) hand the day over to the Daily tab.
        if (this.activeTab !== 'daily' && this.activeTab !== 'list') {
            this.currentDate = target;
            this.dataVersion++; // new date: every cached pane is stale
            await this.switchTab('daily'); // Monthly cell → Daily zooms in, like every narrower view (viewSwitch.ts)
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
     * Touchscreens: a horizontal finger swipe on the active view pages dates (one navigateWithSlide step).
     * The touch is only claimed once it is clearly horizontal, so vertical scrolling stays native; touches inside
     * horizontally scrollable children are left alone. On mobile, the plugin keeps Obsidian's sidebar swipe out
     * (blockSidebarSwipe). The "Swipe to change dates" setting turns both off.
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
            if (e.touches.length !== 1 || !['daily', 'weekly', 'multiDay', 'monthly', 'list'].includes(this.activeTab)) return;
            if (this.plugin.settings.desktopSwipeNavigation === false) return;
            const touch = e.touches[0];
            if (isStylusTouch(e)) return; // a Pencil draws a selection box
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
            const pane = this.panes.get(this.activeTab)?.el;
            if (this.touchDragActive || this.activePointerDrag) { start = null; springBackPage(pane); return; } // a card drag owns the finger
            const touch = e.touches[0];
            dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (!axis && Math.hypot(dx, dy) > LOCK) axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
            if (axis === 'y') { start = null; springBackPage(pane); return; } // vertical scroll: hands off
            if (axis === 'x') {
                if (e.cancelable) e.preventDefault(); // no diagonal scroll drift while paging
                claim(e);                             // other gesture handlers never see it
                if (pane) pullPage(pane, dx);         // the page follows the finger
            }
        }, { passive: false, capture: true });

        // touchend / touchcancel always propagate: the end of a touch sequence must reach every listener
        this.registerDomEvent(rootEl, 'touchend', () => {
            const page = !!start && axis === 'x' && Math.abs(dx) >= MIN_DIST && !this.touchDragActive && !this.activePointerDrag;
            start = null;
            const pane = this.panes.get(this.activeTab)?.el;
            if (!page) { springBackPage(pane); return; }
            // The push starts from where the finger left the page
            this.pendingSwipeOffset = dx;
            void this.navigateWithSlide(dx < 0 ? 1 : -1).then(() => { // swipe left → next
                this.pendingSwipeOffset = 0; // no render took it (no push ran): don't carry it to the next one
                springBackPage(pane);        // no-op once the push took over the pane
            });
        }, { capture: true });
        this.registerDomEvent(rootEl, 'touchcancel', () => {
            start = null;
            springBackPage(this.panes.get(this.activeTab)?.el);
        }, { capture: true });
    }

    /** Keep-alive view panes: each tab renders once, then is only shown/hidden until its data goes stale. */
    panes = new Map<string, { el: HTMLDivElement; version: number; scroll: [HTMLElement, number, number][] }>();
    paneRoot: HTMLDivElement | null = null;
    /** Bumped by every data-driven render (tasks, date, settings, GCal); panes rendered at an older version are dirty. */
    dataVersion = 0;
    isTabSwitch = false;

    render() {
        // The compact shell has no Weekly / N-day tab: a shortcut, command or restored state lands on Daily
        if (this.useCompactLayout() && (this.activeTab === 'weekly' || this.activeTab === 'multiDay')) this.activeTab = 'daily';
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

    /** Tab bar order of the last header render (phone and desktop differ) */
    tabOrder: string[] = [];
    /** The tab whose pane is on screen: the switch motion goes from it to the next one */
    private shownTab: string | null = null;

    /** Settles when the pane of the latest tab switch is shown and rendered (see mountActivePane). */
    paneActivation: Promise<void> = Promise.resolve();
    private paneActivationToken = 0;

    /** Only the header chrome and tracker bar are rebuilt; cached panes stay mounted. */
    rebuildRoot(rootEl: HTMLDivElement) {
        Array.from(rootEl.children).forEach(child => {
            // The search bar survives too: rebuilding it mid-typing would drop the focus and an IME composition
            if (!child.classList.contains('day-planner-view-pane') && !child.classList.contains('dp-search-float')) child.remove();
        });
        this.renderRoot(rootEl);
    }

    mountActivePane(rootEl: HTMLDivElement) {
        if (this.paneRoot !== rootEl) {
            this.panes.clear();
            this.paneRoot = rootEl;
            this.shownTab = null; // a fresh root: nothing to switch from
        }
        const token = ++this.paneActivationToken;
        if (!this.isTabSwitch) {
            { this.activatePane(rootEl); this.applySelectionState(); }
            return;
        }
        // Tab switch: showing a pane means laying it out (and rendering it when stale), which on Weekly is hundreds of
        // nodes. Doing that before the first paint delayed the pill slide; the header and pill commit first, and the
        // pane follows right after that paint while the compositor already runs the slide.
        this.paneActivation = new Promise<void>(resolve => {
            requestAnimationFrame(() => window.setTimeout(() => {
                // Superseded by a newer switch or a data render, which activated its own pane
                if (token === this.paneActivationToken && this.paneRoot === rootEl && rootEl.isConnected) { this.activatePane(rootEl); this.applySelectionState(); }
                resolve();
            }, 0));
        });
    }

    private activatePane(rootEl: HTMLDivElement) {
        let pane = this.panes.get(this.activeTab);
        if (!pane) {
            const el = rootEl.createDiv({ cls: `dp-content day-planner-view-pane day-planner-pane-${this.activeTab}` });
            // Created after the tracker / bottom nav when deferred: keep those as the trailing rows
            rootEl.insertBefore(el, rootEl.querySelector(':scope > .dp-current-task-bar, :scope > .dp-bottom-bar'));
            pane = { el, version: -1, scroll: [] };
            this.panes.set(this.activeTab, pane);
        }
        // Exactly one pane is shown, every other one hidden; coming from another tab, the old pane leaves with the
        // view-switch motion (zoom between time scales, a short slide to / from Board and List)
        const motion = this.shownTab && this.shownTab !== this.activeTab
            ? viewSwitchMotion(this.shownTab, this.activeTab, this.tabOrder) : null;
        this.shownTab = this.activeTab;
        switchViewPane(pane.el, motion);

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
        const nav = this.navDirection;
        const dir: PageDirection | null = nav === 'next' ? 'next' : nav ? 'prev' : null;
        const snap = dir ? capturePage(content, this.pendingSwipeOffset) : null;
        this.pendingSwipeOffset = 0;
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
        if (snap && dir) {
            playPageSwipe(snap, dir);
            this.navDirection = null; // a second render in the same navigation must not push again
        }
    }

    /** Touch offset (px) the page was pulled to when a swipe navigated: the push starts from there. */
    pendingSwipeOffset = 0;
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
