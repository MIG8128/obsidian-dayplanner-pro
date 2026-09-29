import { App, TFile, Notice, Platform } from 'obsidian';
import { TaskItem, DayPlannerSettings } from './types';

// ---------------------------------------------------------------------------------------------
// Haptics: one safe entry point. No-op on desktop, when the setting is off, or where vibrate() is unsupported
// (iOS WebKit has no Vibration API, so iPhone/iPad silently get nothing).
// ---------------------------------------------------------------------------------------------
export type HapticType = 'selection' | 'light' | 'success' | 'warning';

let hapticsEnabled = true;
/** Mirrors the `enableMobileHaptics` setting; called by the plugin on load and on every settings save. */
export function setHapticsEnabled(enabled: boolean) {
    hapticsEnabled = enabled;
}

export function triggerHaptic(type: HapticType = 'light', enabled = hapticsEnabled): void {
    if (!enabled || !Platform.isMobile || typeof navigator.vibrate !== 'function') return;
    const patterns: Record<HapticType, number | number[]> = {
        selection: 6,
        light: 10,
        success: [10, 35, 15],
        warning: [20, 50, 20]
    };
    try { navigator.vibrate(patterns[type]); } catch { /* vibration blocked by the OS */ }
}

// 헬퍼 함수: 특정 시간에 분을 가산하여 반환
export function addMinutesToTime(timeStr: string, minutes: number): string {
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(h);
    date.setMinutes(m + minutes);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// 헬퍼 함수: 1자리수 시/분을 2자리로 통일 (e.g. 9:30 -> 09:30)
export function normalizeTime(timeStr: string): string {
    const [h, m] = timeStr.split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

// 헬퍼 함수: 분 단위 시간을 XX hr XX m 형태로 사람이 읽기 쉽게 변환 (60분 이상 시 시간 단위 표기)
export function formatMinutesNice(mins: number): string {
    if (mins < 60) {
        return `${mins}m`;
    }
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (remMins === 0) {
        return `${hours}hr`;
    }
    return `${hours}hr ${remMins}m`;
}


// Tasks 플러그인 반복 주기(🔁) 규칙 해석용 헬퍼 함수
export function getNextRecurrenceDate(dateStr: string, recurrence: string): string {
    const moment = (window as any).moment;
    const m = moment(dateStr, 'YYYY-MM-DD');
    const cleanRecur = recurrence.toLowerCase().trim();

    if (cleanRecur === 'every day' || cleanRecur === 'daily') {
        return m.add(1, 'days').format('YYYY-MM-DD');
    }
    if (cleanRecur === 'every week' || cleanRecur === 'weekly') {
        return m.add(1, 'weeks').format('YYYY-MM-DD');
    }
    if (cleanRecur === 'every month' || cleanRecur === 'monthly') {
        return m.add(1, 'months').format('YYYY-MM-DD');
    }
    if (cleanRecur === 'every year' || cleanRecur === 'yearly') {
        return m.add(1, 'years').format('YYYY-MM-DD');
    }
    if (cleanRecur === 'every weekday') {
        let next = m.add(1, 'days');
        while (next.day() === 0 || next.day() === 6) {
            next = next.add(1, 'days');
        }
        return next.format('YYYY-MM-DD');
    }

    const customMatch = cleanRecur.match(/every\s+(\d+)\s+(day|week|month|year)s?/);
    if (customMatch) {
        const amount = parseInt(customMatch[1]);
        const unit = customMatch[2] + 's';
        return m.add(amount, unit).format('YYYY-MM-DD');
    }

    return m.add(1, 'days').format('YYYY-MM-DD');
}

// 렌더링용 헬퍼 함수: 마크다운 할 일 텍스트에서 각종 시간/날짜/반복 지형 소거
export function cleanTaskTextForDisplay(text: string): string {
    let cleaned = text;
    cleaned = cleaned.replace(/\[\s*startTime::\s*[^\]]+\]/ig, '');
    cleaned = cleaned.replace(/startTime::\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?/ig, '');
    cleaned = cleaned.replace(/[⏳📅🛫✅❌]\s*\d{4}-\d{2}-\d{2}/g, '');
    cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
    cleaned = cleaned.replace(/⏰\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?/g, '');
    cleaned = cleaned.replace(/\[\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s*\]/g, '');
    cleaned = cleaned.replace(/^\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s+/, '');
    cleaned = cleaned.replace(/🔁\s*[^⏳📅🛫⏰✅❌🔺⏫🔼🔽⏬🟢\n]+/g, '');
    cleaned = cleaned.replace(/[🔺⏫🔼🟢🔽⏬]/g, '');
    cleaned = cleaned.replace(/\[\s*gcalId::\s*[^\]]+\]/ig, '');
    return cleaned.replace(/\s+/g, ' ').trim();
}

