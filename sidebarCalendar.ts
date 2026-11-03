import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type DayPlannerPlugin from './main';
import { VIEW_TYPES, GCAL_CACHE_TTL_MS } from './types';
import { getSpannedDates } from './views';
import { localMoment, collectDayDots, renderDayDots } from './drawer';
import { openNoteForDate, periodicNotePath, parentNoteOf, pageOnWheel } from './utils';
import { t } from './i18n';

/**
 * Month calendar for Obsidian's sidebar, like the Calendar plugin: a day opens (or creates) its daily note, a week
 * number its weekly note (the planner's daily / weekly note settings). Dots under a day: one for its tasks, one per
 * calendar with events that day. A past day without a daily note is struck through.
 */
export class SidebarCalendarView extends ItemView {
    plugin: DayPlannerPlugin;
    /** First day of the month shown; null follows today */
    private shownMonth: any = null;
    private renderTimer: number | null = null;
    private todayStr = '';
    /** Set by a page step: the next render slides the new month in (background redraws don't) */
    private slide: 'next' | 'prev' | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: DayPlannerPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPES.CALENDAR; }
    getDisplayText() { return t('sidebarCal.title'); }
    getIcon() { return 'calendar-days'; }

    async onOpen() {
        this.contentEl.addClass('dp-scal');
        // The open note's day is highlighted (its month shown); today moves on at midnight
        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            this.followNote(file?.path);
            this.requestRender();
        }));
        this.registerInterval(window.setInterval(() => {
            if ((window as any).moment().format('YYYY-MM-DD') !== this.todayStr) this.requestRender();
        }, 60 * 1000));
        this.followNote(this.app.workspace.getActiveFile()?.path);
        // Bound once on the container: render() swaps the root inside it
        pageOnWheel(this.contentEl, (step) => this.page(step), () => this.contentEl.querySelector<HTMLElement>('.dp-scal-grid'));
        this.render();
        // Not awaited: the scan waits for layout ready, which waits for restored views' onOpen (a ~10s startup stall)
        if (!this.plugin.tasksCache) void this.plugin.ensureTasksCache().then(() => this.requestRender());
    }

    async onClose() {
        if (this.renderTimer !== null) window.clearTimeout(this.renderTimer);
    }

    /** Coalesces bursts (a note re-read, then its events) into one redraw */
    requestRender() {
        if (this.renderTimer !== null) return;
        this.renderTimer = window.setTimeout(() => {
            this.renderTimer = null;
            this.render();
        }, 50);
    }

    private month(): any {
        const moment = (window as any).moment;
        return (this.shownMonth ?? moment()).clone().startOf('month');
    }

    /** A daily or weekly note opened: show its month (a week by its middle day, as its row is numbered) */
    private followNote(path: string | undefined) {
        const note = path ? parentNoteOf(path, this.plugin.settings) : null;
        if (!note) return;
        const moment = (window as any).moment;
        const date = moment(note.date, 'YYYY-MM-DD');
        if (note.type === 'weekly') date.add(3, 'days');
        this.shownMonth = date.isSame(moment(), 'month') ? null : date.startOf('month');
    }

    private page(step: number | null) {
        this.slide = step === null ? null : step > 0 ? 'next' : 'prev';
        this.shownMonth = step === null ? null : this.month().add(step, 'month');
        this.render();
    }

    /** Google ranges for the months the grid touches, fetched in the background when missing or stale */
    private ensureEvents(first: any, last: any) {
        const s = this.plugin.settings;
        if (!s.enableGoogleCalendar || !s.googleRefreshToken || !s.googleCalendars?.length) return;
        for (const m = first.clone().startOf('month'); !m.isAfter(last, 'month'); m.add(1, 'month')) {
            const cacheKey = `months_${m.format('YYYY-MM')}_${m.format('YYYY-MM')}`;
            const entry = this.plugin.gcalRanges.get(cacheKey);
            if (entry && Date.now() - entry.fetchedAt <= GCAL_CACHE_TTL_MS) continue;
            void this.plugin.fetchGCalRange(cacheKey, m.clone().startOf('month').toDate(), m.clone().endOf('month').toDate())
                .then(changed => { if (changed) this.requestRender(); });
        }
    }

    render() {
        const moment = (window as any).moment;
        const settings = this.plugin.settings;
        this.todayStr = moment().format('YYYY-MM-DD');
        const month = this.month();
        const first = localMoment(month).startOf('week');
        const last = first.clone().add(6 * 7 - 1, 'days'); // six rows always: the sidebar below never jumps
        this.ensureEvents(first, last);
        const dots = collectDayDots(this.plugin, this.plugin.tasksCache ?? [], first.format('YYYY-MM-DD'), last.format('YYYY-MM-DD'), getSpannedDates);
        const activePath = this.app.workspace.getActiveFile()?.path;
        const noteExists = (path: string) => this.app.vault.getAbstractFileByPath(path) instanceof TFile;

        // Built off-DOM and swapped in whole: no flicker on a background redraw
        const root = createDiv({ cls: 'dp-scal-root' });
        const header = root.createDiv({ cls: 'dp-scal-header' });
        header.createDiv({ cls: 'dp-scal-title', text: localMoment(month).format('MMMM YYYY') });
        const nav = header.createDiv({ cls: 'dp-scal-nav' });
        const prev = nav.createEl('button', { cls: 'dp-scal-nav-btn', attr: { 'aria-label': t('calendar.previous') } });
        setIcon(prev, 'chevron-left');
        const todayBtn = nav.createEl('button', { cls: 'dp-scal-today', text: t('common.today') });
        const next = nav.createEl('button', { cls: 'dp-scal-nav-btn', attr: { 'aria-label': t('calendar.next') } });
        setIcon(next, 'chevron-right');
        prev.addEventListener('click', () => this.page(-1));
        next.addEventListener('click', () => this.page(1));
        todayBtn.addEventListener('click', () => this.page(null));

        const grid = root.createDiv({ cls: 'dp-scal-grid' });
        if (this.slide) grid.addClass(`dp-scal-slide-${this.slide}`);
        this.slide = null;
        grid.createSpan({ cls: 'dp-scal-weekday dp-scal-wk-head', text: 'W' });
        for (let i = 0; i < 7; i++) grid.createSpan({ cls: 'dp-scal-weekday', text: first.clone().add(i, 'days').format('dd') });

        const day = first.clone();
        for (let w = 0; w < 6; w++) {
            // Week number and note from mid-week, so a Sunday-start row still names the week its days belong to
            const mid = day.clone().add(3, 'days');
            const weekPath = periodicNotePath(mid, 'weekly', settings);
            const hasWeekNote = noteExists(weekPath);
            // A week that is over without its weekly note: struck through like a day
            const weekMissed = !hasWeekNote && day.clone().add(6, 'days').format('YYYY-MM-DD') < this.todayStr;
            const weekLabel = t('sidebarCal.weekNote', { n: mid.week() });
            const weekBtn = grid.createEl('button', {
                cls: 'dp-scal-wk',
                attr: { 'aria-label': weekMissed ? `${weekLabel} · ${t('sidebarCal.noWeeklyNote')}` : weekLabel }
            });
            weekBtn.createSpan({ cls: 'dp-scal-num', text: String(mid.week()) });
            weekBtn.toggleClass('has-note', hasWeekNote);
            weekBtn.toggleClass('is-missing-note', weekMissed);
            weekBtn.toggleClass('is-active', weekPath === activePath);
            weekBtn.addEventListener('click', (e) => void this.openNote(mid.format('YYYY-MM-DD'), 'weekly', e));

            for (let i = 0; i < 7; i++, day.add(1, 'day')) {
                const dateStr = day.format('YYYY-MM-DD');
                const notePath = periodicNotePath(dateStr, 'daily', settings);
                const hasNote = noteExists(notePath);
                const cell = grid.createEl('button', { cls: 'dp-scal-day' });
                cell.toggleClass('is-other-month', !day.isSame(month, 'month'));
                cell.toggleClass('is-today', dateStr === this.todayStr);
                cell.toggleClass('is-weekend', day.day() === 0 || day.day() === 6);
                cell.toggleClass('is-active', notePath === activePath);                cell.toggleClass('is-missing-note', !hasNote && dateStr < this.todayStr);
                cell.createSpan({ cls: 'dp-scal-num', text: String(day.date()) });

                const parts = [localMoment(day).format('LL')];
                parts.push(...renderDayDots(cell, dots.get(dateStr) ?? [], 'dp-scal'));
                if (!hasNote && dateStr < this.todayStr) parts.push(t('sidebarCal.noNote'));
                cell.setAttr('aria-label', parts.join(' · '));
                cell.addEventListener('click', (e) => void this.openNote(dateStr, 'daily', e));
            }
        }

        const old = this.contentEl.querySelector('.dp-scal-root');
        if (old) old.replaceWith(root);
        else this.contentEl.appendChild(root);
    }

    /**
     * Ctrl/Cmd+click: a new tab. Otherwise the last note tab is reused (an empty tab too), never a planner tab,
     * so a click from the sidebar does not replace the planner.
     */
    private async openNote(dateStr: string, type: 'daily' | 'weekly', e: MouseEvent) {
        const recent = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
        const reusable = recent && ['markdown', 'empty'].includes(recent.view.getViewType());
        const leaf = e.ctrlKey || e.metaKey || !reusable ? this.app.workspace.getLeaf('tab') : recent!;
        await openNoteForDate(this.app, dateStr, type, this.plugin.settings, leaf);
        this.requestRender(); // a note it just created takes away the day's slash
    }
}
