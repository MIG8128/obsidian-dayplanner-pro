import { Notice, setIcon } from 'obsidian';
import { dueChip, isDeadlineMissed, sortByDueDate } from '../../drawer';
import { t, TranslationKey } from '../../i18n';
import { TaskItem } from '../../types';
import { BOARD_DRAG_MIME, cleanTaskTextForDisplay, compareTasks, createCustomCheckbox, openTaskInEditor, PRIORITY_EMOJI, readDraggedTaskIds, triggerHaptic } from '../../utils';
import { MonthLayer } from './monthView';
import { BOARD_MODES, BOARD_PRIORITY_LABEL, BoardMode, keepActiveTabInView, TaskUpdates, updateTaskInFile, updateTasksInFile } from './shared';

/** Board (Kanban / Priority / Deadline modes). */
export abstract class BoardLayer extends MonthLayer {
    /**
     * 4. 칸반 보드 (Board) 뷰 이원화 통합 컨트롤러
     */
    renderKanbanBoard(parent: HTMLDivElement) {
        parent.empty();
        this.mountBoardModeToggle(parent.parentElement);

        const board = parent.createDiv({ cls: 'dp-kanban-board' });

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
        } else if (this.kanbanViewMode === 'deadline') {
            this.renderDeadlineBoard(board);
        } else {
            this.renderStandardKanbanBoard(board);
        }
        // Box selection across columns (Ctrl / Cmd / Shift add), as on the timeline; Ctrl / Cmd + click works too
        this.registerMarqueeSelection(board, () => Array.from(board.querySelectorAll<HTMLElement>('.dp-kanban-card')));
    }

    /** Board card drag: a selected card carries every selected card (all of them dim); others go alone */
    startBoardCardDrag(e: DragEvent, task: TaskItem, card: HTMLElement) {
        if (!e.dataTransfer) return;
        const ids = this.selectedTaskIds.has(task.id)
            ? this.tasks.filter(t => this.selectedTaskIds.has(t.id)).map(t => t.id)
            : [task.id];
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.setData(BOARD_DRAG_MIME, JSON.stringify(ids));
        const board = card.closest('.dp-kanban-board') ?? card;
        const moving = new Set(ids);
        board.querySelectorAll<HTMLElement>('.dp-kanban-card').forEach(el => {
            if (moving.has(el.dataset.taskId ?? '')) el.style.opacity = '0.4';
        });
    }

    endBoardCardDrag(card: HTMLElement) {
        (card.closest('.dp-kanban-board') ?? card).querySelectorAll<HTMLElement>('.dp-kanban-card').forEach(el => { el.style.opacity = ''; });
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
            attr: { title: t('board.kanbanTitle'), 'aria-label': t('board.kanban') }
        });
        // Obsidian Tasks signifiers: ⏳ scheduled, ⏫ priority, 📅 due (the name unfolds on hover, see styles)
        kanbanToggle.createSpan({ cls: 'dp-btn-icon', text: '⏳' });
        kanbanToggle.createSpan({ cls: 'dp-btn-label', text: t('board.kanban') });
        const priorityToggle = toggleRow.createEl('button', {
            cls: `dp-board-toggle-btn ${this.kanbanViewMode === 'priority' ? 'active' : ''}`,
            attr: { title: t('board.priorityTitle'), 'aria-label': t('common.priority') }
        });
        priorityToggle.createSpan({ cls: 'dp-btn-icon', text: '⏫' });
        priorityToggle.createSpan({ cls: 'dp-btn-label', text: t('common.priority') });
        const deadlineToggle = toggleRow.createEl('button', {
            cls: `dp-board-toggle-btn ${this.kanbanViewMode === 'deadline' ? 'active' : ''}`,
            attr: { title: t('board.deadlineTitle'), 'aria-label': t('board.deadline') }
        });
        deadlineToggle.createSpan({ cls: 'dp-btn-icon', text: '📅' });
        deadlineToggle.createSpan({ cls: 'dp-btn-label', text: t('board.deadline') });

        kanbanToggle.addEventListener('click', () => this.switchBoardMode('kanban'));
        priorityToggle.addEventListener('click', () => this.switchBoardMode('priority'));
        deadlineToggle.addEventListener('click', () => this.switchBoardMode('deadline'));
    }

    /** Board: switch between the Scheduled, Priority and Deadline layouts (header toggle, or j / k on desktop) */
    switchBoardMode(mode: BoardMode) {
        if (this.kanbanViewMode === mode) return;
        triggerHaptic('selection');
        const from = BOARD_MODES.indexOf(this.kanbanViewMode);
        this.kanbanViewMode = mode;
        if ((this as any).updateCodeBlockInFile) void (this as any).updateCodeBlockInFile((this as any).viewType, (this as any).filters);
        // The new board slides in from the side of its tab: a tab to the right → from the right
        this.navDirection = BOARD_MODES.indexOf(mode) > from ? 'next' : 'prev';
        try {
            this.render();
        } finally {
            this.navDirection = null; // only this render animates, not later data refreshes
        }
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
        const open = (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-';

        const columns = [
            { id: 'undated', title: t('board.undated'), filter: (t: TaskItem) => open(t) && t.date === null },
            { id: 'overdue', title: t('board.overdue'), filter: (t: TaskItem) => open(t) && t.date !== null && t.date < todayStr },
            { id: 'today', title: t('common.today'), filter: (t: TaskItem) => open(t) && t.date === todayStr },
            { id: 'tomorrow', title: t('common.tomorrow'), filter: (t: TaskItem) => open(t) && t.date === tomorrowStr },
            { id: 'future', title: t('board.future'), filter: (t: TaskItem) => open(t) && t.date !== null && t.date > tomorrowStr },
            { id: 'completed', title: t('board.completed'), filter: (t: TaskItem) => !open(t) }
        ];
        // Each column's tasks once, for its count in the phone switcher and for its cards
        const tasksOf = new Map(columns.map(col => [col.id, this.tasks.filter(col.filter).sort(compareTasks)]));
        this.pickPhoneBoardColumns(board, columns, col => tasksOf.get(col.id)!.length)
            .forEach(col => this.renderBoardColumn(board, col, tasksOf.get(col.id)!, 'kanban'));
    }

    /**
     * One Board column: fold chevron, title and count over its cards (a folded column is a slim vertical strip; the
     * phone layout never folds). Cards and drawer tasks dropped on it go to dropTasksOnBoardColumn under the column id.
     */
    protected renderBoardColumn(board: HTMLDivElement, col: { id: string; title: string }, colTasks: TaskItem[], variant: 'kanban' | 'priority') {
        const colEl = board.createDiv({ cls: 'dp-kanban-column' });
        colEl.setAttribute('data-col-id', col.id);
        colEl.dataset.colTitle = col.title; // Notices of touch drops name the column

        const isCollapsed = !this.useCompactLayout() && this.collapsedColumns.has(col.id);
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

        // Fold chevron on the far left, before the title (tree / accordion convention)
        const toggleBtn = header.createSpan({
            cls: 'dp-kanban-col-toggle',
            attr: { role: 'button', 'aria-label': isCollapsed ? 'Expand column' : 'Collapse column' }
        });
        setIcon(toggleBtn, isCollapsed ? 'chevron-right' : 'chevron-down');
        toggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isCollapsed) this.collapsedColumns.delete(col.id);
            else this.collapsedColumns.add(col.id);
            if ((this as any).updateCodeBlockInFile) {
                (this as any).debouncedUpdateCodeBlock?.((this as any).viewType, (this as any).filters); // a code block keeps it in its source
            } else {
                this.plugin.settings.collapsedColumns = Array.from(this.collapsedColumns);
                await this.plugin.saveSettings();
            }
            this.render();
        });

        const titleSpan = header.createSpan({ cls: 'dp-kanban-col-title', text: col.title });
        if (isCollapsed) {
            titleSpan.style.writingMode = 'vertical-lr';
            titleSpan.style.textOrientation = 'mixed';
            titleSpan.style.transform = 'rotate(180deg)';
            titleSpan.style.whiteSpace = 'nowrap';
        }
        header.createSpan({ cls: 'dp-kanban-col-count', text: String(colTasks.length) });

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
            colTasks.forEach(task => this.renderBoardCard(cardsWrapper, task, variant));
        }

        // Native Board card drags (code blocks; leaf views drag cards with pointer events)
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
            const ids = readDraggedTaskIds(e.dataTransfer);
            const dropped = this.tasks.filter(t => ids.includes(t.id));
            if (dropped.length > 0) await this.dropTasksOnBoardColumn(dropped, col.id, col.title);
        });
    }

    /**
     * One Board card: checkbox, title and ↗, then the note, time, date and status badges. The Kanban board also shows
     * the priority (the Priority board's column already says it) and greys done / cancelled cards.
     */
    protected renderBoardCard(cardsWrapper: HTMLElement, task: TaskItem, variant: 'kanban' | 'priority') {
        let cardClass = 'dp-kanban-card';
        if (variant === 'priority') {
            if (task.statusChar === '/') cardClass += ' in-progress';
        } else if (task.statusChar === 'x') cardClass += ' completed';
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
        const titleSpan = leftPart.createSpan({ text: cleanTaskTextForDisplay(task.text) });
        titleSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

        const linkBtn = titleWrapper.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
        linkBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await openTaskInEditor(this.app, task);
        });

        const meta = card.createDiv({ cls: 'dp-kanban-card-meta' });
        meta.createDiv({ cls: 'dp-kanban-card-file', text: task.filePath });
        if (task.startTime) meta.createDiv({ cls: 'dp-badge dp-badge-time', text: `⏰ ${task.startTime}-${task.endTime}` });
        if (task.date) meta.createDiv({ cls: 'dp-badge dp-badge-date', text: `⏳ ${task.date}` });
        const due = task.statusChar !== 'x' && task.statusChar !== '-'
            ? dueChip(task, (window as any).moment().format('YYYY-MM-DD')) : null;
        if (due) meta.createDiv({ cls: `dp-badge dp-due-chip${due.urgent ? ' is-urgent' : ''}`, text: `📅 ${due.text}`, attr: { title: due.tooltip } });
        if (variant === 'priority') {
            if (task.statusChar === '/') meta.createDiv({ cls: 'dp-badge', text: `${t('status.inProgress')} ⚡` });
        } else {
            if (task.priority !== 'normal') {
                meta.createDiv({ cls: 'dp-badge dp-badge-priority', text: `${BOARD_PRIORITY_LABEL[task.priority]} ${PRIORITY_EMOJI[task.priority]}` });
            }
            if (task.statusChar !== ' ' && task.statusChar !== 'x') {
                const statusLabels: Record<string, string> = { '/': 'In Progress', '-': 'Cancelled' };
                meta.createDiv({ cls: 'dp-badge', text: statusLabels[task.statusChar] || task.statusChar });
            }
        }

        card.addEventListener('click', (e) => {
            if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
            this.openTaskEditor(task);
        });
        card.addEventListener('dragstart', (e) => this.startBoardCardDrag(e, task, card));
        this.registerMouseDrag(card, { kind: 'task', task, origin: 'board' }); // the planner's drag (chip, drop highlights), not the browser's
        card.addEventListener('dragend', () => this.endBoardCardDrag(card));
    }

    /**
     * A task dropped on a board column: Kanban columns set its date (relative to the real today) or complete it;
     * Priority Focus columns set its priority. Native drags between columns and pointer drags from the drawer land here.
     */
    async dropTasksOnBoardColumn(tasks: TaskItem[], colId: string, colTitle = colId) {
        let updatesFor: (task: TaskItem) => TaskUpdates | null;
        if (this.kanbanViewMode === 'priority') {
            const priority = colId as TaskItem['priority'];
            updatesFor = task => task.priority === priority ? null : { priority };
        } else if (this.kanbanViewMode === 'deadline') {
            const todayStr = (window as any).moment().format('YYYY-MM-DD');
            const nowHHmm = (window as any).moment().format('HH:mm');
            const reopen =(task: TaskItem) => task.statusChar === 'x' || task.statusChar === '-' ? ' ' : task.statusChar;
            switch (colId) {
                // A task placed by its 📅 alone keeps its calendar day: the date becomes its ⏳
                case 'noDeadline': updatesFor = task => task.dueDate === null && reopen(task) === task.statusChar ? null
                    : { dueDate: null, scheduledDate: task.scheduledDate ?? task.dueDate, statusChar: reopen(task) }; break;
                // A due time already past today is dropped, or the card would land straight in Missed
                case 'dueToday': updatesFor = task => task.dueDate === todayStr && !isDeadlineMissed(task) && reopen(task) === task.statusChar ? null
                    : { dueDate: todayStr, dueTime: task.dueTime && task.dueTime < nowHHmm ? null : task.dueTime, statusChar: reopen(task) }; break;
                case 'completed': updatesFor = task => task.statusChar === 'x' ? null : { statusChar: 'x' }; break;
                default:
                    new Notice(t('board.deadlineDropBlocked'));
                    return;
            }
        } else {
            const referenceDate = (window as any).moment().startOf('day');
            let date: string | null | undefined;
            switch (colId) {
                case 'undated': date = null; break;
                case 'overdue': date = referenceDate.clone().subtract(1, 'day').format('YYYY-MM-DD'); break;
                case 'today': date = referenceDate.format('YYYY-MM-DD'); break;
                case 'tomorrow': date = referenceDate.clone().add(1, 'day').format('YYYY-MM-DD'); break;
                case 'future': date = referenceDate.clone().add(3, 'days').format('YYYY-MM-DD'); break;
                case 'completed': break;
                default: return;
            }
            updatesFor = task => colId === 'completed'
                ? (task.statusChar === 'x' ? null : { statusChar: 'x' })
                : { date, statusChar: task.statusChar === 'x' || task.statusChar === '-' ? ' ' : task.statusChar };
        }
        const moving = tasks.filter(task => updatesFor(task) !== null);
        if (moving.length === 0) return;
        const changed = await updateTasksInFile(this.app, moving, task => updatesFor(task)!,
            n => `Moved ${n} tasks to '${colTitle}'.`);
        if (changed === 0) return;
        if (moving.length === 1) new Notice(`Moved task to '${colTitle}'.`); // a batch says so in its Undo notice
        this.selectedTaskIds.clear();
        await this.refreshTasks();
    }

    /**
     * 4-B. 우선순위 포커스 보드 뷰
     */
    renderPriorityFocusBoard(board: HTMLDivElement) {
        const columns = (['highest', 'high', 'medium', 'normal', 'low', 'lowest'] as const).map(priority => ({
            id: priority,
            title: `${t(`priority.${priority}` as TranslationKey)} ${PRIORITY_EMOJI[priority] ?? '🟢'}`
        }));
        // Open tasks (to do / in progress) of each priority, once
        const tasksOf = new Map(columns.map(col => [col.id, this.tasks
            .filter(t => (t.statusChar === ' ' || t.statusChar === '/') && t.priority === col.id)
            .sort(compareTasks)]));
        this.pickPhoneBoardColumns(board, columns, col => tasksOf.get(col.id)!.length)
            .forEach(col => this.renderBoardColumn(board, col, tasksOf.get(col.id)!, 'priority'));
    }

    /**
     * 4-C. Deadline board: open tasks by their 📅 due date, relative to the real today. Drops only on No Deadline,
     * Today and Completed (see dropTasksOnBoardColumn); an exact later date is set in the task editor.
     */
    renderDeadlineBoard(board: HTMLDivElement) {
        const referenceDate = (window as any).moment().startOf('day');
        const todayStr = referenceDate.format('YYYY-MM-DD');
        const weekStr = referenceDate.clone().add(7, 'days').format('YYYY-MM-DD');
        const open = (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-';

        const columns = [
            { id: 'noDeadline', title: t('board.noDeadline'), filter: (t: TaskItem) => open(t) && t.dueDate === null },
            { id: 'missed', title: t('board.missed'), filter: (t: TaskItem) => open(t) && isDeadlineMissed(t) },
            { id: 'dueToday', title: t('common.today'), filter: (t: TaskItem) => open(t) && t.dueDate === todayStr && !isDeadlineMissed(t) },
            { id: 'dueNext7', title: t('board.next7Days'), filter: (t: TaskItem) => open(t) && t.dueDate !== null && t.dueDate > todayStr && t.dueDate <= weekStr },
            { id: 'dueLater', title: t('board.later'), filter: (t: TaskItem) => open(t) && t.dueDate !== null && t.dueDate > weekStr },
            { id: 'completed', title: t('board.completed'), filter: (t: TaskItem) => !open(t) }
        ];
        const tasksOf = new Map(columns.map(col => {
            const colTasks = this.tasks.filter(col.filter);
            return [col.id, col.id === 'noDeadline' || col.id === 'completed' ? colTasks.sort(compareTasks) : sortByDueDate(colTasks)];
        }));
        this.pickPhoneBoardColumns(board, columns, col => tasksOf.get(col.id)!.length)
            .forEach(col => this.renderBoardColumn(board, col, tasksOf.get(col.id)!, 'kanban'));
    }
}