// 정렬용 헬퍼 함수
export function compareTasks(a: TaskItem, b: TaskItem): number {
    const dateA = a.date || '9999-12-31';
    const dateB = b.date || '9999-12-31';
    if (dateA !== dateB) {
        return dateA.localeCompare(dateB);
    }
    const timeA = a.startTime || '23:59';
    const timeB = b.startTime || '23:59';
    return timeA.localeCompare(timeB);
}

// 맞춤형 체크박스 생성
export function createCustomCheckbox(parent: HTMLElement, task: TaskItem, onClick: (newStatus: string) => void): HTMLElement {
    const cb = parent.createDiv({ 
        cls: `dp-custom-cb status-${task.statusChar === ' ' ? 'todo' : task.statusChar === '/' ? 'inprogress' : task.statusChar === 'x' ? 'done' : 'cancelled'}` 
    });
    
    if (task.statusChar === ' ') {
        // Todo
    } else if (task.statusChar === '/') {
        cb.setText('');
    } else if (task.statusChar === 'x') {
        cb.setText('✓');
    } else if (task.statusChar === '-') {
        cb.setText('×');
    }
    
    cb.addEventListener('click', (e) => {
        e.stopPropagation();
        let nextStatus = ' ';
        if (task.statusChar === ' ') nextStatus = '/';
        else if (task.statusChar === '/') nextStatus = 'x';
        else if (task.statusChar === 'x') nextStatus = '-';
        else nextStatus = ' ';

        triggerHaptic(nextStatus === 'x' ? 'success' : 'selection');
        onClick(nextStatus);
    });
    
    return cb;
}

// Daily / weekly note settings, looked up by note type
const NOTE_CONFIG = {
    daily: (s: DayPlannerSettings) => ({ folder: s.dailyNotesFolder, format: s.dailyNotesFormat, template: s.dailyNoteTemplate }),
    weekly: (s: DayPlannerSettings) => ({ folder: s.weeklyNotesFolder, format: s.weeklyNotesFormat, template: s.weeklyNoteTemplate })
};

/**
 * Opens the daily or weekly note for a date in a new tab, creating it first (folder + template) when missing.
 * `date` is a moment or a YYYY-MM-DD string. Template tokens: {{date}}, {{title}}, {{time}}.
 */
export async function openNoteForDate(app: App, date: any, type: 'daily' | 'weekly', settings: DayPlannerSettings): Promise<void> {
    try {
        const moment = (window as any).moment;
        const m = moment(date);
        const dateStr = m.format('YYYY-MM-DD');
        const { folder, format, template } = NOTE_CONFIG[type](settings);
        const fileName = m.format(format);
        const filePath = `${folder ? folder + '/' : ''}${fileName}.md`;

        let file = app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            if (folder && !app.vault.getAbstractFileByPath(folder)) {
                await app.vault.createFolder(folder);
            }
            let noteContent = type === 'daily' ? `# ${dateStr}\n\n` : `# Weekly Plan - ${fileName}\n\n`;
            if (template) {
                const templateFile = app.vault.getAbstractFileByPath(template);
                if (templateFile instanceof TFile) {
                    noteContent = (await app.vault.read(templateFile))
                        .replace(/\{\{date\}\}/g, dateStr)
                        .replace(/\{\{title\}\}/g, fileName)
                        .replace(/\{\{time\}\}/g, moment().format('HH:mm'));
                }
            }
            file = await app.vault.create(filePath, noteContent);
        }

        await app.workspace.getLeaf('tab').openFile(file as TFile);
    } catch (e) {
        console.error(`Day Planner Pro: could not open ${type} note`, e);
        new Notice(`Could not open the ${type} note: ${e instanceof Error ? e.message : String(e)}`);
    }
}

