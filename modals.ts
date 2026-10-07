import { Modal, App, Notice, TFile, TFolder, setIcon } from 'obsidian';
import { TaskItem, GCalEvent } from './types';
import { openTaskInEditor, updateTaskInFile } from './utils';
import { deleteGoogleCalendarEvent, createGoogleCalendarEvent, updateGoogleCalendarEvent, syncAllTasksToGCal } from './gcalApi';
import DayPlannerPlugin from './main';
import { showGCalEventUndoNotice } from './views';

export class TaskEditModal extends Modal {
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
        modalHeader.createEl('h2', { text: 'Create or edit Task' });

        const formState = {
            text: this.task ? this.task.text : '',
            statusChar: this.task ? this.task.statusChar : ' ',
            priority: this.task ? this.task.priority : 'normal',
            date: this.task ? this.task.date : (this.defaultDate || ''),
            startTime: this.task ? this.task.startTime : (this.defaultStartTime || ''),
            endTime: this.task ? this.task.endTime : (this.defaultEndTime || ''),
            filePath: this.task ? this.task.filePath : 'Day Planner.md',
            recurrence: this.task ? this.task.recurrence : null,
            dueDate: this.task ? this.task.dueDate : null,
            scheduledDate: this.task ? this.task.scheduledDate : null,
            startDate: this.task ? this.task.startDate : null,
            completionDate: this.task ? this.task.completionDate : null,
            cancelledDate: this.task ? this.task.cancelledDate : null
        };

        const form = contentEl.createDiv({ cls: 'dp-modal-form' });

        // 1. Description (설명) 영역
        const descRow = form.createDiv({ cls: 'dp-modal-row' });
        descRow.createEl('label', { text: 'Description', cls: 'dp-modal-row-label' });
        const textarea = descRow.createEl('textarea', { 
            cls: 'dp-modal-textarea', 
            placeholder: 'Enter task details...' 
        });
        textarea.value = formState.text;
        textarea.addEventListener('input', () => { formState.text = textarea.value; });

        // 2. Task File Location (파일 위치) 영역
        const fileRow = form.createDiv({ cls: 'dp-modal-row' });
        fileRow.createEl('label', { text: 'Task File Location', cls: 'dp-modal-row-label' });
        const fileFlex = fileRow.createDiv({ cls: 'dp-modal-file-row' });
        
        const fileInput = fileFlex.createEl('input', { 
            type: 'text', 
            cls: 'dp-modal-file-input', 
            value: formState.filePath 
        });
        fileInput.disabled = true;

