import { ItemView, WorkspaceLeaf, TFile, Notice, App, Menu, MarkdownRenderChild } from 'obsidian';
import { TaskItem, GCalEvent, GCAL_CACHE_TTL_MS } from './types';
import { 
    cleanTaskTextForDisplay, 
    compareTasks, 
    createCustomCheckbox, 
    openDailyNoteForDate, 
    openWeeklyNoteForDate, 
    parseTaskLine, 
    scanVaultTasks, 
    updateTaskInFile as rawUpdateTaskInFile, 
    createNewTaskInFile as rawCreateNewTaskInFile, 
    openTaskInEditor, 
    calculateClusteredLayout,
    formatMinutesNice,
    getTargetTaskFilePath,
    isSyncConflictPath,
    addMinutesToTime
} from './utils';
import { patchGoogleCalendarEvent, updateGoogleCalendarEvent, syncTaskToGCal, syncAllTasksToGCal } from './gcalApi';
import { TaskEditModal, GCalEventEditModal, AddChoiceModal, TaskSyncModal } from './modals';
import DayPlannerPlugin from './main';

type TabPillMemo = { key: string; left: number; width: number };

/**
 * The header is rebuilt on every tab switch, so a CSS transition has nothing to transition from.
 * Instead, remember the previous active tab's geometry and let the new pill play a FLIP slide from there.
 */
function animateActiveTabPill(tabsContainer: HTMLElement, owner: { tabPillMemo?: TabPillMemo }, activeKey: string) {
    const activeEl = tabsContainer.querySelector(':scope > .dp-tab.active') as HTMLElement | null;
    if (!activeEl) return;
    const left = activeEl.offsetLeft;
    const width = activeEl.offsetWidth;
    const prev = owner.tabPillMemo;
    if (prev && prev.key !== activeKey && prev.width > 0 && width > 0) { // width 0 = hidden leaf, nothing to slide from
        activeEl.style.setProperty('--dp-pill-dx', `${prev.left - left}px`);
        activeEl.style.setProperty('--dp-pill-sx', String(prev.width / width));
        activeEl.addClass('dp-tab-pill-slide');
    }
    owner.tabPillMemo = { key: activeKey, left, width };
}

function showTaskUndoNotice(
    app: App,
    task: TaskItem,
    previous: Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>>
) {
    const notice = new Notice('', 8000);
    const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
    if (!messageEl) return;

    messageEl.empty();
    const cleanText = cleanTaskTextForDisplay(task.text);
    const displayText = cleanText.length > 20 ? cleanText.substring(0, 17) + '...' : cleanText;
    messageEl.createSpan({ text: `Updated "${displayText}". ` });
    const undoBtn = messageEl.createEl('button', { text: 'Undo' });
    undoBtn.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const plugin = (app as any).plugins?.getPlugin('obsidian-day-planner-pro');
        plugin?.markSelfWrite(task.filePath);
        const success = await rawUpdateTaskInFile(app, task, previous);
        if (success) {
            notice.hide();
            new Notice('Task edit undone.');
            const file = app.vault.getAbstractFileByPath(task.filePath);
            if (plugin && file instanceof TFile) {
                await plugin.updateCacheForFile(file, true);
            }
            if (plugin && plugin.settings.enableGoogleCalendar && plugin.settings.taskSyncCalendarId) {
                syncTaskToGCal(plugin, task, plugin.settings.taskSyncCalendarId).catch(err => {
                    console.error('Error auto-syncing task undo to Google Calendar:', err);
                });
            }
        }
    });
}

