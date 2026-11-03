import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { GCalEventEditModal } from '../../modals';
import { cleanTaskTextForDisplay, createCustomCheckbox, formatMinutesNice, openTaskInEditor, PRIORITY_EMOJI, searchTerms, timeToMinutes } from '../../utils';
import { BoardLayer } from './boardView';
import { deadlineStateCls, eventDescriptionText, eventTimesOnDate, updateTaskInFile } from './shared';
import { PlannerViewCore } from './viewCore';

/** Task list view with its filter panel. */
export abstract class ListLayer extends BoardLayer {
    renderListView(parent: HTMLDivElement) {
        parent.empty();

        if (!(this as any).listSearchQuery) (this as any).listSearchQuery = '';

        const self = this as any;

        const container = parent.createDiv({ cls: 'dp-gc-list-container' });

        // Code blocks keep their own agenda search box; planner views search from the header (/ or Ctrl+F)
        const globalSearch = this instanceof PlannerViewCore ? this.searchQuery : '';
        const header = container.createDiv({ cls: 'dp-gc-list-header' });
        if (this instanceof PlannerViewCore) header.hide();
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

        // Date limits: this month; one day in the compact agenda (or today / this week if in daily / weekly notes)
        const dayAgenda = this.isDayAgendaList();
        const agendaLayout = dayAgenda && !globalSearch; // search results span many days: keep the date column
        container.toggleClass('is-day-agenda', agendaLayout);
        const taskColor = this.plugin.settings.taskColor || '#ff9f1c';
        let startDate = this.currentDate.clone().startOf(dayAgenda ? 'day' : 'month');
        let endDate = this.currentDate.clone().endOf(dayAgenda ? 'day' : 'month');

        if (self.parentNoteType === 'daily' && self.parentNoteDate) {
            startDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('day');
            endDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('day');
        } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
            startDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week');
            endDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week');
        }

        // A planner search lists every match, whatever its month
        const startStr = globalSearch ? '0000-00-00' : startDate.format('YYYY-MM-DD');
        const endStr = globalSearch ? '9999-12-31' : endDate.format('YYYY-MM-DD');

        const todayMoment = (window as any).moment();
        const todayStr = todayMoment.format('YYYY-MM-DD');

        // this.tasks already went through the block's filters (refreshTasks)
        let filteredTasks = this.tasks;

        // Search filter tasks
        if (self.listSearchQuery) {
            filteredTasks = filteredTasks.filter(t =>
                t.text.toLowerCase().includes(self.listSearchQuery) ||
                t.filePath.toLowerCase().includes(self.listSearchQuery)
            );
        }

