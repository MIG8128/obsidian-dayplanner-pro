import { Modal, App, Notice, Setting, setIcon } from 'obsidian';
import { TaskItem, GCalEvent } from './types';
import { openTaskInEditor, cleanTaskTextForDisplay, MotionOrigin, takePressOrigin, popIn, popOut, fadeAlong } from './utils';
import { createGoogleCalendarEvent, updateGoogleCalendarEvent, syncAllTasksToGCal } from './gcalApi';
import DayPlannerPlugin from './main';
import { showGCalEventUndoNotice, deletePlannerItems, getPlannerPlugin, isTypingContext } from './views';
import { t } from './i18n';
import { getReleaseNotes, ReleaseNoteItem } from './releaseNotes';
import { parseSmartEntry } from './smartEntry';
import { GlassSegmented } from './glassSegmented';
import { renderSmartPreview } from './drawer';

/**
 * Base of every planner modal (motion standard, types.ts MOTION): opened from a task / event card it morphs out of
 * that card's own box, and on closing (Esc, the backdrop, Save, Cancel) morphs back into the card, wherever it was
 * redrawn; opened from a button it grows out of the button; by a hotkey or command, from / to the centre. The dimmed
 * backdrop fades along. onClose runs once the shrink ends.
 */
export class PlannerModal extends Modal {
    private motionOrigin: MotionOrigin | null = null;
    private closing = false;

    open() {
        this.closing = false;
        this.motionOrigin = takePressOrigin();
        super.open();
        popIn(this.modalEl, this.motionOrigin);
        const backdrop = this.containerEl.querySelector<HTMLElement>(':scope > .modal-bg');
        if (backdrop) fadeAlong(backdrop, true);
    }

    close() {
        if (this.closing) return;
        this.closing = true;
        const backdrop = this.containerEl.querySelector<HTMLElement>(':scope > .modal-bg');
        if (backdrop) fadeAlong(backdrop, false);
        popOut(this.modalEl, this.motionOrigin, () => super.close());
    }
}

/**
 * Footer shared by every planner modal: actions on the item itself (Delete, Duplicate) at the start, the dialog's
 * own actions (Cancel, then the primary one at the outer edge) at the end. One button size for all (styles.ts).
 */
function createModalFooter(parent: HTMLElement): { start: HTMLElement; end: HTMLElement } {
    const footer = parent.createDiv({ cls: 'dp-modal-buttons' });
    return {
        start: footer.createDiv({ cls: 'dp-modal-actions-start' }),
        end: footer.createDiv({ cls: 'dp-modal-actions-end' })
    };
}

/** primary: accent fill · secondary: neutral glass · danger: red-tinted glass */
function createModalButton(parent: HTMLElement, text: string, variant: 'primary' | 'secondary' | 'danger', icon?: string): HTMLButtonElement {
    const btn = parent.createEl('button', { cls: `dp-modal-btn is-${variant}` });
    if (icon) setIcon(btn.createSpan({ cls: 'dp-modal-btn-icon' }), icon);
    btn.createSpan({ cls: 'dp-modal-btn-label', text });
    return btn;
}

/**
 * Delete / Backspace in an edit modal asks to delete its item (the same confirm as the Delete button). Never while
 * typing: a focused input / textarea / select or an IME composition keeps the key for editing text.
 */
function registerDeleteShortcut(modal: Modal, requestDelete: () => void) {
    const handler = (e: KeyboardEvent) => {
        if (isTypingContext(e)) return true;
        e.preventDefault();
        requestDelete();
        return false;
    };
    modal.scope.register([], 'Delete', handler);
    modal.scope.register([], 'Backspace', handler);
}

export class TaskEditModal extends PlannerModal {
    task: TaskItem | null;
    app: App;
    onSave: (data: {
        text: string;
        statusChar: string;
        priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest';
        date: string | null;
        startTime: string | null;
        endTime: string | null;
        recurrence: string | null;
        dueDate: string | null;
        dueTime: string | null;
        scheduledDate: string | null;
        startDate: string | null;
        completionDate: string | null;
        cancelledDate: string | null;
    }) => void;
    defaultDate: string | null;
    defaultStartTime: string | null;
    defaultEndTime: string | null;