export type PlannerViewType = 'daily' | 'multiDay' | 'weekly' | 'monthly' | 'board' | 'list';

export interface HeaderDateInfo {
    mainText: string;
    subText?: string;
    isClickable: boolean;
    /** Note opened by clicking mainText */
    noteType?: 'daily' | 'weekly';
    /** Note opened by clicking subText (Daily: the week number opens the weekly note) */
    subNoteType?: 'daily' | 'weekly';
    /** Date whose note the header links to (Board links to today, not the viewed date) */
    noteDate: any;
}

/** Single declarative mapping for the top-right header date: label text and which note each part opens. */
export function getHeaderDateInfo(date: any, viewType: PlannerViewType, nDayCount = 4): HeaderDateInfo {
    const moment = (window as any).moment;
    switch (viewType) {
        case 'daily':
            return { mainText: date.format('YYYY-MM-DD'), subText: `(Wk ${date.week()})`, isClickable: true,
                noteType: 'daily', subNoteType: 'weekly', noteDate: date };
        case 'multiDay': {
            const days = Math.max(2, Math.min(14, nDayCount));
            const end = date.clone().add(days - 1, 'days');
            return { mainText: `${date.format('MM/DD')} ~ ${end.format('MM/DD')} (${days} days)`, isClickable: false, noteDate: date };
        }
        case 'weekly': {
            const start = date.clone().startOf('week');
            const end = date.clone().endOf('week');
            return { mainText: `${start.format('MM/DD')} ~ ${end.format('MM/DD')} (Wk ${date.week()})`, isClickable: true,
                noteType: 'weekly', noteDate: date };
        }
        case 'board': {
            const today = moment();
            return { mainText: `${today.format('YYYY-MM-DD')} (Wk ${today.week()})`, isClickable: true,
                noteType: 'daily', noteDate: today };
        }
        default: // monthly, list
            return { mainText: date.format('YYYY-MM'), isClickable: false, noteDate: date };
    }
}

/**
 * Pixel scrollTop that brings `target` into view inside a scroll container, or null when the target is not rendered:
 * 'now'   → the current-time line (Daily / Weekly / N-day), with one hour of context above it and below any sticky all-day row;
 * 'today' → today's List section, else the earliest upcoming day (rows carry data-date).
 */
export function getScrollTargetTop(containerEl: HTMLElement, target: 'now' | 'today'): number | null {
    const offsetInScroller = (el: HTMLElement) =>
        el.getBoundingClientRect().top - containerEl.getBoundingClientRect().top + containerEl.scrollTop;

    if (target === 'now') {
        const line = containerEl.querySelector<HTMLElement>('.dp-timeline-current-indicator');
        if (!line) return null;
        const hourHeight = parseFloat(getComputedStyle(containerEl).getPropertyValue('--dp-hour-height')) || 60;
        const stickyRow = containerEl.querySelector<HTMLElement>(':scope > .dp-daily-allday');
        return Math.max(0, offsetInScroller(line) - hourHeight - (stickyRow?.offsetHeight ?? 0));
    }

    const todayStr = (window as any).moment().format('YYYY-MM-DD');
    const row = Array.from(containerEl.querySelectorAll<HTMLElement>('.dp-gc-day-row'))
        .find(r => (r.dataset.date ?? '') >= todayStr);
    if (!row) return null;
    const paddingTop = parseFloat(getComputedStyle(containerEl).paddingTop) || 0;
    return Math.max(0, offsetInScroller(row) - paddingTop);
}

/** Scrolls a container to 'now' / 'today' (falling back to `fallbackTop` when the target isn't rendered). Returns the top used. */
export function scrollToTarget(containerEl: HTMLElement, target: 'now' | 'today', behavior: 'smooth' | 'auto', fallbackTop: () => number = () => 0): number {
    const top = Math.max(0, getScrollTargetTop(containerEl, target) ?? fallbackTop());
    containerEl.scrollTo({ top, behavior });
    return top;
}

