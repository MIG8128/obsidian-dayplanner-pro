import { Menu, Notice, Platform } from 'obsidian';
import { isDeadlineOnly, sortByDueDate } from '../../drawer';
import { t } from '../../i18n';
import { GCalEventEditModal, TaskEditModal } from '../../modals';
import { describeSmartEntry, parseSmartEntry } from '../../smartEntry';
import { GCalEvent, TaskItem } from '../../types';
import { addMinutesToTime, calculateClusteredLayout, cleanTaskTextForDisplay, createCustomCheckbox, getDefaultTaskFilePath, getTargetTaskFilePath, isTouchLike, minutesToTime, onEnterSubmit, openTaskInEditor, timeToMinutes } from '../../utils';
import { DragDropLayer } from './dragDrop';
import { createNewTaskInFile, DEADLINE_ROW_PX, deadlineStateCls, GCAL_DEFAULT_COLOR, isLockedTask, renderLateBadge, renderTaskTitle, TimelineItem, updateTaskInFile, weekendCls } from './shared';
import { PlannerViewCore } from './viewCore';

/** Daily / N-day / Weekly timelines: hour grid, cards, deadlines, all-day chips, inline create. */
export abstract class TimelineLayer extends DragDropLayer {
    openInlineCreate(e: MouseEvent) {
        if (!this.usesPointerMouseDrag()) return;
        if (this.openInlineCreateAt(e.target as HTMLElement, e.clientY)) e.preventDefault();
    }

    /** Opens the editor in the 15-minute slot at `clientY` of the column `target` is in; false when not an empty slot */
    openInlineCreateAt(target: HTMLElement, clientY: number): boolean {
        if (target.closest('.dp-timeline-event, .dp-resize-handle')) return false;
        const col = target.closest<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events');
        if (!col) return false;
        const ratio = this.getHourHeight() / 60;
        // The 15-minute slot under the pointer (half a slot up, then the usual nearest-slot snap)
        const minutes = this.snapTimelineMinutes(clientY - col.getBoundingClientRect().top - 7.5 * ratio);
        this.inlineCreate = { dateStr: col.dataset.date || this.currentDate.format('YYYY-MM-DD'), minutes, draft: '' };
        this.mountInlineCreate();
        return true;
    }

    /**
     * Touch double-tap on an empty timeline slot opens the same inline editor a mouse double-click does (mobile
     * WebViews never deliver dblclick for a double-tap). Two quick taps (each under 300ms and 10px of travel) at most
     * 300ms and 15px apart. Property handlers, like ondblclick: the pane outlives its re-renders.
     */
    registerDoubleTapCreate(pane: HTMLElement) {
        if (!Platform.isMobile || !(this instanceof PlannerViewCore)) return;
        const TAP_MS = 300, TAP_SLOP = 10, GAP_MS = 300, GAP_DIST = 15;
        pane.ontouchstart = (e: TouchEvent) => {
            const touch = e.touches.length === 1 ? e.touches[0] : null;
            this.timelineTapStart = touch ? { x: touch.clientX, y: touch.clientY, at: Date.now() } : null;
        };
        pane.ontouchend = (e: TouchEvent) => {
            const start = this.timelineTapStart;
            this.timelineTapStart = null;
            const lastTap = this.lastTimelineTap;
            const touch = e.changedTouches[0];
            const now = Date.now();
            // Not a tap: a second finger, a scroll, a hold, or a card being dragged
            if (!start || !touch || e.touches.length > 0 || this.touchDragActive || this.activePointerDrag
                || now - start.at > TAP_MS || Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > TAP_SLOP) {
                this.lastTimelineTap = null;
                return;
            }
            const tap = { x: touch.clientX, y: touch.clientY, at: now };
            if (!lastTap || now - lastTap.at > GAP_MS || Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) > GAP_DIST) {
                this.lastTimelineTap = tap;
                return;
            }
            this.lastTimelineTap = null;
            // No click (or zoom) after the second tap: focusing the editor's input here keeps the keyboard allowed
            if (this.openInlineCreateAt(e.target as HTMLElement, tap.y)) e.preventDefault();
        };
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
        const startTime = minutesToTime(state.minutes);
        const endTime = minutesToTime(Math.min(state.minutes + (settings.defaultTaskDuration || 60), 24 * 60 - 1));