export function showGCalEventUndoNotice(
    plugin: DayPlannerPlugin,
    calendarId: string,
    eventId: string,
    previous: {
        summary: string;
        description?: string;
        location?: string;
        dateStr: string;
        endDateStr?: string;
        startTimeStr?: string | null;
        endTimeStr?: string | null;
        isAllDay: boolean;
    }
) {
    const notice = new Notice('', 8000);
    const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
    if (!messageEl) return;

    messageEl.empty();
    const displayText = previous.summary.length > 20 ? previous.summary.substring(0, 17) + '...' : previous.summary;
    messageEl.createSpan({ text: `Updated "${displayText}". ` });
    const undoBtn = messageEl.createEl('button', { text: 'Undo' });
    undoBtn.addEventListener('click', async (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const cached = plugin.gcalCache.find((ev: any) => ev.id === eventId);
        if (cached) {
            const moment = (window as any).moment;
            cached.summary = previous.summary;
            cached.description = previous.description || '';
            cached.location = previous.location || '';
            cached.dateStr = previous.dateStr;
            cached.startTimeStr = previous.startTimeStr ?? null;
            cached.endTimeStr = previous.endTimeStr ?? null;
            cached.isAllDay = previous.isAllDay;
            if (previous.endDateStr) {
                cached.end = previous.isAllDay 
                    ? moment(previous.endDateStr, 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD')
                    : previous.endDateStr;
            }
        }

        const success = await updateGoogleCalendarEvent(plugin, calendarId, eventId, previous);
        if (success) {
            notice.hide();
            new Notice('Google Calendar edit undone.');
            plugin.refreshActiveViews(true);
        }
    });
}

async function updateTaskInFile(
    app: App,
    task: TaskItem,
    updates: Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>>
): Promise<boolean> {
    const previous = {
        text: task.text,
        statusChar: task.statusChar,
        priority: task.priority,
        date: task.date,
        startTime: task.startTime,
        endTime: task.endTime,
        recurrence: task.recurrence,
        dueDate: task.dueDate,
        scheduledDate: task.scheduledDate,
        startDate: task.startDate,
        completionDate: task.completionDate,
        cancelledDate: task.cancelledDate,
        gcalEventId: task.gcalEventId
    };
    const plugin = (app as any).plugins?.getPlugin('obsidian-day-planner-pro');
    if (plugin?.settings.enableGoogleCalendar && plugin.settings.taskSyncCalendarId) plugin.markSelfWrite(task.filePath);
    const success = await rawUpdateTaskInFile(app, task, updates);
    if (success) {
        showTaskUndoNotice(app, task, previous);
        if (plugin && plugin.settings.enableGoogleCalendar && plugin.settings.taskSyncCalendarId) {
            syncTaskToGCal(plugin, task, plugin.settings.taskSyncCalendarId).catch(err => {
                console.error('Error auto-syncing task to Google Calendar:', err);
            });
        }
    }
    return success;
}

async function createNewTaskInFile(
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
    await rawCreateNewTaskInFile(app, filePath, text, date, startTime, endTime, statusChar, priority, gcalEventId);
}

interface FilterRule {
    kind?: 'rule';
    id?: string;
    type: 'folder' | 'file' | 'tag' | 'status' | 'priority' | 'text' | 'itemType' | 'date';
    operator: 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'isHigher' | 'isLower' | 'isBefore' | 'isAfter' | 'isEmpty' | 'isNotEmpty';
    value: string;
}

interface FilterGroup {
    kind?: 'group';
    id?: string;
    mode: 'all' | 'any' | 'none';
    rules?: FilterRule[];
    children?: (FilterRule | FilterGroup)[];
}

function parseFilterGroup(obj: any): FilterGroup {
    const mode = obj.mode || 'all';
    const children: (FilterRule | FilterGroup)[] = [];
    if (Array.isArray(obj.children)) {
        for (const child of obj.children) {
            if (child.kind === 'group') {
                children.push(parseFilterGroup(child));
            } else {
                children.push({
                    kind: 'rule',
                    id: child.id || Math.random().toString(36).substring(2, 9),
                    type: child.type || 'text',
                    operator: child.operator || 'contains',
                    value: child.value !== undefined ? String(child.value) : ''
                });
            }
        }
    } else if (Array.isArray(obj.rules)) {
        for (const r of obj.rules) {
            children.push({
                kind: 'rule',
                id: Math.random().toString(36).substring(2, 9),
                type: r.type || 'text',
                operator: r.operator || 'contains',
                value: r.value !== undefined ? String(r.value) : ''
            });
        }
    }
    return {
        kind: 'group',
        id: obj.id || 'root',
        mode,
        children
    };
}

function isFilterGroup(node: FilterRule | FilterGroup): node is FilterGroup {
    const n = node as FilterGroup;
    return n.kind === 'group' || (n.children !== undefined && n.rules === undefined);
}

function serializeFilterNode(node: FilterRule | FilterGroup, indent: string): string[] {
    const lines: string[] = [];
    if (isFilterGroup(node)) {
        lines.push(`${indent}- kind: group`);
        lines.push(`${indent}  mode: ${node.mode}`);
        if (node.children && node.children.length > 0) {
            lines.push(`${indent}  children:`);
            for (const child of node.children) {
                lines.push(...serializeFilterNode(child, indent + '    '));
            }
        }
    } else {
        lines.push(`${indent}- kind: rule`);
        lines.push(`${indent}  type: ${node.type}`);
        lines.push(`${indent}  operator: ${node.operator}`);
        lines.push(`${indent}  value: "${node.value.replace(/"/g, '\\"')}"`);
    }
    return lines;
}

function debounce(func: Function, wait: number) {
    let timeout: any;
    return function(...args: any[]) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function matchFilterRule(task: TaskItem, rule: FilterRule): boolean {
    const type = rule.type;
    const op = rule.operator;
    const val = rule.value.toLowerCase().trim();

    let taskValue = '';
    if (type === 'itemType') {
        taskValue = 'task';
    } else if (type === 'folder') {
        const lastSlash = task.filePath.lastIndexOf('/');
        const folder = lastSlash === -1 ? '' : task.filePath.substring(0, lastSlash);
        taskValue = folder.toLowerCase();
    } else if (type === 'file') {
        const lastSlash = task.filePath.lastIndexOf('/');
        const filename = lastSlash === -1 ? task.filePath : task.filePath.substring(lastSlash + 1);
        taskValue = filename.toLowerCase();
    } else if (type === 'tag') {
        const tags = Array.from(task.text.matchAll(/#([a-zA-Z0-9_\-\/]+)/g)).map(m => m[1].toLowerCase());
        const cleanVal = val.startsWith('#') ? val.substring(1) : val;
        const matched = tags.some(tag => tag === cleanVal || tag.startsWith(cleanVal + '/'));
        if (op === 'contains') return matched;
        if (op === 'notContains') return !matched;
        if (op === 'equals') return tags.includes(cleanVal);
        if (op === 'notEquals') return !tags.includes(cleanVal);
        return false;
    } else if (type === 'status') {
        let status = 'todo';
        if (task.completed || task.statusChar === 'x') status = 'completed';
        else if (task.statusChar === '/') status = 'in-progress';
        else if (task.statusChar === '-') status = 'cancelled';
        taskValue = status;
    } else if (type === 'priority') {
        taskValue = task.priority;
    } else if (type === 'text') {
        taskValue = task.text.toLowerCase();
    } else if (type === 'date') {
        const itemDate = task.date || ''; // YYYY-MM-DD
        const moment = (window as any).moment;
        
        if (op === 'isEmpty') {
            return !itemDate;
        }
        if (op === 'isNotEmpty') {
            return !!itemDate;
        }
        if (!itemDate) {
            return false;
        }

        if (val === 'today' || val === 'yesterday' || val === 'tomorrow' || val === 'this week' || val === 'this month' || val === 'this year') {
            const refDate = moment();
            if (val === 'yesterday') refDate.subtract(1, 'day');
            if (val === 'tomorrow') refDate.add(1, 'day');

            const itemMoment = moment(itemDate, 'YYYY-MM-DD', true);
            if (!itemMoment.isValid()) return false;

            if (val === 'this week') {
                if (op === 'equals') return itemMoment.isSame(moment(), 'week');
                if (op === 'notEquals') return !itemMoment.isSame(moment(), 'week');
                if (op === 'isBefore') return itemDate < moment().startOf('week').format('YYYY-MM-DD');
                if (op === 'isAfter') return itemDate > moment().endOf('week').format('YYYY-MM-DD');
            } else if (val === 'this month') {
                if (op === 'equals') return itemMoment.isSame(moment(), 'month');
                if (op === 'notEquals') return !itemMoment.isSame(moment(), 'month');
                if (op === 'isBefore') return itemDate < moment().startOf('month').format('YYYY-MM-DD');
                if (op === 'isAfter') return itemDate > moment().endOf('month').format('YYYY-MM-DD');
            } else if (val === 'this year') {
                if (op === 'equals') return itemMoment.isSame(moment(), 'year');
                if (op === 'notEquals') return !itemMoment.isSame(moment(), 'year');
                if (op === 'isBefore') return itemDate < moment().startOf('year').format('YYYY-MM-DD');
                if (op === 'isAfter') return itemDate > moment().endOf('year').format('YYYY-MM-DD');
            } else {
                const targetStr = refDate.format('YYYY-MM-DD');
                if (op === 'equals') return itemDate === targetStr;
                if (op === 'notEquals') return itemDate !== targetStr;
                if (op === 'isBefore') return itemDate < targetStr;
                if (op === 'isAfter') return itemDate > targetStr;
            }
            return false;
        }

        if (op === 'equals') return itemDate === val;
        if (op === 'notEquals') return itemDate !== val;
        if (op === 'isBefore') return itemDate < val;
        if (op === 'isAfter') return itemDate > val;
        return false;
    }

    if (type === 'priority' && (op === 'isHigher' || op === 'isLower')) {
        const prioritiesOrder = ['lowest', 'low', 'normal', 'medium', 'high', 'highest'];
        const taskIdx = prioritiesOrder.indexOf(taskValue);
        const valIdx = prioritiesOrder.indexOf(val);
        if (taskIdx === -1 || valIdx === -1) return false;
        if (op === 'isHigher') return taskIdx > valIdx;
        if (op === 'isLower') return taskIdx < valIdx;
    }

    if (op === 'contains') {
        return taskValue.includes(val);
    } else if (op === 'notContains') {
        return !taskValue.includes(val);
    } else if (op === 'equals') {
        return taskValue === val;
    } else if (op === 'notEquals') {
        return taskValue !== val;
    } else if (op === 'startsWith') {
        return taskValue.startsWith(val);
    } else if (op === 'endsWith') {
        return taskValue.endsWith(val);
    }
    return false;
}

function matchFilterGroup(task: TaskItem, group: FilterGroup): boolean {
    if (group.children) {
        if (group.children.length === 0) return true;
        const matches = group.children.map(child => {
            if (child.kind === 'group' || (child as any).children !== undefined) {
                return matchFilterGroup(task, child as FilterGroup);
            } else {
                return matchFilterRule(task, child as FilterRule);
            }
        });
        if (group.mode === 'all') return matches.every(m => m === true);
        if (group.mode === 'any') return matches.some(m => m === true);
        if (group.mode === 'none') return !matches.some(m => m === true);
        return true;
    } else if (group.rules) {
        if (group.rules.length === 0) return true;
        if (group.mode === 'all') {
            return group.rules.every(rule => matchFilterRule(task, rule));
        } else if (group.mode === 'any') {
            return group.rules.some(rule => matchFilterRule(task, rule));
        } else if (group.mode === 'none') {
            return !group.rules.some(rule => matchFilterRule(task, rule));
        }
    }
    return true;
}

export function getSpannedDates(e: GCalEvent): string[] {
    const dates: string[] = [];
    const moment = (window as any).moment;
    if (e.isAllDay) {
        const startMom = moment(e.start, 'YYYY-MM-DD');
        const endMom = moment(e.end, 'YYYY-MM-DD');
        let current = startMom.clone();
        while (current.isBefore(endMom, 'day')) {
            dates.push(current.format('YYYY-MM-DD'));
            current.add(1, 'day');
        }
    } else {
        const startMom = moment(e.start).startOf('day');
        const endMom = moment(e.end).startOf('day');
        let current = startMom.clone();
        while (current.isSameOrBefore(endMom, 'day')) {
            dates.push(current.format('YYYY-MM-DD'));
            current.add(1, 'day');
        }
    }
    if (dates.length === 0) {
        dates.push(e.dateStr);
    }
    return dates;
}

function matchGCalEventRule(event: GCalEvent, rule: FilterRule): boolean {
    const type = rule.type;
    const op = rule.operator;
    const val = rule.value.toLowerCase().trim();

    let eventValue = '';
    if (type === 'itemType') {
        eventValue = 'gcal';
    } else if (type === 'text') {
        eventValue = (event.summary + ' ' + (event.description || '')).toLowerCase();
    } else if (type === 'tag') {
        const text = event.summary + ' ' + (event.description || '');
        const tags = Array.from(text.matchAll(/#([a-zA-Z0-9_\-\/]+)/g)).map(m => m[1].toLowerCase());
        const cleanVal = val.startsWith('#') ? val.substring(1) : val;
        const matched = tags.some(tag => tag === cleanVal || tag.startsWith(cleanVal + '/'));
        if (op === 'contains') return matched;
        if (op === 'notContains') return !matched;
        if (op === 'equals') return tags.includes(cleanVal);
        if (op === 'notEquals') return !tags.includes(cleanVal);
        return false;
    } else if (type === 'date') {
        const moment = (window as any).moment;
        const spanned = getSpannedDates(event);
        if (spanned.length === 0) return false;

        const firstDate = spanned[0];
        const lastDate = spanned[spanned.length - 1];

        if (op === 'isEmpty') {
            return false;
        }
        if (op === 'isNotEmpty') {
            return true;
        }

        if (val === 'today' || val === 'yesterday' || val === 'tomorrow' || val === 'this week' || val === 'this month' || val === 'this year') {
            let startRange: string;
            let endRange: string;

            if (val === 'yesterday') {
                const d = moment().subtract(1, 'day').format('YYYY-MM-DD');
                startRange = d;
                endRange = d;
            } else if (val === 'tomorrow') {
                const d = moment().add(1, 'day').format('YYYY-MM-DD');
                startRange = d;
                endRange = d;
            } else if (val === 'this week') {
                startRange = moment().startOf('week').format('YYYY-MM-DD');
                endRange = moment().endOf('week').format('YYYY-MM-DD');
            } else if (val === 'this month') {
                startRange = moment().startOf('month').format('YYYY-MM-DD');
                endRange = moment().endOf('month').format('YYYY-MM-DD');
            } else if (val === 'this year') {
                startRange = moment().startOf('year').format('YYYY-MM-DD');
                endRange = moment().endOf('year').format('YYYY-MM-DD');
            } else { // today
                const d = moment().format('YYYY-MM-DD');
                startRange = d;
                endRange = d;
            }

            if (op === 'equals') {
                return spanned.some(d => d >= startRange && d <= endRange);
            }
            if (op === 'notEquals') {
                return !spanned.some(d => d >= startRange && d <= endRange);
            }
            if (op === 'isBefore') {
                return lastDate < startRange;
            }
            if (op === 'isAfter') {
                return firstDate > endRange;
            }
            return false;
        }

        if (op === 'equals') return spanned.includes(val);
        if (op === 'notEquals') return !spanned.includes(val);
        if (op === 'isBefore') return lastDate < val;
        if (op === 'isAfter') return firstDate > val;
        return false;
    } else {
        return false;
    }

    if (op === 'contains') {
        return eventValue.includes(val);
    } else if (op === 'notContains') {
        return !eventValue.includes(val);
    } else if (op === 'equals') {
        return eventValue === val;
    } else if (op === 'notEquals') {
        return eventValue !== val;
    } else if (op === 'startsWith') {
        return eventValue.startsWith(val);
    } else if (op === 'endsWith') {
        return eventValue.endsWith(val);
    }
    return false;
}

function matchGCalEventGroup(event: GCalEvent, group: FilterGroup): boolean {
    if (group.children) {
        if (group.children.length === 0) return true;
        const matches = group.children.map(child => {
            if (child.kind === 'group' || (child as any).children !== undefined) {
                return matchGCalEventGroup(event, child as FilterGroup);
            } else {
                return matchGCalEventRule(event, child as FilterRule);
            }
        });
        if (group.mode === 'all') return matches.every(m => m === true);
        if (group.mode === 'any') return matches.some(m => m === true);
        if (group.mode === 'none') return !matches.some(m => m === true);
        return true;
    } else if (group.rules) {
        if (group.rules.length === 0) return true;
        if (group.mode === 'all') {
            return group.rules.every(rule => matchGCalEventRule(event, rule));
        } else if (group.mode === 'any') {
            return group.rules.some(rule => matchGCalEventRule(event, rule));
        } else if (group.mode === 'none') {
            return !group.rules.some(rule => matchGCalEventRule(event, rule));
        }
    }
    return true;
}

export abstract class DayPlannerBaseView extends ItemView {
    plugin: DayPlannerPlugin;
    tasks: TaskItem[] = [];
    currentDate: any;
    collapsedColumns: Set<string> = new Set();

    getGCalRange(): { cacheKey: string; timeMin: Date; timeMax: Date } {
        const center = this.currentDate;
        const tabType = this.getViewTabType();
        if (tabType === 'daily') {
            return { cacheKey: `daily_${center.format('YYYY-MM-DD')}`, timeMin: center.clone().startOf('day').toDate(), timeMax: center.clone().endOf('day').toDate() };
        } else if (tabType === 'multiDay') {
            const days = Math.max(2, Math.min(14, this.plugin.settings.nDayViewDays || 4));
            return { cacheKey: `multi_${center.format('YYYY-MM-DD')}_${days}`, timeMin: center.clone().startOf('day').toDate(), timeMax: center.clone().add(days - 1, 'days').endOf('day').toDate() };
        } else if (tabType === 'weekly') {
            return { cacheKey: `weekly_${center.clone().startOf('week').format('YYYY-MM-DD')}`, timeMin: center.clone().startOf('week').toDate(), timeMax: center.clone().endOf('week').toDate() };
        } else if (tabType === 'monthly' || tabType === 'list') {
            return { cacheKey: `monthly_${center.format('YYYY-MM')}`, timeMin: center.clone().startOf('month').toDate(), timeMax: center.clone().endOf('month').toDate() };
        }
        return { cacheKey: `board_${center.format('YYYY-MM-DD')}`, timeMin: center.clone().subtract(7, 'days').toDate(), timeMax: center.clone().add(7, 'days').toDate() };
    }

    getCalendarEvents(): GCalEvent[] {
        let cache = this.plugin.gcalRanges.get(this.getGCalRange().cacheKey)?.events || [];
        const self = this as any;
        if (self.parentNoteType === 'daily' && self.parentNoteDate) {
            const targetDate = self.parentNoteDate;
            cache = cache.filter(e => {
                const spanned = this.getSpannedDatesForEvent(e);
                return spanned.includes(targetDate);
            });
        } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
            const moment = (window as any).moment;
            const startOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week');
            const endOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week');
            cache = cache.filter(e => {
                const spanned = this.getSpannedDatesForEvent(e);
                return spanned.some(dateStr => {
                    const d = moment(dateStr, 'YYYY-MM-DD');
                    return d.isSameOrAfter(startOfWeek, 'day') && d.isSameOrBefore(endOfWeek, 'day');
                });
            });
        }
        const filters = (this as any).filters;
        if (filters) {
            if (filters.children && filters.children.length > 0) {
                return cache.filter(e => matchGCalEventGroup(e, filters));
            } else if (filters.rules && filters.rules.length > 0) {
                return cache.filter(e => matchGCalEventGroup(e, parseFilterGroup(filters)));
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
                ...(this.plugin.settings.enableGoogleCalendar ? dateStrs.flatMap(d => this.getCalendarEventsForDate(d)) : []).map(e => toMin(e.startTimeStr))
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

    getCalendarEventsForDate(dateStr: string): GCalEvent[] {
        const events: GCalEvent[] = [];
        const moment = (window as any).moment;
        
        this.getCalendarEvents().forEach(e => {
            const spanned = this.getSpannedDatesForEvent(e);
            if (spanned.includes(dateStr)) {
                let effStartTimeStr = e.startTimeStr;
                let effEndTimeStr = e.endTimeStr;
                
                if (!e.isAllDay) {
                    const startMom = moment(e.start).startOf('day');
                    const endMom = moment(e.end).startOf('day');
                    const targetMom = moment(dateStr, 'YYYY-MM-DD').startOf('day');
                    const isStartDay = targetMom.isSame(startMom, 'day');
                    const isEndDay = targetMom.isSame(endMom, 'day');
                    
                    if (!isStartDay) effStartTimeStr = '00:00';
                    if (!isEndDay) effEndTimeStr = '24:00';
                }
                
                events.push({
                    ...e,
                    dateStr: dateStr,
                    startTimeStr: effStartTimeStr,
                    endTimeStr: effEndTimeStr
                });
            }
        });
        
        return events;
    }
    
    savedScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }> = {};
    lastScrolledKey: string = '';

    selectedTaskIds: Set<string> = new Set();
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    kanbanViewMode: 'kanban' | 'priority' = 'kanban';
    /** Set by the Kanban/Priority toggle so only a mode switch (not every data refresh) plays the reveal animation */
    boardModeSwitched = false;

    activeDragClickOffsetMin: number = 0;
    dragPreviewContainer: HTMLDivElement | null = null;
    activePrimaryTaskId: string = '';
    activeDragItems: Array<{
        id: string;
        height: number;
        offsetY: number;
        itemDateStr: string;
        title: string;
        classes: string;
        bgStyle: string;
        borderStyle: string;
        priorityBadge: string;
        previewContainerEl?: HTMLDivElement;
    }> = [];

    initDragPreview(e: DragEvent, primaryTaskId: string, clickOffsetMin: number, parentElement: HTMLElement) {
        if (!e.dataTransfer) return;

        // Set transparent drag image to hide native ghost preview
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60;

        let primaryStartMin = 0;
        let primaryDateStr = '';

        const primaryTask = this.tasks.find(t => t.id === primaryTaskId);
        if (primaryTask && primaryTask.startTime) {
            const [sh, sm] = primaryTask.startTime.split(':').map(Number);
            primaryStartMin = sh * 60 + sm;
            primaryDateStr = primaryTask.date || '';
        } else {
            const primaryGCal = this.plugin.gcalCache.find(ev => ev.id === primaryTaskId);
            if (primaryGCal && primaryGCal.startTimeStr) {
                const [sh, sm] = primaryGCal.startTimeStr.split(':').map(Number);
                primaryStartMin = sh * 60 + sm;
                primaryDateStr = primaryGCal.dateStr || '';
            }
        }

        this.clearDragPreview(parentElement);
        this.activePrimaryTaskId = primaryTaskId;
        this.activeDragItems = [];

        const rootSearchContainer = this.containerEl || parentElement;

        this.selectedTaskIds.forEach(id => {
            let startMin = 0;
            let durationMin = 30;
            let itemDateStr = primaryDateStr;
            let title = '';
            let priorityBadge = '';

            const task = this.tasks.find(t => t.id === id);
            if (task) {
                if (task.startTime && task.endTime) {
                    const [sh, sm] = task.startTime.split(':').map(Number);
                    const [eh, em] = task.endTime.split(':').map(Number);
                    startMin = sh * 60 + sm;
                    durationMin = Math.max(15, (eh * 60 + em) - startMin);
                }
                if (task.date) itemDateStr = task.date;
                title = cleanTaskTextForDisplay(task.text);
                if (task.priority && task.priority !== 'normal') {
                    priorityBadge = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[task.priority] || '';
                }
            } else {
                const gcal = this.plugin.gcalCache.find(ev => ev.id === id);
                if (gcal) {
                    if (gcal.startTimeStr && gcal.endTimeStr) {
                        const [sh, sm] = gcal.startTimeStr.split(':').map(Number);
                        const [eh, em] = gcal.endTimeStr.split(':').map(Number);
                        startMin = sh * 60 + sm;
                        durationMin = Math.max(15, (eh * 60 + em) - startMin);
                    }
                    if (gcal.dateStr) itemDateStr = gcal.dateStr;
                    title = gcal.summary || 'Google Event';
                }
            }

            const originalEl = rootSearchContainer.querySelector(`[data-task-id="${id}"]`) as HTMLElement;

            const deltaMin = startMin - primaryStartMin;
            const offsetY = deltaMin * ratio;

            let cardHeight = Math.max(25, Math.round(durationMin * ratio));
            let cardClasses = 'dp-timeline-event selected';
            let bgStyle = '';
            let borderStyle = '';

            if (originalEl) {
                if (originalEl.offsetHeight > 0) cardHeight = originalEl.offsetHeight;
                cardClasses = originalEl.className;
                bgStyle = originalEl.style.backgroundImage || ''; // GCal tint is painted as a gradient layer
                borderStyle = originalEl.style.border || '';
                const titleEl = originalEl.querySelector('span.dp-task-text') || originalEl.querySelector('span');
                if (titleEl && titleEl.textContent) title = titleEl.textContent;
                const priorityEl = originalEl.querySelector('.dp-badge-priority');
                if (priorityEl && priorityEl.textContent) priorityBadge = priorityEl.textContent;

                originalEl.style.opacity = '0.35';
            }

            this.activeDragItems.push({
                id: id,
                height: cardHeight,
                offsetY: offsetY,
                itemDateStr: itemDateStr,
                title: title,
                classes: cardClasses,
                bgStyle: bgStyle,
                borderStyle: borderStyle,
                priorityBadge: priorityBadge
            });
        });
    }

    updateDragPreview(e: DragEvent, currentColumn: HTMLElement, clickOffsetMin: number) {
        if (!this.activeDragItems || this.activeDragItems.length === 0) return;

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60;
        const startHour = this.plugin.settings.timelineStartHour ?? 0;
        const endHour = this.plugin.settings.timelineEndHour ?? 24;

        const rect = currentColumn.getBoundingClientRect();
        const dropY = e.clientY - rect.top - clickOffsetMin;

        let snappedMinutes = Math.round((dropY / ratio) / 15) * 15 + (startHour * 60);
        if (snappedMinutes < startHour * 60) snappedMinutes = startHour * 60;
        if (snappedMinutes > (endHour * 60) - 30) snappedMinutes = (endHour * 60) - 30;

        const primarySnappedY = (snappedMinutes - (startHour * 60)) * ratio;

        const currentDateStr = currentColumn.getAttribute('data-date') || '';
        const primaryItem = this.activeDragItems.find(it => it.id === this.activePrimaryTaskId) || this.activeDragItems[0];
        const primaryDateStr = primaryItem ? (primaryItem.itemDateStr || currentDateStr) : currentDateStr;

        const moment = (window as any).moment;
        const primaryMom = moment(primaryDateStr, 'YYYY-MM-DD');
        const targetMom = moment(currentDateStr, 'YYYY-MM-DD');
        const dayDelta = (targetMom.isValid() && primaryMom.isValid()) ? targetMom.diff(primaryMom, 'days') : 0;

        const daysWrapper = currentColumn.closest('.dp-weekly-days-wrapper') || 
                           (this.containerEl ? this.containerEl.querySelector('.dp-weekly-days-wrapper') : null);

        this.activeDragItems.forEach(item => {
            let targetCol: HTMLElement = currentColumn;
            if (daysWrapper && item.itemDateStr && primaryMom.isValid() && targetMom.isValid()) {
                const itemTargetDateStr = moment(item.itemDateStr, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                const foundCol = daysWrapper.querySelector(`[data-date="${itemTargetDateStr}"]`) as HTMLElement;
                if (foundCol) {
                    targetCol = foundCol;
                }
            }

            let cardContainer = item.previewContainerEl;
            if (!cardContainer || !cardContainer.parentElement) {
                cardContainer = document.createElement('div');
                cardContainer.style.cssText = 'position: absolute; pointer-events: none; z-index: 1000; opacity: 0.85; width: 100%; left: 0;';
                
                const previewCard = cardContainer.createDiv({ cls: item.classes });
                previewCard.style.cssText = `
                    position: absolute !important;
                    top: 0px !important;
                    height: ${item.height}px !important;
                    width: 100% !important;
                    left: 0 !important;
                    box-sizing: border-box !important;
                    opacity: 0.9 !important;
                    border: 2px dashed var(--interactive-accent) !important;
                `;
                if (item.bgStyle) previewCard.style.setProperty('background-image', item.bgStyle, 'important');

                const mainRow = previewCard.createDiv();
                mainRow.style.cssText = 'display: flex; align-items: center; width: 100%; height: 100%; gap: 6px; overflow: hidden; min-width: 0; padding: 2px 4px;';
                const titleSpan = mainRow.createEl('span', { text: item.title });
                titleSpan.style.cssText = 'flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85em; font-weight: bold;';
                if (item.priorityBadge) {
                    const badge = mainRow.createSpan({ cls: 'dp-badge dp-badge-priority', text: item.priorityBadge });
                    badge.style.cssText = 'border:none; background:none; margin:0;';
                }

                item.previewContainerEl = cardContainer;
            }

            if (cardContainer.parentElement !== targetCol) {
                targetCol.appendChild(cardContainer);
            }

            const itemTop = primarySnappedY + item.offsetY;
            cardContainer.style.top = `${itemTop}px`;
            cardContainer.style.display = 'block';
        });
    }

    clearDragPreview(parentWrapper: HTMLElement) {
        this.activeDragItems.forEach(item => {
            if (item.previewContainerEl) {
                item.previewContainerEl.remove();
                item.previewContainerEl = undefined;
            }
        });
        this.activeDragItems = [];
        this.activePrimaryTaskId = '';

        if (this.dragPreviewContainer) {
            this.dragPreviewContainer.remove();
            this.dragPreviewContainer = null;
        }

        const rootSearchContainer = this.containerEl || parentWrapper;
        rootSearchContainer.querySelectorAll<HTMLElement>('.dp-timeline-event').forEach((el) => {
            el.style.opacity = '0.98';
        });
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

    async handleDateClick(dateStr: string) {
        await openDailyNoteForDate(this.app, dateStr, this.plugin.settings);
    }

    async onOpen() {
        const container = this.contentEl;
        container.empty();

        const rootEl = container.createDiv({ cls: 'dp-container' });
        this.renderRoot(rootEl);
        
        await this.refreshTasks(null, true);

        // 단축키 시스템 등록
        this.keydownHandler = async (e: KeyboardEvent) => {
            const activeEl = document.activeElement;
            if (activeEl && (
                activeEl.tagName === 'INPUT' || 
                activeEl.tagName === 'TEXTAREA' || 
                activeEl.getAttribute('contenteditable') === 'true'
            )) {
                return;
            }

            const activeView = this.app.workspace.getActiveViewOfType(DayPlannerBaseView);
            if (activeView !== this) {
                return;
            }

            const key = e.key.toLowerCase();

            if (key === 't') {
                e.preventDefault();
                this.currentDate = (window as any).moment();
                await this.refreshTasks(null, true);
                new Notice('Go to Today');
            } else if (key === 'p' || key === 'k') {
                e.preventDefault();
                this.navigateDate(-1);
                await this.refreshTasks(null, true);
            } else if (key === 'n' || key === 'j') {
                e.preventDefault();
                this.navigateDate(1);
                await this.refreshTasks(null, true);
            } else if (key === 'd') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('daily');
                } else {
                    this.plugin.activateView('day-planner-pro-daily');
                }
            } else if (key === 'w') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('weekly');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'weekly');
                }
            } else if (key === 'm') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('monthly');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'monthly');
                }
            } else if (key === 'b') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('board');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'board');
                }
            } else if (key === 'x') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
                    await this.switchTab('multiDay');
                } else {
                    await this.plugin.activateView('day-planner-pro-view', 'multiDay');
                }
            } else if (key === 'l') {
                e.preventDefault();
                if (this instanceof DayPlannerCombinedView) {
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
        return super.onClose();
    }

    /**
     * [성능 개선 버전] 로컬 파일 점진적 캐싱 업데이트 및 구글 캘린더 읽기 동기화
     */
    async refreshTasks(targetFile?: any, forceFetchGCal: boolean = false) {
        try {
            const plugin = this.plugin as any;
            
            if (!plugin.tasksCache) {
                plugin.tasksCache = await scanVaultTasks(this.app);
                plugin.lastScanTime = Date.now();
            }

            if (targetFile instanceof TFile && targetFile.extension === 'md') {
                const content = await this.app.vault.read(targetFile);
                const lines = content.split('\n');
                const fileTasks: TaskItem[] = [];
                for (let i = 0; i < lines.length; i++) {
                    const parsed = parseTaskLine(lines[i], targetFile.path, i, plugin.settings.dailyNotesFormat);
                    if (parsed) {
                        fileTasks.push(parsed);
                    }
                }
                plugin.tasksCache = plugin.tasksCache.filter((t: any) => t.filePath !== targetFile.path).concat(fileTasks);
            } else if (targetFile === 'force') {
                plugin.tasksCache = await scanVaultTasks(this.app);
                plugin.lastScanTime = Date.now();
            }

            this.tasks = plugin.tasksCache;
            const self = this as any;
            if (self.parentNoteType === 'daily' && self.parentNoteDate) {
                const targetDate = self.parentNoteDate;
                this.tasks = this.tasks.filter(t => t.date === targetDate);
            } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
                const moment = (window as any).moment;
                const startOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week');
                const endOfWeek = moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week');
                this.tasks = this.tasks.filter(t => {
                    if (!t.date) return false;
                    const d = moment(t.date, 'YYYY-MM-DD');
                    return d.isSameOrAfter(startOfWeek, 'day') && d.isSameOrBefore(endOfWeek, 'day');
                });
            }
            const filters = (this as any).filters;
            if (filters) {
                if (filters.children && filters.children.length > 0) {
                    this.tasks = this.tasks.filter(task => matchFilterGroup(task, filters));
                } else if (filters.rules && filters.rules.length > 0) {
                    this.tasks = this.tasks.filter(task => matchFilterGroup(task, parseFilterGroup(filters)));
                }
            }
            
            await this.syncGCalRange(forceFetchGCal);

            this.plugin.updateStatusBar();
            this.render();
        } catch (error) {
            console.error("Day Planner Pro: Error in refreshTasks:", error);
            new Notice("Error refreshing tasks: " + (error instanceof Error ? error.message : String(error)));
        }
    }

    /**
     * Loads GCal events for the current tab's range from the in-memory range cache.
     * awaitMissing=false (tab switches) never blocks on the network: a missing range is fetched in the background.
     */
    async syncGCalRange(forceFetch: boolean, awaitMissing: boolean = true) {
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

        if ((!entry && awaitMissing) || forceFetch) {
            // First load of this range or explicit GCal change: wait for fresh events
            await this.plugin.fetchGCalRange(cacheKey, timeMin, timeMax);
        } else if (!entry || Date.now() - entry.fetchedAt > GCAL_CACHE_TTL_MS) {
            // Missing (non-blocking) or stale: render what is cached now, revalidate in background, re-render only on change
            this.plugin.fetchGCalRange(cacheKey, timeMin, timeMax).then(rerenderOnChange);
        }
    }

    render() {
        try {
            const contentOnly = !!(this as any).contentOnlyRender;
            if (!contentOnly) document.querySelectorAll('.dp-sugg-container').forEach(el => el.remove());
            const scrollPositions = new Map<string, { scrollTop: number; scrollLeft: number }>();
            const counts = new Map<string, number>();
            // Tab switches restore their own per-pane scroll; hidden (cached) panes never take part in index matching
            const isTabSwitch = !!(this as any).isTabSwitch;
            const isVisible = (el: Element) => !el.closest('.is-hidden');
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
                const startHour = this.plugin.settings.timelineStartHour ?? 0;
                const endHour = this.plugin.settings.timelineEndHour ?? 24;
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
            
            let sliderContainer = this.containerEl.querySelector('.dp-zoom-slider-floating') as HTMLElement;
            if (showSlider) {
                if (!sliderContainer) {
                    // Contextual slot in the header actions, before Sync/Filter/+ (same slot as the Board mode toggle)
                    const headerActions = this.containerEl.querySelector('.dp-header-actions') as HTMLElement | null;
                    const viewContent = this.contentEl || this.containerEl;
                    sliderContainer = (headerActions ?? viewContent).createDiv({ cls: 'dp-zoom-slider-floating' });
                    headerActions?.prepend(sliderContainer);
                    
                    sliderContainer.createSpan({ 
                        text: '🔍', 
                        title: 'Timeline Zoom'
                    });

                    const slider = sliderContainer.createEl('input', {
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
                    
                    const valueSpan = sliderContainer.createSpan({
                        cls: 'dp-zoom-value',
                        text: `${this.getHourHeight()}px`
                    });

                    slider.addEventListener('input', async () => {
                        try {
                            const newHeight = parseInt(slider.value, 10);
                            valueSpan.setText(`${newHeight}px`);
                            
                            const isCodeBlock = (this as any).updateCodeBlockInFile !== undefined;
                            
                            if (isCodeBlock) {
                                (this as any).hourHeight = newHeight;
                                this.render();
                                (this as any).updateCodeBlockInFile((this as any).viewType, (this as any).filters);
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
                                await this.plugin.saveSettings();
                                
                                const targetTypes = separate 
                                    ? [this.getViewType()] 
                                    : ['day-planner-pro-view', 'day-planner-pro-daily'];
                                    
                                targetTypes.forEach(viewType => {
                                    this.app.workspace.getLeavesOfType(viewType).forEach(leaf => {
                                        const view = leaf.view as any;
                                        if (view && typeof view.render === 'function') {
                                            try {
                                                view.render();
                                            } catch (err) {
                                                console.error(`Failed to render leaf of type ${viewType}:`, err);
                                            }
                                        }
                                    });
                                });
                            }
                        } catch (err) {
                            console.error("Day Planner Pro: Error in slider event listener:", err);
                        }
                    });
                }
                
                const slider = sliderContainer.querySelector('input') as HTMLInputElement;
                if (slider) {
                    slider.value = String(this.getHourHeight());
                }
                const valueSpan = sliderContainer.querySelector('.dp-zoom-value');
                if (valueSpan) {
                    valueSpan.setText(`${this.getHourHeight()}px`);
                }
                sliderContainer.style.display = 'flex';
            } else {
                if (sliderContainer) {
                    sliderContainer.style.display = 'none';
                }
            }
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
     * 사이드바 너비를 고려한 완전 반응형 멀티레이아웃 렌더링 내비게이터 헤더
     */
    renderNavHeader(parent: HTMLDivElement, showTabs: boolean = false): { nav: HTMLDivElement, dateLabel: string } {
        const headerTop = parent.createDiv({ cls: 'dp-header-top' });
        
        headerTop.createDiv({ 
            cls: 'dp-title', 
            text: 'Day Planner Pro 🗓️' 
        });

        const nav = parent.createDiv({ cls: 'dp-nav' });
        
        const navBtns = nav.createDiv({ cls: 'dp-nav-buttons-group' });
        const prevBtn = navBtns.createEl('button', { text: '<' });
        prevBtn.addEventListener('click', async () => {
            this.navigateDate(-1);
            await this.refreshTasks(null, true);
        });

        const todayBtn = navBtns.createEl('button', { text: 'Today' });
        todayBtn.addEventListener('click', async () => {
            this.currentDate = (window as any).moment();
            await this.refreshTasks(null, true);
        });

        const nextBtn = navBtns.createEl('button', { text: '>' });
        nextBtn.addEventListener('click', async () => {
            this.navigateDate(1);
            await this.refreshTasks(null, true);
        });

        let dateLabel = '';
        const currentViewTab = this.getViewTabType();
        const weekNum = this.currentDate.week();

        // Header date: per-view text, and each segment links to the note that matches it (or nothing)
        const dateEl = nav.createDiv({ cls: 'dp-nav-date' });
        const addSegment = (text: string, link?: { title: string; open: () => void }) => {
            const seg = dateEl.createSpan({ cls: link ? 'dp-nav-date-link' : 'dp-nav-date-static', text });
            if (link) {
                seg.title = link.title;
                seg.addEventListener('click', link.open);
            }
            dateLabel += (dateLabel ? ' ' : '') + text;
        };
        const dailyLink = (d: any) => ({ title: 'Open daily note', open: () => this.handleDateClick(d.format('YYYY-MM-DD')) });
        const weeklyLink = (d: any) => ({
            title: 'Open weekly note',
            open: () => openWeeklyNoteForDate(this.app, d.format('YYYY-MM-DD'), this.plugin.settings)
        });

        if (currentViewTab === 'daily') {
            addSegment(this.currentDate.format('YYYY-MM-DD'), dailyLink(this.currentDate));
            addSegment(`(Wk ${weekNum})`, weeklyLink(this.currentDate));
        } else if (currentViewTab === 'multiDay') {
            const days = Math.max(2, Math.min(14, this.plugin.settings.nDayViewDays || 4));
            const endDay = this.currentDate.clone().add(days - 1, 'days');
            addSegment(`${this.currentDate.format('MM/DD')} ~ ${endDay.format('MM/DD')} (${days} days)`);
        } else if (currentViewTab === 'weekly') {
            const startOfWeek = this.currentDate.clone().startOf('week');
            const endOfWeek = this.currentDate.clone().endOf('week');
            addSegment(`${startOfWeek.format('MM/DD')} ~ ${endOfWeek.format('MM/DD')} (Wk ${weekNum})`, weeklyLink(this.currentDate));
        } else if (currentViewTab === 'board') {
            const today = (window as any).moment();
            addSegment(`${today.format('YYYY-MM-DD')} (Wk ${today.week()})`, dailyLink(today));
        } else {
            // monthly / list: month label only, not a link
            addSegment(this.currentDate.format('YYYY-MM'));
        }

        const headerActions = headerTop.createDiv({ cls: 'dp-header-actions' });
        headerActions.style.cssText = 'display:flex; gap:4px; align-items:center;';

        if (this.plugin.settings.enableGoogleCalendar) {
            const syncBtn = headerActions.createEl('button', { 
                text: '🔄 Sync'
            });
            syncBtn.addEventListener('click', async () => {
                new Notice('🔄 Syncing Google Calendar events & Tasks...');
                const { cacheKey, timeMin, timeMax } = this.getGCalRange();
                await this.plugin.fetchGCalRange(cacheKey, timeMin, timeMax);

                // Sync tasks to Google Calendar if target calendar is configured
                const targetCalendarId = this.plugin.settings.taskSyncCalendarId || this.plugin.settings.googleCalendars.find(c => c.enabled && c.id)?.id;
                if (targetCalendarId) {
                    try {
                        const syncRes = await syncAllTasksToGCal(this.plugin, targetCalendarId);
                        new Notice(`✅ Sync complete! GCal events updated. Tasks (Created: ${syncRes.created}, Updated: ${syncRes.updated})`);
                    } catch (err) {
                        console.error('Task sync error:', err);
                        new Notice(`⚠️ GCal events updated, but task sync encountered an error.`);
                    }
                } else {
                    new Notice('✅ Google Calendar events refreshed!');
                }

                await this.refreshTasks();
            });

            syncBtn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const modal = new TaskSyncModal(this.app, this.plugin, async () => {
                    await this.refreshTasks(null, true);
                });
                modal.open();
            });
        }

        if ((this as any).filters !== undefined) {
            const filterBtn = headerActions.createEl('button', {
                text: '🔍 Filter'
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

        // Consolidate into a single '➕' button
        const addBtn = headerActions.createEl('button', { 
            text: '➕', 
            cls: 'mod-cta' 
        });
        addBtn.addEventListener('click', () => {
            const defaultDateStr = this.currentDate.format('YYYY-MM-DD');

            const openTaskModal = () => {
                const modal = new TaskEditModal(this.app, null, defaultDateStr, async (data) => {
                    const targetFilePath = getTargetTaskFilePath(this.app, this.plugin.settings, data.date || defaultDateStr);
                    await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                    new Notice('New task added successfully.');
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



        return { nav, dateLabel };
    }

    abstract getViewTabType(): 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list';
    abstract navigateDate(direction: number): void;

    /**
     * 현재 실행 중인 실시간 업무 트래킹 상태 바 렌더러
     */
    renderCurrentTaskTracker(parent: HTMLDivElement) {
        const now = (window as any).moment();
        const todayStr = now.format('YYYY-MM-DD');
        const currentMinutes = now.hour() * 60 + now.minute();

        const todayTasks = this.tasks.filter(t => t.date === todayStr && t.startTime && t.endTime);
        let activeTask: TaskItem | null = null;
        let progressPercent = 0;
        let minsRemaining = 0;

        for (const task of todayTasks) {
            const [sh, sm] = task.startTime!.split(':').map(Number);
            const [eh, em] = task.endTime!.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;

            if (currentMinutes >= startMin && currentMinutes < endMin) {
                activeTask = task;
                const duration = endMin - startMin;
                const elapsed = currentMinutes - startMin;
                progressPercent = Math.min(100, Math.max(0, (elapsed / duration) * 100));
                minsRemaining = endMin - currentMinutes;
                break;
            }
        }

        if (activeTask) {
            const trackerBar = parent.createDiv({ cls: 'dp-current-task-bar' });
            
            trackerBar.createDiv({ cls: 'dp-ct-status-icon', text: '▶' });

            const infoContainer = trackerBar.createDiv({ cls: 'dp-ct-info' });
            const titleText = cleanTaskTextForDisplay(activeTask.text);
            infoContainer.createDiv({ cls: 'dp-ct-title', text: titleText });
            infoContainer.createDiv({ 
                cls: 'dp-ct-time', 
                text: `⏰ ${activeTask.startTime}~${activeTask.endTime} (${formatMinutesNice(minsRemaining)} remaining)` 
            });


            const linkBtn = trackerBar.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
            linkBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (activeTask) {
                    await openTaskInEditor(this.app, activeTask);
                }
            });
        }
    }

    /**
     * 마키 다중 선택(Marquee selection) 핸들러 - 이제 Task 뿐 아니라 구글 캘린더 일정도 한 번에 포괄 선택합니다.
     */
    registerMarqueeSelection(eventsCol: HTMLElement, getTimedEvents: () => HTMLElement[]) {
        let isSelecting = false;
        let startX = 0;
        let startY = 0;
        let marquee: HTMLElement | null = null;

        const onMouseDown = (e: MouseEvent) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            if (target.closest('.dp-timeline-event') || target.closest('button') || target.closest('.dp-custom-cb') || target.closest('.dp-task-link-btn') || target.closest('.dp-resize-handle')) {
                return;
            }

            e.preventDefault();

            isSelecting = true;
            const rect = eventsCol.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;

            marquee = eventsCol.createDiv({ cls: 'dp-selection-marquee' });
            marquee.style.left = `${startX}px`;
            marquee.style.top = `${startY}px`;
            marquee.style.width = '0px';
            marquee.style.height = '0px';

            if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                this.selectedTaskIds.clear();
            }

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!isSelecting || !marquee) return;

            const rect = eventsCol.getBoundingClientRect();
            const currentX = e.clientX - rect.left;
            const currentY = e.clientY - rect.top;

            const x = Math.min(startX, currentX);
            const y = Math.min(startY, currentY);
            const width = Math.abs(startX - currentX);
            const height = Math.abs(startY - currentY);

            marquee.style.left = `${x}px`;
            marquee.style.top = `${y}px`;
            marquee.style.width = `${width}px`;
            marquee.style.height = `${height}px`;

            const marqueeClientRect = marquee.getBoundingClientRect();

            const eventEls = getTimedEvents();
            eventEls.forEach(el => {
                const taskId = el.getAttribute('data-task-id');
                if (!taskId) return;

                const elClientRect = el.getBoundingClientRect();

                const isOverlapping = !(
                    elClientRect.right < marqueeClientRect.left ||
                    elClientRect.left > marqueeClientRect.right ||
                    elClientRect.bottom < marqueeClientRect.top ||
                    elClientRect.top > marqueeClientRect.bottom
                );

                if (isOverlapping) {
                    this.selectedTaskIds.add(taskId);
                    el.addClass('selected');
                } else {
                    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                        this.selectedTaskIds.delete(taskId);
                        el.removeClass('selected');
                    }
                }
            });
        };

        const onMouseUp = () => {
            isSelecting = false;
            if (marquee) {
                marquee.remove();
                marquee = null;
            }
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            this.render();
        };

        eventsCol.addEventListener('mousedown', onMouseDown);
    }

    /**
     * 태스크 및 구글 캘린더 일정 길이 조절 드래그 마우스 제어 인터페이스 (높이 조절 비율 대응 완료)
     */
    addResizeListeners(
        eventCard: HTMLElement, 
        item: { type: 'task' | 'gcal'; refId: string; taskRef?: TaskItem; calendarId?: string; text: string; startTime: string; endTime: string }, 
        direction: 'top' | 'bottom'
    ) {
        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60; // pixel / minute
        
        let duration = 0;
        try {
            const [sh, sm] = item.startTime.split(':').map(Number);
            const [eh, em] = item.endTime.split(':').map(Number);
            duration = (eh * 60 + em) - (sh * 60 + sm);
        } catch (e) {
            duration = 30;
        }
        const cardHeight = duration * ratio;

        let handleCls = `dp-resize-handle ${direction}`;
        if (cardHeight < 35) {
            handleCls += ' dp-small-handle';
        }

        const handle = eventCard.createDiv({ cls: handleCls });
        
        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);

            const hourHeight = this.getHourHeight();
            const startHour = this.plugin.settings.timelineStartHour ?? 0;
            const endHour = this.plugin.settings.timelineEndHour ?? 24;
            const ratio = hourHeight / 60; // pixel / minute
            const startMinOffset = startHour * 60;

            const startY = e.clientY;
            const [sh, sm] = item.startTime.split(':').map(Number);
            const [eh, em] = item.endTime.split(':').map(Number);
            const originalStartMin = sh * 60 + sm;
            const originalEndMin = eh * 60 + em;

            const onPointerMove = (moveEvent: PointerEvent) => {
                moveEvent.preventDefault();
                const deltaY = moveEvent.clientY - startY;
                const deltaMin = Math.round((deltaY / ratio) / 15) * 15; // ratio 기반 환산

                let newStartMin = originalStartMin;
                let newEndMin = originalEndMin;

                if (direction === 'top') {
                    newStartMin = Math.max(startMinOffset, Math.min(originalEndMin - 15, originalStartMin + deltaMin));
                } else {
                    newEndMin = Math.min(endHour * 60, Math.max(originalStartMin + 15, originalEndMin + deltaMin));
                }

                const formatMin = (totalMin: number) => {
                    const h = Math.floor(totalMin / 60);
                    const m = totalMin % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                };

                const tempStart = formatMin(newStartMin);
                const tempEnd = formatMin(newEndMin);

                eventCard.style.top = `${(newStartMin - startMinOffset) * ratio}px`;
                eventCard.style.height = `${(newEndMin - newStartMin) * ratio}px`;
                const label = eventCard.querySelector('span');
                if (label) {
                    const displayTitle = cleanTaskTextForDisplay(item.text);
                    label.setText(`${displayTitle} (${tempStart}-${tempEnd})`);
                }
            };

            const onPointerUp = async (upEvent: PointerEvent) => {
                handle.releasePointerCapture(upEvent.pointerId);
                handle.removeEventListener('pointermove', onPointerMove);
                handle.removeEventListener('pointerup', onPointerUp);
                handle.removeEventListener('pointercancel', onPointerUp);

                const deltaY = upEvent.clientY - startY;
                const deltaMin = Math.round((deltaY / ratio) / 15) * 15;

                let newStartMin = originalStartMin;
                let newEndMin = originalEndMin;

                if (direction === 'top') {
                    newStartMin = Math.max(startMinOffset, Math.min(originalEndMin - 15, originalStartMin + deltaMin));
                } else {
                    newEndMin = Math.min(endHour * 60, Math.max(originalStartMin + 15, originalEndMin + deltaMin));
                }

                const formatMin = (totalMin: number) => {
                    const h = Math.floor(totalMin / 60);
                    const m = totalMin % 60;
                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                };

                const finalStart = formatMin(newStartMin);
                const finalEnd = formatMin(newEndMin);

                if (item.type === 'gcal') {
                    const cached = this.plugin.gcalCache.find(ev => ev.id === item.refId);
                    if (cached) {
                        const previousState = {
                            summary: cached.summary,
                            description: cached.description || '',
                            location: cached.location || '',
                            dateStr: cached.dateStr,
                            startTimeStr: cached.startTimeStr,
                            endTimeStr: cached.endTimeStr,
                            isAllDay: cached.isAllDay
                        };
                        const success = await patchGoogleCalendarEvent(
                            this.plugin,
                            item.calendarId!,
                            item.refId,
                            this.currentDate.format('YYYY-MM-DD'),
                            finalStart,
                            finalEnd
                        );
                        if (success) {
                            new Notice(`📅 구글 일정이 성공적으로 변경되었습니다: ${finalStart} ~ ${finalEnd}`);
                            cached.startTimeStr = finalStart;
                            cached.endTimeStr = finalEnd;
                            showGCalEventUndoNotice(this.plugin, item.calendarId!, item.refId, previousState);
                        }
                    }
                } else {
                    await updateTaskInFile(this.plugin.app, item.taskRef!, {
                        startTime: finalStart,
                        endTime: finalEnd
                    });
                    new Notice(`Task rescheduled to: ${finalStart} ~ ${finalEnd}`);
                }
                
                await this.refreshTasks();
            };

            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', onPointerUp);
            handle.addEventListener('pointercancel', onPointerUp);
        });
    }

    /**
     * 1. 일간 타임라인 그리기 구현
     */
    renderDailyTimeline(parent: HTMLDivElement) {
        const dateStr = this.currentDate.format('YYYY-MM-DD');
        const dayTasks = this.tasks.filter(t => t.date === dateStr);
        const dayGCal = this.plugin.settings.enableGoogleCalendar 
            ? this.getCalendarEventsForDate(dateStr) 
            : [];

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60; // pixel / minute 비율

        const scrollKey = `${this.getViewType()}:${dateStr}:daily`;
        parent.addEventListener('scroll', () => {
            this.savedScrollPositions[scrollKey] = {
                scrollTop: parent.scrollTop,
                scrollLeft: parent.scrollLeft
            };
        });

        const startHour = this.plugin.settings.timelineStartHour ?? 0;
        const endHour = this.plugin.settings.timelineEndHour ?? 24;
        const hoursCount = endHour - startHour;

        const timelineWrapper = parent.createDiv({ cls: 'dp-timeline-wrapper' });
        timelineWrapper.style.minHeight = `${hoursCount * hourHeight}px`;

        const hoursCol = timelineWrapper.createDiv({ cls: 'dp-timeline-hours' });
        for (let h = startHour; h < endHour; h++) {
            const hourMark = hoursCol.createDiv({ 
                cls: 'dp-timeline-hour-mark', 
                text: `${String(h).padStart(2, '0')}:00` 
            });
            hourMark.style.height = `${hourHeight}px`;
        }

        const eventsCol = timelineWrapper.createDiv({ cls: 'dp-timeline-events' });
        eventsCol.style.backgroundSize = `100% ${hourHeight}px`;

        // 마키 다중 선택 타겟을 .dp-timeline-event 전체로 확장 (구글 일정 포괄 선택 가능)
        this.registerMarqueeSelection(eventsCol, () => {
            return Array.from(eventsCol.querySelectorAll('.dp-timeline-event')) as HTMLElement[];
        });

        eventsCol.addEventListener('click', (e) => {
            if (e.target === eventsCol) {
                this.selectedTaskIds.clear();
                this.render();
            }
        });

        eventsCol.addEventListener('contextmenu', (e: MouseEvent) => {
            const targetEl = e.target as HTMLElement;
            if (targetEl.closest('.dp-timeline-event') || targetEl.closest('.dp-grid-task-item') || targetEl.closest('.dp-task-link-btn') || targetEl.closest('.dp-custom-cb')) {
                return;
            }
            e.preventDefault();

            const rect = eventsCol.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            let clickedMinutes = Math.round((clickY / ratio) / 15) * 15 + (startHour * 60);
            if (clickedMinutes < startHour * 60) clickedMinutes = startHour * 60;
            if (clickedMinutes > (endHour * 60) - 30) clickedMinutes = (endHour * 60) - 30;

            const hourStr = String(Math.floor(clickedMinutes / 60)).padStart(2, '0');
            const minStr = String(clickedMinutes % 60).padStart(2, '0');
            const startTimeStr = `${hourStr}:${minStr}`;
            const endTimeStr = addMinutesToTime(startTimeStr, 30);

            const menu = new Menu();
            (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
            menu.addItem((item) =>
                item
                    .setTitle(`Add Task at ${startTimeStr}`)
                    .setIcon("pencil")
                    .onClick(async () => {
                        const activeFile = this.app.workspace.getActiveFile();
                        const targetFilePath = (activeFile && activeFile.extension === 'md') ? activeFile.path : this.plugin.settings.defaultTaskFile;
                        
                        const modal = new TaskEditModal(this.app, null, dateStr, async (data) => {
                            await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                            new Notice('New task added successfully.');
                            await this.refreshTasks();
                        }, startTimeStr, endTimeStr);
                        modal.open();
                    })
            );

            if (this.plugin.settings.enableGoogleCalendar) {
                menu.addItem((item) =>
                    item
                        .setTitle(`Add Appointment at ${startTimeStr}`)
                        .setIcon("calendar")
                        .onClick(() => {
                            const modal = new GCalEventEditModal(this.app, this.plugin, null, dateStr, async () => {
                                await this.refreshTasks(null, true);
                            }, startTimeStr, endTimeStr);
                            modal.open();
                        })
                );
            }

            menu.showAtMouseEvent(e);
        });

        const isToday = this.currentDate.isSame((window as any).moment(), 'day');
        if (isToday) {
            const indicator = eventsCol.createDiv({ cls: 'dp-timeline-current-indicator' });
            const updateIndicator = () => {
                const now = (window as any).moment();
                const mins = now.hour() * 60 + now.minute();
                const startMin = startHour * 60;
                const endMin = endHour * 60;
                if (mins < startMin || mins >= endMin) {
                    indicator.style.display = 'none';
                } else {
                    indicator.style.display = 'block';
                    indicator.style.top = `${(mins - startMin) * ratio}px`; // 높이 비율 및 오프셋 적용
                }
            };
            updateIndicator();
            const intervalId = window.setInterval(updateIndicator, 60000);
            this.registerInterval(intervalId);
        }

        const timedItems: Array<{ 
            type: 'task' | 'gcal'; 
            refId: string;
            calendarId?: string;
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
            startTime: string;
            endTime: string;
        }> = [];

        dayTasks.filter(t => t.startTime && t.endTime).forEach(t => {
            const [sh, sm] = t.startTime!.split(':').map(Number);
            const [eh, em] = t.endTime!.split(':').map(Number);
            timedItems.push({
                type: 'task',
                refId: t.id,
                text: t.text,
                startMin: sh * 60 + sm,
                endMin: eh * 60 + em,
                completed: t.completed,
                taskRef: t,
                startTime: t.startTime!,
                endTime: t.endTime!
            });
        });

        dayGCal.filter(e => !e.isAllDay && e.startTimeStr && e.endTimeStr).forEach(e => {
            const [sh, sm] = e.startTimeStr!.split(':').map(Number);
            const [eh, em] = e.endTimeStr!.split(':').map(Number);
            timedItems.push({
                type: 'gcal',
                refId: e.id,
                calendarId: e.calendarId,
                text: e.summary,
                startMin: sh * 60 + sm,
                endMin: eh * 60 + em,
                color: e.color,
                location: e.location,
                description: e.description,
                startTime: e.startTimeStr!,
                endTime: e.endTimeStr!
            });
        });

        calculateClusteredLayout(timedItems);

        const timelineStartMin = startHour * 60;
        const timelineEndMin = endHour * 60;

        timedItems.forEach(item => {
            // 노출 범위 밖의 일정은 렌더링 제외
            if (item.endMin <= timelineStartMin || item.startMin >= timelineEndMin) {
                return;
            }

            const visibleStartMin = Math.max(timelineStartMin, item.startMin);
            const visibleEndMin = Math.min(timelineEndMin, item.endMin);
            const visibleDuration = visibleEndMin - visibleStartMin;

            const totalCols = item.maxCols || 1;
            const colIdx = item.colIdx || 0;
            const widthPct = 100 / totalCols;
            const leftPct = colIdx * widthPct;
            
            // 높이 비율(ratio) 및 시작 시간 오프셋 적용된 포지셔닝 수식 적용
            let cardCls = 'dp-timeline-event';
            const topPx = (visibleStartMin - timelineStartMin) * ratio;
            const heightPx = Math.max(15, visibleDuration * ratio); // 최소 높이 보장
            let customStyle = `top: ${topPx}px; height: ${heightPx}px; left: calc(${leftPct}% + 4px); width: calc(${widthPct}% - 8px);`;

            if (item.type === 'gcal') {
                cardCls += ' dp-gcal-event';
                if (item.color) {
                    customStyle += ` background-image: linear-gradient(${item.color}24, ${item.color}24) !important; border-left: 4px solid ${item.color} !important;`;
                }
                if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected'; // 구글 일정도 다중 선택 비주얼 적용
            } else {
                if (item.taskRef) {
                    if (item.taskRef.statusChar === 'x') cardCls += ' completed';
                    else if (item.taskRef.statusChar === '-') cardCls += ' cancelled';
                }
                if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected';
            }

            const eventCard = eventsCol.createDiv({ cls: cardCls });
            eventCard.style.cssText = customStyle;
            eventCard.setAttribute('data-task-id', item.refId);

            if (item.type === 'gcal') {
                eventCard.setAttribute('draggable', 'true');
                
                this.addResizeListeners(eventCard, item as any, 'top');
                this.addResizeListeners(eventCard, item as any, 'bottom');

                const summaryDiv = eventCard.createDiv();
                summaryDiv.setText(item.text);
                
                if (item.location) {
                    const locDiv = eventCard.createDiv();
                    locDiv.setText(`📍 ${item.location}`);
                }
                if (item.description) {
                    const descDiv = eventCard.createDiv();
                    descDiv.setText(item.description);
                }

                const cachedEvent = this.plugin.gcalCache.find(e => e.id === item.refId);
                if (cachedEvent) {
                    eventCard.addEventListener('click', (ev) => {
                        if (ev.target instanceof HTMLElement && ev.target.classList.contains('dp-resize-handle')) return;
                        new GCalEventEditModal(this.app, this.plugin, cachedEvent, this.currentDate.format('YYYY-MM-DD'), async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                }

                eventCard.addEventListener('dragstart', (e) => {
                    if (!e.dataTransfer) return;
                    if (!this.selectedTaskIds.has(item.refId)) {
                        this.selectedTaskIds.clear();
                        this.selectedTaskIds.add(item.refId);
                        
                        eventsCol.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                        eventCard.addClass('selected');
                    }

                    const cardRect = eventCard.getBoundingClientRect();
                    const clickOffsetMin = e.clientY - cardRect.top;
                    this.activeDragClickOffsetMin = clickOffsetMin;

                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        primaryTaskId: item.refId,
                        clickOffsetMin: clickOffsetMin,
                        sourceTab: this.getViewTabType(),
                        isGCal: true,
                        calendarId: item.calendarId
                    }));
                    
                    this.initDragPreview(e, item.refId, clickOffsetMin, eventsCol);
                });

                eventCard.addEventListener('dragend', () => {
                    this.clearDragPreview(eventsCol);
                });
            } else {
                eventCard.setAttribute('draggable', 'true');

                if (item.taskRef) {
                    this.addResizeListeners(eventCard, item as any, 'top');
                    this.addResizeListeners(eventCard, item as any, 'bottom');
                }

                const mainRow = eventCard.createDiv();

                if (item.taskRef) {
                    createCustomCheckbox(mainRow, item.taskRef, async (newStatus) => {
                        if (item.taskRef) {
                            await updateTaskInFile(this.app, item.taskRef, { statusChar: newStatus });
                            await this.refreshTasks();
                        }
                    });
                }

                const displayTitle = cleanTaskTextForDisplay(item.text);
                const labelSpan = mainRow.createEl('span', { 
                    text: `${displayTitle}` 
                });

                if (item.taskRef && item.taskRef.priority !== 'normal') {
                    const priorityEmojis = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };
                    mainRow.createSpan({ 
                        cls: 'dp-badge dp-badge-priority', 
                        text: priorityEmojis[item.taskRef.priority]
                    });
                }

                const linkBtn = mainRow.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                linkBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (item.taskRef) {
                        await openTaskInEditor(this.app, item.taskRef);
                    }
                });

                let clickStartX = 0;
                let clickStartY = 0;
                let clickDragged = false;

                eventCard.addEventListener('mousedown', (e) => {
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

                    const diffX = Math.abs(e.clientX - clickStartX);
                    const diffY = Math.abs(e.clientY - clickStartY);

                    if (diffX > 5 || diffY > 5 || clickDragged) {
                        return;
                    }

                    if (item.taskRef) {
                        const modal = new TaskEditModal(this.app, item.taskRef, null, async (data) => {
                            await updateTaskInFile(this.app, item.taskRef!, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    }
                });

                eventCard.addEventListener('dragstart', (e) => {
                    clickDragged = true;
                    if (!e.dataTransfer) return;
                    if (!this.selectedTaskIds.has(item.refId)) {
                        this.selectedTaskIds.clear();
                        this.selectedTaskIds.add(item.refId);
                        
                        eventsCol.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                        eventCard.addClass('selected');
                    }

                    const cardRect = eventCard.getBoundingClientRect();
                    const clickOffsetMin = e.clientY - cardRect.top;
                    this.activeDragClickOffsetMin = clickOffsetMin;

                    e.dataTransfer.setData('text/plain', JSON.stringify({
                        primaryTaskId: item.refId,
                        clickOffsetMin: clickOffsetMin,
                        sourceTab: this.getViewTabType(),
                        isGCal: false
                    }));

                    this.initDragPreview(e, item.refId, clickOffsetMin, eventsCol);
                });

                eventCard.addEventListener('dragend', () => {
                    this.clearDragPreview(eventsCol);
                });
            }
        });

        eventsCol.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.updateDragPreview(e, eventsCol, this.activeDragClickOffsetMin);
        });
        eventsCol.addEventListener('drop', async (e) => {
            e.preventDefault();
            const dataStr = e.dataTransfer?.getData('text/plain');
            if (!dataStr) return;

            try {
                const dragData = JSON.parse(dataStr);
                const { primaryTaskId, clickOffsetMin, isGCal, calendarId } = dragData;

                const gridRect = eventsCol.getBoundingClientRect();
                const dropY = e.clientY - gridRect.top - clickOffsetMin;

                // 세로 비율(ratio) 및 시작 시간 오프셋 기반 환산 공식 적용
                let snappedMinutes = Math.round((dropY / ratio) / 15) * 15 + (startHour * 60);
                if (snappedMinutes < startHour * 60) snappedMinutes = startHour * 60;
                if (snappedMinutes > (endHour * 60) - 30) snappedMinutes = (endHour * 60) - 30;

                // [통합 동시 드래그 시스템]: 구글 캘린더와 마크다운 Task 구분 없이 모두 동시 이동 처리 (상대적 날짜 유지)
                let primaryItemStartMin = 0;
                let primaryDateStr = dateStr;
                if (isGCal) {
                    const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === primaryTaskId);
                    if (gcalEvent && gcalEvent.startTimeStr) {
                        const [sh, sm] = gcalEvent.startTimeStr.split(':').map(Number);
                        primaryItemStartMin = sh * 60 + sm;
                        if (gcalEvent.dateStr) primaryDateStr = gcalEvent.dateStr;
                    }
                } else {
                    const primaryItem = this.tasks.find(t => t.id === primaryTaskId);
                    if (primaryItem && primaryItem.startTime) {
                        const [sh, sm] = primaryItem.startTime.split(':').map(Number);
                        primaryItemStartMin = sh * 60 + sm;
                        if (primaryItem.date) primaryDateStr = primaryItem.date;
                    }
                }

                const deltaMin = snappedMinutes - primaryItemStartMin;
                const moment = (window as any).moment;
                const primaryMom = moment(primaryDateStr, 'YYYY-MM-DD');
                const targetMom = moment(dateStr, 'YYYY-MM-DD');
                const dayDelta = (targetMom.isValid() && primaryMom.isValid()) ? targetMom.diff(primaryMom, 'days') : 0;

                let taskUpdateCount = 0;
                let gcalUpdateCount = 0;

                for (const taskId of this.selectedTaskIds) {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task && task.startTime && task.endTime) {
                        const [tsh, tsm] = task.startTime.split(':').map(Number);
                        const [teh, tem] = task.endTime.split(':').map(Number);

                        const newStartTotal = (tsh * 60 + tsm) + deltaMin;
                        const newEndTotal = (teh * 60 + tem) + deltaMin;

                        const nsh = Math.max(0, Math.min(23, Math.floor(newStartTotal / 60)));
                        const nsm = Math.max(0, Math.min(59, newStartTotal % 60));
                        const neh = Math.max(0, Math.min(24, Math.floor(newEndTotal / 60)));
                        const nem = Math.max(0, Math.min(59, newEndTotal % 60));

                        const newStartTime = `${String(nsh).padStart(2, '0')}:${String(nsm).padStart(2, '0')}`;
                        const newEndTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;

                        let taskTargetDate = dateStr;
                        if (task.date) {
                            taskTargetDate = moment(task.date, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                        }

                        const success = await updateTaskInFile(this.app, task, {
                            startTime: newStartTime,
                            endTime: newEndTime,
                            date: taskTargetDate
                        });
                        if (success) taskUpdateCount++;
                    } else {
                        // 선택된 ID가 구글 일정 캐시에 존재하는 경우 동시 이동 API 전송
                        const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === taskId);
                        if (gcalEvent && gcalEvent.startTimeStr && gcalEvent.endTimeStr && !gcalEvent.isAllDay) {
                            const previousState = {
                                summary: gcalEvent.summary,
                                description: gcalEvent.description || '',
                                location: gcalEvent.location || '',
                                dateStr: gcalEvent.dateStr,
                                startTimeStr: gcalEvent.startTimeStr,
                                endTimeStr: gcalEvent.endTimeStr,
                                isAllDay: gcalEvent.isAllDay
                            };
                            const [sh, sm] = gcalEvent.startTimeStr.split(':').map(Number);
                            const [eh, em] = gcalEvent.endTimeStr.split(':').map(Number);

                            const newStartTotal = (sh * 60 + sm) + deltaMin;
                            const newEndTotal = (eh * 60 + em) + deltaMin;

                            const nsh = Math.max(0, Math.min(23, Math.floor(newStartTotal / 60)));
                            const nsm = Math.max(0, Math.min(59, newStartTotal % 60));
                            const neh = Math.max(0, Math.min(24, Math.floor(newEndTotal / 60)));
                            const nem = Math.max(0, Math.min(59, newEndTotal % 60));

                            const newStartTime = `${String(nsh).padStart(2, '0')}:${String(nsm).padStart(2, '0')}`;
                            const newEndTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;

                            let gcalTargetDate = dateStr;
                            if (gcalEvent.dateStr) {
                                gcalTargetDate = moment(gcalEvent.dateStr, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                            }

                            const success = await patchGoogleCalendarEvent(
                                this.plugin,
                                gcalEvent.calendarId,
                                gcalEvent.id,
                                gcalTargetDate,
                                newStartTime,
                                newEndTime
                            );
                            if (success) {
                                gcalEvent.dateStr = gcalTargetDate;
                                gcalEvent.startTimeStr = newStartTime;
                                gcalEvent.endTimeStr = newEndTime;
                                gcalUpdateCount++;
                                showGCalEventUndoNotice(this.plugin, gcalEvent.calendarId, gcalEvent.id, previousState);
                            }
                        }
                    }
                }

                if (taskUpdateCount > 0 || gcalUpdateCount > 0) {
                    new Notice(`🔄 일정이 재배치되었습니다: 할 일 ${taskUpdateCount}개, 구글 일정 ${gcalUpdateCount}개`);
                    this.selectedTaskIds.clear();
                    await this.refreshTasks(null, gcalUpdateCount > 0);
                }
            } catch (err) {
                console.error('Daily drop error:', err);
            }
        });

        const untimedTasks = dayTasks.filter(t => !t.startTime || !t.endTime);
        const untimedAllDayGCal = dayGCal.filter(e => e.isAllDay);

        if (untimedTasks.length > 0 || untimedAllDayGCal.length > 0) {
            // Same row as the Weekly/N-day all-day grid ([All Day | cell], same item classes), pinned above the hourly grid
            const allDaySection = parent.createDiv({ cls: 'dp-daily-allday' });
            parent.insertBefore(allDaySection, timelineWrapper);

            allDaySection.createDiv({ cls: 'dp-allday-label', text: 'All Day' });
            const listEl = allDaySection.createDiv({ cls: 'dp-allday-cell' });

            untimedAllDayGCal.forEach(e => {
                const card = listEl.createDiv({
                    cls: 'dp-grid-task-item dp-gcal-event dp-allday-item',
                    text: `🗓️ ${e.summary}${e.location ? ` (📍 ${e.location})` : ''}`
                });
                if (e.color) {
                    card.style.cssText = `background-color: ${e.color}1c !important; border-left: 3px solid ${e.color} !important;`;
                }

                card.addEventListener('click', () => {
                    new GCalEventEditModal(this.app, this.plugin, e, this.currentDate.format('YYYY-MM-DD'), async () => {
                        await this.refreshTasks(null, true);
                    }).open();
                });
            });

            untimedTasks.sort((a, b) => a.text.localeCompare(b.text));
            untimedTasks.forEach(task => {
                let cardClass = 'dp-grid-task-item dp-allday-item';
                if (task.statusChar === 'x') cardClass += ' completed';
                else if (task.statusChar === '-') cardClass += ' cancelled';

                const card = listEl.createDiv({ cls: cardClass });

                // Daily keeps its one-click status toggle (Weekly/N-day items have none)
                createCustomCheckbox(card, task, async (newStatus) => {
                    await updateTaskInFile(this.app, task, { statusChar: newStatus });
                    await this.refreshTasks();
                });

                const displayTitle = cleanTaskTextForDisplay(task.text);
                const priorityPrefix = task.priority !== 'normal' ? { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[task.priority] + ' ' : '';
                card.createSpan({ cls: 'dp-task-text', text: `${priorityPrefix}${displayTitle}` });

                const linkBtn = card.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                linkBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await openTaskInEditor(this.app, task);
                });
                
                card.addEventListener('click', (e) => {
                    if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
                    const modal = new TaskEditModal(this.app, task, null, async (data) => {
                        await updateTaskInFile(this.app, task, {
                            text: data.text,
                            statusChar: data.statusChar,
                            priority: data.priority,
                            date: data.date,
                            startTime: data.startTime,
                            endTime: data.endTime,
                            recurrence: data.recurrence,
                            dueDate: data.dueDate,
                            scheduledDate: data.scheduledDate,
                            startDate: data.startDate,
                            completionDate: data.completionDate,
                            cancelledDate: data.cancelledDate
                        });
                        await this.refreshTasks();
                    });
                    modal.open();
                });
            });
        }

        const savedScroll = this.savedScrollPositions[scrollKey];
        if (savedScroll !== undefined) {
            parent.scrollTop = savedScroll.scrollTop;
            parent.scrollLeft = savedScroll.scrollLeft;
        } else {
            if (this.lastScrolledKey !== scrollKey) {
                this.lastScrolledKey = scrollKey;
                const targetScrollY = this.getAutoScrollY([dateStr], startHour, hourHeight);
                parent.scrollTo({ top: targetScrollY, behavior: 'smooth' });
                this.savedScrollPositions[scrollKey] = {
                    scrollTop: targetScrollY,
                    scrollLeft: 0
                };
            }
        }
    }

    /**
     * 2. 주간 캘린더 뷰 구현
     */
    renderWeeklyView(parent: HTMLDivElement, daysCount: number = 7, startFromCurrentDate: boolean = false) {
        parent.empty();
        
        const scrollWrapper = parent.createDiv({ cls: 'dp-weekly-scroll-wrapper' });
        const container = scrollWrapper.createDiv({ cls: 'dp-weekly-container' });
        const dayColumnTemplate = `48px repeat(${daysCount}, minmax(120px, 1fr))`;
        container.style.minWidth = `${Math.max(520, 120 * daysCount + 48)}px`;

        const headerGrid = container.createDiv({ cls: 'dp-weekly-header-grid' });
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
        const startHour = this.plugin.settings.timelineStartHour ?? 0;
        const endHour = this.plugin.settings.timelineEndHour ?? 24;
        const hoursCount = endHour - startHour;
        const ratio = hourHeight / 60; // pixel / minute 비율

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

        const gcalByDate = new Map<string, GCalEvent[]>();
        if (this.plugin.settings.enableGoogleCalendar) {
            for (let i = 0; i < daysCount; i++) {
                const loopDayStr = startOfWeek.clone().add(i, 'days').format('YYYY-MM-DD');
                gcalByDate.set(loopDayStr, this.getCalendarEventsForDate(loopDayStr));
            }
        }

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            const isToday = loopDay.isSame((window as any).moment(), 'day');
            
            const cellHeader = headerGrid.createDiv({ 
                cls: `dp-grid-header ${isToday ? 'today' : ''}`, 
                text: `${loopDay.format('ddd')} (${loopDay.format('M/D')})`
            });
            
            cellHeader.style.cssText = 'cursor: pointer; text-decoration: underline;';
            if (isToday) {
                cellHeader.style.cssText += ' border: 2px solid var(--interactive-accent); font-weight: bold;';
            }
            cellHeader.addEventListener('click', () => {
                this.handleDateClick(loopDayStr);
            });
        }

        const allDayGrid = container.createDiv({ cls: 'dp-weekly-allday-grid' });
        allDayGrid.style.gridTemplateColumns = dayColumnTemplate;
        allDayGrid.createDiv({ cls: 'dp-allday-label', text: 'All Day' });

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            
            const dayTasks = tasksByDate.get(loopDayStr) || [];
            const dayGCal = gcalByDate.get(loopDayStr) || [];

            const untimedTasks = dayTasks.filter(t => !t.startTime || !t.endTime);
            const untimedAllDayGCal = dayGCal.filter(e => e.isAllDay);

            const cell = allDayGrid.createDiv({ cls: 'dp-allday-cell' });

            untimedAllDayGCal.forEach(e => {
                const gcalItem = cell.createDiv({
                    cls: 'dp-grid-task-item dp-gcal-event dp-allday-item',
                    text: `🗓️ ${e.summary}${e.location ? ` (📍 ${e.location})` : ''}`
                });
                if (e.color) {
                    gcalItem.style.cssText = `background-color: ${e.color}1c !important; border-left: 3px solid ${e.color} !important;`;
                }
                gcalItem.addEventListener('click', () => {
                    new GCalEventEditModal(this.app, this.plugin, e, this.currentDate.format('YYYY-MM-DD'), async () => {
                        await this.refreshTasks(null, true);
                    }).open();
                });
            });

            untimedTasks.sort((a, b) => a.text.localeCompare(b.text));
            untimedTasks.forEach(task => {
                let itemClass = 'dp-grid-task-item dp-allday-item';
                if (task.statusChar === 'x') itemClass += ' completed';
                else if (task.statusChar === '-') itemClass += ' cancelled';

                const item = cell.createDiv({ cls: itemClass });

                const displayTitle = cleanTaskTextForDisplay(task.text);
                const priorityPrefix = task.priority !== 'normal' ? { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[task.priority] + ' ' : '';
                const textSpan = item.createSpan({ text: `${priorityPrefix}${displayTitle}` });
                
                const linkBtn = item.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                linkBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await openTaskInEditor(this.app, task);
                });

                item.addEventListener('click', (e) => {
                    if (e.target === linkBtn) return;
                    e.stopPropagation();
                    const modal = new TaskEditModal(this.app, task, null, async (data) => {
                        await updateTaskInFile(this.app, task, {
                            text: data.text,
                            statusChar: data.statusChar,
                            priority: data.priority,
                            date: data.date,
                            startTime: data.startTime,
                            endTime: data.endTime,
                            recurrence: data.recurrence,
                            dueDate: data.dueDate,
                            scheduledDate: data.scheduledDate,
                            startDate: data.startDate,
                            completionDate: data.completionDate,
                            cancelledDate: data.cancelledDate
                        });
                        await this.refreshTasks();
                    });
                    modal.open();
                });
            });
        }

        const timelineScroll = container.createDiv({ cls: 'dp-content' });
        timelineScroll.style.cssText = 'flex-grow: 1; overflow-y: auto; padding: 0; position: relative;';

        const scrollKey = `${this.getViewType()}:${startOfWeek.format('YYYY-MM-DD')}:${daysCount}:weekly`;
        timelineScroll.addEventListener('scroll', () => {
            this.savedScrollPositions[scrollKey] = {
                scrollTop: timelineScroll.scrollTop,
                scrollLeft: timelineScroll.scrollLeft
            };
        });

        const timelineWrapper = timelineScroll.createDiv({ cls: 'dp-timeline-wrapper' });
        timelineWrapper.style.cssText = `min-height: calc(${hoursCount} * ${hourHeight}px);`;

        const hoursCol = timelineWrapper.createDiv({ cls: 'dp-timeline-hours' });
        for (let h = startHour; h < endHour; h++) {
            const hourMark = hoursCol.createDiv({ 
                cls: 'dp-timeline-hour-mark', 
                text: `${String(h).padStart(2, '0')}:00` 
            });
            hourMark.style.height = `${hourHeight}px`;
        }

        const daysWrapper = timelineWrapper.createDiv({ cls: 'dp-weekly-days-wrapper' });

        // 주간 뷰에서도 Task + 구글 일정을 동시 다중 선택하도록 필터링 해제
        this.registerMarqueeSelection(daysWrapper, () => {
            return Array.from(daysWrapper.querySelectorAll('.dp-timeline-event')) as HTMLElement[];
        });

        for (let i = 0; i < daysCount; i++) {
            const loopDay = startOfWeek.clone().add(i, 'days');
            const loopDayStr = loopDay.format('YYYY-MM-DD');
            
            const dayTasks = tasksByDate.get(loopDayStr) || [];
            const dayGCal = gcalByDate.get(loopDayStr) || [];

            const isToday = loopDay.isSame((window as any).moment(), 'day');

            const dayCol = daysWrapper.createDiv({ cls: `dp-weekly-day-col ${isToday ? 'today' : ''}` });
            dayCol.style.cssText = 'flex: 1; position: relative; border-right: 1px solid var(--background-modifier-border); box-sizing: border-box;';
            dayCol.setAttribute('data-date', loopDayStr);

            dayCol.addEventListener('contextmenu', (e: MouseEvent) => {
                const targetEl = e.target as HTMLElement;
                if (targetEl.closest('.dp-timeline-event') || targetEl.closest('.dp-grid-task-item') || targetEl.closest('.dp-task-link-btn') || targetEl.closest('.dp-custom-cb')) {
                    return;
                }
                e.preventDefault();

                const rect = dayCol.getBoundingClientRect();
                const clickY = e.clientY - rect.top;
                let clickedMinutes = Math.round((clickY / ratio) / 15) * 15 + (startHour * 60);
                if (clickedMinutes < startHour * 60) clickedMinutes = startHour * 60;
                if (clickedMinutes > (endHour * 60) - 30) clickedMinutes = (endHour * 60) - 30;

                const hourStr = String(Math.floor(clickedMinutes / 60)).padStart(2, '0');
                const minStr = String(clickedMinutes % 60).padStart(2, '0');
                const startTimeStr = `${hourStr}:${minStr}`;
                const endTimeStr = addMinutesToTime(startTimeStr, 30);

                const menu = new Menu();
                (menu as any).dom?.addClass('dp-glass-menu');
                menu.addItem((item) =>
                    item
                        .setTitle(`Add Task at ${startTimeStr}`)
                        .setIcon("pencil")
                        .onClick(async () => {
                            const modal = new TaskEditModal(this.app, null, loopDayStr, async (data) => {
                                const targetFilePath = getTargetTaskFilePath(this.app, this.plugin.settings, data.date || loopDayStr);
                                await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                                new Notice('New task added successfully.');
                                await this.refreshTasks();
                            }, startTimeStr, endTimeStr);
                            modal.open();
                        })
                );

                if (this.plugin.settings.enableGoogleCalendar) {
                    menu.addItem((item) =>
                        item
                            .setTitle(`Add Appointment at ${startTimeStr}`)
                            .setIcon("calendar")
                            .onClick(() => {
                                const modal = new GCalEventEditModal(this.app, this.plugin, null, loopDayStr, async () => {
                                    await this.refreshTasks(null, true);
                                }, startTimeStr, endTimeStr);
                                modal.open();
                            })
                    );
                }

                menu.showAtMouseEvent(e);
            });

            dayCol.addEventListener('dragover', (e) => {
                e.preventDefault();
                this.updateDragPreview(e, dayCol, this.activeDragClickOffsetMin);
            });
            dayCol.addEventListener('drop', async (e) => {
                e.preventDefault();
                const dataStr = e.dataTransfer?.getData('text/plain');
                if (!dataStr) return;

                try {
                    const dragData = JSON.parse(dataStr);
                    const { primaryTaskId, clickOffsetMin, isGCal, calendarId } = dragData;

                    const rect = dayCol.getBoundingClientRect();
                    const dropY = e.clientY - rect.top - clickOffsetMin;

                    // 높이 조절 비율 및 시작 시간 오프셋 기반으로 분 환산 공식 대입
                    let snappedMinutes = Math.round((dropY / ratio) / 15) * 15 + (startHour * 60);
                    if (snappedMinutes < startHour * 60) snappedMinutes = startHour * 60;
                    if (snappedMinutes > (endHour * 60) - 30) snappedMinutes = (endHour * 60) - 30;

                    // [통합 동시 드래그 시스템]: 주간 뷰 드랍 시에도 구글 일정 및 로컬 할 일 동시 이동 처리 (상대적 날짜 유지)
                    let primaryItemStartMin = 0;
                    let primaryDateStr = loopDayStr;
                    if (isGCal) {
                        const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === primaryTaskId);
                        if (gcalEvent && gcalEvent.startTimeStr) {
                            const [sh, sm] = gcalEvent.startTimeStr.split(':').map(Number);
                            primaryItemStartMin = sh * 60 + sm;
                            if (gcalEvent.dateStr) primaryDateStr = gcalEvent.dateStr;
                        }
                    } else {
                        const primaryItem = this.tasks.find(t => t.id === primaryTaskId);
                        if (primaryItem && primaryItem.startTime) {
                            const [sh, sm] = primaryItem.startTime.split(':').map(Number);
                            primaryItemStartMin = sh * 60 + sm;
                            if (primaryItem.date) primaryDateStr = primaryItem.date;
                        }
                    }

                    const deltaMin = snappedMinutes - primaryItemStartMin;
                    const moment = (window as any).moment;
                    const primaryMom = moment(primaryDateStr, 'YYYY-MM-DD');
                    const targetMom = moment(loopDayStr, 'YYYY-MM-DD');
                    const dayDelta = (targetMom.isValid() && primaryMom.isValid()) ? targetMom.diff(primaryMom, 'days') : 0;

                    let taskUpdateCount = 0;
                    let gcalUpdateCount = 0;

                    for (const taskId of this.selectedTaskIds) {
                        const task = this.tasks.find(t => t.id === taskId);
                        if (task && task.startTime && task.endTime) {
                            const [tsh, tsm] = task.startTime.split(':').map(Number);
                            const [teh, tem] = task.endTime.split(':').map(Number);

                            const newStartTotal = (tsh * 60 + tsm) + deltaMin;
                            const newEndTotal = (teh * 60 + tem) + deltaMin;

                            const nsh = Math.max(0, Math.min(23, Math.floor(newStartTotal / 60)));
                            const nsm = Math.max(0, Math.min(59, newStartTotal % 60));
                            const neh = Math.max(0, Math.min(24, Math.floor(newEndTotal / 60)));
                            const nem = Math.max(0, Math.min(59, newEndTotal % 60));

                            const newStartTime = `${String(nsh).padStart(2, '0')}:${String(nsm).padStart(2, '0')}`;
                            const newEndTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;

                            let taskTargetDate = loopDayStr;
                            if (task.date) {
                                taskTargetDate = moment(task.date, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                            }

                            const success = await updateTaskInFile(this.app, task, {
                                startTime: newStartTime,
                                endTime: newEndTime,
                                date: taskTargetDate
                            });
                            if (success) taskUpdateCount++;
                        } else {
                            const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === taskId);
                            if (gcalEvent && gcalEvent.startTimeStr && gcalEvent.endTimeStr && !gcalEvent.isAllDay) {
                                const previousState = {
                                    summary: gcalEvent.summary,
                                    description: gcalEvent.description || '',
                                    location: gcalEvent.location || '',
                                    dateStr: gcalEvent.dateStr,
                                    startTimeStr: gcalEvent.startTimeStr,
                                    endTimeStr: gcalEvent.endTimeStr,
                                    isAllDay: gcalEvent.isAllDay
                                };
                                const [sh, sm] = gcalEvent.startTimeStr.split(':').map(Number);
                                const [eh, em] = gcalEvent.endTimeStr.split(':').map(Number);

                                const newStartTotal = (sh * 60 + sm) + deltaMin;
                                const newEndTotal = (eh * 60 + em) + deltaMin;

                                const nsh = Math.max(0, Math.min(23, Math.floor(newStartTotal / 60)));
                                const nsm = Math.max(0, Math.min(59, newStartTotal % 60));
                                const neh = Math.max(0, Math.min(24, Math.floor(newEndTotal / 60)));
                                const nem = Math.max(0, Math.min(59, newEndTotal % 60));

                                const newStartTime = `${String(nsh).padStart(2, '0')}:${String(nsm).padStart(2, '0')}`;
                                const newEndTime = `${String(neh).padStart(2, '0')}:${String(nem).padStart(2, '0')}`;

                                let gcalTargetDate = loopDayStr;
                                if (gcalEvent.dateStr) {
                                    gcalTargetDate = moment(gcalEvent.dateStr, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                                }

                                const success = await patchGoogleCalendarEvent(
                                    this.plugin,
                                    gcalEvent.calendarId,
                                    gcalEvent.id,
                                    gcalTargetDate,
                                    newStartTime,
                                    newEndTime
                                );
                                if (success) {
                                    gcalEvent.dateStr = gcalTargetDate;
                                    gcalEvent.startTimeStr = newStartTime;
                                    gcalEvent.endTimeStr = newEndTime;
                                    gcalUpdateCount++;
                                    showGCalEventUndoNotice(this.plugin, gcalEvent.calendarId, gcalEvent.id, previousState);
                                }
                            }
                        }
                    }

                    if (taskUpdateCount > 0 || gcalUpdateCount > 0) {
                        new Notice(`🔄 주간 플래너 재배치: 할 일 ${taskUpdateCount}개, 구글 일정 ${gcalUpdateCount}개`);
                        this.selectedTaskIds.clear();
                        await this.refreshTasks(null, gcalUpdateCount > 0);
                    }
                } catch (err) {
                    console.error('Weekly drop error:', err);
                }
            });

            dayCol.addEventListener('click', (e) => {
                if (e.target === dayCol) {
                    this.selectedTaskIds.clear();
                    this.render();
                }
            });

            if (isToday) {
                const indicator = dayCol.createDiv({ cls: 'dp-timeline-current-indicator' });
                indicator.style.cssText = 'left: 0; right: 0;';
                const updateIndicator = () => {
                    const now = (window as any).moment();
                    const mins = now.hour() * 60 + now.minute();
                    const startMin = startHour * 60;
                    const endMin = endHour * 60;
                    if (mins < startMin || mins >= endMin) {
                        indicator.style.display = 'none';
                    } else {
                        indicator.style.display = 'block';
                        indicator.style.top = `${(mins - startMin) * ratio}px`; // 높이 비율 및 오프셋 적용
                    }
                };
                updateIndicator();
                const intervalId = window.setInterval(updateIndicator, 60000);
                this.registerInterval(intervalId);
            }

            const timedItems: Array<{ 
                type: 'task' | 'gcal'; 
                refId: string;
                calendarId?: string;
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
                startTime: string;
                endTime: string;
            }> = [];

            dayTasks.filter(t => t.startTime && t.endTime).forEach(t => {
                const [sh, sm] = t.startTime!.split(':').map(Number);
                const [eh, em] = t.endTime!.split(':').map(Number);
                timedItems.push({
                    type: 'task',
                    refId: t.id,
                    text: t.text,
                    startMin: sh * 60 + sm,
                    endMin: eh * 60 + em,
                    completed: t.completed,
                    taskRef: t,
                    startTime: t.startTime!,
                    endTime: t.endTime!
                });
            });

            dayGCal.filter(e => !e.isAllDay && e.startTimeStr && e.endTimeStr).forEach(e => {
                const [sh, sm] = e.startTimeStr!.split(':').map(Number);
                const [eh, em] = e.endTimeStr!.split(':').map(Number);
                timedItems.push({
                    type: 'gcal',
                    refId: e.id,
                    calendarId: e.calendarId,
                    text: e.summary,
                    startMin: sh * 60 + sm,
                    endMin: eh * 60 + em,
                    color: e.color,
                    location: e.location,
                    description: e.description,
                    startTime: e.startTimeStr!,
                    endTime: e.endTimeStr!
                });
            });

            calculateClusteredLayout(timedItems);

            const timelineStartMin = startHour * 60;
            const timelineEndMin = endHour * 60;

            timedItems.forEach(item => {
                // 노출 범위 밖의 일정은 렌더링 제외
                if (item.endMin <= timelineStartMin || item.startMin >= timelineEndMin) {
                    return;
                }

                const visibleStartMin = Math.max(timelineStartMin, item.startMin);
                const visibleEndMin = Math.min(timelineEndMin, item.endMin);
                const visibleDuration = visibleEndMin - visibleStartMin;

                const totalCols = item.maxCols || 1;
                const colIdx = item.colIdx || 0;
                const widthPct = 100 / totalCols;
                const leftPct = colIdx * widthPct;
                
                // 높이 조절 비율(ratio) 및 시작 시간 오프셋 적용된 주간 뷰 개별 카드 배치
                let cardCls = 'dp-timeline-event';
                const topPx = (visibleStartMin - timelineStartMin) * ratio;
                const heightPx = Math.max(15, visibleDuration * ratio); // 최소 높이 보장
                let customStyle = `top: ${topPx}px; height: ${heightPx}px; left: calc(${leftPct}% + 1px); width: calc(${widthPct}% - 2px);`;

                if (item.type === 'gcal') {
                    cardCls += ' dp-gcal-event';
                    if (item.color) {
                        customStyle += ` background-image: linear-gradient(${item.color}24, ${item.color}24) !important; border-left: 3px solid ${item.color} !important;`;
                    }
                    if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected'; // 다중 선택 visual 피드백 바인딩
                } else {
                    if (item.taskRef) {
                        if (item.taskRef.statusChar === 'x') cardCls += ' completed';
                        else if (item.taskRef.statusChar === '-') cardCls += ' cancelled';
                    }
                    if (this.selectedTaskIds.has(item.refId)) cardCls += ' selected';
                }

                const eventCard = dayCol.createDiv({ cls: cardCls });
                eventCard.style.cssText = customStyle;
                eventCard.setAttribute('data-task-id', item.refId);
                eventCard.style.fontSize = '0.75em';
                eventCard.style.padding = '4px';

                if (item.type === 'gcal') {
                    eventCard.setAttribute('draggable', 'true');
                    
                    this.addResizeListeners(eventCard, item as any, 'top');
                    this.addResizeListeners(eventCard, item as any, 'bottom');

                    const summaryDiv = eventCard.createDiv();
                    summaryDiv.setText(item.text);
                    
                    if (item.location) {
                        const locDiv = eventCard.createDiv();
                        locDiv.setText(`📍 ${item.location}`);
                    }
                    if (item.description) {
                        const descDiv = eventCard.createDiv();
                        descDiv.setText(item.description);
                    }

                    const cachedEvent = this.plugin.gcalCache.find(e => e.id === item.refId);
                    if (cachedEvent) {
                        eventCard.addEventListener('click', (ev) => {
                            if (ev.target instanceof HTMLElement && ev.target.classList.contains('dp-resize-handle')) return;
                            new GCalEventEditModal(this.app, this.plugin, cachedEvent, this.currentDate.format('YYYY-MM-DD'), async () => {
                                await this.refreshTasks(null, true);
                            }).open();
                        });
                    }

                    eventCard.addEventListener('dragstart', (e) => {
                        if (!e.dataTransfer) return;
                        if (!this.selectedTaskIds.has(item.refId)) {
                            this.selectedTaskIds.clear();
                            this.selectedTaskIds.add(item.refId);
                            
                            daysWrapper.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                            eventCard.addClass('selected');
                        }

                        const cardRect = eventCard.getBoundingClientRect();
                        const clickOffsetMin = e.clientY - cardRect.top;
                        this.activeDragClickOffsetMin = clickOffsetMin;

                        e.dataTransfer.setData('text/plain', JSON.stringify({
                            primaryTaskId: item.refId,
                            clickOffsetMin: clickOffsetMin,
                            sourceTab: this.getViewTabType(),
                            isGCal: true,
                            calendarId: item.calendarId
                        }));
                        
                        this.initDragPreview(e, item.refId, clickOffsetMin, daysWrapper);
                    });

                    eventCard.addEventListener('dragend', () => {
                        this.clearDragPreview(daysWrapper);
                    });
                } else {
                    eventCard.setAttribute('draggable', 'true');

                    if (item.taskRef) {
                        this.addResizeListeners(eventCard, item as any, 'top');
                        this.addResizeListeners(eventCard, item as any, 'bottom');
                    }

                    const mainRow = eventCard.createDiv();

                    if (item.taskRef) {
                        createCustomCheckbox(mainRow, item.taskRef, async (newStatus) => {
                            if (item.taskRef) {
                                await updateTaskInFile(this.app, item.taskRef, { statusChar: newStatus });
                                await this.refreshTasks();
                            }
                        });
                    }

                    const displayTitle = cleanTaskTextForDisplay(item.text);
                    const priorityPrefix = (item.taskRef && item.taskRef.priority !== 'normal') ? { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[item.taskRef.priority] + ' ' : '';
                    const textSpan = mainRow.createEl('span', { 
                        text: ` ${priorityPrefix}${displayTitle}` 
                    });

                    const linkBtn = mainRow.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (item.taskRef) {
                            await openTaskInEditor(this.app, item.taskRef);
                        }
                    });

                    let clickStartX = 0;
                    let clickStartY = 0;
                    let clickDragged = false;

                    eventCard.addEventListener('mousedown', (e) => {
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

                        const diffX = Math.abs(e.clientX - clickStartX);
                        const diffY = Math.abs(e.clientY - clickStartY);

                        if (diffX > 5 || diffY > 5 || clickDragged) {
                            return;
                        }

                        if (item.taskRef) {
                            const modal = new TaskEditModal(this.app, item.taskRef, null, async (data) => {
                                await updateTaskInFile(this.app, item.taskRef!, {
                                    text: data.text,
                                    statusChar: data.statusChar,
                                    priority: data.priority,
                                    date: data.date,
                                    startTime: data.startTime,
                                    endTime: data.endTime,
                                    recurrence: data.recurrence,
                                    dueDate: data.dueDate,
                                    scheduledDate: data.scheduledDate,
                                    startDate: data.startDate,
                                    completionDate: data.completionDate,
                                    cancelledDate: data.cancelledDate
                                });
                                await this.refreshTasks();
                            });
                            modal.open();
                        }
                    });

                    eventCard.addEventListener('dragstart', (e) => {
                        clickDragged = true;
                        if (!e.dataTransfer) return;
                        if (!this.selectedTaskIds.has(item.refId)) {
                            this.selectedTaskIds.clear();
                            this.selectedTaskIds.add(item.refId);
                            
                            daysWrapper.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                            eventCard.addClass('selected');
                        }

                        const cardRect = eventCard.getBoundingClientRect();
                        const clickOffsetMin = e.clientY - cardRect.top;
                        this.activeDragClickOffsetMin = clickOffsetMin;

                        e.dataTransfer.setData('text/plain', JSON.stringify({
                            primaryTaskId: item.refId,
                            clickOffsetMin: clickOffsetMin,
                            sourceTab: this.getViewTabType(),
                            isGCal: false
                        }));

                        this.initDragPreview(e, item.refId, clickOffsetMin, daysWrapper);
                    });

                    eventCard.addEventListener('dragend', () => {
                        this.clearDragPreview(daysWrapper);
                    });
                }
            });
        }

        const savedScroll = this.savedScrollPositions[scrollKey];
        if (savedScroll !== undefined) {
            timelineScroll.scrollTop = savedScroll.scrollTop;
            timelineScroll.scrollLeft = savedScroll.scrollLeft;
        } else {
            if (this.lastScrolledKey !== scrollKey) {
                this.lastScrolledKey = scrollKey;
                const visibleDates = Array.from({ length: daysCount }, (_, i) => startOfWeek.clone().add(i, 'days').format('YYYY-MM-DD'));
                const targetScrollY = this.getAutoScrollY(visibleDates, startHour, hourHeight);
                timelineScroll.scrollTo({ top: targetScrollY, behavior: 'smooth' });
                this.savedScrollPositions[scrollKey] = {
                    scrollTop: targetScrollY,
                    scrollLeft: 0
                };
            }
        }
    }

    /**
     * 3. 월간 달력 그리기 구현 (요일 헤더 분리 및 셀 높이 160px 균등 고정 설계)
     */
    renderMonthlyCalendar(parent: HTMLDivElement) {
        parent.empty();
        
        const scrollWrapper = parent.createDiv({ cls: 'dp-monthly-scroll-wrapper' });
        const container = scrollWrapper.createDiv({ cls: 'dp-monthly-container' });

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
        headerGrid.createDiv({ 
            cls: 'dp-grid-header', 
            text: 'Wk' 
        });

        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (let i = 0; i < 7; i++) {
            headerGrid.createDiv({ cls: 'dp-grid-header', text: weekdays[i] });
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

        const gcalByDate = new Map<string, GCalEvent[]>();
        if (this.plugin.settings.enableGoogleCalendar) {
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

            const weekCell = cells.createDiv({ cls: 'dp-grid-week-cell' });
            weekCell.createDiv({ 
                text: `Wk ${weekNum}` 
            });
            weekCell.createDiv({ 
                text: 'W' 
            });

            weekCell.addEventListener('click', () => {
                openWeeklyNoteForDate(this.app, weekStartDate.format('YYYY-MM-DD'), this.plugin.settings);
            });

            for (let d = 0; d < 7; d++) {
                const loopDay = weekStartDate.clone().add(d, 'days');
                const loopDayStr = loopDay.format('YYYY-MM-DD');
                const isCurrentMonth = loopDay.month() === startOfMonth.month();
                const isToday = loopDay.isSame((window as any).moment(), 'day');
                const cell = cells.createDiv({ cls: `dp-grid-cell ${isToday ? 'today' : ''}` });
                
                if (!isCurrentMonth) cell.style.opacity = '0.3';

                const cellNum = cell.createDiv({ cls: 'dp-grid-cell-num', text: String(loopDay.date()) });
                cellNum.style.cssText = 'cursor: pointer; text-decoration: underline; color: var(--text-accent); font-weight: bold;';
                cellNum.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.handleDateClick(loopDayStr);
                });

                const listWrapper = cell.createDiv({ cls: 'dp-grid-task-list' });

                const dayTasks = [...(tasksByDate.get(loopDayStr) || [])];
                dayTasks.sort((a, b) => {
                    const timeA = a.startTime || '23:59';
                    const timeB = b.startTime || '23:59';
                    return timeA.localeCompare(timeB);
                });

                const dayGCal = gcalByDate.get(loopDayStr) || [];

                dayGCal.forEach(e => {
                    let customStyle = '';
                    if (e.color) {
                        customStyle = `background-color: ${e.color}1c !important; border-left: 3px solid ${e.color} !important;`;
                    }
                    const timePrefix = e.startTimeStr ? `${e.startTimeStr} ` : '';
                    const locationSuffix = e.location ? ` (📍 ${e.location})` : '';
                    const displayText = `${timePrefix}${e.summary}${locationSuffix}`;

                    const gcalItem = listWrapper.createDiv({ 
                        cls: 'dp-grid-task-item dp-gcal-event',
                        text: displayText
                    });
                    if (customStyle) gcalItem.style.cssText = customStyle;
                    
                    gcalItem.addEventListener('click', () => {
                        new GCalEventEditModal(this.app, this.plugin, e, loopDayStr, async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                });

                dayTasks.forEach(task => {
                    let itemClass = 'dp-grid-task-item';
                    if (task.statusChar === 'x') itemClass += ' completed';
                    else if (task.statusChar === '-') itemClass += ' cancelled';

                    const item = listWrapper.createDiv({ cls: itemClass });
                    const displayTitle = cleanTaskTextForDisplay(task.text);
                    const priorityPrefix = task.priority !== 'normal' ? { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' }[task.priority] + ' ' : '';
                    const textSpan = item.createSpan({
                        cls: 'dp-task-text',
                        text: `${task.startTime ? `${task.startTime} ` : ''}${priorityPrefix}${displayTitle}`
                    });

                    const taskColor = this.plugin.settings.taskColor || '#ff9f1c';
                    if (task.statusChar === '-') {
                        item.style.cssText = `opacity: 0.55; border-left: 3px solid var(--text-error) !important; background-color: rgba(235, 87, 87, 0.05) !important;`;
                    } else if (task.statusChar === 'x') {
                        item.style.cssText = `opacity: 0.5; border-left: 3px solid var(--text-muted) !important; background-color: var(--background-secondary) !important;`;
                    } else {
                        item.style.cssText = `border-left: 3px solid ${taskColor} !important; background-color: ${taskColor}15 !important;`;
                    }

                    const linkBtn = item.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, task);
                    });

                    item.addEventListener('click', (e) => {
                        if (e.target === linkBtn) return;
                        e.stopPropagation();
                        const modal = new TaskEditModal(this.app, task, null, async (data) => {
                            await updateTaskInFile(this.app, task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });
                });

                cell.addEventListener('dblclick', (e) => {
                    if (e.target !== cell && e.target !== listWrapper) return;
                    const modal = new TaskEditModal(this.app, null, loopDayStr, async (data) => {
                        const activeFile = this.app.workspace.getActiveFile();
                        const targetFilePath = (activeFile && activeFile.extension === 'md') ? activeFile.path : this.plugin.settings.defaultTaskFile;
                        await createNewTaskInFile(this.app, targetFilePath, data.text, data.date, data.startTime, data.endTime, data.statusChar, data.priority);
                        await this.refreshTasks();
                    });
                    modal.open();
                });
            }
        }
        grid.appendChild(cells);
    }

    /**
     * 4. 칸반 보드 (Board) 뷰 이원화 통합 컨트롤러
     */
    renderKanbanBoard(parent: HTMLDivElement) {
        parent.empty();
        this.mountBoardModeToggle(parent.parentElement);

        const board = parent.createDiv({ cls: 'dp-kanban-board' });
        // The board element is rebuilt on every render, so adding the class to the fresh node replays the keyframe
        if (this.boardModeSwitched) {
            board.addClass('dp-board-reveal');
            this.boardModeSwitched = false;
        }

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
        } else {
            this.renderStandardKanbanBoard(board);
        }
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
            text: '🗂️ Kanban',
            attr: { title: 'Standard Kanban' }
        });
        const priorityToggle = toggleRow.createEl('button', {
            cls: `dp-board-toggle-btn ${this.kanbanViewMode === 'priority' ? 'active' : ''}`,
            text: '🎯 Priority',
            attr: { title: 'Priority Focus' }
        });

        const switchMode = (mode: 'kanban' | 'priority') => {
            if (this.kanbanViewMode === mode) return;
            this.kanbanViewMode = mode;
            this.boardModeSwitched = true;
            this.render();
        };
        kanbanToggle.addEventListener('click', () => switchMode('kanban'));
        priorityToggle.addEventListener('click', () => switchMode('priority'));
    }

    /**
     * 4-A. 기본 스탠다드 칸반 보드 뷰 그리기
     */
    renderStandardKanbanBoard(board: HTMLDivElement) {
        const referenceDate = this.currentDate || (window as any).moment();
        const todayStr = referenceDate.format('YYYY-MM-DD');
        const tomorrowStr = referenceDate.clone().add(1, 'day').format('YYYY-MM-DD');

        const columns = [
            {
                id: 'undated',
                title: 'Undated',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date === null
            },
            {
                id: 'overdue',
                title: 'Overdue',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date !== null && t.date < todayStr
            },
            {
                id: 'today',
                title: 'Today',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date === todayStr
            },
            {
                id: 'tomorrow',
                title: 'Tomorrow',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date === tomorrowStr
            },
            {
                id: 'future',
                title: 'Future',
                filter: (t: TaskItem) => t.statusChar !== 'x' && t.statusChar !== '-' && t.date !== null && t.date > tomorrowStr
            },
            {
                id: 'completed',
                title: 'Completed',
                filter: (t: TaskItem) => t.statusChar === 'x' || t.statusChar === '-'
            }
        ];

          if (!this.collapsedColumns) {
            this.collapsedColumns = new Set<string>();
        }

        columns.forEach(col => {
            const colTasks = this.tasks.filter(col.filter);
            colTasks.sort(compareTasks);

            const colEl = board.createDiv({ cls: 'dp-kanban-column' });
            colEl.setAttribute('data-col-id', col.id);

            const isCollapsed = this.collapsedColumns.has(col.id);
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

            const titleSpan = header.createSpan({ text: col.title });
            if (isCollapsed) {
                titleSpan.style.writingMode = 'vertical-lr';
                titleSpan.style.textOrientation = 'mixed';
                titleSpan.style.transform = 'rotate(180deg)';
                titleSpan.style.whiteSpace = 'nowrap';
            }

            header.createSpan({ cls: 'dp-kanban-col-count', text: String(colTasks.length) });

            const toggleBtn = header.createSpan({ 
                text: isCollapsed ? '▶' : '◀', 
                cls: 'dp-kanban-col-toggle'
            });
            toggleBtn.addEventListener('mouseenter', () => toggleBtn.style.opacity = '1');
            toggleBtn.addEventListener('mouseleave', () => toggleBtn.style.opacity = '0.6');
            toggleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedColumns.delete(col.id);
                } else {
                    this.collapsedColumns.add(col.id);
                }
                if ((this as any).updateCodeBlockInFile) {
                    if ((this as any).debouncedUpdateCodeBlock) {
                        (this as any).debouncedUpdateCodeBlock((this as any).viewType, (this as any).filters);
                    }
                } else {
                    this.plugin.settings.collapsedColumns = Array.from(this.collapsedColumns);
                    await this.plugin.saveSettings();
                }
                this.render();
            });

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

                colTasks.forEach(task => {
                    let cardClass = 'dp-kanban-card';
                    if (task.statusChar === 'x') cardClass += ' completed';
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

                    const displayTitle = cleanTaskTextForDisplay(task.text);
                    const titleSpan = leftPart.createSpan({ text: `${displayTitle}` });
                    titleSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                    const linkBtn = titleWrapper.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, task);
                    });

                    const meta = card.createDiv({ cls: 'dp-kanban-card-meta' });
                    meta.createDiv({ cls: 'dp-kanban-card-file', text: task.filePath });
                    if (task.startTime) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-time', text: `⏰ ${task.startTime}-${task.endTime}` });
                    }
                    if (task.date) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-date', text: `⏳ ${task.date}` });
                    }
                    
                    if (task.priority !== 'normal') {
                        const priorityEmojis = { highest: 'Highest 🔺', high: 'High ⏫', medium: 'Medium 🔼', low: 'Low 🔽', lowest: 'Lowest ⏬' };
                        meta.createDiv({ 
                            cls: 'dp-badge dp-badge-priority', 
                            text: priorityEmojis[task.priority]
                        });
                    }
                    if (task.statusChar !== ' ' && task.statusChar !== 'x') {
                        const statusLabels = { '/': 'In Progress', '-': 'Cancelled' };
                        meta.createDiv({
                            cls: 'dp-badge',
                            text: (statusLabels as any)[task.statusChar] || task.statusChar
                        });
                    }

                    card.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
                        const modal = new TaskEditModal(this.app, task, null, async (data) => {
                            await updateTaskInFile(this.app, task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });

                    card.addEventListener('dragstart', (e) => {
                        if (e.dataTransfer) {
                            e.dataTransfer.setData('text/plain', task.id);
                            card.style.opacity = '0.4';
                        }
                    });

                    card.addEventListener('dragend', () => {
                        card.style.opacity = '1';
                    });
                });
            }

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
                
                const taskId = e.dataTransfer?.getData('text/plain');
                if (!taskId) return;

                const targetTask = this.tasks.find(t => t.id === taskId);
                if (!targetTask) return;

                let dateUpdate: string | null = targetTask.date;
                let statusCharUpdate: string = targetTask.statusChar;

                switch (col.id) {
                    case 'undated':
                        dateUpdate = null;
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'overdue':
                        dateUpdate = referenceDate.clone().subtract(1, 'day').format('YYYY-MM-DD');
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'today':
                        dateUpdate = todayStr;
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'tomorrow':
                        dateUpdate = tomorrowStr;
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'future':
                        dateUpdate = referenceDate.clone().add(3, 'days').format('YYYY-MM-DD');
                        if (statusCharUpdate === 'x' || statusCharUpdate === '-') {
                            statusCharUpdate = ' ';
                        }
                        break;
                    case 'completed':
                        statusCharUpdate = 'x';
                        break;
                }

                const updated = await updateTaskInFile(this.app, targetTask, {
                    date: dateUpdate,
                    statusChar: statusCharUpdate
                });

                if (updated) {
                    new Notice(`Moved task to '${col.title}' column.`);
                    await this.refreshTasks();
                }
            });
        });
    }

    /**
     * 4-B. 우선순위 포커스 보드 뷰
     */
    renderPriorityFocusBoard(board: HTMLDivElement) {
        const columns = [
            { id: 'highest', title: 'Highest 🔺', priority: 'highest' as const },
            { id: 'high', title: 'High ⏫', priority: 'high' as const },
            { id: 'medium', title: 'Medium 🔼', priority: 'medium' as const },
            { id: 'normal', title: 'Normal 🟢', priority: 'normal' as const },
            { id: 'low', title: 'Low 🔽', priority: 'low' as const },
            { id: 'lowest', title: 'Lowest ⏬', priority: 'lowest' as const }
        ];

        columns.forEach(col => {
            const colTasks = this.tasks.filter(t => (t.statusChar === ' ' || t.statusChar === '/') && t.priority === col.priority);
            colTasks.sort(compareTasks);

            const colEl = board.createDiv({ cls: 'dp-kanban-column' });
            colEl.setAttribute('data-col-id', col.id);

            const isCollapsed = this.collapsedColumns.has(col.id);
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

            const titleSpan = header.createSpan({ text: col.title });
            if (isCollapsed) {
                titleSpan.style.writingMode = 'vertical-lr';
                titleSpan.style.textOrientation = 'mixed';
                titleSpan.style.transform = 'rotate(180deg)';
                titleSpan.style.whiteSpace = 'nowrap';
            }

            header.createSpan({ cls: 'dp-kanban-col-count', text: String(colTasks.length) });

            const toggleBtn = header.createSpan({ 
                text: isCollapsed ? '▶' : '◀', 
                cls: 'dp-kanban-col-toggle'
            });
            toggleBtn.addEventListener('mouseenter', () => toggleBtn.style.opacity = '1');
            toggleBtn.addEventListener('mouseleave', () => toggleBtn.style.opacity = '0.6');
            toggleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedColumns.delete(col.id);
                } else {
                    this.collapsedColumns.add(col.id);
                }
                if ((this as any).updateCodeBlockInFile) {
                    if ((this as any).debouncedUpdateCodeBlock) {
                        (this as any).debouncedUpdateCodeBlock((this as any).viewType, (this as any).filters);
                    }
                } else {
                    this.plugin.settings.collapsedColumns = Array.from(this.collapsedColumns);
                    await this.plugin.saveSettings();
                }
                this.render();
            });

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

                colTasks.forEach(task => {
                    let cardClass = 'dp-kanban-card';
                    if (task.statusChar === '/') cardClass += ' in-progress';

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

                    const displayTitle = cleanTaskTextForDisplay(task.text);
                    const titleSpan = leftPart.createSpan({ text: displayTitle });
                    titleSpan.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                    const linkBtn = titleWrapper.createSpan({ text: '↗', cls: 'dp-task-link-btn' });
                    linkBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, task);
                    });

                    const meta = card.createDiv({ cls: 'dp-kanban-card-meta' });
                    meta.createDiv({ cls: 'dp-kanban-card-file', text: task.filePath });
                    if (task.startTime) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-time', text: `⏰ ${task.startTime}-${task.endTime}` });
                    }
                    if (task.date) {
                        meta.createDiv({ cls: 'dp-badge dp-badge-date', text: `⏳ ${task.date}` });
                    }
                    if (task.statusChar === '/') {
                        meta.createDiv({
                            cls: 'dp-badge',
                            text: 'In Progress ⚡'
                        });
                    }

                    card.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target === linkBtn)) return;
                        const modal = new TaskEditModal(this.app, task, null, async (data) => {
                            await updateTaskInFile(this.app, task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });

                    card.addEventListener('dragstart', (e) => {
                        if (e.dataTransfer) {
                            e.dataTransfer.setData('text/plain', task.id);
                            card.style.opacity = '0.4';
                        }
                    });

                    card.addEventListener('dragend', () => {
                        card.style.opacity = '1';
                    });
                });
            }

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
                
                const taskId = e.dataTransfer?.getData('text/plain');
                if (!taskId) return;

                const targetTask = this.tasks.find(t => t.id === taskId);
                if (!targetTask) return;
                const updated = await updateTaskInFile(this.app, targetTask, {
                    priority: col.priority
                });

                if (updated) {
                    new Notice(`Priority re-assigned to '${col.title}'`);
                    await this.refreshTasks();
                }
            });
        });
    }

    renderListView(parent: HTMLDivElement) {
        parent.empty();

        if (!(this as any).listSearchQuery) (this as any).listSearchQuery = '';

        const self = this as any;

        const container = parent.createDiv({ cls: 'dp-gc-list-container' });

        // Header with search bar
        const header = container.createDiv({ cls: 'dp-gc-list-header' });
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

        // Date limits: only this month (or today/this week if in daily/weekly notes)!
        let startDate = this.currentDate.clone().startOf('month');
        let endDate = this.currentDate.clone().endOf('month');

        if (self.parentNoteType === 'daily' && self.parentNoteDate) {
            startDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('day');
            endDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('day');
        } else if (self.parentNoteType === 'weekly' && self.parentNoteDate) {
            startDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').startOf('week');
            endDate = (window as any).moment(self.parentNoteDate, 'YYYY-MM-DD').endOf('week');
        }

        const startStr = startDate.format('YYYY-MM-DD');
        const endStr = endDate.format('YYYY-MM-DD');

        const todayMoment = (window as any).moment();
        const todayStr = todayMoment.format('YYYY-MM-DD');

        // Apply filters to tasks
        let filteredTasks = this.tasks;
        if (self.filters && self.filters.rules && self.filters.rules.length > 0) {
            filteredTasks = filteredTasks.filter(task => matchFilterGroup(task, self.filters));
        }

        // Search filter tasks
        if (self.listSearchQuery) {
            filteredTasks = filteredTasks.filter(t => 
                t.text.toLowerCase().includes(self.listSearchQuery) || 
                t.filePath.toLowerCase().includes(self.listSearchQuery)
            );
        }

        // Fetch GCal events
        let filteredEvents = this.getCalendarEvents();
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
        });

        filteredEvents.forEach(event => {
            const spannedDates = this.getSpannedDatesForEvent(event);
            spannedDates.forEach(dateStr => {
                if (dateStr >= startStr && dateStr <= endStr) {
                    if (!daysMap.has(dateStr)) daysMap.set(dateStr, []);
                    
                    let effStartTimeStr = event.startTimeStr;
                    let effEndTimeStr = event.endTimeStr;
                    if (!event.isAllDay) {
                        const moment = (window as any).moment;
                        const startMom = moment(event.start).startOf('day');
                        const endMom = moment(event.end).startOf('day');
                        const targetMom = moment(dateStr, 'YYYY-MM-DD').startOf('day');
                        const isStartDay = targetMom.isSame(startMom, 'day');
                        const isEndDay = targetMom.isSame(endMom, 'day');
                        if (!isStartDay) effStartTimeStr = '00:00';
                        if (!isEndDay) effEndTimeStr = '24:00';
                    }
                    
                    daysMap.get(dateStr)!.push({ 
                        type: 'event', 
                        event: {
                            ...event,
                            dateStr,
                            startTimeStr: effStartTimeStr,
                            endTimeStr: effEndTimeStr
                        } 
                    });
                }
            });
        });

        const listScroll = container.createDiv({ cls: 'dp-gc-list-scroll' });
        const listScrollKey = `${this.getViewType()}:list-scroll`;
        listScroll.addEventListener('scroll', () => {
            this.savedScrollPositions[listScrollKey] = {
                scrollTop: listScroll.scrollTop,
                scrollLeft: listScroll.scrollLeft
            };
        });

        if (daysMap.size === 0) {
            let emptyText = 'No tasks or events found in this month.';
            if (self.parentNoteType === 'daily') {
                emptyText = 'No tasks or events found for today.';
            } else if (self.parentNoteType === 'weekly') {
                emptyText = 'No tasks or events found for this week.';
            }
            listScroll.createDiv({ 
                text: emptyText 
            });
            return;
        }

        // Sort dates chronologically
        const sortedDates = Array.from(daysMap.keys()).sort();

        // Helper function to format time str nicely
        const formatTimeStr = (time: string) => {
            const moment = (window as any).moment;
            const isKorean = moment.locale() === 'ko';
            const parsed = moment(time, 'HH:mm');
            if (!parsed.isValid()) return time;
            if (isKorean) {
                return parsed.minute() === 0 ? parsed.format('a h시') : parsed.format('a h:mm');
            } else {
                return parsed.format('h:mm A');
            }
        };

        // Helper function to format range
        const formatTimeRange = (start: string, end: string | null) => {
            if (!end) return formatTimeStr(start);
            const moment = (window as any).moment;
            const isKorean = moment.locale() === 'ko';
            const s = moment(start, 'HH:mm');
            const e = moment(end, 'HH:mm');
            if (!s.isValid() || !e.isValid()) return `${start} - ${end}`;

            if (isKorean) {
                const sAmpm = s.format('a');
                const eAmpm = e.format('a');
                const sTime = s.minute() === 0 ? s.format('h시') : s.format('h:mm');
                const eTime = e.minute() === 0 ? e.format('h시') : e.format('h:mm');
                if (sAmpm === eAmpm) {
                    return `${sAmpm} ${sTime} - ${eTime}`;
                } else {
                    return `${sAmpm} ${sTime} - ${eAmpm} ${eTime}`;
                }
            } else {
                return `${s.format('h:mm A')} - ${e.format('h:mm A')}`;
            }
        };

        sortedDates.forEach(dateStr => {
            const items = daysMap.get(dateStr)!;
            const loopDay = (window as any).moment(dateStr);
            const isToday = dateStr === todayStr;

            // Separate all-day vs timed
            const allDayItems = items.filter(item => {
                if (item.type === 'task') return !item.task.startTime;
                return item.event.isAllDay;
            });
            const timedItems = items.filter(item => {
                if (item.type === 'task') return !!item.task.startTime;
                return !item.event.isAllDay;
            });

            // Sort timed items chronologically
            timedItems.sort((a, b) => {
                const timeA = a.type === 'task' ? a.task.startTime! : a.event.startTimeStr!;
                const timeB = b.type === 'task' ? b.task.startTime! : b.event.startTimeStr!;
                return timeA.localeCompare(timeB);
            });

            const dayRow = listScroll.createDiv({ 
                cls: `dp-gc-day-row ${isToday ? 'is-today' : ''}` 
            });

            // Left Sidebar: the day heading links to that day's daily note
            const sidebar = dayRow.createDiv({ cls: 'dp-gc-day-sidebar dp-gc-day-link' });
            sidebar.title = 'Open daily note';
            sidebar.addEventListener('click', () => this.handleDateClick(dateStr));
            
            const numberDiv = sidebar.createDiv({ 
                cls: 'dp-gc-day-number',
                text: loopDay.format('D')
            });
            
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
            const nowMinutes = todayMoment.hours() * 60 + todayMoment.minutes();
            const nowStr = todayMoment.format('HH:mm');

            const renderItem = (item: any) => {
                const isTask = item.type === 'task';
                let cardClass = 'dp-gc-item';
                if (isTask) {
                    if (item.task.completed) cardClass += ' completed';
                    else if (item.task.statusChar === '-') cardClass += ' cancelled';
                }

                const card = contentDiv.createDiv({ cls: cardClass });

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

                // Time
                let timeText = isKorean ? '종일' : 'All day';
                if (isTask && item.task.startTime) {
                    timeText = formatTimeRange(item.task.startTime, item.task.endTime);
                } else if (!isTask && !item.event.isAllDay) {
                    timeText = formatTimeRange(item.event.startTimeStr!, item.event.endTimeStr);
                }
                card.createDiv({ 
                    cls: 'dp-gc-item-time', 
                    text: timeText 
                });

                // Title
                const displayTitle = isTask ? cleanTaskTextForDisplay(item.task.text) : item.event.summary;
                card.createDiv({ 
                    cls: 'dp-gc-item-title', 
                    text: displayTitle 
                });

                // File (Only for tasks)
                if (isTask) {
                    const fileBase = item.task.filePath.split(/[/\\]/).pop() || item.task.filePath;
                    const fileBadge = card.createDiv({ 
                        cls: 'dp-gc-item-file', 
                        text: `📄 ${fileBase}` 
                    });
                    fileBadge.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await openTaskInEditor(this.app, item.task);
                    });

                    card.addEventListener('click', (e) => {
                        if (e.target instanceof HTMLElement && (e.target.classList.contains('dp-custom-cb') || e.target.classList.contains('dp-gc-item-file'))) return;
                        const modal = new TaskEditModal(this.app, item.task, null, async (data) => {
                            await updateTaskInFile(this.app, item.task, {
                                text: data.text,
                                statusChar: data.statusChar,
                                priority: data.priority,
                                date: data.date,
                                startTime: data.startTime,
                                endTime: data.endTime,
                                recurrence: data.recurrence,
                                dueDate: data.dueDate,
                                scheduledDate: data.scheduledDate,
                                startDate: data.startDate,
                                completionDate: data.completionDate,
                                cancelledDate: data.cancelledDate
                            });
                            await this.refreshTasks();
                        });
                        modal.open();
                    });
                } else {
                    card.addEventListener('click', () => {
                        new GCalEventEditModal(this.app, this.plugin, item.event, item.event.dateStr, async () => {
                            await this.refreshTasks(null, true);
                        }).open();
                    });
                }
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
                    const itemTime = item.type === 'task' ? item.task.startTime! : item.event.startTimeStr!;
                    
                    if (!timeLineInserted && itemTime > nowStr) {
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

        const savedListScroll = this.savedScrollPositions[listScrollKey];
        if (savedListScroll) listScroll.scrollTop = savedListScroll.scrollTop;
    }
}