        const openBtn = fileFlex.createEl('button', { 
            text: 'Open in File ↗', 
            cls: 'mod-cta'
        });
        openBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (this.task) {
                await openTaskInEditor(this.app, this.task);
                this.close();
            } else {
                new Notice('This task hasn\'t been created in a file yet.');
            }
        });

        // 3. Priority (중요도 선택) 영역 - [Dropdown 형태로 컴팩트하게 구성]
        const priorityRow = form.createDiv({ cls: 'dp-modal-row' });
        priorityRow.createEl('label', { text: 'Priority', cls: 'dp-modal-row-label' });
        const prioritySelect = priorityRow.createEl('select', { cls: 'dp-modal-select' });
        const priorityOptions = [
            { value: 'lowest', label: 'Lowest ⏬' },
            { value: 'low', label: 'Low 🔽' },
            { value: 'normal', label: 'Normal 🟢' },
            { value: 'medium', label: 'Medium 🔼' },
            { value: 'high', label: 'High ⏫' },
            { value: 'highest', label: 'Highest 🔺' }
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
        statusRow.createEl('label', { text: 'Status', cls: 'dp-modal-row-label' });
        const statusSelect = statusRow.createEl('select', { cls: 'dp-modal-select' });
        const statusOptions = [
            { value: ' ', label: 'Todo [ ]' },
            { value: '/', label: 'In Progress [/]' },
            { value: 'x', label: 'Done [x]' },
            { value: '-', label: 'Cancelled [-]' }
        ];
        statusOptions.forEach(opt => {
            const op = statusSelect.createEl('option', { value: opt.value, text: opt.label });
            if (opt.value === formState.statusChar) op.selected = true;
        });
        statusSelect.addEventListener('change', () => {
            formState.statusChar = statusSelect.value;
        });

        const dateRow = statusDateGrid.createDiv({ cls: 'dp-modal-row' });
        dateRow.createEl('label', { text: '⏳ Date', cls: 'dp-modal-row-label' });
        const dateInput = dateRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        dateInput.value = formState.date || '';
        dateInput.addEventListener('change', () => {
            formState.date = dateInput.value || null;
        });

        // 6 & 7. Start Time & End Time (나란히 배치)
        const timesGrid = form.createDiv({ cls: 'dp-modal-grid' });

        const startTimeRow = timesGrid.createDiv({ cls: 'dp-modal-row' });
        startTimeRow.createEl('label', { text: '⏰ Start Time', cls: 'dp-modal-row-label' });
        const startTimeInput = startTimeRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        startTimeInput.value = formState.startTime || '';
        startTimeInput.addEventListener('change', () => {
            formState.startTime = startTimeInput.value || null;
        });

        const endTimeRow = timesGrid.createDiv({ cls: 'dp-modal-row' });
        endTimeRow.createEl('label', { text: '🕒 End Time', cls: 'dp-modal-row-label' });
        const endTimeInput = endTimeRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        endTimeInput.value = formState.endTime || '';
        endTimeInput.addEventListener('change', () => {
            formState.endTime = endTimeInput.value || null;
        });

        // [Tasks 호환 UI]: Tasks 플러그인 연동 전용 그룹 섹션 (Collapsible details element)
        const tasksSection = form.createEl('details', { cls: 'dp-modal-tasks-section' });
        tasksSection.createEl('summary', { text: 'Tasks Plugin Compatibility 🔁' });

        // 반복 주기 + 날짜 5종을 하나의 2열 그리드로 구성 (3행)
        const datesGrid = tasksSection.createDiv({ cls: 'dp-modal-grid' });

        // 1) 반복 주기 (Recurrence 🔁)
        const recurRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        recurRow.createEl('label', { text: '🔁 Recurrence', cls: 'dp-modal-row-label' });
        const recurInput = recurRow.createEl('input', { 
            type: 'text', 
            cls: 'dp-modal-input', 
            placeholder: 'e.g., every week'
        });
        recurInput.value = formState.recurrence || '';
        recurInput.addEventListener('input', () => {
            formState.recurrence = recurInput.value || null;
        });

        // 예정일 (Scheduled Date ⏳)
        const schedRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        schedRow.createEl('label', { text: '⏳ Scheduled Date', cls: 'dp-modal-row-label' });
        const schedInput = schedRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        schedInput.value = formState.scheduledDate || '';
        schedInput.addEventListener('change', () => {
            formState.scheduledDate = schedInput.value || null;
        });

        // 마감일 (Due Date 📅)
        const dueRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        dueRow.createEl('label', { text: '📅 Due Date', cls: 'dp-modal-row-label' });
        const dueInput = dueRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        dueInput.value = formState.dueDate || '';
        dueInput.addEventListener('change', () => {
            formState.dueDate = dueInput.value || null;
        });

        // 시작일 (Start Date 🛫)
        const startDRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        startDRow.createEl('label', { text: '🛫 Start Date', cls: 'dp-modal-row-label' });
        const startDInput = startDRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        startDInput.value = formState.startDate || '';
        startDInput.addEventListener('change', () => {
            formState.startDate = startDInput.value || null;
        });

        // 완료일 (Completion Date ✅)
        const compDRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        compDRow.createEl('label', { text: '✅ Completion Date', cls: 'dp-modal-row-label' });
        const compDInput = compDRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        compDInput.value = formState.completionDate || '';
        compDInput.addEventListener('change', () => {
            formState.completionDate = compDInput.value || null;
        });

        // 취소일 (Cancelled Date ❌)
        const cancelDRow = datesGrid.createDiv({ cls: 'dp-modal-row' });
        cancelDRow.createEl('label', { text: '❌ Cancelled Date', cls: 'dp-modal-row-label' });
        const cancelDInput = cancelDRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        cancelDInput.value = formState.cancelledDate || '';
        cancelDInput.addEventListener('change', () => {
            formState.cancelledDate = cancelDInput.value || null;
        });

        // 하단 조작 버튼 그룹
        const buttonRow = form.createDiv({ cls: 'dp-modal-buttons' });
        
        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
        });

        const saveBtn = buttonRow.createEl('button', { text: 'Save', cls: 'mod-cta' });
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (!formState.text.trim()) {
                new Notice('Please enter task content!');
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

export class GCalEventEditModal extends Modal {
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
        summaryRow.createEl('label', { text: 'Event Title', cls: 'dp-modal-row-label' });
        const summaryInput = summaryRow.createEl('input', { type: 'text', cls: 'dp-modal-input', placeholder: 'Enter event summary...' });
        summaryInput.value = formState.summary;
        summaryInput.addEventListener('input', () => { formState.summary = summaryInput.value; });

        // 캘린더 선택/표시 + All Day 체크박스를 한 줄에 배치
        const optionsRow = form.createDiv({ cls: 'dp-modal-options-row' });
        const calRow = optionsRow.createDiv({ cls: 'dp-modal-row' });

        if (!this.event) {
            calRow.createEl('label', { text: 'Target Calendar', cls: 'dp-modal-row-label' });
            const calSelect = calRow.createEl('select', { cls: 'dp-modal-select' });
            this.plugin.settings.googleCalendars.filter(c => c.enabled).forEach(cal => {
                const opt = calSelect.createEl('option', { value: cal.id, text: cal.name });
                if (cal.id === formState.calendarId) opt.selected = true;
            });
            calSelect.addEventListener('change', () => {
                formState.calendarId = calSelect.value;
            });
        } else {
            calRow.createEl('label', { text: 'Calendar', cls: 'dp-modal-row-label' });
            const calName = this.plugin.settings.googleCalendars.find(c => c.id === formState.calendarId)?.name || 'Google Calendar';
            calRow.createDiv({ text: calName, cls: 'dp-modal-static-value' });
        }

        const allDayLabel = optionsRow.createEl('label', { cls: 'dp-modal-checkbox' });
        const allDayCheckbox = allDayLabel.createEl('input', { type: 'checkbox' });
        allDayCheckbox.checked = formState.isAllDay;
        allDayLabel.createSpan({ text: 'All Day' });

        const dateRow = form.createDiv({ cls: 'dp-modal-grid' });

        const startDtRow = dateRow.createDiv({ cls: 'dp-modal-row' });
        startDtRow.createEl('label', { text: 'Start Date', cls: 'dp-modal-row-label' });
        const startDtInput = startDtRow.createEl('input', { type: 'date', cls: 'dp-modal-input' });
        startDtInput.value = formState.dateStr;

        const endDtRow = dateRow.createDiv({ cls: 'dp-modal-row' });
        endDtRow.createEl('label', { text: 'End Date', cls: 'dp-modal-row-label' });
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
        startRow.createEl('label', { text: 'Start Time', cls: 'dp-modal-row-label' });
        const startInput = startRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        startInput.value = formState.startTimeStr || '09:00';
        startInput.addEventListener('change', () => { formState.startTimeStr = startInput.value; });

        const endRow = timesRow.createDiv({ cls: 'dp-modal-row' });
        endRow.createEl('label', { text: 'End Time', cls: 'dp-modal-row-label' });
        const endInput = endRow.createEl('input', { type: 'time', cls: 'dp-modal-input' });
        endInput.value = formState.endTimeStr || '10:00';
        endInput.addEventListener('change', () => { formState.endTimeStr = endInput.value; });

        allDayCheckbox.addEventListener('change', () => {
            formState.isAllDay = allDayCheckbox.checked;
            timesCollapse.toggleClass('is-collapsed', formState.isAllDay);
        });

        const locRow = form.createDiv({ cls: 'dp-modal-row' });
        locRow.createEl('label', { text: 'Location', cls: 'dp-modal-row-label' });
        const locInput = locRow.createEl('input', { type: 'text', cls: 'dp-modal-input', placeholder: 'Add location...' });
        locInput.value = formState.location;
        locInput.addEventListener('input', () => { formState.location = locInput.value; });

        const descRow = form.createDiv({ cls: 'dp-modal-row' });
        descRow.createEl('label', { text: 'Description', cls: 'dp-modal-row-label' });
        const descTextarea = descRow.createEl('textarea', { cls: 'dp-modal-textarea', placeholder: 'Add description...' });
        descTextarea.value = formState.description;
        descTextarea.addEventListener('input', () => { formState.description = descTextarea.value; });

        const buttonRow = form.createDiv({ cls: 'dp-modal-buttons' });
        
        const leftActions = buttonRow.createDiv();
        if (this.event) {
            const deleteBtn = leftActions.createEl('button', { text: 'Delete 🗑', cls: 'mod-warning' });
            deleteBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                if (await deleteGoogleCalendarEvent(this.plugin, formState.calendarId, this.event!.id)) {
                    new Notice('📅 Google Calendar 일정이 성공적으로 삭제되었습니다.');
                    this.onSave();
                    this.close();
                }
            });

            const duplicateBtn = leftActions.createEl('button', { text: 'Duplicate 📑' });
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
                    new Notice('📅 Google Calendar 일정이 복사 및 추가되었습니다.');
                    this.onSave();
                    this.close();
                }
            });
        }

        const rightActions = buttonRow.createDiv();
        const cancelBtn = rightActions.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.close();
        });

        const saveBtn = rightActions.createEl('button', { text: this.event ? 'Save' : 'Create', cls: 'mod-cta' });
        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!formState.summary.trim()) {
                new Notice('일정 제목을 정확하게 입력하세요.');
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
                    new Notice('📅 구글 캘린더 일정이 업데이트되었습니다.');
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
                if (success) new Notice('📅 구글 캘린더에 일정이 추가되었습니다.');
            }

            if (success) {
                this.onSave();
                this.close();
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class AddChoiceModal extends Modal {
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
            text: 'Add New Item ➕' 
        });

        const choiceGrid = contentEl.createDiv({ cls: 'dp-modal-choice-grid' });

        // Choice 1: Task
        const taskCard = choiceGrid.createDiv({ cls: 'dp-modal-choice-card' });
        taskCard.createDiv({ text: '📝', cls: 'dp-modal-choice-icon' });
        taskCard.createDiv({ text: 'Add Local Task', cls: 'dp-modal-choice-title' });
        taskCard.createDiv({ text: 'Create a local task inside your vault\'s daily note or default file.', cls: 'dp-modal-choice-desc' });
        taskCard.addEventListener('click', () => {
            this.onChoose('task');
            this.close();
        });

        // Choice 2: Appointment
        const apptCard = choiceGrid.createDiv({ cls: 'dp-modal-choice-card' });
        apptCard.createDiv({ text: '📅', cls: 'dp-modal-choice-icon' });
        apptCard.createDiv({ text: 'Add Appointment', cls: 'dp-modal-choice-title' });
        apptCard.createDiv({ text: 'Create a new event and schedule it directly on Google Calendar.', cls: 'dp-modal-choice-desc' });
        apptCard.addEventListener('click', () => {
            this.onChoose('appointment');
            this.close();
        });

        const buttonRow = contentEl.createDiv({ 
            cls: 'dp-modal-buttons'
        });
        const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