// 마크다운의 한 줄을 분석하여 TaskItem으로 반환
export function parseTaskLine(line: string, filePath: string, lineNumber: number, dailyNotesFormat?: string): TaskItem | null {
    const checkboxMatch = line.match(/^\s*-\s*\[([^\]])\]\s*(.*)$/);
    if (!checkboxMatch) return null;

    const statusChar = checkboxMatch[1];
    const completed = statusChar.toLowerCase() === 'x';
    let remainingText = checkboxMatch[2].trim();

    // Tasks 반복 기호(🔁) 및 패턴 추출
    let recurrence: string | null = null;
    const recurMatch = remainingText.match(/🔁\s*([^⏳📅🛫⏰✅❌🔺⏫🔼🔽⏬🟢\n]+)/);
    if (recurMatch) {
        recurrence = recurMatch[1].trim();
        remainingText = remainingText.replace(/🔁\s*[^⏳📅🛫⏰✅❌🔺⏫🔼🔽⏬🟢\n]+/, '').trim();
    }

    // Tasks 핵심 기호 추출
    let dueDate: string | null = null;
    const dueMatch = remainingText.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
    if (dueMatch) {
        dueDate = dueMatch[1];
        remainingText = remainingText.replace(/📅\s*\d{4}-\d{2}-\d{2}/, '').trim();
    }

    let scheduledDate: string | null = null;
    const schedMatch = remainingText.match(/⏳\s*(\d{4}-\d{2}-\d{2})/);
    if (schedMatch) {
        scheduledDate = schedMatch[1];
        remainingText = remainingText.replace(/⏳\s*\d{4}-\d{2}-\d{2}/, '').trim();
    }

    let startDate: string | null = null;
    const startDMatch = remainingText.match(/🛫\s*(\d{4}-\d{2}-\d{2})/);
    if (startDMatch) {
        startDate = startDMatch[1];
        remainingText = remainingText.replace(/🛫\s*\d{4}-\d{2}-\d{2}/, '').trim();
    }

    let completionDate: string | null = null;
    const compDMatch = remainingText.match(/✅\s*(\d{4}-\d{2}-\d{2})/);
    if (compDMatch) {
        completionDate = compDMatch[1];
        remainingText = remainingText.replace(/✅\s*\d{4}-\d{2}-\d{2}/, '').trim();
    }

    let cancelledDate: string | null = null;
    const cancelDMatch = remainingText.match(/❌\s*(\d{4}-\d{2}-\d{2})/);
    if (cancelDMatch) {
        cancelledDate = cancelDMatch[1];
        remainingText = remainingText.replace(/❌\s*\d{4}-\d{2}-\d{2}/, '').trim();
    }

    // 중요도 파싱
    let priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest' = 'normal';
    if (remainingText.includes('🔺')) {
        priority = 'highest';
        remainingText = remainingText.replace('🔺', '').trim();
    } else if (remainingText.includes('⏫')) {
        priority = 'high';
        remainingText = remainingText.replace('⏫', '').trim();
    } else if (remainingText.includes('🔼')) {
        priority = 'medium';
        remainingText = remainingText.replace('🔼', '').trim();
    } else if (remainingText.includes('🔽')) {
        priority = 'low';
        remainingText = remainingText.replace('🔽', '').trim();
    } else if (remainingText.includes('⏬')) {
        priority = 'lowest';
        remainingText = remainingText.replace('⏬', '').trim();
    } else if (remainingText.includes('🟢')) {
        priority = 'normal';
        remainingText = remainingText.replace('🟢', '').trim();
    }

    let date = scheduledDate || dueDate;
    if (!date) {
        const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.md$/, '') || '';
        let momentDate;
        const moment = (window as any).moment;
        
        if (dailyNotesFormat) {
            const p = moment(fileName, dailyNotesFormat, true);
            if (p.isValid()) momentDate = p;
        }
        if (!momentDate) {
            const formats = ['YYYY-MM-DD', 'YYYY.MM.DD', 'YYYYMMDD', 'YYYY년 MM월 DD일', 'YYYY_MM_DD'];
            for (const fmt of formats) {
                const p = moment(fileName, fmt, true);
                if (p.isValid()) {
                    momentDate = p;
                    break;
                }
            }
        }
        if (!momentDate) {
            const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
            if (match) {
                momentDate = moment(match[1], 'YYYY-MM-DD', true);
            }
        }
        if (momentDate && momentDate.isValid()) {
            date = momentDate.format('YYYY-MM-DD');
        }
    }

    // 업무 소요 시각 파싱
    let startTime: string | null = null;
    let endTime: string | null = null;

    const bracketGCalRegex = /\[\s*startTime::\s*(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s*\]/i;
    const bracketGCalMatch = remainingText.match(bracketGCalRegex);

    if (bracketGCalMatch) {
        startTime = bracketGCalMatch[1];
        endTime = bracketGCalMatch[2] || addMinutesToTime(startTime, 30);
        remainingText = remainingText.replace(bracketGCalRegex, '').trim();
    } 
    else {
        const rawGCalRegex = /startTime::\s*(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?/i;
        const rawGCalMatch = remainingText.match(rawGCalRegex);
        if (rawGCalMatch) {
            startTime = rawGCalMatch[1];
            endTime = rawGCalMatch[2] || addMinutesToTime(startTime, 30);
            remainingText = remainingText.replace(rawGCalRegex, '').trim();
        }
        else {
            const alarmTimeRegex = /⏰\s*(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?/;
            const alarmMatch = remainingText.match(alarmTimeRegex);
            if (alarmMatch) {
                startTime = alarmMatch[1];
                endTime = alarmMatch[2] || addMinutesToTime(startTime, 30);
                remainingText = remainingText.replace(alarmTimeRegex, '').trim();
            } 
            else {
                const bracketTimeRegex = /\[\s*(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s*\]/;
                const bracketMatch = remainingText.match(bracketTimeRegex);
                if (bracketMatch) {
                    startTime = bracketMatch[1];
                    endTime = bracketMatch[2] || addMinutesToTime(startTime, 30);
                    remainingText = remainingText.replace(bracketTimeRegex, '').trim();
                }
                else {
                    const leadingTimeRegex = /^(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?\s+/;
                    const leadingMatch = remainingText.match(leadingTimeRegex);
                    if (leadingMatch) {
                        startTime = leadingMatch[1];
                        endTime = leadingMatch[2] || addMinutesToTime(startTime, 30);
                        remainingText = remainingText.replace(leadingTimeRegex, '').trim();
                    }
                }
            }
        }
    }

    if (startTime) startTime = normalizeTime(startTime);
    if (endTime) endTime = normalizeTime(endTime);

    let gcalEventId: string | null = null;
    const gcalIdMatch = remainingText.match(/\[\s*gcalId::\s*([^\]]+)\]/i);
    if (gcalIdMatch) {
        gcalEventId = gcalIdMatch[1].trim();
        remainingText = remainingText.replace(/\[\s*gcalId::\s*[^\]]+\]/i, '').trim();
    }

    const text = remainingText.trim();

    return {
        id: `${filePath}:${lineNumber}`,
        filePath,
        lineNumber,
        originalLine: line,
        completed,
        statusChar,
        text,
        startTime,
        endTime,
        date,
        priority,
        recurrence,
        dueDate,
        scheduledDate,
        startDate,
        completionDate,
        cancelledDate,
        gcalEventId
    };
}

// Vault 내의 모든 마크다운 파일에서 할 일 파싱
/** Syncthing conflict copies, e.g. `Note.sync-conflict-20260927-101500-ABCDEFG.md` */
export function isSyncConflictPath(path: string): boolean {
    return /\.sync-conflict-/i.test(path);
}

export async function scanVaultTasks(app: App): Promise<TaskItem[]> {
    const files = app.vault.getMarkdownFiles().filter(f => !isSyncConflictPath(f.path));
    const tasks: TaskItem[] = [];

    const plugin = (app as any).plugins?.getPlugin('obsidian-day-planner-pro');
    const excludeLines = (plugin?.settings?.excludePaths || []).filter((p: string) => p.trim().length > 0);
    const excludeMode = plugin?.settings?.excludeMatchMode || 'any';

    for (const file of files) {
        let isExcluded = false;
        if (excludeLines.length > 0) {
            if (excludeMode === 'all') {
                isExcluded = excludeLines.every((excludePath: string) => {
                    const normalizedExclude = excludePath.replace(/\\/g, '/').toLowerCase();
                    const normalizedFilePath = file.path.replace(/\\/g, '/').toLowerCase();
                    return normalizedFilePath.startsWith(normalizedExclude);
                });
            } else {
                isExcluded = excludeLines.some((excludePath: string) => {
                    const normalizedExclude = excludePath.replace(/\\/g, '/').toLowerCase();
                    const normalizedFilePath = file.path.replace(/\\/g, '/').toLowerCase();
                    return normalizedFilePath.startsWith(normalizedExclude);
                });
            }
        }
        if (isExcluded) continue;

        const plugin = (app as any).plugins?.plugins?.['obsidian-day-planner-pro'];
        const dailyNotesFormat = plugin?.settings?.dailyNotesFormat;

        const content = await app.vault.read(file);
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const parsed = parseTaskLine(lines[i], file.path, i, dailyNotesFormat);
            if (parsed) {
                tasks.push(parsed);
            }
        }
    }
    return tasks;
}

// 파일 내 할 일 수정 및 동기화 [GCal 자동 연동 코드를 완전히 소거한 순수 파일 동기화로 원복]
export async function updateTaskInFile(
    app: App, 
    task: TaskItem, 
    updates: Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>>
): Promise<boolean> {
    const file = app.vault.getAbstractFileByPath(task.filePath);
    if (!(file instanceof TFile)) return false;

    const content = await app.vault.read(file);
    const lines = content.split('\n');

    let targetIndex = task.lineNumber;
    if (lines[targetIndex] !== task.originalLine) {
        targetIndex = lines.indexOf(task.originalLine);
    }

    if (targetIndex === -1) {
        targetIndex = lines.findIndex(l => l.includes(task.text));
    }

    if (targetIndex !== -1) {
        const statusCharVal = updates.statusChar !== undefined ? updates.statusChar : task.statusChar;
        const textVal = updates.text !== undefined ? updates.text : task.text;
        const startTimeVal = updates.startTime !== undefined ? updates.startTime : task.startTime;
        const endTimeVal = updates.endTime !== undefined ? updates.endTime : task.endTime;
        const dateVal = updates.date !== undefined ? updates.date : task.date;
        const priorityVal = updates.priority !== undefined ? updates.priority : task.priority;

        const recurrenceVal = updates.recurrence !== undefined ? updates.recurrence : task.recurrence;
        let dueDateVal = updates.dueDate !== undefined ? updates.dueDate : task.dueDate;
        let scheduledDateVal = updates.scheduledDate !== undefined ? updates.scheduledDate : task.scheduledDate;
        const startDateVal = updates.startDate !== undefined ? updates.startDate : task.startDate;
        
        let completionDateVal = updates.completionDate !== undefined ? updates.completionDate : task.completionDate;
        let cancelledDateVal = updates.cancelledDate !== undefined ? updates.cancelledDate : task.cancelledDate;

        if (statusCharVal === 'x' && !completionDateVal) {
            completionDateVal = (window as any).moment().format('YYYY-MM-DD');
            cancelledDateVal = null;
        } else if (statusCharVal === '-' && !cancelledDateVal) {
            cancelledDateVal = (window as any).moment().format('YYYY-MM-DD');
            completionDateVal = null;
        } else if (statusCharVal === ' ' || statusCharVal === '/') {
            completionDateVal = null;
            cancelledDateVal = null;
        }

        if (updates.date !== undefined) {
            if (scheduledDateVal) scheduledDateVal = dateVal;
            else if (dueDateVal) dueDateVal = dateVal;
            else scheduledDateVal = dateVal;
        }

        const gcalEventIdVal = updates.gcalEventId !== undefined ? updates.gcalEventId : task.gcalEventId;

        let newLine = `- [${statusCharVal}] ${textVal}`;
        if (startTimeVal && endTimeVal) {
            newLine += ` ⏰${startTimeVal}-${endTimeVal}`;
        }
        if (gcalEventIdVal) {
            newLine += ` [gcalId:: ${gcalEventIdVal}]`;
        }
        if (priorityVal && priorityVal !== 'normal') {
            const priorityEmojis = {
                highest: '🔺',
                high: '⏫',
                medium: '🔼',
                low: '🔽',
                lowest: '⏬'
            };
            newLine += ` ${priorityEmojis[priorityVal]}`;
        }
        if (recurrenceVal) {
            newLine += ` 🔁 ${recurrenceVal}`;
        }
        if (startDateVal) {
            newLine += ` 🛫 ${startDateVal}`;
        }
        if (scheduledDateVal) {
            newLine += ` ⏳ ${scheduledDateVal}`;
        }
        if (dueDateVal) {
            newLine += ` 📅 ${dueDateVal}`;
        }
        if (completionDateVal) {
            newLine += ` ✅ ${completionDateVal}`;
        }
        if (cancelledDateVal) {
            newLine += ` ❌ ${cancelledDateVal}`;
        }

        lines[targetIndex] = newLine;

        // Tasks 플러그인 차기 반복 일정 생성 주입 규칙 적용
        if (statusCharVal === 'x' && recurrenceVal && (task.statusChar !== 'x')) {
            const baseDate = scheduledDateVal || dueDateVal || dateVal || (window as any).moment().format('YYYY-MM-DD');
            const nextDate = getNextRecurrenceDate(baseDate, recurrenceVal);

            let nextLine = `- [ ] ${textVal}`;
            if (startTimeVal && endTimeVal) {
                nextLine += ` ⏰${startTimeVal}-${endTimeVal}`;
            }
            if (recurrenceVal) {
                nextLine += ` 🔁 ${recurrenceVal}`;
            }
            if (startDateVal) {
                nextLine += ` 🛫 ${nextDate}`;
            }
            if (scheduledDateVal) {
                nextLine += ` ⏳ ${nextDate}`;
            }
            if (dueDateVal && !scheduledDateVal) {
                nextLine += ` 📅 ${nextDate}`;
            }
            if (priorityVal && priorityVal !== 'normal') {
                const priorityEmojis = {
                    highest: '🔺',
                    high: '⏫',
                    medium: '🔼',
                    low: '🔽',
                    lowest: '⏬'
                };
                nextLine += ` ${priorityEmojis[priorityVal]}`;
            }

            lines.splice(targetIndex + 1, 0, nextLine);
        }

        await app.vault.modify(file, lines.join('\n'));

        task.originalLine = newLine;
        task.statusChar = statusCharVal;
        task.completed = statusCharVal.toLowerCase() === 'x';
        task.text = textVal;
        task.startTime = startTimeVal;
        task.endTime = endTimeVal;
        task.date = dateVal;
        task.priority = priorityVal;
        task.recurrence = recurrenceVal;
        task.dueDate = dueDateVal;
        task.scheduledDate = scheduledDateVal;
        task.startDate = startDateVal;
        task.completionDate = completionDateVal;
        task.cancelledDate = cancelledDateVal;
        task.gcalEventId = gcalEventIdVal;
        task.lineNumber = targetIndex;
        return true;
    }

    return false;
}

// 대상 태스크 저장 마크다운 파일 경로 결정 헬퍼 함수
export function getTargetTaskFilePath(app: App, settings: DayPlannerSettings, dateStr?: string | null): string {
    const targetDate = dateStr || (window as any).moment().format('YYYY-MM-DD');
    
    const folder = settings.dailyNotesFolder ? settings.dailyNotesFolder.trim().replace(/\/$/, '') + '/' : '';
    const format = settings.dailyNotesFormat || 'YYYY-MM-DD';
    const fileName = (window as any).moment(targetDate, 'YYYY-MM-DD').format(format);
    const dailyNotePath = `${folder}${fileName}.md`;

    if (settings.dailyNotesFolder || settings.dailyNotesFormat !== 'YYYY-MM-DD' || app.vault.getAbstractFileByPath(dailyNotePath)) {
        return dailyNotePath;
    }

    if (settings.defaultTaskFile && settings.defaultTaskFile.trim().length > 0) {
        let path = settings.defaultTaskFile.trim();
        if (!path.endsWith('.md')) path += '.md';
        return path;
    }

    return 'Day Planner.md';
}

// 새 할 일 생성
export async function createNewTaskInFile(
    app: App,
    filePath: string,
    text: string,
    date: string | null,
    startTime: string | null,
    endTime: string | null,
    statusChar: string = ' ',
    priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest' = 'normal',
    gcalEventId: string | null = null
): Promise<void> {
    let file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
        file = await app.vault.create(filePath, '# Day Planner Tasks\n\n');
    }

    const content = await app.vault.read(file as TFile);
    let newLine = `- [${statusChar}] ${text}`;
    if (startTime && endTime) {
        newLine += ` ⏰${startTime}-${endTime}`;
    }
    if (gcalEventId) {
        newLine += ` [gcalId:: ${gcalEventId}]`;
    }
    if (priority && priority !== 'normal') {
        const priorityEmojis = {
            highest: '🔺',
            high: '⏫',
            medium: '🔼',
            low: '🔽',
            lowest: '⏬'
        };
        newLine += ` ${priorityEmojis[priority]}`;
    }
    if (date) {
        newLine += ` ⏳ ${date}`;
    }

    const updatedContent = content.endsWith('\n') ? content + newLine + '\n' : content + '\n' + newLine + '\n';
    await app.vault.modify(file as TFile, updatedContent);
}