    constructor(
        app: App,
        task: TaskItem | null,
        defaultDate: string | null,
        onSave: (data: {
            text: string;
            statusChar: string;
            priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest';
            date: string | null;
            startTime: string | null;
            endTime: string | null;
            recurrence: string | null;
            dueDate: string | null;
            dueTime: string | null;
            scheduledDate: string | null;
            startDate: string | null;
            completionDate: string | null;
            cancelledDate: string | null;
        }) => void,
        defaultStartTime: string | null = null,
        defaultEndTime: string | null = null
    ) {
        super(app);
        this.app = app;
        this.task = task;
        this.defaultDate = defaultDate;
        this.onSave = onSave;
        this.defaultStartTime = defaultStartTime;
        this.defaultEndTime = defaultEndTime;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.addClass('dp-task-modal');

        const modalHeader = contentEl.createDiv({ cls: 'dp-modal-header' });
        modalHeader.createEl('h2', { text: t('taskModal.title') });

        // The main ⏳ Date and the Tasks section's ⏳ Scheduled are one value (a 📅-only task opens with both empty)
        const scheduled = this.task ? this.task.scheduledDate : (this.defaultDate || null);
        const formState = {
            text: this.task ? this.task.text : '',
            statusChar: this.task ? this.task.statusChar : ' ',
            priority: this.task ? this.task.priority : 'normal',
            date: scheduled,
            startTime: this.task ? this.task.startTime : (this.defaultStartTime || ''),
            endTime: this.task ? this.task.endTime : (this.defaultEndTime || ''),
            filePath: this.task ? this.task.filePath : 'Day Planner.md',
            recurrence: this.task ? this.task.recurrence : null,
            dueDate: this.task ? this.task.dueDate : null,
            dueTime: this.task ? this.task.dueTime ?? null : null,
            scheduledDate: scheduled,
            startDate: this.task ? this.task.startDate : null,
            completionDate: this.task ? this.task.completionDate : null,
            cancelledDate: this.task ? this.task.cancelledDate : null
        };

        const form = contentEl.createDiv({ cls: 'dp-modal-form' });

        // 1. Description (설명) 영역
        const descRow = form.createDiv({ cls: 'dp-modal-row' });
        descRow.createEl('label', { text: t('common.description'), cls: 'dp-modal-row-label' });
        const textarea = descRow.createEl('textarea', {
            cls: 'dp-modal-textarea',
            placeholder: t('taskModal.descPlaceholder')
        });
        textarea.value = formState.text;
        textarea.addEventListener('input', () => { formState.text = textarea.value; });

        // New tasks: the description is read like quick capture ("Report fri 3pm 1h !high"); the recognized parts
        // show under it, and Apply (or Save) moves them into the fields below
        let applySmart: (() => void) | null = null;
        if (!this.task) {
            const smartRow = descRow.createDiv({ cls: 'dp-smart-row is-empty' });
            const preview = smartRow.createDiv({ cls: 'dp-smart-preview' });
            const applyBtn = smartRow.createEl('button', {
                cls: 'dp-smart-apply',
                text: t('smart.apply'),
                attr: { type: 'button', title: t('smart.applyTooltip') }
            });
            const defaultDuration = getPlannerPlugin(this.app)?.settings.defaultTaskDuration || 60;
            const parse = () => parseSmartEntry(textarea.value, { defaultDuration });
            const update = () => {
                const entry = parse();
                renderSmartPreview(preview, entry);
                smartRow.toggleClass('is-empty', !entry.recognized);
            };
            applySmart = () => {
                const entry = parse();
                if (!entry.recognized) return;
                textarea.value = formState.text = entry.text;
                formState.priority = entry.priority;
                prioritySelect.value = entry.priority;
                if (entry.date) {
                    formState.date = formState.scheduledDate = entry.date;
                    dateInput.value = schedInput.value = entry.date;
                }
                if (entry.startTime && entry.endTime) {
                    formState.startTime = startTimeInput.value = entry.startTime;
                    formState.endTime = endTimeInput.value = entry.endTime;
                }
                if (entry.dueDate) {
                    formState.dueDate = dueInput.value = entry.dueDate;
                    formState.dueTime = entry.dueTime;
                    dueTimeInput.value = entry.dueTime ?? '';
                    dueTimeInput.disabled = false;
                    tasksSection.open = true;
                }
                update();
            };
            textarea.addEventListener('input', update);
            applyBtn.addEventListener('click', (e) => {
                e.preventDefault();
                applySmart?.();
                textarea.focus();
            });
        }

        // 2. Task File Location (파일 위치) 영역
        const fileRow = form.createDiv({ cls: 'dp-modal-row' });
        fileRow.createEl('label', { text: t('taskModal.fileLocation'), cls: 'dp-modal-row-label' });
        const fileFlex = fileRow.createDiv({ cls: 'dp-modal-file-row' });

        const fileInput = fileFlex.createEl('input', {
            type: 'text',
            cls: 'dp-modal-file-input',
            value: formState.filePath
        });
        fileInput.disabled = true;

        const openBtn = createModalButton(fileFlex, t('taskModal.openInFile'), 'secondary');
        openBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (this.task) {
                await openTaskInEditor(this.app, this.task);
                this.close();
            } else {
                new Notice(t('taskModal.notInFile'));
            }
        });

        // 3. Priority (중요도 선택) 영역 - [Dropdown 형태로 컴팩트하게 구성]
        const priorityRow = form.createDiv({ cls: 'dp-modal-row' });
        priorityRow.createEl('label', { text: t('common.priority'), cls: 'dp-modal-row-label' });
        const prioritySelect = priorityRow.createEl('select', { cls: 'dp-modal-select' });
        const priorityOptions = [
            { value: 'lowest', label: `${t('priority.lowest')} ⏬` },
            { value: 'low', label: `${t('priority.low')} 🔽` },
            { value: 'normal', label: `${t('priority.normal')} 🟢` },
            { value: 'medium', label: `${t('priority.medium')} 🔼` },
            { value: 'high', label: `${t('priority.high')} ⏫` },
            { value: 'highest', label: `${t('priority.highest')} 🔺` }
        ];
        priorityOptions.forEach(opt => {
            const op = prioritySelect.createEl('option', { value: opt.value, text: opt.label });
            if (opt.value === formState.priority) op.selected = true;
        });
        prioritySelect.addEventListener('change', () => {
            formState.priority = prioritySelect.value as any;
        });

        // 4 & 5. Status (진행 상태) & Date (날짜 선택) 영역 (나란히 배치)
        const statusDateGrid = form.createDiv({ cls: 'dp-modal-grid' });

        const statusRow = statusDateGrid.createDiv({ cls: 'dp-modal-row' });
        statusRow.createEl('label', { text: t('common.status'), cls: 'dp-modal-row-label' });
        const statusSelect = statusRow.createEl('select', { cls: 'dp-modal-select' });
        const statusOptions = [
            { value: ' ', label: `${t('status.todo')} [ ]` },
            { value: '/', label: `${t('status.inProgress')} [/]` },
            { value: 'x', label: `${t('status.done')} [x]` },
            { value: '-', label: `${t('status.cancelled')} [-]` }
        ];
        statusOptions.forEach(opt => {
            const op = statusSelect.createEl('option', { value: opt.value, text: opt.label });
            if (opt.value === formState.statusChar) op.selected = true;
        });
        statusSelect.addEventListener('change', () => {
            formState.statusChar = statusSelect.value;
        });

        const dateRow = statusDateGrid.createDiv({ cls: 'dp-modal-row' });
        dateRow.createEl('label', { text: `⏳ ${t('taskModal.date')}`, cls: 'dp-modal-row-label' });
        const dateInput = dateRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        dateInput.value = formState.date || '';
        dateInput.addEventListener('change', () => {
            formState.date = formState.scheduledDate = dateInput.value || null;
            schedInput.value = dateInput.value;
        });

        // 6 & 7. Start Time & End Time (나란히 배치)
        const timesGrid = form.createDiv({ cls: 'dp-modal-grid' });

        const startTimeRow = timesGrid.createDiv({ cls: 'dp-modal-row' });
        startTimeRow.createEl('label', { text: `⏰ ${t('common.startTime')}`, cls: 'dp-modal-row-label' });
        const startTimeInput = startTimeRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        startTimeInput.value = formState.startTime || '';
        startTimeInput.addEventListener('change', () => {
            formState.startTime = startTimeInput.value || null;
        });

        const endTimeRow = timesGrid.createDiv({ cls: 'dp-modal-row' });
        endTimeRow.createEl('label', { text: `🕒 ${t('common.endTime')}`, cls: 'dp-modal-row-label' });
        const endTimeInput = endTimeRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        endTimeInput.value = formState.endTime || '';
        endTimeInput.addEventListener('change', () => {
            formState.endTime = endTimeInput.value || null;
        });

        // [Tasks 호환 UI]: Tasks 플러그인 연동 전용 그룹 섹션 (Collapsible details element)
        const tasksSection = form.createEl('details', { cls: 'dp-modal-tasks-section' });
        tasksSection.createEl('summary', { text: t('taskModal.tasksCompat') });

        // 반복 주기 + 날짜 5종을 하나의 2열 그리드로 구성 (3행)
        const datesGrid = tasksSection.createDiv({ cls: 'dp-modal-grid' });

        // 1) 반복 주기 (Recurrence 🔁)
        const recurRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        recurRow.createEl('label', { text: `🔁 ${t('taskModal.recurrence')}`, cls: 'dp-modal-row-label' });
        const recurInput = recurRow.createEl('input', {
            type: 'text',
            cls: 'dp-modal-input',
            placeholder: t('taskModal.recurrencePlaceholder')
        });
        recurInput.value = formState.recurrence || '';
        recurInput.addEventListener('input', () => {
            formState.recurrence = recurInput.value || null;
        });

        // 예정일 (Scheduled Date ⏳)
        const schedRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        schedRow.createEl('label', { text: `⏳ ${t('taskModal.scheduled')}`, cls: 'dp-modal-row-label' });
        const schedInput = schedRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        schedInput.value = formState.scheduledDate || '';
        schedInput.addEventListener('change', () => {
            formState.scheduledDate = formState.date = schedInput.value || null;
            dateInput.value = schedInput.value;
        });

        // 마감일 (Due Date 📅) + optional deadline time ([dueTime:: HH:mm]); the time needs a date to apply
        const dueRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        dueRow.createEl('label', { text: `📅 ${t('taskModal.due')}`, cls: 'dp-modal-row-label' });
        const dueInputs = dueRow.createDiv({ cls: 'dp-modal-due-inputs' });
        const dueInput = dueInputs.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        dueInput.value = formState.dueDate || '';
        const dueTimeInput = dueInputs.createEl('input', { type: 'time', cls: 'dp-modal-input', attr: { 'aria-label': t('taskModal.dueTime'), title: t('taskModal.dueTime') } });
        dueTimeInput.value = formState.dueTime || '';
        dueTimeInput.disabled = !formState.dueDate;
        dueInput.addEventListener('change', () => {
            formState.dueDate = dueInput.value || null;
            dueTimeInput.disabled = !formState.dueDate;
        });
        dueTimeInput.addEventListener('change', () => {
            formState.dueTime = dueTimeInput.value || null;
        });
        // A task with a deadline opens with this section unfolded
        if (formState.dueDate) tasksSection.open = true;

        // 시작일 (Start Date 🛫)
        const startDRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        startDRow.createEl('label', { text: `🛫 ${t('common.startDate')}`, cls: 'dp-modal-row-label' });
        const startDInput = startDRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        startDInput.value = formState.startDate || '';
        startDInput.addEventListener('change', () => {
            formState.startDate = startDInput.value || null;
        });

        // 완료일 (Completion Date ✅)
        const compDRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        compDRow.createEl('label', { text: `✅ ${t('taskModal.completion')}`, cls: 'dp-modal-row-label' });
        const compDInput = compDRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        compDInput.value = formState.completionDate || '';
        compDInput.addEventListener('change', () => {
            formState.completionDate = compDInput.value || null;
        });

        // 취소일 (Cancelled Date ❌)
        const cancelDRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        cancelDRow.createEl('label', { text: `❌ ${t('taskModal.cancelledDate')}`, cls: 'dp-modal-row-label' });
        const cancelDInput = cancelDRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        cancelDInput.value = formState.cancelledDate || '';
        cancelDInput.addEventListener('change', () => {
            formState.cancelledDate = cancelDInput.value || null;
        });

        // 하단 조작 버튼 그룹
        const footer = createModalFooter(form);

        // Existing tasks only: confirm, then remove the line (one Undo in the notice), like Delete on a selection
        const task = this.task;
        const plugin = getPlannerPlugin(this.app);
        if (task && plugin) {
            const requestDelete = () => {
                new DeleteConfirmModal(this.app, [{ kind: 'task', title: cleanTaskTextForDisplay(task.text) }], () => {
                    this.close();
                    void deletePlannerItems(plugin, [task]);
                }).open();
            };
            const deleteBtn = createModalButton(footer.start, t('common.delete'), 'danger', 'trash-2');
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                requestDelete();
            });
            registerDeleteShortcut(this, requestDelete);
        }

        const cancelBtn = createModalButton(footer.end, t('common.cancel'), 'secondary');
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
        });

        const saveBtn = createModalButton(footer.end, t('common.save'), 'primary');
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            applySmart?.(); // words not applied yet still set the fields
            if (!formState.text.trim()) {
                new Notice(t('taskModal.emptyText'));
                return;
            }
            this.onSave(formState as any);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class GCalEventEditModal extends PlannerModal {
    plugin: DayPlannerPlugin;
    event: GCalEvent | null; // null이면 새 일정 생성
    defaultDate: string;
    defaultStartTime: string | null;
    defaultEndTime: string | null;
    onSave: () => void;

    constructor(
        app: App,
        plugin: DayPlannerPlugin,
        event: GCalEvent | null,
        defaultDate: string,
        onSave: () => void,
        defaultStartTime: string | null = null,
        defaultEndTime: string | null = null
    ) {
        super(app);
        this.plugin = plugin;
        this.event = event;
        this.defaultDate = defaultDate;
        this.onSave = onSave;
        this.defaultStartTime = defaultStartTime;
        this.defaultEndTime = defaultEndTime;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dp-task-modal');
        if (this.event?.readOnly) {
            this.renderReadOnly(this.event);
            return;
        }

        const modalHeader = contentEl.createDiv({ cls: 'dp-modal-header' });
        modalHeader.createEl('h2', {
            text: this.event ? 'Edit Google Calendar Event' : 'Create Google Calendar Event'
        });

        let initEndDate = this.defaultDate;
        if (this.event) {
            const moment = (window as any).moment;
            if (this.event.isAllDay) {
                // Google Calendar's end date is exclusive, so we subtract 1 day for user-facing end date
                initEndDate = moment(this.event.end, 'YYYY-MM-DD').subtract(1, 'day').format('YYYY-MM-DD');
            } else {
                initEndDate = moment(this.event.end).format('YYYY-MM-DD');
            }
        }

        const formState = {
            summary: this.event ? this.event.summary : '',
            calendarId: this.event ? this.event.calendarId : (this.plugin.settings.googleCalendars.filter(c => c.enabled)[0]?.id || ''),
            dateStr: this.event ? this.event.dateStr : this.defaultDate,
            endDateStr: initEndDate,
            startTimeStr: this.event ? this.event.startTimeStr : (this.defaultStartTime || '09:00'),
            endTimeStr: this.event ? this.event.endTimeStr : (this.defaultEndTime || '10:00'),
            isAllDay: this.event ? this.event.isAllDay : false,
            location: this.event ? this.event.location || '' : '',
            description: this.event ? this.event.description || '' : ''
        };

        const form = contentEl.createDiv({ cls: 'dp-modal-form' });

        const summaryRow = form.createDiv({ cls: 'dp-modal-row' });
        summaryRow.createEl('label', { text: t('eventModal.summary'), cls: 'dp-modal-row-label' });
        const summaryInput = summaryRow.createEl('input', { type: 'text', cls: 'dp-modal-input', placeholder: t('eventModal.summaryPlaceholder') });
        summaryInput.value = formState.summary;
        summaryInput.addEventListener('input', () => { formState.summary = summaryInput.value; });

        // 캘린더 선택/표시 + All Day 체크박스를 한 줄에 배치
        const optionsRow = form.createDiv({ cls: 'dp-modal-options-row' });
        const calRow = optionsRow.createDiv({ cls: 'dp-modal-row' });

        if (!this.event) {
            calRow.createEl('label', { text: t('eventModal.targetCalendar'), cls: 'dp-modal-row-label' });
            const calSelect = calRow.createEl('select', { cls: 'dp-modal-select' });
            this.plugin.settings.googleCalendars.filter(c => c.enabled).forEach(cal => {
                const opt = calSelect.createEl('option', { value: cal.id, text: cal.name });
                if (cal.id === formState.calendarId) opt.selected = true;
            });
            calSelect.addEventListener('change', () => {
                formState.calendarId = calSelect.value;
            });
        } else {
            calRow.createEl('label', { text: t('eventModal.calendar'), cls: 'dp-modal-row-label' });
            const calName = this.plugin.settings.googleCalendars.find(c => c.id === formState.calendarId)?.name || 'Google Calendar';
            calRow.createDiv({ text: calName, cls: 'dp-modal-static-value' });
        }

        const allDayLabel = optionsRow.createEl('label', { cls: 'dp-modal-checkbox' });
        const allDayCheckbox = allDayLabel.createEl('input', { type: 'checkbox' });
        allDayCheckbox.checked = formState.isAllDay;
        allDayLabel.createSpan({ text: t('common.allDay') });

        const dateRow = form.createDiv({ cls: 'dp-modal-grid' });

        const startDtRow = dateRow.createDiv({ cls: 'dp-modal-row' });
        startDtRow.createEl('label', { text: t('common.startDate'), cls: 'dp-modal-row-label' });
        const startDtInput = startDtRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        startDtInput.value = formState.dateStr;

        const endDtRow = dateRow.createDiv({ cls: 'dp-modal-row' });
        endDtRow.createEl('label', { text: t('common.endDate'), cls: 'dp-modal-row-label' });
        const endDtInput = endDtRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        endDtInput.value = formState.endDateStr;

        startDtInput.addEventListener('change', () => {
            formState.dateStr = startDtInput.value;
            if (formState.endDateStr < formState.dateStr) {
                formState.endDateStr = formState.dateStr;
                endDtInput.value = formState.endDateStr;
            }
        });

        endDtInput.addEventListener('change', () => {
            formState.endDateStr = endDtInput.value;
            if (formState.endDateStr < formState.dateStr) {
                formState.dateStr = formState.endDateStr;
                startDtInput.value = formState.dateStr;
            }
        });

        // All Day 전환 시 부드럽게 접히도록 collapse 래퍼 사용
        const timesCollapse = form.createDiv({ cls: 'dp-modal-collapse' });
        timesCollapse.toggleClass('is-collapsed', formState.isAllDay);
        const timesRow = timesCollapse.createDiv({ cls: 'dp-modal-grid' });

        const startRow = timesRow.createDiv({ cls: 'dp-modal-row' });
        startRow.createEl('label', { text: t('common.startTime'), cls: 'dp-modal-row-label' });
        const startInput = startRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        startInput.value = formState.startTimeStr || '09:00';
        startInput.addEventListener('change', () => { formState.startTimeStr = startInput.value; });

        const endRow = timesRow.createDiv({ cls: 'dp-modal-row' });
        endRow.createEl('label', { text: t('common.endTime'), cls: 'dp-modal-row-label' });
        const endInput = endRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        endInput.value = formState.endTimeStr || '10:00';
        endInput.addEventListener('change', () => { formState.endTimeStr = endInput.value; });

        allDayCheckbox.addEventListener('change', () => {
            formState.isAllDay = allDayCheckbox.checked;
            timesCollapse.toggleClass('is-collapsed', formState.isAllDay);
        });

        const locRow = form.createDiv({ cls: 'dp-modal-row' });
        locRow.createEl('label', { text: t('eventModal.location'), cls: 'dp-modal-row-label' });
        const locInput = locRow.createEl('input', { type: 'text', cls: 'dp-modal-input', placeholder: t('eventModal.locationPlaceholder') });
        locInput.value = formState.location;
        locInput.addEventListener('input', () => { formState.location = locInput.value; });

        const descRow = form.createDiv({ cls: 'dp-modal-row' });
        descRow.createEl('label', { text: t('common.description'), cls: 'dp-modal-row-label' });
        const descTextarea = descRow.createEl('textarea', { cls: 'dp-modal-textarea', placeholder: t('eventModal.descPlaceholder') });
        descTextarea.value = formState.description;
        descTextarea.addEventListener('input', () => { formState.description = descTextarea.value; });

        const footer = createModalFooter(form);
        if (this.event) {
            // Same pipeline as Delete on a timeline selection: confirm, close, delete, one notice with Undo
            const event = this.event;
            const requestDelete = () => {
                new DeleteConfirmModal(this.app, [{ kind: 'event', title: event.summary || '—' }], () => {
                    this.close();
                    void deletePlannerItems(this.plugin, [], [event]);
                }).open();
            };
            const deleteBtn = createModalButton(footer.start, t('common.delete'), 'danger', 'trash-2');
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                requestDelete();
            });
            registerDeleteShortcut(this, requestDelete);

            const duplicateBtn = createModalButton(footer.start, t('eventModal.duplicate'), 'secondary', 'copy');
            duplicateBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                if (await createGoogleCalendarEvent(this.plugin, formState.calendarId, {
                    summary: formState.summary + ' (Copy)',
                    description: formState.description,
                    location: formState.location,
                    dateStr: formState.dateStr,
                    endDateStr: formState.endDateStr,
                    startTimeStr: formState.startTimeStr,
                    endTimeStr: formState.endTimeStr,
                    isAllDay: formState.isAllDay
                })) {
                    new Notice(t('eventModal.duplicated'));
                    this.onSave();
                    this.close();
                }
            });
        }

        const cancelBtn = createModalButton(footer.end, t('common.cancel'), 'secondary');
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
        });

        const saveBtn = createModalButton(footer.end, this.event ? t('common.save') : t('common.create'), 'primary');
        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!formState.summary.trim()) {
                new Notice(t('eventModal.titleRequired'));
                return;
            }

            let success = false;
            if (this.event) {
                const previousState = {
                    summary: this.event.summary,
                    description: this.event.description || '',
                    location: this.event.location || '',
                    dateStr: this.event.dateStr,
                    endDateStr: this.event.isAllDay
                        ? (window as any).moment(this.event.end, 'YYYY-MM-DD').subtract(1, 'day').format('YYYY-MM-DD')
                        : (window as any).moment(this.event.end).format('YYYY-MM-DD'),
                    startTimeStr: this.event.startTimeStr,
                    endTimeStr: this.event.endTimeStr,
                    isAllDay: this.event.isAllDay
                };
                success = await updateGoogleCalendarEvent(this.plugin, formState.calendarId, this.event.id, {
                    summary: formState.summary,
                    description: formState.description,
                    location: formState.location,
                    dateStr: formState.dateStr,
                    endDateStr: formState.endDateStr,
                    startTimeStr: formState.startTimeStr,
                    endTimeStr: formState.endTimeStr,
                    isAllDay: formState.isAllDay
                });
                if (success) {
                    new Notice(t('eventModal.updated'));
                    showGCalEventUndoNotice(this.plugin, formState.calendarId, this.event.id, previousState);
                }
            } else {
                // Resolves to the new event id, or null on failure
                success = null !== await createGoogleCalendarEvent(this.plugin, formState.calendarId, {
                    summary: formState.summary,
                    description: formState.description,
                    location: formState.location,
                    dateStr: formState.dateStr,
                    endDateStr: formState.endDateStr,
                    startTimeStr: formState.startTimeStr,
                    endTimeStr: formState.endTimeStr,
                    isAllDay: formState.isAllDay
                });
                if (success) new Notice(t('eventModal.added'));
            }

            if (success) {
                this.onSave();
                this.close();
            }
        });
    }

    /** A subscribed (.ics) calendar's event: its details, nothing to edit */
    private renderReadOnly(event: GCalEvent) {
        const { contentEl } = this;
        const moment = (window as any).moment;
        contentEl.addClass('dp-event-readonly');
        contentEl.createDiv({ cls: 'dp-modal-header' }).createEl('h2', { text: event.summary });
        const source = contentEl.createDiv({ cls: 'dp-event-readonly-source' });
        source.createSpan({ cls: 'dp-event-readonly-dot' }).style.backgroundColor = event.color || '#4285f4';
        source.createSpan({ text: `${event.calendarName ?? ''} · ${t('ics.readOnly')}` });

        let when: string;
        if (event.isAllDay) {
            const start = moment(event.start, 'YYYY-MM-DD');
            const last = moment(event.end, 'YYYY-MM-DD').subtract(1, 'day');
            when = last.isAfter(start, 'day') ? `${start.format('ddd, MMM D')} – ${last.format('ddd, MMM D')}` : start.format('dddd, MMM D');
        } else {
            const start = moment(event.start), end = moment(event.end);
            when = start.isSame(end, 'day')
                ? `${start.format('ddd, MMM D')} · ${start.format('HH:mm')}–${end.format('HH:mm')}`
                : `${start.format('ddd, MMM D HH:mm')} – ${end.format('ddd, MMM D HH:mm')}`;
        }
        contentEl.createDiv({ cls: 'dp-event-readonly-when', text: `🕒 ${when}` });
        if (event.location) contentEl.createDiv({ cls: 'dp-event-readonly-meta', text: `📍 ${event.location}` });
        if (event.description) contentEl.createDiv({ cls: 'dp-event-readonly-desc', text: event.description });

        const footer = createModalFooter(contentEl);
        createModalButton(footer.end, t('common.close'), 'primary').addEventListener('click', () => this.close());
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class AddChoiceModal extends PlannerModal {
    onChoose: (choice: 'task' | 'appointment') => void;

    constructor(app: App, onChoose: (choice: 'task' | 'appointment') => void) {
        super(app);
        this.onChoose = onChoose;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        contentEl.style.padding = '24px';
        contentEl.style.maxWidth = '500px';

        const modalHeader = contentEl.createDiv();
        modalHeader.createEl('h2', {
            text: t('addChoice.title')
        });

        const choiceGrid = contentEl.createDiv({ cls: 'dp-modal-choice-grid' });

        // Choice 1: Task
        const taskCard = choiceGrid.createDiv({ cls: 'dp-modal-choice-card' });
        taskCard.createDiv({ text: '📝', cls: 'dp-modal-choice-icon' });
        taskCard.createDiv({ text: t('addChoice.task'), cls: 'dp-modal-choice-title' });
        taskCard.createDiv({ text: t('addChoice.taskDesc'), cls: 'dp-modal-choice-desc' });
        taskCard.addEventListener('click', () => {
            this.onChoose('task');
            this.close();
        });

        // Choice 2: Appointment
        const apptCard = choiceGrid.createDiv({ cls: 'dp-modal-choice-card' });
        apptCard.createDiv({ text: '📅', cls: 'dp-modal-choice-icon' });
        apptCard.createDiv({ text: t('addChoice.appointment'), cls: 'dp-modal-choice-title' });
        apptCard.createDiv({ text: t('addChoice.appointmentDesc'), cls: 'dp-modal-choice-desc' });
        apptCard.addEventListener('click', () => {
            this.onChoose('appointment');
            this.close();
        });

        const cancelBtn = createModalButton(createModalFooter(contentEl).end, t('common.cancel'), 'secondary');
        cancelBtn.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

/** A code block's visible timeline hours, picked from two hour lists (the end list only offers hours after the start) */
export class TimelineHoursModal extends PlannerModal {
    constructor(
        app: App,
        private range: { startHour: number; endHour: number },
        private onSave: (range: { startHour: number; endHour: number }) => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: t('hours.modalTitle') });
        const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
        let { startHour, endHour } = this.range;

        let endDropdown: { selectEl: HTMLSelectElement; setValue(v: string): unknown } | null = null;
        const fillEnd = () => {
            if (!endDropdown) return;
            endDropdown.selectEl.empty();
            for (let h = startHour + 1; h <= 24; h++) endDropdown.selectEl.createEl('option', { value: String(h), text: fmt(h) });
            if (endHour <= startHour) endHour = startHour + 1;
            endDropdown.setValue(String(endHour));
        };
        new Setting(contentEl).setName(t('common.startTime')).addDropdown(dropdown => {
            for (let h = 0; h < 24; h++) dropdown.addOption(String(h), fmt(h));
            dropdown.setValue(String(startHour)).onChange(value => {
                startHour = parseInt(value, 10);
                fillEnd();
            });
        });
        new Setting(contentEl).setName(t('common.endTime')).addDropdown(dropdown => {
            endDropdown = dropdown;
            fillEnd();
            dropdown.onChange(value => { endHour = parseInt(value, 10); });
        });

        const footer = createModalFooter(contentEl);
        const cancelBtn = createModalButton(footer.end, t('common.cancel'), 'secondary');
        cancelBtn.addEventListener('click', () => this.close());
        const saveBtn = createModalButton(footer.end, t('common.save'), 'primary');
        saveBtn.addEventListener('click', () => {
            this.close();
            this.onSave({ startHour, endHour });
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

/**
 * Confirms deleting the selected tasks / events (Delete or Backspace in a planner view) or an edit modal's item (its
 * Delete button or key). Enter deletes, Esc cancels;
 * the Delete button has focus, so Enter / Space on it work like any focused button too.
 */
export class DeleteConfirmModal extends PlannerModal {
    private confirmed = false;

    constructor(
        app: App,
        private items: Array<{ kind: 'task' | 'event'; title: string }>,
        private onConfirm: () => void
    ) {
        super(app);
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        modalEl.addClass('dp-delete-modal');
        contentEl.empty();
        const count = this.items.length;
        contentEl.createEl('h2', { text: count === 1 ? t('delete.titleOne') : t('delete.titleMany', { n: count }) });

        const list = contentEl.createDiv({ cls: 'dp-delete-list' });
        const SHOWN = 5;
        this.items.slice(0, SHOWN).forEach(item => {
            const row = list.createDiv({ cls: `dp-delete-item is-${item.kind}` });
            row.createSpan({ cls: 'dp-delete-item-icon', text: item.kind === 'task' ? '📝' : '📅' });
            row.createSpan({ cls: 'dp-delete-item-title', text: item.title });
        });
        if (count > SHOWN) list.createDiv({ cls: 'dp-delete-more', text: t('delete.more', { n: count - SHOWN }) });

        const notes = contentEl.createDiv({ cls: 'dp-delete-notes' });
        if (this.items.some(i => i.kind === 'task')) notes.createDiv({ text: t('delete.tasksNote') });
        if (this.items.some(i => i.kind === 'event')) notes.createDiv({ cls: 'mod-warning', text: t('delete.eventsNote') });

        const footer = createModalFooter(contentEl);
        const cancelBtn = createModalButton(footer.end, t('common.cancel'), 'secondary');
        cancelBtn.addEventListener('click', () => this.close());
        const deleteBtn = createModalButton(footer.end, t('common.delete'), 'danger', 'trash-2');
        deleteBtn.addEventListener('click', () => this.confirm());
        this.scope.register([], 'Enter', (e) => {
            e.preventDefault();
            if (document.activeElement === cancelBtn) this.close();
            else this.confirm();
            return false;
        });
        window.setTimeout(() => deleteBtn.focus(), 0);
    }

    private confirm() {
        if (this.confirmed) return;
        this.confirmed = true;
        this.close();
        this.onConfirm();
    }

    onClose() {
        this.contentEl.empty();
    }
}

/** Keyboard shortcut reference (`?`), frosted like the other planner modals */
/**
 * "What's New": one release's notes (releaseNotes.ts). Opens by itself once after an update (main.ts), and from the
 * command and the settings button. The title names the release the notes belong to.
 */
export type ReviewChoice = 'keep' | 'tomorrow' | 'unschedule' | 'done' | 'cancel';

/**
 * Review today (evening review): every task of today still open, each with a choice (keep, tomorrow, unschedule,
 * done, cancelled; "All:" sets every row). Nothing changes until Apply, which hands the choices back in one batch.
 */
export class DayReviewModal extends PlannerModal {
    private readonly choices = new Map<TaskItem, ReviewChoice>();

    constructor(app: App, private readonly tasks: TaskItem[], private readonly doneCount: number,
        private readonly onApply: (choices: Array<{ task: TaskItem; choice: ReviewChoice }>) => void,
        /** Set while today's daily note does not exist: opens (creates) it */
        private readonly writeNote: (() => void) | null = null) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('dp-task-modal', 'dp-review-modal');
        const header = contentEl.createDiv({ cls: 'dp-modal-header' });
        header.createEl('h2', { text: t('review.title') });
        header.createDiv({ cls: 'dp-review-summary', text: t('review.summary', { done: this.doneCount, open: this.tasks.length }) });

        if (this.writeNote) {
            const bar = contentEl.createDiv({ cls: 'dp-review-note-missing' });
            setIcon(bar.createSpan({ cls: 'dp-review-note-icon' }), 'notebook-pen');
            bar.createSpan({ cls: 'dp-review-note-text', text: t('review.noDailyNote') });
            const write = bar.createEl('button', { cls: 'dp-review-note-btn', text: t('review.writeDailyNote') });
            write.addEventListener('click', () => {
                this.close();
                this.writeNote!();
            });
        }

        if (this.tasks.length === 0) {
            contentEl.createDiv({ cls: 'dp-review-empty', text: t('review.allDone') });
            const footer = createModalFooter(contentEl);
            createModalButton(footer.end, t('common.close'), 'primary').addEventListener('click', () => this.close());
            return;
        }

        contentEl.createDiv({ cls: 'dp-review-hint', text: t('review.hint') });
        const options: Array<{ value: ReviewChoice; label: string }> = [
            { value: 'keep', label: t('review.keep') },
            { value: 'tomorrow', label: t('smart.tomorrow') },
            { value: 'unschedule', label: t('drawer.card.undate') },
            { value: 'done', label: t('status.done') },
            { value: 'cancel', label: t('status.cancelled') }
        ];

        const bulk = contentEl.createDiv({ cls: 'dp-review-bulk' });
        bulk.createSpan({ cls: 'dp-review-bulk-label', text: t('review.setAll') });
        const list = contentEl.createDiv({ cls: 'dp-review-list' });
        const controls: Array<GlassSegmented<ReviewChoice>> = [];

        const footer = createModalFooter(contentEl);
        createModalButton(footer.end, t('common.cancel'), 'secondary').addEventListener('click', () => this.close());
        const applyBtn = createModalButton(footer.end, '', 'primary');
        const applyLabel = applyBtn.querySelector<HTMLElement>('.dp-modal-btn-label')!;
        const refreshApply = () => {
            const n = Array.from(this.choices.values()).filter(c => c !== 'keep').length;
            applyLabel.setText(t('review.apply', { n }));
            applyBtn.disabled = n === 0;
        };
        applyBtn.addEventListener('click', () => {
            const picked = this.tasks.map(task => ({ task, choice: this.choices.get(task) ?? 'keep' })).filter(c => c.choice !== 'keep');
            if (picked.length === 0) return;
            this.close();
            this.onApply(picked);
        });

        (['tomorrow', 'unschedule', 'keep'] as ReviewChoice[]).forEach(choice => {
            const btn = bulk.createEl('button', { cls: 'dp-review-bulk-btn', text: options.find(o => o.value === choice)!.label });
            btn.addEventListener('click', () => {
                this.tasks.forEach(task => this.choices.set(task, choice));
                controls.forEach(control => control.select(choice, false));
                refreshApply();
            });
        });

        this.tasks.forEach(task => {
            this.choices.set(task, 'keep');
            const row = list.createDiv({ cls: 'dp-review-row' });
            const head = row.createDiv({ cls: 'dp-review-row-head' });
            if (task.startTime && task.endTime) head.createSpan({ cls: 'dp-review-time', text: `${task.startTime}–${task.endTime}` });
            head.createSpan({ cls: 'dp-review-title', text: cleanTaskTextForDisplay(task.text) });
            controls.push(new GlassSegmented<ReviewChoice>(row, {
                options,
                value: 'keep',
                ariaLabel: cleanTaskTextForDisplay(task.text),
                cls: 'dp-review-choice',
                onChange: (choice) => {
                    this.choices.set(task, choice);
                    refreshApply();
                }
            }));
        });
        refreshApply();
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class WhatsNewModal extends PlannerModal {
    private version: string;

    constructor(app: App, version: string) {
        super(app);
        this.version = version;
    }

    onOpen() {
        const { contentEl, modalEl } = this;
        const notes = getReleaseNotes(this.version);
        modalEl.addClass('dp-whats-new-modal');
        contentEl.empty();

        const header = contentEl.createDiv({ cls: 'dp-whats-new-header' });
        header.createEl('h2', { text: t('whatsNew.title', { version: notes.version }) });
        header.createDiv({ cls: 'dp-whats-new-date', text: t('whatsNew.released', { date: notes.date }) });

        const body = contentEl.createDiv({ cls: 'dp-whats-new-body' });
        const sections: Array<[string, ReleaseNoteItem[]]> = [
            [t('whatsNew.features'), notes.features],
            [t('whatsNew.improvements'), notes.improvements],
            [t('whatsNew.fixes'), notes.fixes]
        ];
        sections.forEach(([title, items]) => {
            if (items.length === 0) return;
            const section = body.createDiv({ cls: 'dp-whats-new-section' });
            section.createDiv({ cls: 'dp-whats-new-section-title', text: title });
            const list = section.createEl('ul', { cls: 'dp-whats-new-list' });
            items.forEach(item => {
                const row = list.createEl('li', { cls: 'dp-whats-new-item' });
                row.createSpan({ cls: 'dp-whats-new-emoji', text: item.emoji, attr: { 'aria-hidden': 'true' } });
                const text = row.createDiv({ cls: 'dp-whats-new-text' });
                text.createDiv({ cls: 'dp-whats-new-item-title', text: item.title });
                text.createDiv({ cls: 'dp-whats-new-item-desc', text: item.text });
            });
        });

        const footer = contentEl.createDiv({ cls: 'dp-whats-new-footer' });
        const ok = footer.createEl('button', { cls: 'mod-cta dp-whats-new-ok', text: t('whatsNew.gotIt') });
        ok.addEventListener('click', () => this.close());
        window.setTimeout(() => ok.focus({ preventScroll: true }), 0); // Enter / Space dismiss it too
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class ShortcutHelpModal extends PlannerModal {
    /**
     * The open instance, if any. `?` / `h` keep reaching the view's document-level key handler while the modal is up
     * (a modal does not change the active view), so each press used to stack one more modal and darken the backdrop.
     */
    private static current: ShortcutHelpModal | null = null;

    /** Every entry point (? / h, the header button, the command) toggles: open it, or close the one already open */
    static toggle(app: App, plugin: DayPlannerPlugin) {
        if (ShortcutHelpModal.current) {
            ShortcutHelpModal.current.close();
            return;
        }
        new ShortcutHelpModal(app, plugin).open();
    }

    private plugin: DayPlannerPlugin;

    private constructor(app: App, plugin: DayPlannerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        ShortcutHelpModal.current = this;
        const { contentEl, modalEl } = this;
        modalEl.addClass('dp-shortcut-modal');
        contentEl.empty();
        contentEl.createEl('h2', { text: t('shortcuts.title') });

        const groups: Array<[string, Array<[string[], string]>]> = [
            [t('shortcuts.group.navigate'), [
                [['j'], t('shortcuts.next')],
                [['k'], t('shortcuts.prev')],
                [['t'], t('shortcuts.today')]
            ]],
            [t('shortcuts.group.switchView'), [
                [['d'], t('shortcuts.daily')],
                [['x'], t('shortcuts.nDay')],
                [['w'], t('shortcuts.weekly')],
                [['m'], t('shortcuts.monthly')],
                [['b'], t('view.board')],
                [['l'], t('shortcuts.list')]
            ]],
            [t('shortcuts.group.panels'), [
                [['s'], t('shortcuts.drawer')],
                [['/'], t('shortcuts.search')],
                [['?', 'h'], t('shortcuts.help')],
                [['F5', 'Ctrl/Cmd+R'], t('shortcuts.sync')]
            ]],
            [t('shortcuts.group.selection'), [
                [['Ctrl/Cmd+Click'], t('shortcuts.multiSelect')],
                [['Ctrl/Cmd+Drag'], t('shortcuts.marqueeAdd')],
                [['Delete', 'Backspace'], t('shortcuts.delete')],
                [['Esc'], t('shortcuts.clearSelection')]
            ]],
            [t('shortcuts.group.drawerCard'), [
                [['f'], t('shortcuts.fit')],
                [['Ctrl/Cmd+Click', 'Drag'], t('shortcuts.drawerMulti')],
                [['p'], t('shortcuts.priority')],
                [['Enter'], t('shortcuts.edit')]
            ]],
            [t('shortcuts.group.dragging'), [
                [['j', 'k'], t('shortcuts.pageDates')],
                [['Esc'], t('shortcuts.cancelDrag')]
            ]]
        ];

        groups.forEach(([title, rows]) => {
            const section = contentEl.createDiv({ cls: 'dp-shortcut-section' });
            section.createDiv({ cls: 'dp-shortcut-section-title', text: title });
            rows.forEach(([keys, desc]) => {
                const row = section.createDiv({ cls: 'dp-shortcut-row' });
                const keysEl = row.createDiv({ cls: 'dp-shortcut-keys' });
                keys.forEach(k => keysEl.createEl('kbd', { cls: 'dp-kbd', text: k }));
                row.createDiv({ cls: 'dp-shortcut-desc', text: desc });
            });
        });

        // Footer: the header button can be hidden right here (same setting as Settings → Display)
        const footer = contentEl.createDiv({ cls: 'dp-shortcut-footer' });
        const label = footer.createEl('label', { cls: 'dp-shortcut-footer-option' });
        const checkbox = label.createEl('input', { type: 'checkbox' });
        checkbox.checked = this.plugin.settings.showShortcutButton === false;
        label.createSpan({ text: t('shortcuts.hideButton') });
        checkbox.addEventListener('change', async () => {
            this.plugin.settings.showShortcutButton = !checkbox.checked;
            await this.plugin.saveSettings();
            this.plugin.refreshActiveViews(); // re-renders the headers: the button goes / comes back at once
        });
        footer.createDiv({ cls: 'dp-shortcut-footer-hint', text: t('shortcuts.hint') });
    }

    onClose() {
        if (ShortcutHelpModal.current === this) ShortcutHelpModal.current = null;
        this.contentEl.empty();
    }
}

export class TaskSyncModal extends PlannerModal {
    plugin: DayPlannerPlugin;
    onSyncComplete: () => void;

    constructor(app: App, plugin: DayPlannerPlugin, onSyncComplete: () => void) {
        super(app);
        this.plugin = plugin;
        this.onSyncComplete = onSyncComplete;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.padding = '24px';
        contentEl.style.maxWidth = '450px';

        contentEl.createEl('h2', {
            text: t('syncModal.title')
        });

        contentEl.createEl('p', {
            text: t('syncModal.desc')
        });

        const form = contentEl.createDiv({ cls: 'dp-modal-form' });

        const calRow = form.createDiv({ cls: 'dp-modal-row' });
        calRow.createEl('label', { text: t('syncModal.chooseCalendar'), cls: 'dp-modal-row-label' });

        const calSelect = calRow.createEl('select', { cls: 'dp-modal-select' });

        const enabledCalendars = this.plugin.settings.googleCalendars.filter(c => c.enabled && c.id);

        if (enabledCalendars.length === 0) {
            const opt = calSelect.createEl('option', { value: '', text: t('syncModal.noCalendars') });
            opt.disabled = true;
        } else {
            enabledCalendars.forEach(cal => {
                const opt = calSelect.createEl('option', { value: cal.id, text: cal.name });
                if (cal.id === this.plugin.settings.taskSyncCalendarId) {
                    opt.selected = true;
                }
            });
        }

        const footer = createModalFooter(contentEl);
        const cancelBtn = createModalButton(footer.end, t('common.cancel'), 'secondary');
        cancelBtn.addEventListener('click', () => this.close());

        const syncBtn = createModalButton(footer.end, t('syncModal.syncNow'), 'primary');

        if (enabledCalendars.length === 0) {
            syncBtn.disabled = true;
        }

        syncBtn.addEventListener('click', async () => {
            const calendarId = calSelect.value;
            if (!calendarId) {
                new Notice(t('syncModal.selectCalendar'));
                return;
            }

            // Save the selected calendar as the default task sync calendar
            this.plugin.settings.taskSyncCalendarId = calendarId;
            await this.plugin.saveSettings();

            syncBtn.disabled = true;
            syncBtn.setText(t('syncModal.syncing'));
            new Notice(t('syncModal.starting'));

            try {
                const result = await syncAllTasksToGCal(this.plugin, calendarId);
                new Notice(t('syncModal.complete', { created: result.created, updated: result.updated, repaired: result.repaired, removed: result.removed, skipped: result.skipped }));
                this.onSyncComplete();
                this.close();
            } catch (e) {
                console.error('Task synchronization failed:', e);
                new Notice(t('syncModal.failed'));
                syncBtn.disabled = false;
                syncBtn.setText(t('syncModal.syncNow'));
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