/** Keyboard shortcut reference (`?`), frosted like the other planner modals */
export class ShortcutHelpModal extends Modal {
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
        contentEl.createEl('h2', { text: 'Keyboard Shortcuts' });

        const groups: Array<[string, Array<[string[], string]>]> = [
            ['Navigate', [
                [['j'], 'Next day / period (compact Board: next column)'],
                [['k'], 'Previous day / period (compact Board: previous column)'],
                [['t'], 'Jump to today']
            ]],
            ['Switch view', [
                [['d'], 'Daily timeline'],
                [['x'], 'N-day view'],
                [['w'], 'Weekly view'],
                [['m'], 'Monthly calendar'],
                [['b'], 'Board'],
                [['l'], 'List view']
            ]],
            ['Panels', [
                [['s'], 'Toggle the sidebar drawer (desktop)'],
                [['?', 'h'], 'Show this help'],
                [['F5', 'Ctrl/Cmd+R'], 'Sync (rescan tasks, refresh Google Calendar)']
            ]],
            ['Side drawer card (Tab to focus)', [
                [['f'], 'Fit it into the first free slot (next 14 days)'],
                [['Enter'], 'Edit the task']
            ]],
            ['While dragging (desktop)', [
                [['j', 'k'], 'Page dates without dropping the task'],
                [['Esc'], 'Cancel the drag']
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
        label.createSpan({ text: 'Hide the shortcut (?) button in the header' });
        checkbox.addEventListener('change', async () => {
            this.plugin.settings.showShortcutButton = !checkbox.checked;
            await this.plugin.saveSettings();
            this.plugin.refreshActiveViews(); // re-renders the headers: the button goes / comes back at once
        });
        footer.createDiv({ cls: 'dp-shortcut-footer-hint', text: '? and h open this list either way.' });
    }

    onClose() {
        if (ShortcutHelpModal.current === this) ShortcutHelpModal.current = null;
        this.contentEl.empty();
    }
}

export class TaskSyncModal extends Modal {
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
            text: 'Synchronize Tasks with Google Calendar 📤' 
        });