        const card = col.createDiv({ cls: 'dp-timeline-event dp-inline-create' });
        card.style.cssText = `top: ${(state.minutes - this.getTimelineHours().startHour * 60) * ratio}px; height: ${Math.max(30, (settings.defaultTaskDuration || 60) * ratio)}px; left: 2px; width: calc(100% - 4px);`;
        const timeLabel = card.createDiv({ cls: 'dp-inline-create-time', text: `${startTime}–${endTime}` });
        const input = card.createEl('input', { cls: 'dp-inline-create-input', attr: { type: 'text', placeholder: 'New task', 'aria-label': `New task at ${startTime}` } });
        input.value = state.draft;
        // The slot gives the date and time; words in the text override them ("30m", "5pm", "tomorrow", "!high")
        const parse = () => parseSmartEntry(input.value, {
            baseDate: state.dateStr, baseStart: startTime, baseEnd: endTime, defaultDuration: settings.defaultTaskDuration || 60
        });
        const updateLabel = () => {
            const entry = parse();
            const extras = describeSmartEntry(entry).filter(chip => !chip.startsWith('⏰') && !(chip.startsWith('⏳') && entry.date === state.dateStr));
            timeLabel.setText([`${entry.startTime}–${entry.endTime}`, ...extras].join(' · '));
        };
        if (input.value) updateLabel();

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
        input.addEventListener('input', () => {
            state.draft = input.value;
            updateLabel();
        });
        input.addEventListener('keydown', (ke: KeyboardEvent) => {
            if (ke.key !== 'Escape') return;
            ke.preventDefault();
            discard();
        });
        // Enter (IME-safe: a Hangul syllable still composing is committed first, then submitted)
        onEnterSubmit(input, () => {
            const entry = parse();
            input.value = ''; // a second Enter from the IME sequence finds nothing to submit
            discard();
            if (!entry.text) return;
            // Into the default task file like every quick entry, dated and timed by the slot (⏳ date, ⏰ start-end)
            const filePath = getDefaultTaskFilePath(settings);
            void (async () => {
                try {
                    await createNewTaskInFile(this.app, filePath, entry.text, entry.date, entry.startTime, entry.endTime, ' ', entry.priority,
                        null, entry.dueDate ? { date: entry.dueDate, time: entry.dueTime } : null);
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

    /**
     * One all-day task chip, identical in Daily, Weekly and N-day:
     * status checkbox · priority + title · ↗ jump to source; clicking the chip opens the edit modal.
     */
    renderAllDayTaskChip(task: TaskItem, containerEl: HTMLElement): HTMLElement {
        let cls = 'dp-grid-task-item dp-allday-item';
        if (task.statusChar === 'x') cls += ' completed';
        else if (task.statusChar === '-') cls += ' cancelled';
        else cls += ' dp-tinted'; // open: the task colour fill
        const chip = containerEl.createDiv({ cls });
        chip.dataset.selectId = task.id;

        createCustomCheckbox(chip, task, async (newStatus) => {
            await updateTaskInFile(this.app, task, { statusChar: newStatus });
            await this.refreshTasks();
        });

        renderTaskTitle(chip.createSpan({ cls: 'dp-task-text' }), cleanTaskTextForDisplay(task.text), task.priority);
        renderLateBadge(chip, task);

        const linkBtn = chip.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
        linkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openTaskInEditor(this.app, task);
        });

        chip.addEventListener('click', (e) => {
            if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
            e.stopPropagation();
            this.openTaskEditor(task);
        });
        // Desktop: drag onto a time slot (gets defaultTaskDuration) or back into the side drawer (unschedule)
        if (!isLockedTask(task)) this.registerMouseDrag(chip, { kind: 'task', task, origin: 'allday' });
        return chip;
    }

    /** All-day Google Calendar chip, the event counterpart of renderAllDayTaskChip (same size, calendar colour stripe). */
    renderAllDayEventChip(event: GCalEvent, dateStr: string, containerEl: HTMLElement): HTMLElement {
        const chip = containerEl.createDiv({
            cls: 'dp-grid-task-item dp-gcal-event dp-allday-item dp-tinted',
            text: `🗓️ ${event.summary}${event.location ? ` (📍 ${event.location})` : ''}`
        });
        chip.style.setProperty('--dp-item-color', event.color || GCAL_DEFAULT_COLOR);
        chip.dataset.selectId = event.id;
        chip.addEventListener('click', () => {
            new GCalEventEditModal(this.app, this.plugin, event, dateStr, async () => {
                await this.refreshTasks(null, true);
            }).open();
        });
        return chip;
    }

    /** Hour labels down the left edge of a timeline */
    protected renderHourMarks(timelineWrapper: HTMLElement, startHour: number, endHour: number, hourHeight: number) {
        const hoursCol = timelineWrapper.createDiv({ cls: 'dp-timeline-hours' });
        for (let h = startHour; h < endHour; h++) {
            const hourMark = hoursCol.createDiv({ cls: 'dp-timeline-hour-mark', text: `${String(h).padStart(2, '0')}:00` });
            hourMark.style.height = `${hourHeight}px`;
        }
    }

    /**
     * Right-click on empty space in a timeline column: "Add Task at HH:MM" (and, with Google Calendar, "Add
     * Appointment"), 30 minutes long. `targetFile` picks the note a new task goes to, from the date the editor saves.
     */
    protected registerSlotMenu(col: HTMLElement, dateStr: string, targetFile: (date: string) => string) {
        col.addEventListener('contextmenu', (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.dp-timeline-event, .dp-grid-task-item, .dp-task-link-btn, .dp-custom-cb')) return;
            e.preventDefault();

            const ratio = this.getHourHeight() / 60;
            const { startHour, endHour } = this.getTimelineHours();
            const clickY = e.clientY - col.getBoundingClientRect().top;
            const clickedMinutes = Math.min(Math.max(Math.round((clickY / ratio) / 15) * 15 + startHour * 60, startHour * 60), endHour * 60 - 30);
            const startTimeStr = minutesToTime(clickedMinutes);
            const endTimeStr = addMinutesToTime(startTimeStr, 30);

            const menu = new Menu();
            (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
            menu.addItem(item => item
                .setTitle(`Add Task at ${startTimeStr}`)
                .setIcon('pencil')
                .onClick(() => {
                    new TaskEditModal(this.app, null, dateStr, async (data) => {
                        await createNewTaskInFile(this.app, targetFile(data.date || dateStr), data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority,
                        null, { date: data.dueDate, time: data.dueTime });
                        new Notice(t('notice.taskAdded'));
                        await this.refreshTasks();
                    }, startTimeStr, endTimeStr).open();
                }));
            if (this.plugin.settings.enableGoogleCalendar) {
                menu.addItem(item => item
                    .setTitle(`Add Appointment at ${startTimeStr}`)
                    .setIcon('calendar')
                    .onClick(() => {
                        new GCalEventEditModal(this.app, this.plugin, null, dateStr, async () => {
                            await this.refreshTasks(null, true);
                        }, startTimeStr, endTimeStr).open();
                    }));
            }
            menu.showAtMouseEvent(e);
        });
    }

    /** The current-time line in today's column, moved every minute (`fullWidth`: across a Weekly / N-day day column) */
    protected mountNowIndicator(col: HTMLElement, fullWidth: boolean) {
        const ratio = this.getHourHeight() / 60;
        const { startHour, endHour } = this.getTimelineHours();
        const startMin = startHour * 60;
        const endMin = endHour * 60;
        const indicator = col.createDiv({ cls: 'dp-timeline-current-indicator' });
        if (fullWidth) indicator.style.cssText = 'left: 0; right: 0;';
        const update = () => {
            const now = (window as any).moment();
            const mins = now.hour() * 60 + now.minute();
            if (mins < startMin || mins >= endMin) {
                indicator.style.display = 'none';
            } else {
                indicator.style.display = 'block';
                indicator.style.top = `${(mins - startMin) * ratio}px`;
            }
        };
        update();
        // Every render mounts a new indicator: stop this timer once its line is gone, or one leaks per render
        const intervalId = window.setInterval(() => {
            if (!indicator.isConnected) window.clearInterval(intervalId);
            else update();
        }, 60000);
        this.registerInterval(intervalId);
    }

    /** Tasks with a 📅, by due date (earliest due time first): the deadlines of the timeline and Monthly views (done ones faded) */
    protected deadlinesByDate(): Map<string, TaskItem[]> {
        const byDate = new Map<string, TaskItem[]>();
        this.tasks.forEach(task => {
            if (!task.dueDate) return;
            if (!byDate.has(task.dueDate)) byDate.set(task.dueDate, []);
            byDate.get(task.dueDate)!.push(task);
        });
        byDate.forEach(list => sortByDueDate(list));
        return byDate;
    }

    /** A deadline drawn as a line on the timeline: one with a due time inside the visible hours */
    protected isTimedDeadline(task: TaskItem): boolean {
        if (!task.dueTime) return false;
        const { startHour, endHour } = this.getTimelineHours();
        const mins = timeToMinutes(task.dueTime);
        return mins >= startHour * 60 && mins < endHour * 60;
    }

    /**
     * Deadlines for a day's all-day row: date-only ones and due times outside the visible hours. Skipped when the
     * task's own all-day chip already sits in that cell (scheduled on its due day, untimed, no due time).
     */
    protected allDayDeadlines(deadlines: TaskItem[], dateStr: string): TaskItem[] {
        return deadlines.filter(task => !this.isTimedDeadline(task)
            && !(task.date === dateStr && (!task.startTime || !task.endTime) && !task.dueTime && !isDeadlineOnly(task)));
    }

    /**
     * A deadline flag / chip: a click opens the task; a mouse or pen drag moves the deadline (📅 and due time only, ⏳ / ⏰
     * stay). Over a timeline column it takes that day and the snapped time, over an all-day row the day without a time,
     * over a mini calendar day that date with the time kept. Never a slot menu, marquee or card-drag start.
     */
    protected bindDeadlineItem(el: HTMLElement, task: TaskItem) {
        let suppressClick = false;
        const stop = (e: Event) => e.stopPropagation();
        el.addEventListener('mousedown', stop);
        el.addEventListener('dblclick', stop);
        el.addEventListener('contextmenu', stop);
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (suppressClick) return;
            this.openTaskEditor(task);
        });
        el.addEventListener('pointerdown', (down: PointerEvent) => {
            down.stopPropagation();
            // touch: tap to edit; a done / cancelled task's deadline stays put, like its card
            if (down.button !== 0 || isTouchLike(down) || isLockedTask(task)) return;
            const doc = el.ownerDocument;
            const moment = (window as any).moment;
            const ratio = this.getHourHeight() / 60;
            const startMin = this.getTimelineHours().startHour * 60;
            let dragging = false;
            let ghost: HTMLElement | null = null;
            let preview: HTMLElement | null = null;
            let lit: HTMLElement | null = null;
            let target: { date: string; time: string | null } | null = null;

            const locate = (x: number, y: number): { date: string; time: string | null; el: HTMLElement; mins?: number } | null => {
                const hit = doc.elementFromPoint(x, y) as HTMLElement | null;
                if (!hit || !this.containerEl.contains(hit)) return null;
                const day = hit.closest<HTMLElement>('.dp-mc-day[data-date], .dp-grid-cell[data-date]');
                if (day) return { date: day.dataset.date!, time: task.dueTime ?? null, el: day };
                const allDay = hit.closest<HTMLElement>('[data-allday-date]');
                if (allDay) return { date: allDay.dataset.alldayDate!, time: null, el: allDay };
                const col = hit.closest<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events');
                if (!col) return null;
                const mins = this.snapTimelineMinutes(y - col.getBoundingClientRect().top);
                // The Daily column carries no data-date: it always shows the current date
                return { date: col.dataset.date || this.currentDate.format('YYYY-MM-DD'), time: minutesToTime(mins), el: col, mins };
            };
            const title = cleanTaskTextForDisplay(task.text);
            let previewTime: HTMLElement | null = null;
            const onMove = (ev: PointerEvent) => {
                if (!dragging) {
                    if (Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) < 4) return;
                    dragging = true;
                    el.addClass('is-dragging');
                    ghost = doc.body.createDiv({ cls: 'dp-deadline-ghost' });
                }
                const hit = locate(ev.clientX, ev.clientY);
                target = hit ? { date: hit.date, time: hit.time } : null;
                if (lit && lit !== hit?.el) lit.removeClass('dp-drop-target');
                lit = hit && hit.mins === undefined ? hit.el : null;
                lit?.addClass('dp-drop-target');
                // Where the deadline would land: its line and flag on a timeline column, its chip in an all-day row
                const kind = hit?.mins !== undefined ? 'line' : hit?.el.dataset.alldayDate ? 'chip' : null;
                if (!hit || !kind) {
                    preview?.remove();
                    preview = null;
                } else {
                    if (preview?.parentElement !== hit.el || preview.dataset.kind !== kind) {
                        preview?.remove();
                        if (kind === 'line') {
                            preview = hit.el.createDiv({ cls: 'dp-deadline-marker is-preview' });
                            const flag = preview.createDiv({ cls: 'dp-deadline-flag' });
                            previewTime = flag.createSpan({ cls: 'dp-deadline-time' });
                            flag.createSpan({ cls: 'dp-deadline-title', text: title });
                        } else {
                            preview = hit.el.createDiv({ cls: 'dp-deadline-chip is-preview' });
                            preview.createSpan({ cls: 'dp-deadline-time', text: '⌛' });
                            preview.createSpan({ cls: 'dp-deadline-title', text: title });
                            hit.el.prepend(preview);
                            previewTime = null;
                        }
                        preview.dataset.kind = kind;
                    }
                    if (kind === 'line') {
                        preview!.style.top = `${(hit.mins! - startMin) * ratio}px`;
                        previewTime?.setText(hit.time!);
                    }
                }
                ghost!.style.left = `${ev.clientX + 14}px`;
                ghost!.style.top = `${ev.clientY + 14}px`;
                ghost!.setText(target
                    ? `📅 ${moment(target.date, 'YYYY-MM-DD').format('ddd M/D')}${target.time ? ` · ${target.time}` : ''}`
                    : `📅 ${cleanTaskTextForDisplay(task.text)}`);
            };
            const teardown = () => {
                doc.removeEventListener('pointermove', onMove);
                doc.removeEventListener('pointerup', onUp);
                doc.removeEventListener('pointercancel', onCancel);
                doc.removeEventListener('keydown', onKey, true);
                el.removeClass('is-dragging');
                ghost?.remove();
                preview?.remove();
                lit?.removeClass('dp-drop-target');
            };
            const onUp = async () => {
                teardown();
                if (!dragging) return;
                // The release's click (if it lands on the item) must not open the editor
                suppressClick = true;
                window.setTimeout(() => { suppressClick = false; }, 0);
                if (!target || (target.date === task.dueDate && target.time === (task.dueTime ?? null))) return;
                if (await updateTaskInFile(this.app, task, { dueDate: target.date, dueTime: target.time })) await this.refreshTasks();
            };
            const onCancel = () => {
                dragging = false;
                teardown();
            };
            const onKey = (e: KeyboardEvent) => {
                if (e.key !== 'Escape') return;
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            };
            doc.addEventListener('pointermove', onMove);
            doc.addEventListener('pointerup', onUp);
            doc.addEventListener('pointercancel', onCancel);
            doc.addEventListener('keydown', onKey, true);
        });
    }

    /**
     * Timeline column: a dashed line at each due time, with a flag (17:00 title, up to 3 lines) at its right end.
     * Deadlines whose flags would cover each other (same or nearby times) share one stack centred on the first line, a row
     * each (past three: the first two and a +N menu), so every deadline stays visible and draggable.
     */
    protected renderDeadlineMarkers(col: HTMLElement, deadlines: TaskItem[]) {
        const ratio = this.getHourHeight() / 60;
        const startMin = this.getTimelineHours().startHour * 60;
        const topOf = (task: TaskItem) => (timeToMinutes(task.dueTime!) - startMin) * ratio;
        const clusters: TaskItem[][] = [];
        let clusterTop = -Infinity;
        deadlines.filter(task => this.isTimedDeadline(task)).forEach(task => { // already sorted by due time
            if (clusters.length && topOf(task) - clusterTop < DEADLINE_ROW_PX) clusters[clusters.length - 1].push(task);
            else { clusters.push([task]); clusterTop = topOf(task); }
        });

        clusters.forEach(cluster => {
            // One dashed line per distinct time; the flag / stack hangs on the first
            const lines = new Map<string, HTMLElement>();
            cluster.forEach(task => {
                if (lines.has(task.dueTime!)) return;
                const marker = col.createDiv({ cls: `dp-deadline-marker${deadlineStateCls(task)}` });
                marker.style.top = `${topOf(task)}px`;
                lines.set(task.dueTime!, marker);
            });
            const first = lines.get(cluster[0].dueTime!)!;

            if (cluster.length === 1) {
                const task = cluster[0];
                const title = cleanTaskTextForDisplay(task.text);
                const flag = first.createDiv({ cls: 'dp-deadline-flag', attr: { title: t('timeline.deadline', { time: task.dueTime!, title }) } });
                flag.createSpan({ cls: 'dp-deadline-time', text: task.dueTime! });
                flag.createSpan({ cls: 'dp-deadline-title', text: title });
                this.bindDeadlineItem(flag, task);
                return;
            }

            first.addClass('has-stack'); // above the later lines of its cluster
            const stack = first.createDiv({ cls: 'dp-deadline-stack' });
            const shown = cluster.length > 3 ? cluster.slice(0, 2) : cluster;
            shown.forEach(task => {
                const title = cleanTaskTextForDisplay(task.text);
                const row = stack.createDiv({
                    cls: `dp-deadline-chip${deadlineStateCls(task)}`,
                    attr: { title: t('timeline.deadline', { time: task.dueTime!, title }) }
                });
                row.createSpan({ cls: 'dp-deadline-time', text: task.dueTime! });
                row.createSpan({ cls: 'dp-deadline-title', text: title });
                this.bindDeadlineItem(row, task);
            });
            const rest = cluster.slice(shown.length);
            if (!rest.length) return;
            const more = stack.createDiv({ cls: 'dp-deadline-chip dp-deadline-more', text: `+${rest.length}` });
            const stop = (e: Event) => e.stopPropagation();
            more.addEventListener('mousedown', stop);
            more.addEventListener('pointerdown', stop);
            more.addEventListener('dblclick', stop);
            more.addEventListener('contextmenu', stop);
            more.addEventListener('click', (e: MouseEvent) => {
                e.stopPropagation();
                const menu = new Menu();
                (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
                rest.forEach(task => menu.addItem(item => item
                    .setTitle(`⌛ ${task.dueTime} ${cleanTaskTextForDisplay(task.text)}`)
                    .onClick(() => this.openTaskEditor(task))));
                menu.showAtMouseEvent(e);
            });
        });
    }

    /** All-day row: a deadline chip (⌛ title, or ⌛ 06:00 title for a due time outside the visible hours) */
    protected renderDeadlineChip(cell: HTMLElement, task: TaskItem) {
        const title = cleanTaskTextForDisplay(task.text);
        const chip = cell.createDiv({
            cls: `dp-deadline-chip${deadlineStateCls(task)}`,
            attr: { title: t('timeline.deadline', { time: task.dueTime ?? t('common.allDay'), title }) }
        });
        chip.createSpan({ cls: 'dp-deadline-time', text: task.dueTime ? `⌛ ${task.dueTime}` : '⌛' });
        chip.createSpan({ cls: 'dp-deadline-title', text: title });
        this.bindDeadlineItem(chip, task);
    }

    /** A day's timed tasks and Google events: side by side when they start together, else nested (calculateClusteredLayout) */
    protected layoutTimedItems(dayTasks: TaskItem[], dayGCal: GCalEvent[]): TimelineItem[] {
        const items: TimelineItem[] = [];
        dayTasks.forEach(task => {
            if (!task.startTime || !task.endTime) return;
            items.push({
                type: 'task', refId: task.id, text: task.text, taskRef: task, completed: task.completed,
                startMin: timeToMinutes(task.startTime), endMin: timeToMinutes(task.endTime),
                startTime: task.startTime, endTime: task.endTime
            });
        });
        dayGCal.forEach(e => {
            if (e.isAllDay || !e.startTimeStr || !e.endTimeStr) return;
            items.push({
                type: 'gcal', refId: e.id, calendarId: e.calendarId, text: e.summary,
                color: e.color, location: e.location, description: e.description,
                startMin: timeToMinutes(e.startTimeStr), endMin: timeToMinutes(e.endTimeStr),
                startTime: e.startTimeStr, endTime: e.endTimeStr, readOnly: e.readOnly
            });
        });
        // Side by side while a later start would hide the earlier card's title (~44px), never under 30 minutes
        const ratio = this.getHourHeight() / 60;
        calculateClusteredLayout(items, Math.max(30, Math.ceil(44 / ratio / 15) * 15));
        return items;
    }

    /**
     * The cards of one timeline column: the Daily column, or one Weekly / N-day day (`compact`: narrower gutters and a
     * thinner calendar stripe). A Google event opens its editor; a task has a checkbox and ↗ and opens
     * the task editor. Unlocked items get resize bars and every drag path (pointer, phone long-press, native in code
     * blocks). `previewRoot` holds the drag previews: the Daily column, or the Weekly days wrapper (drags cross days).
     */
    protected renderTimelineCards(col: HTMLElement, items: TimelineItem[], previewRoot: HTMLElement, compact: boolean) {
        const ratio = this.getHourHeight() / 60;
        const { startHour, endHour } = this.getTimelineHours();
        const timelineStartMin = startHour * 60;
        const timelineEndMin = endHour * 60;
        const gutter = compact ? 1 : 4;
        const indent = compact ? 8 : 14; // px per nesting step: the host card's strip left of a nested card

        items.forEach(item => {
            // Items outside the visible hours are not drawn
            if (item.endMin <= timelineStartMin || item.startMin >= timelineEndMin) return;

            const visibleStartMin = Math.max(timelineStartMin, item.startMin);
            const visibleEndMin = Math.min(timelineEndMin, item.endMin);
            const isGCal = item.type === 'gcal';

            let cardCls = 'dp-timeline-event';
            const topPx = (visibleStartMin - timelineStartMin) * ratio;
            const heightPx = Math.max(15, (visibleEndMin - visibleStartMin) * ratio); // minimum height
            const leftPx = (item.leftIndent ?? 0) * indent + gutter;
            const widthPx = (item.widthIndent ?? 0) * indent - gutter * 2;
            let customStyle = `top: ${topPx}px; height: ${heightPx}px; left: calc(${item.leftPct ?? 0}% + ${leftPx}px); `
                + `width: calc(${item.widthPct ?? 100}% + ${widthPx}px); --dp-stack: ${Math.min(item.depth ?? 0, 10)};`;
            if (isGCal) {
                cardCls += item.readOnly ? ' dp-gcal-event is-readonly' : ' dp-gcal-event';
                // The calendar's colour fills the card like the task colour does (styles: --dp-item-color)
                customStyle += ` --dp-item-color: ${item.color || GCAL_DEFAULT_COLOR};`;
            } else if (item.taskRef) {
                if (item.taskRef.statusChar === 'x') cardCls += ' completed';
                else if (item.taskRef.statusChar === '-') cardCls += ' cancelled';
            }
            if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected'; // Google events select like tasks

            const eventCard = col.createDiv({ cls: cardCls });
            eventCard.style.cssText = customStyle;
            eventCard.setAttribute('data-task-id', item.refId);
            if (this.isTouchActive(item.refId)) eventCard.addClass('is-touch-active'); // survives data re-renders
            // The item's real range on this day (the card itself is clipped to the visible hours): drag previews use it
            eventCard.dataset.startMin = String(item.startMin);
            eventCard.dataset.endMin = String(item.endMin);
            // done / cancelled tasks and subscribed (.ics) events: no drag, resize or long-press
            const locked = isLockedTask(item.taskRef) || !!item.readOnly;
            // Native drag for code blocks; leaf views switch it off for the pointer engine (registerMouseDrag)
            eventCard.setAttribute('draggable', String(!locked));
            if (!locked && (isGCal || item.taskRef)) {
                this.addResizeListeners(eventCard, item, 'top');
                this.addResizeListeners(eventCard, item, 'bottom');
            }

            let clickDragged = false; // a native drag began: its release is no click
            if (isGCal) {
                eventCard.createDiv({ cls: 'dp-event-title', text: item.text });
                if (item.location) eventCard.createDiv({ cls: 'dp-event-meta', text: `📍 ${item.location}` });
                if (item.description) eventCard.createDiv({ cls: 'dp-event-meta', text: item.description });

                const cachedEvent = this.plugin.gcalCache.find(e => e.id === item.refId);
                if (cachedEvent) {
                    eventCard.addEventListener('click', (ev) => {
                        if (ev.target instanceof HTMLElement && ev.target.classList.contains('dp-resize-handle')) return;
                        new GCalEventEditModal(this.app, this.plugin, cachedEvent, this.currentDate.format('YYYY-MM-DD'), async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                }
            } else {
                const task = item.taskRef;
                const mainRow = eventCard.createDiv({ cls: 'dp-event-main' });
                if (task) {
                    createCustomCheckbox(mainRow, task, async (newStatus) => {
                        await updateTaskInFile(this.app, task, { statusChar: newStatus });
                        await this.refreshTasks();
                    });
                }
                renderTaskTitle(mainRow.createEl('span', { cls: 'dp-task-text' }), cleanTaskTextForDisplay(item.text), task?.priority);
                renderLateBadge(mainRow, task);
                const linkBtn = mainRow.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                linkBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (task) await openTaskInEditor(this.app, task);
                });

                // A click opens the editor; a press that travelled (or turned into a native drag) does not
                let clickStartX = 0;
                let clickStartY = 0;
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
                    if (Math.abs(e.clientX - clickStartX) > 5 || Math.abs(e.clientY - clickStartY) > 5 || clickDragged) return;
                    if (task) this.openTaskEditor(task);
                });
            }

            eventCard.addEventListener('dragstart', (e) => {
                clickDragged = true;
                if (!e.dataTransfer) return;
                if (!this.selectedTaskIds.has(item.refId)) {
                    this.selectedTaskIds.clear();
                    this.selectedTaskIds.add(item.refId);
                    previewRoot.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                    eventCard.addClass('selected');
                }
                const clickOffsetMin = this.timelineGrabOffset(eventCard, e.clientY);
                this.activeDragClickOffsetMin = clickOffsetMin;
                e.dataTransfer.setData('text/plain', JSON.stringify({
                    primaryTaskId: item.refId,
                    clickOffsetMin,
                    sourceTab: this.getViewTabType(),
                    isGCal,
                    ...(isGCal ? { calendarId: item.calendarId } : {})
                }));
                this.initDragPreview(e, item.refId, clickOffsetMin, previewRoot);
            });
            eventCard.addEventListener('dragend', () => this.clearDragPreview(previewRoot));

            if (this.useCompactLayout() && !locked) this.registerLongPressDrag(eventCard, item.refId, isGCal, previewRoot);
            if (!locked) this.registerMouseDrag(eventCard, { kind: 'timeline', refId: item.refId, isGCal, previewRoot });
        });
    }

    /** Native drag-and-drop onto a timeline column (code blocks; leaf views drag with pointer events, beginPointerDrag) */
    protected registerNativeTimelineDrop(col: HTMLElement, dateStr: string) {
        col.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.updateDragPreview(e, col, this.activeDragClickOffsetMin, true);
        });
        col.addEventListener('drop', async (e) => {
            e.preventDefault();
            const dataStr = e.dataTransfer?.getData('text/plain');
            if (!dataStr) return;
            try {
                const { primaryTaskId, clickOffsetMin, isGCal } = JSON.parse(dataStr);
                const top = col.getBoundingClientRect().top;
                await this.moveSelectedTimelineItems(primaryTaskId, isGCal, this.snapTimelineMinutes(e.clientY - top - clickOffsetMin, true), dateStr);
            } catch (err) {
                console.error('Day Planner Pro: timeline drop failed', err);
            }
        });
    }

    /**
     * 1. 일간 타임라인 그리기 구현
     */
    renderDailyTimeline(parent: HTMLDivElement) {
        const dateStr = this.currentDate.format('YYYY-MM-DD');
        const dayTasks = this.tasks.filter(t => t.date === dateStr);
        const dayGCal = this.plugin.hasCalendars()
            ? this.getCalendarEventsForDate(dateStr)
            : [];

        const hourHeight = this.getHourHeight();
        const scrollKey = `${this.getViewType()}:${dateStr}:daily`;
        // Property handlers, not addEventListener: the pane outlives its re-renders, so listeners stacked one more per
        // render, all of them running on every scroll frame (and writing this offset into earlier dates' keys)
        parent.ondblclick = (e) => this.openInlineCreate(e);
        this.registerDoubleTapCreate(parent); // touch: double-tap an empty slot
        parent.onscroll = () => {
            this.savedScrollPositions[scrollKey] = {
                scrollTop: parent.scrollTop,
                scrollLeft: parent.scrollLeft
            };
        };

        const { startHour, endHour } = this.getTimelineHours();

        const timelineWrapper = parent.createDiv({ cls: 'dp-timeline-wrapper' });
        timelineWrapper.style.minHeight = `${(endHour - startHour) * hourHeight}px`;
        this.renderHourMarks(timelineWrapper, startHour, endHour, hourHeight);

        const eventsCol = timelineWrapper.createDiv({ cls: 'dp-timeline-events' });
        eventsCol.style.backgroundSize = `100% ${hourHeight}px`;
        // Box selection over every card, Google events included
        this.registerMarqueeSelection(eventsCol, () => Array.from(eventsCol.querySelectorAll<HTMLElement>('.dp-timeline-event')));
        // A task added from the slot menu goes to the note open in the editor, else the default task file
        this.registerSlotMenu(eventsCol, dateStr, () => {
            const activeFile = this.app.workspace.getActiveFile();
            return activeFile && activeFile.extension === 'md' ? activeFile.path : this.plugin.settings.defaultTaskFile;
        });
        if (this.currentDate.isSame((window as any).moment(), 'day')) this.mountNowIndicator(eventsCol, false);
        this.renderTimelineCards(eventsCol, this.layoutTimedItems(dayTasks, dayGCal), eventsCol, false);
        this.registerNativeTimelineDrop(eventsCol, dateStr);
        const dayDeadlines = this.deadlinesByDate().get(dateStr) ?? [];
        this.renderDeadlineMarkers(eventsCol, dayDeadlines);

        const untimedTasks = dayTasks.filter(t => (!t.startTime || !t.endTime) && !isDeadlineOnly(t));
        const untimedAllDayGCal = dayGCal.filter(e => e.isAllDay);
        const allDayDeadlines = this.allDayDeadlines(dayDeadlines, dateStr);

        {
            // Same row as the Weekly/N-day all-day grid ([All Day | cell], same item classes), pinned above the hourly
            // grid; drawn even when empty, so a task or deadline can always be dropped on it
            const allDaySection = parent.createDiv({ cls: 'dp-daily-allday' });
            parent.insertBefore(allDaySection, timelineWrapper);

            allDaySection.createDiv({ cls: 'dp-allday-label', text: t('common.allDay') });
            const listEl = allDaySection.createDiv({ cls: 'dp-allday-cell' });
            listEl.dataset.alldayDate = dateStr; // drops here go untimed: tasks (beginPointerDrag), deadlines (bindDeadlineItem)

            allDayDeadlines.forEach(task => this.renderDeadlineChip(listEl, task));
            untimedAllDayGCal.forEach(e => this.renderAllDayEventChip(e, dateStr, listEl));
            untimedTasks.sort((a, b) => a.text.localeCompare(b.text));
            untimedTasks.forEach(task => this.renderAllDayTaskChip(task, listEl));
            // Box selection of all-day items only (the timeline below has its own; the two never mix)
            this.registerMarqueeSelection(allDaySection, () => Array.from(allDaySection.querySelectorAll<HTMLElement>('.dp-allday-item')));
        }

        // 'now' line when today is shown; otherwise the earliest timed item of the day
        this.applyAutoScroll(parent, scrollKey, 'daily', 'now', () => this.getAutoScrollY([dateStr], startHour, hourHeight));
    }

    /**
     * 2. 주간 캘린더 뷰 구현
     */
    renderWeeklyView(parent: HTMLDivElement, daysCount: number = 7, startFromCurrentDate: boolean = false) {
        parent.empty();

        parent.ondblclick = (e) => this.openInlineCreate(e); // property, not addEventListener: the pane outlives renders
        this.registerDoubleTapCreate(parent); // touch: double-tap an empty slot
        const scrollWrapper = parent.createDiv({ cls: 'dp-weekly-scroll-wrapper' });
        const container = scrollWrapper.createDiv({ cls: 'dp-weekly-container' });
        // 84px day columns: a 7-day week fits ~640px, so it keeps fitting beside the open side drawer
        const DAY_COL_MIN = 84;
        const dayColumnTemplate = `48px repeat(${daysCount}, minmax(${DAY_COL_MIN}px, 1fr))`;
        const minWidth = Math.max(360, DAY_COL_MIN * daysCount + 48);
        container.style.minWidth = `${minWidth}px`;

        // One vertical scroller for the day headers, the all-day row and the hourly grid: the two rows stick to its top
        // (like Daily's all-day row), so every column shares the scroller's width and lines up at any day count.
        // Only the outer wrapper scrolls sideways: this one's vertical scrollbar narrowed the columns below their minimum
        // in a slightly small pane, and both showed a horizontal bar. The minimum width makes room for that scrollbar.
        const timelineScroll = container.createDiv({ cls: 'dp-content' });
        timelineScroll.style.cssText = 'flex-grow: 1; overflow-x: hidden; overflow-y: auto; padding: 0; position: relative;';
        requestAnimationFrame(() => {
            const scrollbar = timelineScroll.offsetWidth - timelineScroll.clientWidth;
            if (scrollbar > 0) container.style.minWidth = `${minWidth + scrollbar}px`;
        });
        const stickyHead = timelineScroll.createDiv({ cls: 'dp-weekly-sticky-head' });

        const headerGrid = stickyHead.createDiv({ cls: 'dp-weekly-header-grid' });
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
        const { startHour, endHour } = this.getTimelineHours();
        const hoursCount = endHour - startHour;

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

        const deadlinesByDate = this.deadlinesByDate();

        const gcalByDate = new Map<string, GCalEvent[]>();
        if (this.plugin.hasCalendars()) {
            for (let i = 0; i < daysCount; i++) {
                const loopDayStr = startOfWeek.clone().add(i, 'days').format('YYYY-MM-DD');
                gcalByDate.set(loopDayStr, this.getCalendarEventsForDate(loopDayStr));
            }
        }

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            const isToday = loopDay.isSame((window as any).moment(), 'day');

            // Same anatomy as the phone date strip: weekday over date, today in the accent
            const cellHeader = headerGrid.createDiv({
                cls: `dp-grid-header dp-day-pill ${isToday ? 'today' : ''}${weekendCls(loopDay)}`
            });
            cellHeader.createSpan({ cls: 'dp-date-pill-dow', text: loopDay.format('ddd') });
            cellHeader.createSpan({ cls: 'dp-date-pill-date', text: loopDay.format('M/D') });
            cellHeader.dataset.date = loopDayStr; // "Fit it in" drop target for a dragged task
            cellHeader.addEventListener('click', () => void this.openDayInDaily(loopDayStr)); // that day in Daily
        }

        const allDayGrid = stickyHead.createDiv({ cls: 'dp-weekly-allday-grid' });
        // Box selection of all-day items only (the day columns below have their own; the two never mix)
        this.registerMarqueeSelection(allDayGrid, () => Array.from(allDayGrid.querySelectorAll<HTMLElement>('.dp-allday-item')));
        allDayGrid.style.gridTemplateColumns = dayColumnTemplate;
        allDayGrid.createDiv({ cls: 'dp-allday-label', text: t('common.allDay') }).style.gridArea = '1 / 1';

        // Multi-day all-day events: one bar across their days, on lanes above each cell's own items (A→Z). Every item
        // sits on grid row 1 by explicit column, so the bars overlay the cells; a cell's top padding keeps the lanes free.
        const visibleDates = Array.from({ length: daysCount }, (_, i) => startOfWeek.clone().add(i, 'days').format('YYYY-MM-DD'));
        const multiDay = this.multiDayLanes(visibleDates, gcalByDate, true);
        allDayGrid.style.setProperty('--dp-span-lanes', String(multiDay.laneCount));
        multiDay.spans.forEach(span => {
            const bar = this.renderAllDayEventChip(span.e, visibleDates[span.first], allDayGrid);
            bar.addClass('dp-allday-span');
            bar.toggleClass('dp-span-left', span.left);
            bar.toggleClass('dp-span-right', span.right);
            bar.style.gridArea = `1 / ${span.first + 2} / 2 / ${span.last + 3}`;
            bar.style.setProperty('--dp-span-lane', String(span.lane));
        });

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');

            const dayTasks = tasksByDate.get(loopDayStr) || [];
            const dayGCal = gcalByDate.get(loopDayStr) || [];

            const untimedTasks = dayTasks.filter(t => (!t.startTime || !t.endTime) && !isDeadlineOnly(t));
            const untimedAllDayGCal = dayGCal.filter(e => e.isAllDay && !multiDay.keys.has(`${e.calendarId}:${e.id}`));

            const cell = allDayGrid.createDiv({ cls: `dp-allday-cell${weekendCls(loopDay)}` });
            cell.style.gridArea = `1 / ${i + 2}`;
            cell.dataset.alldayDate = loopDayStr; // drops here go untimed: tasks (beginPointerDrag), deadlines (bindDeadlineItem)

            this.allDayDeadlines(deadlinesByDate.get(loopDayStr) ?? [], loopDayStr).forEach(task => this.renderDeadlineChip(cell, task));
            untimedAllDayGCal.forEach(e => this.renderAllDayEventChip(e, loopDayStr, cell));
            untimedTasks.sort((a, b) => a.text.localeCompare(b.text));
            untimedTasks.forEach(task => this.renderAllDayTaskChip(task, cell));
        }

        const scrollKey = `${this.getViewType()}:${startOfWeek.format('YYYY-MM-DD')}:${daysCount}:weekly`;
        timelineScroll.addEventListener('scroll', () => {
            this.savedScrollPositions[scrollKey] = {
                scrollTop: timelineScroll.scrollTop,
                scrollLeft: timelineScroll.scrollLeft
            };
        });

        const timelineWrapper = timelineScroll.createDiv({ cls: 'dp-timeline-wrapper' });
        timelineWrapper.style.cssText = `min-height: calc(${hoursCount} * ${hourHeight}px);`;
        this.renderHourMarks(timelineWrapper, startHour, endHour, hourHeight);

        const daysWrapper = timelineWrapper.createDiv({ cls: 'dp-weekly-days-wrapper' });

        // Box selection across the day columns, Google events included
        this.registerMarqueeSelection(daysWrapper, () => Array.from(daysWrapper.querySelectorAll<HTMLElement>('.dp-timeline-event')));

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            const isToday = loopDay.isSame((window as any).moment(), 'day');

            const dayCol = daysWrapper.createDiv({ cls: `dp-weekly-day-col ${isToday ? 'today' : ''}${weekendCls(loopDay)}` });
            dayCol.style.cssText = 'flex: 1; position: relative; border-right: 1px solid var(--background-modifier-border); box-sizing: border-box;';
            dayCol.setAttribute('data-date', loopDayStr);

            // A task added from the slot menu goes to that day's daily note (or the default task file)
            this.registerSlotMenu(dayCol, loopDayStr, date => getTargetTaskFilePath(this.app, this.plugin.settings, date));
            this.registerNativeTimelineDrop(dayCol, loopDayStr);
            if (isToday) this.mountNowIndicator(dayCol, true);
            const items = this.layoutTimedItems(tasksByDate.get(loopDayStr) || [], gcalByDate.get(loopDayStr) || []);
            this.renderTimelineCards(dayCol, items, daysWrapper, true);
            this.renderDeadlineMarkers(dayCol, deadlinesByDate.get(loopDayStr) ?? []);
        }

        this.applyAutoScroll(timelineScroll, scrollKey, `weekly:${daysCount}`, 'now', () => this.getAutoScrollY(visibleDates, startHour, hourHeight));
    }
}