        // Fetch GCal events (searching: from every cached month, narrowed like getCalendarEvents narrows the view's)
        const terms = searchTerms(globalSearch);
        let filteredEvents = globalSearch
            ? this.plugin.gcalCache.filter(e => {
                const haystack = `${e.summary}\n${e.location ?? ''}\n${e.description ?? ''}\n${e.calendarName ?? ''}`.toLowerCase();
                return terms.every(term => haystack.includes(term));
            })
            : this.getCalendarEvents();
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
            // An open task's deadline gets its own row on its due day (unless the task itself is listed there)
            if (task.dueDate && task.dueDate !== task.date && task.dueDate >= startStr && task.dueDate <= endStr) {
                if (!daysMap.has(task.dueDate)) daysMap.set(task.dueDate, []);
                daysMap.get(task.dueDate)!.push({ type: 'task', task, deadline: true });
            }
        });

        filteredEvents.forEach(event => {
            const spannedDates = this.getSpannedDatesForEvent(event);
            spannedDates.forEach(dateStr => {
                if (dateStr >= startStr && dateStr <= endStr) {
                    if (!daysMap.has(dateStr)) daysMap.set(dateStr, []);

                    daysMap.get(dateStr)!.push({
                        type: 'event',
                        event: {
                            ...event,
                            dateStr,
                            ...eventTimesOnDate(event, dateStr)
                        }
                    });
                }
            });
        });

        const listScroll = container.createDiv({ cls: 'dp-gc-list-scroll' });
        const listScrollKey = `${this.getViewType()}:${this.currentDate.format(dayAgenda ? 'YYYY-MM-DD' : 'YYYY-MM')}:list-scroll`;
        listScroll.addEventListener('scroll', () => {
            this.savedScrollPositions[listScrollKey] = {
                scrollTop: listScroll.scrollTop,
                scrollLeft: listScroll.scrollLeft
            };
        });

        if (daysMap.size === 0) {
            let emptyText = 'No tasks or events found in this month.';
            if (globalSearch) {
                emptyText = 'No tasks or events match the search.';
            } else if (dayAgenda) {
                emptyText = 'No tasks or events on this day.';
            } else if (self.parentNoteType === 'daily') {
                emptyText = 'No tasks or events found for today.';
            } else if (self.parentNoteType === 'weekly') {
                emptyText = 'No tasks or events found for this week.';
            }
            const empty = listScroll.createDiv({ cls: 'dp-gc-list-empty' });
            if (agendaLayout) setIcon(empty.createDiv({ cls: 'dp-gc-list-empty-icon' }), 'calendar-check');
            empty.createDiv({ text: emptyText });
            return;
        }

        // Agenda: one quiet line on how the day stands (tasks done, events), with a thin progress track
        if (agendaLayout) {
            const dayItems = Array.from(daysMap.values()).flat();
            const tasksOfDay = dayItems.filter(item => item.type === 'task' && !item.deadline);
            const deadlineRows = dayItems.filter(item => item.deadline).length;
            const done = tasksOfDay.filter(item => item.task.completed).length;
            const events = dayItems.length - tasksOfDay.length - deadlineRows;
            const summary = listScroll.createDiv({ cls: 'dp-agenda-summary' });
            const line = summary.createDiv({ cls: 'dp-agenda-summary-line' });
            line.createSpan({
                cls: 'dp-agenda-summary-main',
                text: tasksOfDay.length > 0 ? `${done} of ${tasksOfDay.length} tasks done` : 'No tasks'
            });
            if (events > 0) line.createSpan({ cls: 'dp-agenda-summary-sub', text: `${events} event${events === 1 ? '' : 's'}` });
            if (tasksOfDay.length > 0) {
                const track = summary.createDiv({ cls: 'dp-agenda-summary-track' });
                track.createDiv({ cls: 'dp-agenda-summary-fill' }).style.setProperty('--dp-agenda-done', String(done / tasksOfDay.length));
            }
        }

        // Sort dates chronologically
        const sortedDates = Array.from(daysMap.keys()).sort();

        // 24-hour HH:mm, like every other view (timeline cards, the current-task bar)
        const formatTimeStr = (time: string) => {
            const parsed = (window as any).moment(time, 'HH:mm');
            return parsed.isValid() ? parsed.format('HH:mm') : time;
        };
        const formatTimeRange = (start: string, end: string | null) =>
            end ? `${formatTimeStr(start)} - ${formatTimeStr(end)}` : formatTimeStr(start);

        sortedDates.forEach(dateStr => {
            const items = daysMap.get(dateStr)!;
            const loopDay = (window as any).moment(dateStr);
            const isToday = dateStr === todayStr;

            // Separate all-day vs timed (a deadline row is timed by its due time)
            const itemTime = (item: any): string | null => item.type === 'task'
                ? (item.deadline ? item.task.dueTime : item.task.startTime) ?? null
                : (item.event.isAllDay ? null : item.event.startTimeStr ?? null);
            const allDayItems = items.filter(item => !itemTime(item));
            const timedItems = items.filter(item => !!itemTime(item));

            // Sort timed items chronologically
            timedItems.sort((a, b) => itemTime(a)!.localeCompare(itemTime(b)!));

            const dayRow = listScroll.createDiv({
                cls: `dp-gc-day-row ${isToday ? 'is-today' : ''}`,
                attr: { 'data-date': dateStr }
            });

            // Left Sidebar: the day heading links to that day's daily note
            const sidebar = dayRow.createDiv({ cls: 'dp-gc-day-sidebar dp-gc-day-link' });
            sidebar.title = 'Open daily note';
            sidebar.addEventListener('click', () => this.handleDateClick(dateStr));

            sidebar.createDiv({ cls: 'dp-gc-day-number', text: loopDay.format('D') });

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
            const nowStr = todayMoment.format('HH:mm');

            const renderItem = (item: any) => {
                const isTask = item.type === 'task';
                const isDeadline = !!item.deadline;
                let cardClass = 'dp-gc-item';
                if (isDeadline) cardClass += ` dp-gc-deadline${deadlineStateCls(item.task)}`;
                else if (isTask) {
                    if (item.task.completed) cardClass += ' completed';
                    else if (item.task.statusChar === '-') cardClass += ' cancelled';
                }

                const card = contentDiv.createDiv({ cls: cardClass });
                if (!isDeadline) card.dataset.selectId = isTask ? item.task.id : item.event.id;

                const start: string | null = itemTime(item);
                const end: string | null = isDeadline ? null : isTask ? item.task.endTime : (item.event.isAllDay ? null : item.event.endTimeStr);
                if (agendaLayout) {
                    // Agenda row: time gutter · colour rail on the day's spine · checkbox / dot · title over a meta line
                    card.addClass('dp-agenda-item');
                    card.style.setProperty('--dp-agenda-color', isTask ? taskColor : (item.event.color || 'var(--interactive-accent)'));
                    const when = card.createDiv({ cls: 'dp-agenda-when' });
                    if (isDeadline) {
                        when.createDiv({ cls: 'dp-agenda-start', text: start ? `⌛ ${formatTimeStr(start)}` : '⌛' });
                    } else if (start) {
                        when.createDiv({ cls: 'dp-agenda-start', text: formatTimeStr(start) });
                        if (end) when.createDiv({ cls: 'dp-agenda-end', text: formatTimeStr(end) });
                    } else {
                        when.createDiv({ cls: 'dp-agenda-start is-allday', text: isKorean ? '종일' : 'All day' });
                    }
                    card.createDiv({ cls: 'dp-agenda-rail' });
                }

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

                // Time (the agenda shows it in its gutter instead)
                if (!agendaLayout) {
                    card.createDiv({
                        cls: 'dp-gc-item-time',
                        text: isDeadline ? (start ? `⌛ ${formatTimeStr(start)}` : '⌛')
                            : start ? formatTimeRange(start, end) : (isKorean ? '종일' : 'All day')
                    });
                }

                // Title, then the task's priority as a trailing pill (List keeps it after the title, unlike the
                // timeline views, so the rows stay balanced; it never shrinks away when the title is cut short)
                const displayTitle = isTask ? cleanTaskTextForDisplay(item.task.text) : item.event.summary;
                // Events stack their details under the title, so the title gets a column of its own
                const body = agendaLayout ? card.createDiv({ cls: 'dp-agenda-body' })
                    : isTask ? card : card.createDiv({ cls: 'dp-gc-item-main' });
                const titleEl = body.createDiv({ cls: 'dp-gc-item-title' });
                titleEl.createSpan({ cls: 'dp-gc-item-title-text', text: displayTitle });
                const priority: string | undefined = isTask ? item.task.priority : undefined;
                if (priority && PRIORITY_EMOJI[priority]) {
                    const label = t(`priority.${priority}` as Parameters<typeof t>[0]);
                    titleEl.createSpan({
                        cls: `dp-gc-item-priority is-${priority}`,
                        text: PRIORITY_EMOJI[priority],
                        attr: { 'aria-label': label, title: label }
                    });
                }

                // Agenda meta line: duration · source note (tasks) or location · calendar (events)
                let meta: HTMLElement | null = null;
                if (agendaLayout) {
                    meta = body.createDiv({ cls: 'dp-agenda-meta' });
                    const startMin = start ? timeToMinutes(start) : null;
                    const endMin = end ? timeToMinutes(end) : null;
                    if (startMin !== null && endMin !== null && endMin > startMin) {
                        meta.createSpan({ cls: 'dp-agenda-duration', text: formatMinutesNice(endMin - startMin) });
                    }
                    if (!isTask) {
                        if (item.event.location) meta.createSpan({ text: item.event.location });
                        if (item.event.calendarName) meta.createSpan({ text: item.event.calendarName });
                    }
                }

                // Event details, small and dim under the title: location · calendar (the agenda's meta line has
                // them already), then the description clamped to two lines (full text on hover)
                if (!isTask) {
                    if (!agendaLayout) {
                        const details = body.createDiv({ cls: 'dp-agenda-meta dp-gc-item-details' });
                        if (item.event.location) details.createSpan({ text: item.event.location });
                        if (item.event.calendarName) details.createSpan({ text: item.event.calendarName });
                        if (!details.hasChildNodes()) details.remove();
                    }
                    const desc = eventDescriptionText(item.event.description);
                    if (desc) body.createDiv({ cls: 'dp-gc-item-desc', text: desc, attr: { title: desc } });
                    if (!agendaLayout && body.childElementCount > 1) card.addClass('has-details');
                }

                // File (Only for tasks)
                if (isTask) {
                    const fileBase = item.task.filePath.split(/[/\\]/).pop() || item.task.filePath;
                    const fileBadge = meta
                        ? meta.createSpan({ cls: 'dp-gc-item-file', text: fileBase.replace(/\.md$/i, ''), attr: { 'aria-label': `Open ${fileBase}` } })
                        : card.createDiv({ cls: 'dp-gc-item-file', text: `📄 ${fileBase}` });
                    fileBadge.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, item.task);
                    });

                    card.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target.classList.contains('dp-gc-item-file'))) return;
                        this.openTaskEditor(item.task);
                    });
                } else {
                    card.addEventListener('click', () => {
                        new GCalEventEditModal(this.app, this.plugin, item.event, item.event.dateStr, async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                }
                if (meta && !meta.hasChildNodes()) meta.remove();
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
                    if (!timeLineInserted && itemTime(item)! > nowStr) {
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