/**
 * 1. Day Planner 통합 뷰 (모든 주간, 월간, 보드 레이아웃을 탭 컨트롤러 형태로 포괄)
 */
export class DayPlannerCombinedView extends DayPlannerBaseView {
    activeTab: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list' = 'daily';

    getViewType(): string { return 'day-planner-pro-view'; }
    getDisplayText(): string { return 'Day Planner Pro (Combined View)'; }
    getIcon(): string { return 'calendar-glyph'; }
    getViewTabType() { return this.activeTab; }

    navigateDate(direction: number) {
        if (this.activeTab === 'daily') this.currentDate.add(direction, 'day');
        if (this.activeTab === 'multiDay') this.currentDate.add(direction * (this.plugin.settings.nDayViewDays || 4), 'day');
        if (this.activeTab === 'weekly') this.currentDate.add(direction, 'week');
        if (this.activeTab === 'monthly') this.currentDate.add(direction, 'month');
        if (this.activeTab === 'list') {
            this.currentDate.add(direction, 'month');
        }
    }

    renderRoot(rootEl: HTMLDivElement) {
        const header = rootEl.createDiv({ cls: 'dp-header' });
        rootEl.prepend(header); // cached panes may still be mounted below
        this.renderNavHeader(header, true);

        const tabsContainer = header.createDiv({ cls: 'dp-tabs' });
        const tabs: { key: typeof DayPlannerCombinedView.prototype.activeTab; label: string }[] = [
            { key: 'daily', label: 'Daily Timeline' },
            { key: 'multiDay', label: `${this.plugin.settings.nDayViewDays || 4}-day View` },
            { key: 'weekly', label: 'Weekly View' },
            { key: 'monthly', label: 'Monthly Calendar' },
            { key: 'board', label: 'Board' },
            { key: 'list', label: 'List View' }
        ];

        tabs.forEach(tab => {
            if (tab.key === 'multiDay') {
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

                tabEl.createSpan({ text: '-day View' });

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
                    text: tab.label
                });
                btn.addEventListener('click', async () => {
                    await this.switchTab(tab.key);
                });
            }
        });
        animateActiveTabPill(tabsContainer, this as any, this.activeTab);

        this.mountActivePane(rootEl);
        if (this.activeTab === 'daily') this.renderCurrentTaskTracker(rootEl);
    }

    /** Keep-alive view panes: each tab renders once, then is only shown/hidden until its data goes stale. */
    panes = new Map<string, { el: HTMLDivElement; version: number; scroll: [HTMLElement, number, number][] }>();
    paneRoot: HTMLDivElement | null = null;
    /** Bumped by every data-driven render (tasks, date, settings, GCal); panes rendered at an older version are dirty. */
    dataVersion = 0;
    isTabSwitch = false;

    render() {
        if (!this.isTabSwitch) this.dataVersion++;
        super.render();
    }

    /** Instant tab change: no vault scan, no blocking GCal fetch, and no rebuild of an up-to-date pane. */
    async switchTab(tab: typeof this.activeTab) {
        if (tab === this.activeTab) return;
        const current = this.panes.get(this.activeTab);
        if (current) {
            // display:none drops scroll offsets, so remember them for when this pane is shown again
            const scrollers = [current.el, ...Array.from(current.el.querySelectorAll<HTMLElement>(
                '.dp-content, .dp-weekly-scroll-wrapper, .dp-monthly-scroll-wrapper, .dp-kanban-board, .dp-kanban-cards, .dp-gc-list-scroll'))];
            current.scroll = scrollers.map(el => [el, el.scrollTop, el.scrollLeft] as [HTMLElement, number, number]);
        }
        this.activeTab = tab;
        await this.syncGCalRange(false, false);
        this.isTabSwitch = true;
        try {
            this.render();
        } finally {
            this.isTabSwitch = false;
        }
    }

    /** Only the header chrome and tracker bar are rebuilt; cached panes stay mounted. */
    rebuildRoot(rootEl: HTMLDivElement) {
        Array.from(rootEl.children).forEach(child => {
            if (!child.classList.contains('day-planner-view-pane')) child.remove();
        });
        this.renderRoot(rootEl);
    }

    mountActivePane(rootEl: HTMLDivElement) {
        if (this.paneRoot !== rootEl) {
            this.panes.clear();
            this.paneRoot = rootEl;
        }
        let pane = this.panes.get(this.activeTab);
        if (!pane) {
            pane = {
                el: rootEl.createDiv({ cls: `dp-content day-planner-view-pane day-planner-pane-${this.activeTab}` }),
                version: -1,
                scroll: []
            };
            this.panes.set(this.activeTab, pane);
        }
        // Strict mutual exclusion: exactly one pane is shown, every other one is hidden
        this.panes.forEach((p, key) => {
            const isActive = key === this.activeTab;
            p.el.toggleClass('is-hidden', !isActive);
            p.el.toggleClass('is-active', isActive);
        });

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
        content.empty();
        if (this.activeTab === 'daily') {
            this.renderDailyTimeline(content);
        } else if (this.activeTab === 'multiDay') {
            this.renderWeeklyView(content, Math.max(2, Math.min(14, this.plugin.settings.nDayViewDays || 4)), true);
        } else if (this.activeTab === 'weekly') {
            this.renderWeeklyView(content);
        } else if (this.activeTab === 'monthly') {
            this.renderMonthlyCalendar(content);
        } else if (this.activeTab === 'board') {
            this.renderKanbanBoard(content);
        } else if (this.activeTab === 'list') {
            this.renderListView(content);
        }
    }
}