        contentEl.createEl('p', {
            text: 'This will scan all timed tasks in your vault (containing dates and times) and synchronize them to your selected Google Calendar. Existing tasks linked via gcalId will be updated, and new ones will be created.'
        });

        const form = contentEl.createDiv({ cls: 'dp-modal-form' });

        const calRow = form.createDiv({ cls: 'dp-modal-row' });
        calRow.createEl('label', { text: 'Choose Target Calendar', cls: 'dp-modal-row-label' });
        
        const calSelect = calRow.createEl('select', { cls: 'dp-modal-select' });
        
        const enabledCalendars = this.plugin.settings.googleCalendars.filter(c => c.enabled && c.id);
        
        if (enabledCalendars.length === 0) {
            const opt = calSelect.createEl('option', { value: '', text: 'No enabled Google Calendars' });
            opt.disabled = true;
        } else {
            enabledCalendars.forEach(cal => {
                const opt = calSelect.createEl('option', { value: cal.id, text: cal.name });
                if (cal.id === this.plugin.settings.taskSyncCalendarId) {
                    opt.selected = true;
                }
            });
        }

        const buttonsRow = contentEl.createDiv({ 
            cls: 'dp-modal-buttons' 
        });

        const cancelBtn = buttonsRow.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        const syncBtn = buttonsRow.createEl('button', { 
            text: 'Sync Tasks Now', 
            cls: 'mod-cta' 
        });
        
