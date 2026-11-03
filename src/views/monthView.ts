import { isDeadlineOnly } from '../../drawer';
import { t } from '../../i18n';
import { GCalEventEditModal, TaskEditModal } from '../../modals';
import { GCalEvent, TaskItem } from '../../types';
import { cleanTaskTextForDisplay, openTaskInEditor } from '../../utils';
import { createNewTaskInFile, deadlineStateCls, GCAL_DEFAULT_COLOR, isLockedTask, renderLateBadge, renderTaskTitle, weekendCls } from './shared';
import { TimelineLayer } from './timelineView';

/** Monthly calendar view. */
export abstract class MonthLayer extends TimelineLayer {
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

        const deadlinesByDate = this.deadlinesByDate();

        const gcalByDate = new Map<string, GCalEvent[]>();
        if (this.plugin.hasCalendars()) {
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
                const weekCell = cells.createDiv({ cls: 'dp-grid-week-cell dp-day-pill' });
                weekCell.style.gridArea = `${w + 1} / 1`;
                weekCell.createSpan({ cls: 'dp-date-pill-dow', text: 'Wk' });
                weekCell.createSpan({ cls: 'dp-date-pill-date', text: String(weekNum) });

                weekCell.addEventListener('click', () => void this.openWeekInWeekly(weekStartDate.format('YYYY-MM-DD')));
            }