/**
 * 2. 독립 일간 타임라인 전용 뷰
 */
export class DayPlannerDailyView extends DayPlannerBaseView {
    getViewType(): string { return 'day-planner-pro-daily'; }
    getDisplayText(): string { return 'Day Planner (Daily View)'; }
    getIcon(): string { return 'calendar-clock'; }
    getViewTabType() { return 'daily' as const; }
    navigateDate(direction: number) { this.currentDate.add(direction, 'day'); }

    renderRoot(rootEl: HTMLDivElement) {
        const header = rootEl.createDiv({ cls: 'dp-header' });
        this.renderNavHeader(header, false);

        const content = rootEl.createDiv({ cls: 'dp-content' });
        this.renderDailyTimeline(content);
        this.renderCurrentTaskTracker(rootEl);
    }
}

export class DayPlannerCodeBlockRenderer extends MarkdownRenderChild {
    plugin: DayPlannerPlugin;
    app: App;
    tasks: TaskItem[] = [];
    currentDate: any;
    viewType: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list';
    heightStr: string;
    selectedTaskIds: Set<string> = new Set();
    savedScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }> = {};
    activeDragClickOffsetMin: number = 0;
    dragPreviewContainer: HTMLDivElement | null = null;
    activeDragItems: any[] = [];
    kanbanViewMode: 'kanban' | 'priority' = 'kanban';
    /** Set by the Kanban/Priority toggle so only a mode switch (not every data refresh) plays the reveal animation */
    boardModeSwitched = false;
    ctx: any;
    filters: any;
    showFilterPanel: boolean = false;
    collapsedColumns: Set<string> = new Set();
    hourHeight: number | undefined;
    debouncedUpdateCodeBlock: any;
    parentNoteType: 'daily' | 'weekly' | null = null;
    parentNoteDate: string | null = null;
    contentOnlyRender: boolean = false;
    filtersDirty: boolean = false;
    filterPanelEl: HTMLElement | null = null;
    filterRefreshTimer: number | undefined;
    filterDismissCleanup: (() => void) | null = null;

    constructor(
        containerEl: HTMLElement,
        plugin: DayPlannerPlugin, 
        viewType: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list', 
        dateStr?: string,
        heightStr?: string,
        ctx?: any,
        config?: any
    ) {
        super(containerEl);
        this.plugin = plugin;
        this.app = plugin.app;
        this.viewType = viewType;
        this.heightStr = heightStr || '500px';
        this.ctx = ctx;

        if (!(plugin as any).codeblockShowFiltersState) {
            (plugin as any).codeblockShowFiltersState = new Map<string, boolean>();
        }
        const sectionInfo = ctx && ctx.getSectionInfo && ctx.getSectionInfo(containerEl);
        const lineStartVal = sectionInfo ? sectionInfo.lineStart : 0;
        const blockKeyStr = ctx ? `${ctx.sourcePath}:${lineStartVal}` : '';

        this.showFilterPanel = false;
        if (blockKeyStr && (plugin as any).codeblockShowFiltersState.has(blockKeyStr)) {
            this.showFilterPanel = (plugin as any).codeblockShowFiltersState.get(blockKeyStr)!;
        } else if (config && config.showFilters === true) {
            this.showFilterPanel = true;
        }
        this.hourHeight = config && (config.hourHeight !== undefined ? parseInt(config.hourHeight, 10) : (config.hourheight !== undefined ? parseInt(config.hourheight, 10) : undefined));

        // Parse parent file's daily/weekly note date
        const fileName = ctx?.sourcePath?.split(/[/\\]/).pop()?.replace(/\.md$/, '') || '';
        const moment = (window as any).moment;
        
        let parsedDaily = moment(fileName, plugin.settings.dailyNotesFormat, true);
        if (!parsedDaily.isValid()) {
            const formats = ['YYYY-MM-DD', 'YYYY.MM.DD', 'YYYYMMDD', 'YYYY년 MM월 DD일', 'YYYY_MM_DD'];
            for (const fmt of formats) {
                const p = moment(fileName, fmt, true);
                if (p.isValid()) { parsedDaily = p; break; }
            }
        }
        if (!parsedDaily.isValid()) {
            const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
            if (match) parsedDaily = moment(match[1], 'YYYY-MM-DD', true);
        }

        let parsedWeekly = moment(fileName, plugin.settings.weeklyNotesFormat, true);
        if (!parsedWeekly.isValid()) {
            const weeklyFormats = ['YYYY-[W]WW', 'YYYY-[W]ww', 'gggg-[W]ww', 'gggg-[W]WW', 'YYYY-Www', 'YYYY-Wwww'];
            for (const fmt of weeklyFormats) {
                const p = moment(fileName, fmt, true);
                if (p.isValid()) { parsedWeekly = p; break; }
            }
        }

        if (parsedWeekly.isValid()) {
            this.parentNoteType = 'weekly';
            this.parentNoteDate = parsedWeekly.startOf('week').format('YYYY-MM-DD');
        } else if (parsedDaily.isValid()) {
            this.parentNoteType = 'daily';
            this.parentNoteDate = parsedDaily.format('YYYY-MM-DD');
        } else {
            this.parentNoteType = null;
            this.parentNoteDate = null;
        }

        if (config && config.filters) {
            this.filters = parseFilterGroup(config.filters);
        } else {
            this.filters = { kind: 'group', id: 'root', mode: 'all', children: [] };
        }
        
        let momentDate = (window as any).moment();
        if (this.parentNoteDate) {
            momentDate = (window as any).moment(this.parentNoteDate, 'YYYY-MM-DD');
        }
        if (dateStr && dateStr.toLowerCase() !== 'today') {
            const parsed = (window as any).moment(dateStr, 'YYYY-MM-DD', true);
            if (parsed.isValid()) {
                momentDate = parsed;
            }
        }
        this.currentDate = momentDate;

        const rawCollapsed = config && (config.collapsedColumns !== undefined ? config.collapsedColumns : config.collapsedcolumns);
        if (rawCollapsed) {
            let cols: string[] = [];
            if (Array.isArray(rawCollapsed)) {
                cols = rawCollapsed;
            } else if (typeof rawCollapsed === 'string') {
                const cleanStr = rawCollapsed.replace(/[\[\]]/g, '');
                cols = cleanStr.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
            this.collapsedColumns = new Set(cols);
        } else {
            this.collapsedColumns = new Set();
        }

        this.debouncedUpdateCodeBlock = debounce(async (newViewType: string, newFilters: FilterGroup) => {
            await this.updateCodeBlockInFile(newViewType, newFilters);
        }, 1500);
    }

    onload() {
        this.containerEl.empty();
        const rootEl = this.containerEl.createDiv({ cls: 'dp-container dp-codeblock-container' });
        
        this.containerEl.style.height = this.heightStr;
        this.containerEl.style.position = 'relative';
        this.containerEl.style.overflow = 'hidden';
        this.containerEl.style.resize = 'vertical';
        this.containerEl.style.border = '1px solid var(--background-modifier-border)';
        this.containerEl.style.borderRadius = '8px';
        this.containerEl.style.margin = '12px 0';

        this.registerDomEvent(this.containerEl, 'mouseup', () => {
            const newHeight = this.containerEl.style.height;
            if (newHeight && newHeight !== this.heightStr) {
                this.heightStr = newHeight;
                this.updateCodeBlockInFile(this.viewType, this.filters);
            }
        });

        this.registerEvent(this.plugin.app.metadataCache.on('resolved', async () => {
            await this.refreshContentOnly();
        }));

        this.refreshTasks();
    }

    onunload() {
        window.clearTimeout(this.filterRefreshTimer);
        this.detachFilterDismissListeners();
        if (this.filtersDirty && this.app.workspace.getActiveFile()?.path === this.ctx?.sourcePath) {
            this.flushFilterWrite();
        }
        this.filterPanelEl = null;
        super.onunload();
    }

    async refreshContentOnly() {
        this.contentOnlyRender = true;
        try {
            await this.refreshTasks();
        } finally {
            this.contentOnlyRender = false;
        }
    }

    // Filter edits update the task area in place; the codeblock source is only rewritten
    // once the panel closes, since rewriting it makes Obsidian remount the whole block.
    onFilterChanged(structural: boolean = false) {
        this.filtersDirty = true;
        if (structural) this.rebuildFilterPanel();
        if (!this.showFilterPanel) this.flushFilterWrite();
        window.clearTimeout(this.filterRefreshTimer);
        this.filterRefreshTimer = window.setTimeout(() => {
            this.filterRefreshTimer = undefined;
            this.refreshContentOnly();
        }, 120);
    }

    flushFilterWrite() {
        if (!this.filtersDirty) return;
        this.filtersDirty = false;
        this.updateCodeBlockInFile(this.viewType, this.filters);
    }

    // While the panel is open it stays up for any interaction inside the codeblock and closes
    // on a click / keypress outside it, Escape, or focus moving out of the block.
    attachFilterDismissListeners() {
        if (this.filterDismissCleanup) return;
        const doc = this.containerEl.ownerDocument;
        // Modals/menus opened from inside the block are rendered outside it in the DOM.
        const inPopup = (t: EventTarget | null) => t instanceof Element && !!t.closest('.modal-container, .menu');
        const inBlock = (t: EventTarget | null) => t instanceof Node && this.containerEl.contains(t);

        const onPointerDown = (e: PointerEvent) => {
            if (!inBlock(e.target) && !inPopup(e.target)) this.closeFilterPanel();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (inPopup(e.target) || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
            if (e.key === 'Escape' || !inBlock(e.target)) this.closeFilterPanel();
        };
        const onFocusOut = (e: FocusEvent) => {
            // relatedTarget is null for clicks on non-focusable areas and window blur; only
            // react when focus actually lands somewhere outside the block.
            if (e.relatedTarget && !inBlock(e.relatedTarget) && !inPopup(e.relatedTarget)) this.closeFilterPanel();
        };

        doc.addEventListener('pointerdown', onPointerDown, true);
        doc.addEventListener('keydown', onKeyDown, true);
        this.containerEl.addEventListener('focusout', onFocusOut);
        this.filterDismissCleanup = () => {
            doc.removeEventListener('pointerdown', onPointerDown, true);
            doc.removeEventListener('keydown', onKeyDown, true);
            this.containerEl.removeEventListener('focusout', onFocusOut);
        };
    }

    detachFilterDismissListeners() {
        if (this.filterDismissCleanup) this.filterDismissCleanup();
        this.filterDismissCleanup = null;
    }

    closeFilterPanel() {
        this.detachFilterDismissListeners();
        if (!this.showFilterPanel) return;
        this.showFilterPanel = false;
        this.filterPanelEl = null;
        if (this.ctx && this.ctx.getSectionInfo) {
            const section = this.ctx.getSectionInfo(this.containerEl);
            const blockKey = `${this.ctx.sourcePath}:${section ? section.lineStart : 0}`;
            (this.plugin as any).codeblockShowFiltersState.set(blockKey, false);
        }
        this.render();
        this.flushFilterWrite();
    }

    rebuildFilterPanel() {
        const oldPanel = this.filterPanelEl;
        if (!oldPanel || !oldPanel.isConnected) return;
        const newPanel = this.renderFilterPanel(createDiv());
        if (newPanel) oldPanel.replaceWith(newPanel);
    }

    getViewType(): string {
        return `day-planner-pro-codeblock-${this.viewType}`;
    }

    getViewTabType() {
        return this.viewType;
    }

    async updateCodeBlockInFile(newViewType: string, newFilters: FilterGroup) {
        if (!this.app.workspace.getActiveFile()) return;
        const activeFile = this.app.workspace.getActiveFile()!;
        if (!this.ctx) return;
        const section = this.ctx.getSectionInfo(this.containerEl);
        if (!section) return;

        try {
            const fileContent = await this.app.vault.read(activeFile);
            const lines = fileContent.split('\n');
            
            let lineStart = section.lineStart;
            // Verify and adjust the start line if it shifted
            if (lineStart >= lines.length || !lines[lineStart].trim().startsWith('```')) {
                let found = false;
                for (let offset = 0; offset <= 5; offset++) {
                    if (lineStart - offset >= 0 && lines[lineStart - offset].trim().startsWith('```')) {
                        lineStart = lineStart - offset;
                        found = true;
                        break;
                    }
                    if (lineStart + offset < lines.length && lines[lineStart + offset].trim().startsWith('```')) {
                        lineStart = lineStart + offset;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.warn('Could not locate codeblock start line in file');
                    return;
                }
            }

            const startLine = lines[lineStart];

            // Scan down to find the exact closing backticks
            let lineEnd = -1;
            for (let i = lineStart + 1; i < lines.length; i++) {
                if (lines[i].trim().startsWith('```')) {
                    lineEnd = i;
                    break;
                }
            }
            if (lineEnd === -1) {
                console.warn('Could not locate codeblock end line in file');
                return;
            }

            const yamlLines = [];
            yamlLines.push(`type: ${newViewType}`);
            
            const origLines = fileContent.split('\n').slice(lineStart + 1, lineEnd);
            for (const origLine of origLines) {
                const parts = origLine.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim().toLowerCase();
                    const val = parts.slice(1).join(':').trim();
                    if (key === 'date') {
                        yamlLines.push(`date: ${val}`);
                    }
                }
            }

            if (this.heightStr) {
                yamlLines.push(`height: ${this.heightStr}`);
            }

            if (this.hourHeight !== undefined) {
                yamlLines.push(`hourHeight: ${this.hourHeight}`);
            }
            if (this.collapsedColumns && this.collapsedColumns.size > 0) {
                yamlLines.push(`collapsedColumns: [${Array.from(this.collapsedColumns).join(', ')}]`);
            }

            if (newFilters.children && newFilters.children.length > 0) {
                yamlLines.push('filters:');
                yamlLines.push(`  kind: group`);
                yamlLines.push(`  mode: ${newFilters.mode}`);
                yamlLines.push('  children:');
                for (const child of newFilters.children) {
                    yamlLines.push(...serializeFilterNode(child, '    '));
                }
            }

            const newCodeBlock = [startLine, ...yamlLines, '```'].join('\n');
            const beforeBlock = lines.slice(0, lineStart).join('\n');
            const afterBlock = lines.slice(lineEnd + 1).join('\n');
            
            const newFileContent = [beforeBlock, newCodeBlock, afterBlock].filter(x => x !== '').join('\n');
            await this.app.vault.modify(activeFile, newFileContent);
        } catch (e) {
            console.error('Error updating codeblock in file:', e);
        }
    }

    renderFilterPanel(parent: HTMLElement): HTMLElement | null {
        if (!this.showFilterPanel) return null;

        const panel = parent.createDiv({ cls: 'dp-filter-panel' });
        panel.style.cssText = 'padding: 4px; margin-bottom: 8px; display: flex; flex-direction: column; gap: 8px;';
        this.filterPanelEl = panel;
        this.attachFilterDismissListeners();

        this.renderFilterGroup(panel, this.filters, true);
        return panel;
    }

    renderFilterGroup(parent: HTMLElement, group: FilterGroup, isRoot: boolean) {
        const groupDiv = parent.createDiv({ cls: 'dp-filter-group' });
        groupDiv.style.cssText = isRoot 
            ? 'padding: 12px; border: 2px solid var(--interactive-accent); border-radius: 8px; background-color: var(--background-secondary-alt); display: flex; flex-direction: column; gap: 10px;' 
            : 'margin-left: 24px; padding: 12px; border: 1.5px solid var(--background-modifier-border-hover); border-radius: 8px; background-color: rgba(var(--mono-rgb-100), 0.015); margin-top: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;';

        // Mode row
        const modeRow = groupDiv.createDiv();
        modeRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;';
        
        const modeSelect = modeRow.createEl('select');
        modeSelect.style.cssText = 'padding: 2px 4px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background-color: var(--background-primary); font-size: 0.85em; cursor: pointer;';
        
        const modes = [
            { value: 'all', label: 'All the following are true' },
            { value: 'any', label: 'Any of the following are true' },
            { value: 'none', label: 'None of the following are true' }
        ];
        modes.forEach(m => {
            const opt = modeSelect.createEl('option', { value: m.value, text: m.label });
            if (m.value === group.mode) opt.selected = true;
        });
        modeSelect.addEventListener('change', async () => {
            group.mode = modeSelect.value as any;
            this.onFilterChanged();
        });

        if (!isRoot) {
            const delGroupBtn = modeRow.createEl('button', { text: '🗑️' });
            delGroupBtn.style.cssText = 'padding: 2px 4px; font-size: 0.85em; background: none; border: none; cursor: pointer; opacity: 0.6; transition: opacity 0.2s; margin-left: auto;';
            delGroupBtn.addEventListener('mouseenter', () => delGroupBtn.style.opacity = '1');
            delGroupBtn.addEventListener('mouseleave', () => delGroupBtn.style.opacity = '0.6');
            delGroupBtn.addEventListener('click', async () => {
                this.removeNodeFromGroup(this.filters, group.id!);
                this.onFilterChanged(true);
            });
        }

        const childrenDiv = groupDiv.createDiv();
        childrenDiv.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';

        if (group.children) {
            group.children.forEach((child) => {
                if (child.kind === 'group' || (child as any).children !== undefined) {
                    this.renderFilterGroup(childrenDiv, child as FilterGroup, false);
                } else {
                    this.renderFilterRuleRow(childrenDiv, child as FilterRule, group);
                }
            });
        }

        const btnsRow = groupDiv.createDiv();
        btnsRow.style.cssText = 'display: flex; gap: 12px; margin-top: 6px;';
        
        const addRuleBtn = btnsRow.createEl('button', { text: '➕ Add filter' });
        addRuleBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background-color: var(--background-primary); font-size: 0.8em; cursor: pointer; font-weight: bold;';
        addRuleBtn.addEventListener('click', async () => {
            if (!group.children) group.children = [];
            group.children.push({
                kind: 'rule',
                id: Math.random().toString(36).substring(2, 9),
                type: 'text',
                operator: 'contains',
                value: ''
            });
            this.onFilterChanged(true);
        });

        const addGroupBtn = btnsRow.createEl('button', { text: '➕ Add filter group' });
        addGroupBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); background-color: var(--background-primary); font-size: 0.8em; cursor: pointer; font-weight: bold;';
        addGroupBtn.addEventListener('click', async () => {
            if (!group.children) group.children = [];
            group.children.push({
                kind: 'group',
                id: Math.random().toString(36).substring(2, 9),
                mode: 'all',
                children: []
            });
            this.onFilterChanged(true);
        });
    }

    renderFilterRuleRow(parent: HTMLElement, rule: FilterRule, parentGroup: FilterGroup) {
        const ruleRow = parent.createDiv();
        ruleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

        const ruleBox = ruleRow.createDiv({ cls: 'dp-filter-rule-box' });
        ruleBox.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 10px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background-color: var(--background-primary); flex-grow: 1; flex-wrap: wrap;';

        const typeSelect = ruleBox.createEl('select');
        typeSelect.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; cursor: pointer; color: var(--text-normal);';
        
        const types = [
            { value: 'itemType', label: 'Item Type' },
            { value: 'folder', label: 'Folder' },
            { value: 'file', label: 'File' },
            { value: 'tag', label: 'Tag' },
            { value: 'status', label: 'Status' },
            { value: 'priority', label: 'Priority' },
            { value: 'text', label: 'Text' },
            { value: 'date', label: 'Date' }
        ];
        types.forEach(t => {
            const opt = typeSelect.createEl('option', { value: t.value, text: t.label });
            if (t.value === rule.type) opt.selected = true;
        });

        const opSelect = ruleBox.createEl('select');
        opSelect.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; cursor: pointer; color: var(--text-normal);';
        
        const updateOperators = () => {
            opSelect.empty();
            let ops: { value: string; label: string }[] = [];
            if (rule.type === 'priority') {
                ops = [
                    { value: 'equals', label: 'is' },
                    { value: 'notEquals', label: 'is not' },
                    { value: 'isHigher', label: 'is higher than' },
                    { value: 'isLower', label: 'is lower than' }
                ];
            } else if (rule.type === 'status') {
                ops = [
                    { value: 'equals', label: 'is' },
                    { value: 'notEquals', label: 'is not' }
                ];
            } else if (rule.type === 'itemType') {
                ops = [
                    { value: 'equals', label: 'is' },
                    { value: 'notEquals', label: 'is not' }
                ];
            } else if (rule.type === 'date') {
                ops = [
                    { value: 'equals', label: 'is' },
                    { value: 'notEquals', label: 'is not' },
                    { value: 'isBefore', label: 'is before' },
                    { value: 'isAfter', label: 'is after' },
                    { value: 'isEmpty', label: 'is empty' },
                    { value: 'isNotEmpty', label: 'is not empty' }
                ];
            } else if (rule.type === 'folder' || rule.type === 'file') {
                ops = [
                    { value: 'contains', label: 'is located' },
                    { value: 'notContains', label: 'is not located' }
                ];
            } else {
                ops = [
                    { value: 'contains', label: 'contains' },
                    { value: 'notContains', label: 'does not contain' },
                    { value: 'equals', label: 'equals' },
                    { value: 'notEquals', label: 'does not equal' },
                    { value: 'startsWith', label: 'starts with' },
                    { value: 'endsWith', label: 'ends with' }
                ];
            }
            ops.forEach(op => {
                const opt = opSelect.createEl('option', { value: op.value, text: op.label });
                if (op.value === rule.operator) opt.selected = true;
            });
            if (ops.length > 0 && !ops.some(op => op.value === rule.operator)) {
                rule.operator = ops[0].value as any;
                opSelect.value = rule.operator;
            }
        };
        updateOperators();

        let valInput: HTMLElement;
        const renderValueInput = () => {
            if (valInput) valInput.remove();
            
            if (rule.type === 'status') {
                const select = ruleBox.createEl('select');
                select.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; cursor: pointer; color: var(--text-normal);';
                const statuses = ['todo', 'in-progress', 'completed', 'cancelled'];
                statuses.forEach(s => {
                    const opt = select.createEl('option', { value: s, text: s });
                    if (s === rule.value) opt.selected = true;
                });
                select.addEventListener('change', async () => {
                    rule.value = select.value;
                    this.onFilterChanged();
                });
                valInput = select;
            } else if (rule.type === 'priority') {
                const select = ruleBox.createEl('select');
                select.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; cursor: pointer; color: var(--text-normal);';
                const priorities = ['lowest', 'low', 'normal', 'medium', 'high', 'highest'];
                priorities.forEach(p => {
                    const opt = select.createEl('option', { value: p, text: p });
                    if (p === rule.value) opt.selected = true;
                });
                select.addEventListener('change', async () => {
                    rule.value = select.value;
                    this.onFilterChanged();
                });
                valInput = select;
            } else if (rule.type === 'itemType') {
                const select = ruleBox.createEl('select');
                select.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; cursor: pointer; color: var(--text-normal);';
                const typesList = [
                    { value: 'task', label: 'Task' },
                    { value: 'gcal', label: 'GCal Appointment' }
                ];
                typesList.forEach(t => {
                    const opt = select.createEl('option', { value: t.value, text: t.label });
                    if (t.value === rule.value) opt.selected = true;
                });
                select.addEventListener('change', async () => {
                    rule.value = select.value;
                    this.onFilterChanged();
                });
                valInput = select;
            } else if (rule.type === 'date') {
                if (rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty') {
                    valInput = ruleBox.createDiv();
                    valInput.style.cssText = 'display:none;';
                } else {
                    const dateWrapper = ruleBox.createSpan();
                    dateWrapper.style.cssText = 'display: inline-flex; align-items: center; gap: 6px;';

                    const select = dateWrapper.createEl('select');
                    select.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; cursor: pointer; color: var(--text-normal);';

                    const dateOptions = [
                        { value: 'today', label: 'Today' },
                        { value: 'yesterday', label: 'Yesterday' },
                        { value: 'tomorrow', label: 'Tomorrow' },
                        { value: 'this week', label: 'This Week' },
                        { value: 'this month', label: 'This Month' },
                        { value: 'this year', label: 'This Year' },
                        { value: 'custom', label: 'Specific Date...' }
                    ];

                    const isPredefined = ['today', 'yesterday', 'tomorrow', 'this week', 'this month', 'this year'].includes(rule.value);
                    const selectedVal = isPredefined ? rule.value : 'custom';

                    dateOptions.forEach(opt => {
                        const optionEl = select.createEl('option', { value: opt.value, text: opt.label });
                        if (opt.value === selectedVal) optionEl.selected = true;
                    });

                    const datePicker = dateWrapper.createEl('input', { type: 'date' });
                    datePicker.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; color: var(--text-normal);';

                    if (selectedVal === 'custom') {
                        datePicker.style.display = 'inline-block';
                        const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(rule.value);
                        datePicker.value = isValidDate ? rule.value : (window as any).moment().format('YYYY-MM-DD');
                    } else {
                        datePicker.style.display = 'none';
                    }

                    select.addEventListener('change', async () => {
                        if (select.value === 'custom') {
                            datePicker.style.display = 'inline-block';
                            const pickerVal = datePicker.value || (window as any).moment().format('YYYY-MM-DD');
                            rule.value = pickerVal;
                            datePicker.value = pickerVal;
                        } else {
                            datePicker.style.display = 'none';
                            rule.value = select.value;
                        }
                        this.onFilterChanged();
                    });

                    datePicker.addEventListener('change', async () => {
                        rule.value = datePicker.value;
                        this.onFilterChanged();
                    });

                    valInput = dateWrapper;
                }
            } else {
                const inputWrapper = ruleBox.createDiv();
                inputWrapper.style.cssText = 'position: relative; flex-grow: 1; display: flex; align-items: center; min-width: 80px;';

                const input = inputWrapper.createEl('input', {
                    type: 'text',
                    value: rule.value,
                    placeholder: rule.type === 'tag' ? 'e.g. urgent' : 'value...'
                });
                input.style.cssText = 'padding: 2px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background-color: var(--background-primary); font-size: 0.85em; width: 100%; color: var(--text-normal);';

                if (rule.type === 'folder' || rule.type === 'file') {
                    // Create suggestion container
                    const suggContainer = inputWrapper.createDiv({ cls: 'dp-sugg-container' });
                    suggContainer.style.cssText = 'position: absolute; top: 100%; left: 0; width: 100%; display: none;';

                    const updateSuggestions = () => {
                        suggContainer.empty();
                        const query = input.value.toLowerCase().trim();
                        
                        let items: string[] = [];
                        if (rule.type === 'folder') {
                            items = this.app.vault.getAllLoadedFiles()
                                .filter(f => (f as any).children !== undefined)
                                .map(f => f.path)
                                .filter(p => p && p !== '/');
                        } else {
                            items = this.app.vault.getMarkdownFiles()
                                .filter(f => !isSyncConflictPath(f.path))
                                .map(f => f.basename);
                        }

                        const filtered = query === '' 
                            ? items 
                            : items.filter(item => item.toLowerCase().includes(query));

                        const uniqueFiltered = Array.from(new Set(filtered)).sort();

                        if (uniqueFiltered.length === 0) {
                            const noItem = suggContainer.createDiv({ cls: 'dp-sugg-item' });
                            noItem.style.cssText = 'color: var(--text-muted); cursor: default;';
                            noItem.setText('No matching items found');
                            suggContainer.style.display = 'block';
                            return;
                        }

                        uniqueFiltered.slice(0, 10).forEach(val => {
                            const item = suggContainer.createDiv({ cls: 'dp-sugg-item' });
                            item.setText(val);
                            
                            item.addEventListener('mousedown', async (e) => {
                                e.preventDefault();
                                input.value = val;
                                rule.value = val;
                                suggContainer.style.display = 'none';
                                this.onFilterChanged();
                            });
                        });

                        suggContainer.style.display = 'block';
                    };

                    input.addEventListener('input', () => {
                        updateSuggestions();
                    });

                    input.addEventListener('focus', () => {
                        updateSuggestions();
                    });

                    input.addEventListener('blur', () => {
                        setTimeout(() => {
                            suggContainer.style.display = 'none';
                        }, 150);
                    });
                }

                input.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        input.blur();
                    }
                });

                input.addEventListener('blur', async () => {
                    setTimeout(async () => {
                        if (rule.value !== input.value) {
                            rule.value = input.value;
                            this.onFilterChanged();
                        }
                    }, 200);
                });
                valInput = inputWrapper;
            }
        };
        renderValueInput();

        typeSelect.addEventListener('change', async () => {
            rule.type = typeSelect.value as any;
            if (rule.type === 'status') {
                rule.operator = 'equals';
                rule.value = 'todo';
            } else if (rule.type === 'priority') {
                rule.operator = 'equals';
                rule.value = 'normal';
            } else if (rule.type === 'itemType') {
                rule.operator = 'equals';
                rule.value = 'task';
            } else if (rule.type === 'date') {
                rule.operator = 'equals';
                rule.value = 'today';
            } else {
                rule.operator = 'contains';
                rule.value = '';
            }
            updateOperators();
            renderValueInput();
            this.onFilterChanged();
        });

        opSelect.addEventListener('change', async () => {
            rule.operator = opSelect.value as any;
            renderValueInput();
            this.onFilterChanged();
        });

        const delBtn = ruleBox.createEl('button', { text: '🗑️' });
        delBtn.style.cssText = 'padding: 2px 4px; font-size: 0.85em; background: none; border: none; cursor: pointer; opacity: 0.6; transition: opacity 0.2s; margin-left: auto;';
        delBtn.addEventListener('mouseenter', () => delBtn.style.opacity = '1');
        delBtn.addEventListener('mouseleave', () => delBtn.style.opacity = '0.6');
        delBtn.addEventListener('click', async () => {
            if (parentGroup.children) {
                const idx = parentGroup.children.indexOf(rule);
                if (idx !== -1) {
                    parentGroup.children.splice(idx, 1);
                }
            }
            this.onFilterChanged(true);
        });
    }

    removeNodeFromGroup(group: FilterGroup, targetId: string): boolean {
        if (!group.children) return false;
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if (child.id === targetId) {
                group.children.splice(i, 1);
                return true;
            }
            if (child.kind === 'group' || (child as any).children !== undefined) {
                const found = this.removeNodeFromGroup(child as FilterGroup, targetId);
                if (found) return true;
            }
        }
        return false;
    }

    navigateDate(direction: number) {
        if (this.viewType === 'daily') this.currentDate.add(direction, 'day');
        if (this.viewType === 'multiDay') this.currentDate.add(direction * (this.plugin.settings.nDayViewDays || 4), 'day');
        if (this.viewType === 'weekly') this.currentDate.add(direction, 'week');
        if (this.viewType === 'monthly') this.currentDate.add(direction, 'month');
        if (this.viewType === 'list') {
            this.currentDate.add(direction, 'month');
        }
    }

    renderRoot(rootEl: HTMLDivElement) {
        const header = rootEl.createDiv({ cls: 'dp-header' });
        this.renderNavHeader(header, false);

        const tabsContainer = header.createDiv({ cls: 'dp-tabs' });
        const tabs: { key: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list'; label: string }[] = [
            { key: 'daily', label: 'Daily Timeline' },
            { key: 'multiDay', label: `${this.plugin.settings.nDayViewDays || 4}-day View` },
            { key: 'weekly', label: 'Weekly View' },
            { key: 'monthly', label: 'Monthly Calendar' },
            { key: 'board', label: 'Board' },
            { key: 'list', label: 'List View' }
        ];

        tabs.forEach(tab => {
            if (tab.key === 'multiDay') {
                const tabEl = tabsContainer.createEl('div', {
                    cls: `dp-tab dp-tab-nday ${this.viewType === 'multiDay' ? 'active' : ''}`
                });
                
                tabEl.addEventListener('click', async (e) => {
                    if (e.target instanceof HTMLSelectElement) return;
                    this.viewType = 'multiDay';
                    await this.refreshTasks(); // tab change: cached GCal ranges only, no forced fetch
                    this.updateCodeBlockInFile(this.viewType, this.filters);
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

                tabEl.createSpan({ text: '-day View' });

                select.addEventListener('change', async (e) => {
                    const val = parseInt(select.value, 10);
                    this.plugin.settings.nDayViewDays = val;
                    await this.plugin.saveSettings();
                    this.viewType = 'multiDay';
                    this.plugin.refreshActiveViews();
                });
            } else {
                const btn = tabsContainer.createEl('button', {
                    cls: `dp-tab ${this.viewType === tab.key ? 'active' : ''}`,
                    text: tab.label
                });
                btn.addEventListener('click', async () => {
                    this.viewType = tab.key;
                    await this.refreshTasks(); // tab change: cached GCal ranges only, no forced fetch
                    this.updateCodeBlockInFile(this.viewType, this.filters);
                });
            }
        });
        animateActiveTabPill(tabsContainer, this as any, this.viewType);

        this.renderFilterPanel(rootEl);

        const content = rootEl.createDiv({ cls: 'dp-content' });
        content.style.cssText = 'flex-grow: 1; overflow-y: auto; padding: 0; position: relative;';
        this.renderContentArea(rootEl, content);
    }

    renderContentArea(rootEl: HTMLDivElement, content: HTMLDivElement) {
        content.empty();
        rootEl.querySelector(':scope > .dp-current-task-bar')?.remove();

        if (this.viewType === 'daily') {
            this.renderDailyTimeline(content);
            this.renderCurrentTaskTracker(rootEl);
        } else if (this.viewType === 'weekly') {
            this.renderWeeklyView(content);
        } else if (this.viewType === 'multiDay') {
            this.renderWeeklyView(content, Math.max(2, Math.min(14, this.plugin.settings.nDayViewDays || 4)), true);
        } else if (this.viewType === 'monthly') {
            this.renderMonthlyCalendar(content);
        } else if (this.viewType === 'board') {
            this.renderKanbanBoard(content);
        } else if (this.viewType === 'list') {
            this.renderListView(content);
        }
    }
}

// Type-side view of the runtime mixin below: the renderer really has these base-view methods on its prototype
export interface DayPlannerCodeBlockRenderer extends Pick<DayPlannerBaseView,
    'refreshTasks' | 'render' | 'renderNavHeader' | 'renderDailyTimeline' | 'renderCurrentTaskTracker' |
    'renderWeeklyView' | 'renderMonthlyCalendar' | 'renderKanbanBoard' | 'renderListView'> {}

// Copy all methods from DayPlannerBaseView's prototype to DayPlannerCodeBlockRenderer's prototype dynamically
for (const key of Object.getOwnPropertyNames(DayPlannerBaseView.prototype)) {
    if (
        key === 'constructor' || 
        key === 'onload' || 
        key === 'onunload' || 
        key === 'renderRoot' || 
        key === 'getViewType' || 
        key === 'getViewTabType' || 
        key === 'navigateDate'
    ) {
        continue;
    }
    
    const descriptor = Object.getOwnPropertyDescriptor(DayPlannerBaseView.prototype, key);
    if (descriptor) {
        Object.defineProperty(DayPlannerCodeBlockRenderer.prototype, key, descriptor);
    }
}