        if (enabledCalendars.length === 0) {
            syncBtn.disabled = true;
        }

        syncBtn.addEventListener('click', async () => {
            const calendarId = calSelect.value;
            if (!calendarId) {
                new Notice('⚠️ Please select a valid target Google Calendar.');
                return;
            }

            // Save the selected calendar as the default task sync calendar
            this.plugin.settings.taskSyncCalendarId = calendarId;
            await this.plugin.saveSettings();

            syncBtn.disabled = true;
            syncBtn.setText('Syncing...');
            new Notice('🔄 Starting background task synchronization...');

            try {
                const result = await syncAllTasksToGCal(this.plugin, calendarId);
                new Notice(`✅ Task synchronization complete! Created: ${result.created}, Updated: ${result.updated}, Repaired: ${result.repaired}, Removed: ${result.removed}, Skipped: ${result.skipped}`);
                this.onSyncComplete();
                this.close();
            } catch (e) {
                console.error('Task synchronization failed:', e);
                new Notice('❌ Task synchronization failed. Check console for details.');
                syncBtn.disabled = false;
                syncBtn.setText('Sync Tasks Now');
            }
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class PathSelectorModal extends Modal {
    onSelect: (path: string) => void;
    activeTab: 'folders' | 'files' = 'folders';
    searchQuery: string = '';

    constructor(app: App, onSelect: (path: string) => void) {
        super(app);
        this.onSelect = onSelect;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.padding = '20px';
        contentEl.style.maxWidth = '480px';

        contentEl.createEl('h2', { 
            text: 'Select File/Folder to Exclude 📂' 
        });

        // Tabs
        const tabsContainer = contentEl.createDiv({ cls: 'dp-selector-modal-tabs' });
        
        const folderTab = tabsContainer.createDiv({ 
            cls: `dp-selector-modal-tab ${this.activeTab === 'folders' ? 'active' : ''}`,
            text: 'Folders'
        });
        const fileTab = tabsContainer.createDiv({ 
            cls: `dp-selector-modal-tab ${this.activeTab === 'files' ? 'active' : ''}`,
            text: 'Files'
        });

        // Search Input
        const searchInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Search folder or file name...',
            cls: 'dp-selector-modal-search'
        });

        // List Container
        const listContainer = contentEl.createDiv({ cls: 'dp-selector-modal-list' });

        const renderList = () => {
            listContainer.empty();
            const query = this.searchQuery.toLowerCase().trim();

            const allItems = this.app.vault.getAllLoadedFiles();
            
            if (this.activeTab === 'folders') {
                const folders = allItems.filter(f => f instanceof TFolder) as TFolder[];
                // Exclude root folder
                const filteredFolders = folders.filter(f => f.path !== '/' && f.path !== '' && f.path.toLowerCase().includes(query));
                
                if (filteredFolders.length === 0) {
                    listContainer.createDiv({ text: 'No folders found.' });
                } else {
                    filteredFolders.forEach(folder => {
                        const item = listContainer.createDiv({ cls: 'dp-selector-modal-item' });
                        const iconEl = item.createDiv({ cls: 'dp-selector-modal-item-icon' });
                        setIcon(iconEl, 'folder');
                        item.createDiv({ cls: 'dp-selector-modal-item-text', text: folder.path + '/' });
                        item.addEventListener('click', () => {
                            this.onSelect(folder.path + '/');
                            this.close();
                        });
                    });
                }
            } else {
                const files = allItems.filter(f => f instanceof TFile) as TFile[];
                const filteredFiles = files.filter(f => f.path.toLowerCase().includes(query));
                
                if (filteredFiles.length === 0) {
                    listContainer.createDiv({ text: 'No files found.' });
                } else {
                    filteredFiles.forEach(file => {
                        const item = listContainer.createDiv({ cls: 'dp-selector-modal-item' });
                        const iconEl = item.createDiv({ cls: 'dp-selector-modal-item-icon' });
                        setIcon(iconEl, 'file-text');
                        item.createDiv({ cls: 'dp-selector-modal-item-text', text: file.path });
                        item.addEventListener('click', () => {
                            this.onSelect(file.path);
                            this.close();
                        });
                    });
                }
            }
        };

        folderTab.addEventListener('click', () => {
            this.activeTab = 'folders';
            folderTab.addClass('active');
            fileTab.removeClass('active');
            renderList();
        });

        fileTab.addEventListener('click', () => {
            this.activeTab = 'files';
            fileTab.addClass('active');
            folderTab.removeClass('active');
            renderList();
        });

        searchInput.addEventListener('input', () => {
            this.searchQuery = searchInput.value;
            renderList();
        });

        // Focus search input
        setTimeout(() => searchInput.focus(), 50);

        renderList();
    }

    onClose() {
        this.contentEl.empty();
    }
}