            // Multi-day events of this week each take one lane (row) on every day they cover, so a bar stays on the
            // same row across the week, A→Z by title. Desktop draws each as one bar over the week's cells (every item
            // placed by explicit grid row / column, so the bars overlay the cells); phones keep a piece per day.
            const weekDates = Array.from({ length: 7 }, (_, i) => weekStartDate.clone().add(i, 'days').format('YYYY-MM-DD'));
            const multiDay = this.multiDayLanes(weekDates, gcalByDate, false);
            const spanKeys = multiDay.keys;
            const lanesByDay = new Map(weekDates.map((dateStr, i) => [dateStr, multiDay.lanesByDay[i]]));
            if (!phone) {
                multiDay.spans.forEach(span => {
                    const e = span.e;
                    const text = `${!span.left && e.startTimeStr ? `${e.startTimeStr} ` : ''}${e.summary}${e.location ? ` (📍 ${e.location})` : ''}`;
                    const bar = cells.createDiv({ cls: 'dp-grid-task-item dp-gcal-event dp-tinted dp-span dp-month-span', attr: { title: text } });
                    bar.createSpan({ cls: 'dp-task-text', text });
                    bar.toggleClass('dp-span-left', span.left);
                    bar.toggleClass('dp-span-right', span.right);
                    bar.style.gridArea = `${w + 1} / ${span.first + 2} / ${w + 2} / ${span.last + 3}`;
                    bar.style.setProperty('--dp-item-color', e.color || GCAL_DEFAULT_COLOR);
                    bar.style.setProperty('--dp-span-lane', String(span.lane));
                    bar.dataset.selectId = e.id;
                    bar.addEventListener('click', () => {
                        new GCalEventEditModal(this.app, this.plugin, e, weekDates[span.first], async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                });
            }

            for (let d = 0; d < 7; d++) {
                const loopDay = weekStartDate.clone().add(d, 'days');
                const loopDayStr = loopDay.format('YYYY-MM-DD');
                const isCurrentMonth = loopDay.month() === startOfMonth.month();
                const isToday = loopDay.isSame((window as any).moment(), 'day');
                const cell = cells.createDiv({ cls: `dp-grid-cell ${isToday ? 'today' : ''}${weekendCls(loopDay)}` });
                cell.dataset.date = loopDayStr; // drop target for drawer tasks (date only)
                if (!phone) cell.style.gridArea = `${w + 1} / ${d + 2}`;

                if (!isCurrentMonth) cell.style.opacity = '0.3';

                const cellNum = cell.createDiv({ cls: 'dp-grid-cell-num', text: String(loopDay.date()) });
                cellNum.style.cssText = 'cursor: pointer; text-decoration: underline; color: var(--text-accent); font-weight: bold;';
                cellNum.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (phone) void this.focusDay(loopDayStr);
                    else void this.openDayInDaily(loopDayStr); // as on phones
                });
                // Desktop: the room the week's bars lie over (same height in every cell of the week)
                if (!phone && multiDay.laneCount > 0) {
                    cell.createDiv({ cls: 'dp-month-span-lanes' }).style.setProperty('--dp-span-lanes', String(multiDay.laneCount));
                }
                if (phone) {
                    cell.addEventListener('click', () => this.focusDay(loopDayStr));
                } else {
                    // Desktop: the cell's empty space opens the day as well (its items open their own editors)
                    cell.addEventListener('click', (e) => {
                        if ((e.target as HTMLElement).closest('.dp-grid-task-item, button, .dp-task-link-btn')) return;
                        void this.openDayInDaily(loopDayStr);
                    });
                }

                const listWrapper = cell.createDiv({ cls: 'dp-grid-task-list' });

                // A multi-day event shows its title where its bar starts (its first day, or the week's first column);
                // later days continue the bar (squared joining corners, no stripe)
                const renderEvent = (e: GCalEvent, span?: { left: boolean; right: boolean; label: boolean }) => {
                    // Compact cells are ~45px wide: the time would leave room for only 1–2 title characters
                    const timePrefix = e.startTimeStr && !phone && !span?.left ? `${e.startTimeStr} ` : '';
                    const locationSuffix = e.location ? ` (📍 ${e.location})` : '';
                    const displayText = `${timePrefix}${e.summary}${locationSuffix}`;

                    const gcalItem = listWrapper.createDiv({
                        cls: 'dp-grid-task-item dp-gcal-event dp-tinted',
                        text: !span || span.label ? displayText : '',
                        attr: { title: displayText }
                    });
                    if (span) {
                        gcalItem.addClass('dp-span');
                        gcalItem.toggleClass('dp-span-left', span.left);
                        gcalItem.toggleClass('dp-span-right', span.right);
                    }
                    gcalItem.style.setProperty('--dp-item-color', e.color || GCAL_DEFAULT_COLOR);
                    gcalItem.dataset.selectId = e.id;

                    gcalItem.addEventListener('click', () => {
                        new GCalEventEditModal(this.app, this.plugin, e, loopDayStr, async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                };

                // 1. Phones: multi-day events in their week lanes; an empty lane keeps its height so the pieces line up
                const lanes = phone ? lanesByDay.get(loopDayStr) ?? [] : []; // desktop: the bars above
                for (let i = 0; i < lanes.length; i++) {
                    const e = lanes[i];
                    if (!e) {
                        listWrapper.createDiv({ cls: 'dp-grid-task-item dp-span-spacer' });
                        continue;
                    }
                    const allDates = this.getSpannedDatesForEvent(e);
                    const at = allDates.indexOf(loopDayStr);
                    renderEvent(e, { left: at > 0, right: at < allDates.length - 1, label: at <= 0 || d === 0 });
                }

                // 2. Then everything else of the day, tasks and events together: all-day first, then by start time
                const dayTasks = tasksByDate.get(loopDayStr) || [];
                const dayItems: Array<{ allDay: boolean; time: string; title: string; render: () => void }> = [
                    ...(gcalByDate.get(loopDayStr) || [])
                        .filter(e => !spanKeys.has(`${e.calendarId}:${e.id}`))
                        .map(e => ({ allDay: e.isAllDay || !e.startTimeStr, time: e.startTimeStr || '', title: e.summary || '', render: () => renderEvent(e) })),
                    ...dayTasks.filter(task => !isDeadlineOnly(task)).map(task => ({ allDay: !task.startTime, time: task.startTime || '', title: cleanTaskTextForDisplay(task.text), render: () => renderTask(task) })),
                    // Deadlines of tasks placed on another day (a task scheduled here already shows in this cell)
                    ...(deadlinesByDate.get(loopDayStr) ?? []).filter(task => task.date !== loopDayStr || isDeadlineOnly(task))
                        .map(task => ({ allDay: !task.dueTime, time: task.dueTime || '', title: cleanTaskTextForDisplay(task.text), render: () => renderDeadline(task) }))
                ];
                dayItems.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.time.localeCompare(b.time) || a.title.localeCompare(b.title));

                const renderTask = (task: TaskItem) => {
                    let itemClass = 'dp-grid-task-item';
                    if (task.statusChar === 'x') itemClass += ' completed';
                    else if (task.statusChar === '-') itemClass += ' cancelled';

                    const item = listWrapper.createDiv({ cls: itemClass });
                    item.dataset.selectId = task.id;
                    const displayTitle = cleanTaskTextForDisplay(task.text);
                    const textSpan = item.createSpan({ cls: 'dp-task-text' });
                    renderTaskTitle(textSpan, displayTitle, task.priority, task.startTime && !phone ? `${task.startTime} ` : '');
                    renderLateBadge(item, task);

                    if (task.statusChar === '-') {
                        item.style.cssText = `opacity: 0.55; border-left: 3px solid var(--text-error) !important; background-color: rgba(235, 87, 87, 0.05) !important;`;
                    } else if (task.statusChar !== 'x') { // done: the faded task colour (styles, .completed)
                        item.addClass('dp-tinted'); // the task colour fill (styles)
                    }

                    const linkBtn = item.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, task);
                    });

                    item.addEventListener('click', (e) => {
                        if (e.target === linkBtn) return;
                        e.stopPropagation();
                        this.openTaskEditor(task);
                    });
                    // Desktop: drag onto another day (date only) or back into the side drawer (unschedule)
                    if (!isLockedTask(task)) this.registerMouseDrag(item, { kind: 'task', task, origin: 'month' });
                };
                // A deadline: the task colour filled solid (⌛ 17:00 title); drag it onto another day to move the due date
                const renderDeadline = (task: TaskItem) => {
                    const title = cleanTaskTextForDisplay(task.text);
                    const item = listWrapper.createDiv({
                        cls: `dp-grid-task-item dp-deadline-chip${deadlineStateCls(task)}`,
                        attr: { title: t('timeline.deadline', { time: task.dueTime ?? t('common.allDay'), title }) }
                    });
                    item.createSpan({ cls: 'dp-deadline-time', text: task.dueTime && !phone ? `⌛ ${task.dueTime}` : '⌛' });
                    item.createSpan({ cls: 'dp-deadline-title', text: title });
                    this.bindDeadlineItem(item, task);
                };
                dayItems.forEach(entry => entry.render());

                cell.addEventListener('dblclick', (e) => {
                    if (e.target !== cell && e.target !== listWrapper) return;
                    const modal = new TaskEditModal(this.app, null, loopDayStr, async (data) => {
                        const activeFile = this.app.workspace.getActiveFile();
                        const targetFilePath = (activeFile && activeFile.extension === 'md') ? activeFile.path : this.plugin.settings.defaultTaskFile;
                        await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority,
                        null, { date: data.dueDate, time: data.dueTime });
                        await this.refreshTasks();
                    });
                    modal.open();
                });
            }
        }
        grid.appendChild(cells);
        if (phone) this.fitMonthlyChips(grid);
        else this.alignMonthlySpans(grid);
    }

    /**
     * Desktop Monthly: the multi-day bars lie over the cells from the top of each cell's lane room (below the day
     * number), measured once laid out and again on size changes (zoom, font); a hidden pane (height 0) keeps its value.
     */
    alignMonthlySpans(grid: HTMLElement) {
        const align = () => {
            const room = grid.querySelector<HTMLElement>('.dp-grid-cell:not(.today) > .dp-month-span-lanes');
            const cell = room?.parentElement;
            if (!room || !cell || cell.clientHeight === 0) return;
            grid.style.setProperty('--dp-month-lane-top', `${room.getBoundingClientRect().top - cell.getBoundingClientRect().top}px`);
        };
        const observer = new ResizeObserver(() => {
            if (!grid.isConnected) observer.disconnect();
            else align();
        });
        observer.observe(grid);
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
                // Lane placeholders (multi-day alignment) take a row but are not items: never counted in +N
                const hidden = chips.slice(shown).filter(chip => !chip.hasClass('dp-span-spacer')).length;
                if (hidden > 0) list.createDiv({ cls: 'dp-grid-more', text: `+${hidden}` });
            });
        };
        // Fires once after the first layout, then on every size change; stops with the grid it measures
        const observer = new ResizeObserver(() => {
            if (!grid.isConnected) observer.disconnect();
            else fit();
        });
        observer.observe(grid);
    }
}