// 에디터에서 해당 라인으로 포커싱 이동
export async function openTaskInEditor(app: App, task: TaskItem) {
    const file = app.vault.getAbstractFileByPath(task.filePath);
    if (file instanceof TFile) {
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file);
        
        setTimeout(() => {
            const view = leaf.view as any;
            if (view && view.editor) {
                const editor = view.editor;
                editor.setCursor({ line: task.lineNumber, ch: 0 });
                editor.scrollIntoView({ from: { line: task.lineNumber, ch: 0 }, to: { line: task.lineNumber, ch: 0 } }, true);
            }
        }, 150);
    } else {
        new Notice('Target markdown file could not be found.');
    }
}

// 캘린더 겹침 정지 레이아웃 계산 함수
export function calculateClusteredLayout(timedItems: Array<{ 
    type: 'task' | 'gcal'; 
    refId: string;
    text: string; 
    startMin: number; 
    endMin: number; 
    completed?: boolean;
    taskRef?: TaskItem;
    color?: string;
    location?: string;
    description?: string;
    colIdx?: number;
    maxCols?: number;
}>) {
    if (timedItems.length === 0) return;

    timedItems.sort((a, b) => {
        if (a.startMin !== b.startMin) return a.startMin - b.startMin;
        return (b.endMin - b.startMin) - (a.endMin - a.startMin);
    });

    const clusters: typeof timedItems[] = [];
    timedItems.forEach(item => {
        let assignedCluster: typeof timedItems | null = null;
        for (const cluster of clusters) {
            const overlaps = cluster.some(cItem => 
                item.startMin < cItem.endMin && item.endMin > cItem.startMin
            );
            if (overlaps) {
                assignedCluster = cluster;
                break;
            }
        }
        if (assignedCluster) {
            assignedCluster.push(item);
        } else {
            clusters.push([item]);
        }
    });

    clusters.forEach(cluster => {
        const columns: typeof timedItems[] = [];
        cluster.forEach(item => {
            let colIdx = 0;
            while (true) {
                if (!columns[colIdx]) {
                    columns[colIdx] = [];
                }
                const hasOverlap = columns[colIdx].some(cItem => 
                    item.startMin < cItem.endMin && item.endMin > cItem.startMin
                );
                if (!hasOverlap) {
                    columns[colIdx].push(item);
                    item.colIdx = colIdx;
                    break;
                }
                colIdx++;
            }
        });

        cluster.forEach(item => {
            const overlappingItems = cluster.filter(cItem => 
                item.startMin < cItem.endMin && item.endMin > cItem.startMin
            );
            const maxColIdx = Math.max(...overlappingItems.map(cItem => cItem.colIdx || 0));
            item.maxCols = maxColIdx + 1;
        });
    });
}