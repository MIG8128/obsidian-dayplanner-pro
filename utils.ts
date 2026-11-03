import { App, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, Platform, setIcon, AbstractInputSuggest, prepareFuzzySearch, renderMatches } from 'obsidian';
import { TaskItem, DayPlannerSettings, MOTION } from './types';

// ---------------------------------------------------------------------------------------------
// Haptics: one safe entry point. No-op on desktop, when the setting is off, or where vibrate() is unsupported
// (iOS WebKit has no Vibration API, so iPhone/iPad silently get nothing).
// ---------------------------------------------------------------------------------------------
/** 'lift': a touch long-press picked a card up for dragging */
export type HapticType = 'selection' | 'light' | 'lift' | 'success' | 'warning';

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
        lift: 25,
        success: [10, 35, 15],
        warning: [20, 50, 20]
    };
    try { navigator.vibrate(patterns[type]); } catch { /* vibration blocked by the OS */ }
}

/** A finger, or Apple Pencil on iPad / mobile (it scrolls, taps and long-presses like a finger there) */
export const isTouchLike = (e: PointerEvent): boolean => e.pointerType === 'touch' || (e.pointerType === 'pen' && Platform.isMobile);

/** Obsidian Tasks priority signifiers ('normal' has none) */
export const PRIORITY_EMOJI: Record<string, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };

/** "HH:mm" → minutes since midnight */
/**
 * Vertical mouse wheel / two-finger trackpad scroll over a calendar pages it: down → next, up → previous.
 * While the fingers move, the grid (pullTarget) follows them through --dp-wheel-pull; past PAGE_AT it pages, short of
 * it the grid springs back when the gesture stops. After a page, the trackpad's momentum (shrinking deltas) is ignored;
 * a fresh push, a pause, or another wheel notch pages again.
 */
export function pageOnWheel(el: HTMLElement, page: (step: number) => void, pullTarget: () => HTMLElement | null) {
    const PAGE_AT = 60;      // px of scroll that turn the page
    const QUIET_MS = 160;    // no event for this long: the gesture is over
    const ANIM_MS = 260;     // the page slide; momentum during it never pages
    let acc = 0;
    let lastAbs = 0;
    let lockedAt = 0;        // performance.now() of the last page, 0 when free
    let quietTimer: number | null = null;

    const setPull = (px: number, release: boolean) => {
        const target = pullTarget();
        if (!target) return;
        target.toggleClass('dp-wheel-release', release);
        if (px === 0) {
            target.style.removeProperty('--dp-wheel-pull');
            target.style.removeProperty('--dp-wheel-fade');
        } else {
            target.style.setProperty('--dp-wheel-pull', `${px}px`);
            target.style.setProperty('--dp-wheel-fade', String(1 - Math.min(Math.abs(px) / PAGE_AT, 1) * 0.6));
        }
    };
    const endGesture = () => {
        quietTimer = null;
        if (!lockedAt && acc !== 0) setPull(0, true); // not far enough: spring back
        acc = 0;
        lastAbs = 0;
        lockedAt = 0;
    };

    el.addEventListener('wheel', (e: WheelEvent) => {
        if (e.ctrlKey) return; // pinch zoom
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1; // lines / pages → pixels
        const dy = e.deltaY * scale;
        if (dy === 0 || Math.abs(e.deltaX * scale) > Math.abs(dy)) return; // sideways: left to Obsidian
        e.preventDefault();
        if (quietTimer !== null) window.clearTimeout(quietTimer);
        quietTimer = window.setTimeout(endGesture, QUIET_MS);

        const abs = Math.abs(dy);
        if (lockedAt) {
            const since = performance.now() - lockedAt;
            const freshPush = since > ANIM_MS && (abs > lastAbs * 1.3 + 2 || abs >= 50); // a new swipe or wheel notch
            lastAbs = abs;
            if (!freshPush) return; // momentum of the swipe that already paged
            lockedAt = 0;
            acc = 0;
        }
        lastAbs = abs;
        if (acc !== 0 && Math.sign(dy) !== Math.sign(acc)) acc = 0; // turned around
        acc += dy;
        if (Math.abs(acc) >= PAGE_AT) {
            const step = acc > 0 ? 1 : -1;
            acc = 0;
            lockedAt = performance.now();
            setPull(0, false);
            page(step);
            return;
        }
        setPull(-acc * 0.5, false); // follows the fingers: scrolling down lifts the month up
    }, { passive: false });
}

export function timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

/** Minutes since midnight → "HH:mm" */
export function minutesToTime(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
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

/**
 * Time estimate of a task: `⏱ 30m`, `⏱ 1h`, `⏱ 1h30m`, `⏱ 1.5h`, `⏱ 45` (minutes), or a `[estimate:: 30m]` field.
 * It stays in the task text (so every line rewrite keeps it) and is hidden from displayed titles.
 */
const ESTIMATE_TOKEN = '(\\d+(?:\\.\\d+)?\\s*h(?:\\s*\\d+\\s*m(?:in)?)?|\\d+\\s*m(?:in)?|\\d+)(?![\\w:.])';
const ESTIMATE_RE = new RegExp(`⏱\\uFE0F?\\s*${ESTIMATE_TOKEN}`, 'i');
const ESTIMATE_RE_G = new RegExp(`⏱\\uFE0F?\\s*${ESTIMATE_TOKEN}`, 'gi');
const ESTIMATE_FIELD_RE = /\[\s*estimate::\s*([^\]]+)\]/i;

/** "1h30m" / "1.5h" / "45m" / "45" → minutes; null when it is not a duration */
export function parseDurationToken(token: string): number | null {
    const m = token.trim().toLowerCase().match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*(?:m|min)?)?$/);
    if (!m || (!m[1] && !m[2])) return null;
    const minutes = Math.round(parseFloat(m[1] ?? '0') * 60 + parseInt(m[2] ?? '0', 10));
    return minutes > 0 && minutes <= 24 * 60 ? minutes : null;
}

/** The task's ⏱ estimate in minutes, or null */
export function parseEstimate(text: string): number | null {
    const token = text.match(ESTIMATE_RE)?.[1] ?? text.match(ESTIMATE_FIELD_RE)?.[1];
    return token ? parseDurationToken(token) : null;
}

// Display titles are re-cleaned on every render (and twice per comparison when the drawer sorts by title): memoised
// per text and metadata setting. Cleared wholesale when full, which only costs a re-clean.
const displayTextCache = new Map<string, string>();
const DISPLAY_TEXT_CACHE_MAX = 5000;

// 렌더링용 헬퍼 함수: 마크다운 할 일 텍스트에서 각종 시간/날짜/반복 지형 소거
export function cleanTaskTextForDisplay(text: string): string {
    const hideMeta = scanSettings?.hideBracketMetadata !== false;
    const key = (hideMeta ? '1' : '0') + text;
    const hit = displayTextCache.get(key);
    if (hit !== undefined) return hit;
    const result = cleanTaskTextUncached(text, hideMeta);
    if (displayTextCache.size >= DISPLAY_TEXT_CACHE_MAX) displayTextCache.clear();
    displayTextCache.set(key, result);
    return result;
}

function cleanTaskTextUncached(text: string, hideMeta: boolean): string {
    let cleaned = text;
    cleaned = cleaned.replace(/\[\s*startTime::\s*[^\]]+\]/ig, '');
    cleaned = cleaned.replace(/startTime::\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?/ig, '');
    cleaned = cleaned.replace(/[⏳📅🛫✅❌]\s*\d{4}-\d{2}-\d{2}/g, '');
    cleaned = cleaned.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
    cleaned = cleaned.replace(/⏰\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?/g, '');
    cleaned = cleaned.replace(/\[\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s*\]/g, '');
    cleaned = cleaned.replace(/^\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?\s+/, '');
    cleaned = cleaned.replace(/🔁\s*[^⏳📅🛫⏰⏱✅❌🔺⏫🔼🔽⏬🟢\n]+/g, '');
    cleaned = cleaned.replace(/[🔺⏫🔼🟢🔽⏬]/g, '');
    cleaned = cleaned.replace(ESTIMATE_RE_G, '');
    // Display only: [key:: value] inline fields (gcalId, Dataview fields) are hidden unless the setting is turned off.
    // Files keep them; parseTaskLine / updateTaskInFile never go through this function.
    if (hideMeta) cleaned = cleaned.replace(/\[[^\[\]]*?::[^\[\]]*\]/g, '');
    return cleaned.replace(/\s+/g, ' ').trim();
}

/** The sync-tracking tag with its leading space, as written by updateTaskInFile: ` [gcalId:: <id>]`. Hidden in note views only. */
export const GCAL_ID_TAG_RE = / ?\[\s*gcalId::[^\]\n]*\]/gi;

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

/** Content key of a task list: equal keys render identically (id carries path + line, originalLine every parsed field). */
export function taskListSignature(tasks: TaskItem[]): string {
    let key = '';
    for (const t of tasks) key += `${t.id}\u0000${t.date}\u0000${t.originalLine}\n`;
    return key;
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
        // Binary toggle: done → todo; todo or any other status (in progress, cancelled, custom) → done
        const nextStatus = task.statusChar === 'x' ? ' ' : 'x';

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

/** Vault path of the daily or weekly note for a date (moment or YYYY-MM-DD), whether or not it exists */
export function periodicNotePath(date: any, type: 'daily' | 'weekly', settings: DayPlannerSettings): string {
    const { folder, format } = NOTE_CONFIG[type](settings);
    return `${folder ? folder + '/' : ''}${(window as any).moment(date).format(format)}.md`;
}

/**
 * Opens the daily or weekly note for a date in a new tab (or in `leaf`), creating it first (folder + template) when
 * missing. `date` is a moment or a YYYY-MM-DD string. Template tokens: {{date}}, {{title}}, {{time}}.
 */
export async function openNoteForDate(app: App, date: any, type: 'daily' | 'weekly', settings: DayPlannerSettings, leaf?: WorkspaceLeaf): Promise<void> {
    try {
        const moment = (window as any).moment;
        const m = moment(date);
        const dateStr = m.format('YYYY-MM-DD');
        const { folder, format, template } = NOTE_CONFIG[type](settings);
        const fileName = m.format(format);
        const filePath = periodicNotePath(m, type, settings);

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

        await (leaf ?? app.workspace.getLeaf('tab')).openFile(file as TFile);
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

/**
 * Scrolls a container to 'now' / 'today' (falling back to `fallbackTop` when the target isn't rendered). Returns the top used.
 * 'smooth' glides (see glideScrollTop) and calls `onArrive` when it lands.
 */
export function scrollToTarget(containerEl: HTMLElement, target: 'now' | 'today', behavior: 'smooth' | 'auto', fallbackTop: () => number = () => 0,
    onArrive?: () => void, delayMs = 0): number {
    const top = Math.max(0, getScrollTargetTop(containerEl, target) ?? fallbackTop());
    if (behavior === 'smooth') glideScrollTop(containerEl, top, onArrive, delayMs);
    else containerEl.scrollTo({ top, behavior });
    return top;
}

/**
 * Glides a scroller to `top`: ease-in-out, 450–1000ms by distance, after `delayMs`; then calls `onArrive`. A wheel,
 * touch, click or key from the user takes over at once (no arrival). Reduced motion: an instant jump, no arrival.
 */
export function glideScrollTop(el: HTMLElement, top: number, onArrive?: () => void, delayMs = 0) {
    const win = el.ownerDocument.defaultView ?? window;
    if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        el.scrollTop = top;
        return;
    }
    const abort = new AbortController();
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) {
        el.addEventListener(type, () => abort.abort(), { passive: true, signal: abort.signal });
    }
    win.setTimeout(() => {
        if (abort.signal.aborted || !el.isConnected) return;
        const from = el.scrollTop;
        // Ends on the real stop: easing toward a point past the end would halt abruptly at the scroll limit
        const max = el.scrollHeight - el.clientHeight;
        const to = max > 0 ? Math.min(top, max) : top;
        const finish = () => {
            abort.abort();
            onArrive?.();
        };
        if (Math.abs(to - from) < 2) return finish();
        const duration = Math.min(1000, 450 + Math.abs(to - from) * 0.35);
        const t0 = win.performance.now();
        const step = (now: number) => {
            if (abort.signal.aborted || !el.isConnected) return;
            const p = Math.min(1, (now - t0) / duration);
            const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // ease-in-out cubic
            el.scrollTop = from + (to - from) * eased;
            if (p < 1) win.requestAnimationFrame(step);
            else finish();
        };
        win.requestAnimationFrame(step);
    }, delayMs);
}

// ---- Motion standard (types.ts MOTION): a pop-up grows out of what was pressed and goes back into it ----

/** Where a pop-up grows from: the pressed element's box, and its item id to find it again once redrawn */
export interface MotionOrigin {
    rect: DOMRect;
    id: string | null;
}

/** Cards and controls a press can start from, inside the planner, its pop-ups and its menus */
const PRESS_ORIGIN = '[data-task-id], [data-select-id], [data-drawer-task-id], .dp-grid-cell, button, .clickable-icon, [role="button"], .menu-item';
/** A pop-up opening later than this after the press (or with no press: a hotkey, a command) grows from the centre */
const PRESS_ORIGIN_MAX_AGE_MS = 1500;
let lastPress: (MotionOrigin & { at: number }) | null = null;

/** Capture-phase pointerdown on every window (main.ts watchInputWindow): remembers the last planner press */
export function recordPressOrigin(e: PointerEvent) {
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(PRESS_ORIGIN);
    lastPress = el && el.closest('.dp-container, .modal, .menu.dp-glass-menu')
        ? { rect: el.getBoundingClientRect(), id: el.dataset.taskId ?? el.dataset.selectId ?? el.dataset.drawerTaskId ?? null, at: Date.now() }
        : null;
}

/** The press that opened a pop-up (used once), or null to grow from the centre */
export function takePressOrigin(): MotionOrigin | null {
    const press = lastPress;
    lastPress = null;
    return press && Date.now() - press.at < PRESS_ORIGIN_MAX_AGE_MS ? { rect: press.rect, id: press.id } : null;
}

function prefersReducedMotionIn(el: HTMLElement): boolean {
    return (el.ownerDocument.defaultView ?? window).matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The origin now: its item's card if redrawn since (a saved task may have moved), else where the press was */
function originRectNow(origin: MotionOrigin, doc: Document): DOMRect {
    if (origin.id) {
        const id = CSS.escape(origin.id);
        const card = Array.from(doc.querySelectorAll<HTMLElement>(
            `.dp-container :is([data-task-id="${id}"], [data-select-id="${id}"], [data-drawer-task-id="${id}"])`))
            .find(el => !el.closest('.is-hidden') && el.getBoundingClientRect().width > 0);
        if (card) return card.getBoundingClientRect();
    }
    return origin.rect;
}

/** The transform that lays `box` over `origin`: centred on it, scaled down to its size (no squashing) */
function transformOnto(origin: DOMRect, box: DOMRect): string {
    const scale = Math.min(1, Math.max(0.1, origin.width / box.width, origin.height / box.height));
    const dx = origin.left + origin.width / 2 - (box.left + box.width / 2);
    const dy = origin.top + origin.height / 2 - (box.top + box.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

/** The transform that lays `box` exactly over `card`: its size and place, so the pop-up is the card's own shape */
function morphOnto(card: DOMRect, box: DOMRect): string {
    const sx = Math.max(0.02, card.width / box.width);
    const sy = Math.max(0.02, card.height / box.height);
    const dx = card.left + card.width / 2 - (box.left + box.width / 2);
    const dy = card.top + card.height / 2 - (box.top + box.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

/** Card → pop-up and back (a task or event editor opened from its card): the surface morphs between the card's box
 *  and its own, like the view zoom through the date; its contents only show once it has grown (no squashed text) */
const MORPH_OUT_MS = 250;
function fadeContents(el: HTMLElement, show: boolean, duration: number) {
    Array.from(el.children).forEach(child => (child as HTMLElement).animate(show
        ? [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }]
        : [{ opacity: 1 }, { opacity: 0, offset: 0.4 }, { opacity: 0 }], { duration, fill: show ? 'none' : 'forwards' }));
}

/** Grows a pop-up out of its origin: out of a card it morphs from the card's own box; out of a button (or with no
 *  origin: from the centre) it grows a little past its size, then settles */
export function popIn(el: HTMLElement, origin: MotionOrigin | null) {
    const box = el.getBoundingClientRect();
    if (prefersReducedMotionIn(el) || !box.width || !box.height) return;
    if (origin?.id) {
        el.animate([
            { transform: morphOnto(originRectNow(origin, el.ownerDocument), box), opacity: 0.6 },
            { opacity: 1, offset: 0.2 },
            { transform: 'none', opacity: 1 },
        ], { duration: MOTION.inMs, easing: MOTION.settle });
        fadeContents(el, true, MOTION.inMs);
        return;
    }
    el.animate([
        { transform: origin ? transformOnto(originRectNow(origin, el.ownerDocument), box) : 'scale(0.92)', opacity: 0 },
        { opacity: 1, offset: 0.35 },
        { transform: 'none', opacity: 1 },
    ], { duration: MOTION.inMs, easing: MOTION.spring });
}

/** Shrinks a pop-up back into its origin (a card: into its box, wherever it was redrawn; no origin: down in place) and
 *  fades it, then calls `done` once */
export function popOut(el: HTMLElement, origin: MotionOrigin | null, done: () => void) {
    const box = el.getBoundingClientRect();
    if (prefersReducedMotionIn(el) || !box.width || !box.height) return done();
    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        done();
    };
    if (origin?.id) {
        fadeContents(el, false, MORPH_OUT_MS);
        el.animate([
            { transform: 'none', opacity: 1 },
            { opacity: 1, offset: 0.7 },
            { transform: morphOnto(originRectNow(origin, el.ownerDocument), box), opacity: 0 },
        ], { duration: MORPH_OUT_MS, easing: MOTION.settle, fill: 'forwards' }).onfinish = finish;
        window.setTimeout(finish, MORPH_OUT_MS + 150);
        return;
    }
    el.animate([
        { transform: 'none', opacity: 1 },
        { transform: origin ? transformOnto(originRectNow(origin, el.ownerDocument), box) : 'scale(0.92)', opacity: 0 },
    ], { duration: MOTION.outMs, easing: MOTION.exit, fill: 'forwards' }).onfinish = finish;
    window.setTimeout(finish, MOTION.outMs + 150); // never left open if the animation is dropped
}

// Daily-note date fallback, memoised per note: strict moment parsing tries up to 6 formats and ran for every dateless
// task line of the same note during a full scan
const fileNameDateCache = new Map<string, string | null>();
function dateFromFileName(filePath: string, dailyNotesFormat?: string): string | null {
    const key = `${dailyNotesFormat ?? ''}|${filePath}`;
    const hit = fileNameDateCache.get(key);
    if (hit !== undefined) return hit;

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
    const date = momentDate && momentDate.isValid() ? momentDate.format('YYYY-MM-DD') : null;
    fileNameDateCache.set(key, date);
    return date;
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
    const recurMatch = remainingText.match(/🔁\s*([^⏳📅🛫⏰⏱✅❌🔺⏫🔼🔽⏬🟢\n]+)/);
    if (recurMatch) {
        recurrence = recurMatch[1].trim();
        remainingText = remainingText.replace(/🔁\s*[^⏳📅🛫⏰⏱✅❌🔺⏫🔼🔽⏬🟢\n]+/, '').trim();
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

    const date = scheduledDate || dueDate || dateFromFileName(filePath, dailyNotesFormat);

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

    // Deadline time: [dueTime:: 17:00] (📅 itself only takes a date in the Tasks plugin)
    let dueTime: string | null = null;
    const dueTimeMatch = remainingText.match(/\[\s*dueTime::\s*(\d{1,2}:\d{2})\s*\]/i);
    if (dueTimeMatch) {
        dueTime = normalizeTime(dueTimeMatch[1]);
        remainingText = remainingText.replace(/\[\s*dueTime::\s*\d{1,2}:\d{2}\s*\]/i, '').trim();
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
        dueTime,
        scheduledDate,
        startDate,
        completionDate,
        cancelledDate,
        gcalEventId,
        estimateMinutes: parseEstimate(text)
    };
}

// Vault 내의 모든 마크다운 파일에서 할 일 파싱
/** Syncthing conflict copies, e.g. `Note.sync-conflict-20260927-101500-ABCDEFG.md` */
export function isSyncConflictPath(path: string): boolean {
    return /\.sync-conflict-/i.test(path);
}

/** OAuth client IDs, secrets and tokens never contain whitespace: drops spaces, tabs and CR/LF left by copy-paste */
export function sanitizeCredential(value: unknown): string {
    return typeof value === 'string' ? value.replace(/\s+/g, '') : '';
}

// Settings the scanner reads. Set by the plugin on load and on every save, so exclusions apply from the very first
// scan (looking the plugin up via app.plugins can return nothing while it is still loading).
let scanSettings: DayPlannerSettings | null = null;
export function setScanSettings(settings: DayPlannerSettings) {
    scanSettings = settings;
}

/** The date a task inherits from its note's file name (daily notes), as parseTaskLine falls back to; null if none */
export function fileNameTaskDate(filePath: string): string | null {
    return dateFromFileName(filePath, scanSettings?.dailyNotesFormat);
}

const WEEKLY_NOTE_FORMATS = ['YYYY-[W]WW', 'YYYY-[W]ww', 'gggg-[W]ww', 'gggg-[W]WW', 'YYYY-Www', 'YYYY-Wwww'];

/**
 * The daily or weekly note a file is, judged by its name: a code block in it shows that day or week by default.
 * Weekly is checked first; `date` is the week's first day for a weekly note. Null for any other note.
 */
export function parentNoteOf(filePath: string, settings: DayPlannerSettings): { type: 'daily' | 'weekly'; date: string } | null {
    const fileName = filePath.split(/[/\\]/).pop()?.replace(/\.md$/, '') || '';
    const moment = (window as any).moment;
    let weekly = moment(fileName, settings.weeklyNotesFormat, true);
    for (let i = 0; !weekly.isValid() && i < WEEKLY_NOTE_FORMATS.length; i++) weekly = moment(fileName, WEEKLY_NOTE_FORMATS[i], true);
    if (weekly.isValid()) return { type: 'weekly', date: weekly.startOf('week').format('YYYY-MM-DD') };
    const daily = dateFromFileName(filePath, settings.dailyNotesFormat);
    return daily ? { type: 'daily', date: daily } : null;
}

// NFC: paths synced from iOS/macOS can be NFD, so a typed Korean folder name would otherwise never match
const normalizePathForMatch = (p: string) =>
    p.normalize('NFC').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '').toLowerCase();

/** One exclusion rule, compiled: `keep` rules ("!" prefix) re-include what an exclude rule caught */
interface PathRule { keep: boolean; test: (target: string) => boolean }

/**
 * Compiles a rule body (already normalized). With "*" it is a pattern: "*" stays within one folder level, "**"
 * crosses folders, and a match also covers ".md" and everything below a matched folder. Without it, the rule is
 * that file (with or without ".md") or that folder and everything inside it.
 */
export function compilePathRule(raw: string): PathRule | null {
    const trimmed = raw.trim();
    const keep = trimmed.startsWith('!');
    const body = normalizePathForMatch(keep ? trimmed.slice(1) : trimmed);
    if (!body) return null;
    if (!body.includes('*')) {
        return { keep, test: t => t === body || t === `${body}.md` || t.startsWith(`${body}/`) };
    }
    const pattern = body
        .split(/(\*\*|\*)/)
        .map(part => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('');
    const re = new RegExp(`^${pattern}(?:\\.md)?(?:/.*)?$`);
    return { keep, test: t => re.test(t) };
}

let compiledRulesKey: string | null = null;
let compiledRules: PathRule[] = [];

/**
 * "Excluded files & folders" (settings): a note is skipped when an exclude rule matches it and no keep ("!") rule
 * does, so "Archive" + "!Archive/2026" scans only 2026 of the archive. Rules compile once per rule list (this runs
 * for every note on each scan). The former "match all rules" mode is gone with the group builder it belonged to.
 */
export function isExcludedPath(path: string): boolean {
    const rules = scanSettings?.excludePaths ?? [];
    if (rules.length === 0) return false;
    const key = rules.join('\u0000');
    if (key !== compiledRulesKey) {
        compiledRules = rules.map(compilePathRule).filter((r): r is PathRule => r !== null);
        compiledRulesKey = key;
    }
    const target = normalizePathForMatch(path);
    let excluded = false;
    for (const rule of compiledRules) {
        if (!rule.test(target)) continue;
        if (rule.keep) return false;
        excluded = true;
    }
    return excluded;
}

/**
 * Vault path type-ahead on a text input: Obsidian's own suggestion popover, fuzzy-ranked like the quick switcher.
 * `kind` limits it to markdown files, folders, or both. With `onPick` a choice is handed over (and the field
 * cleared); without it the path is written into the field and an 'input' event lets Setting.onChange save it.
 * Obsidian builds before 1.4.10 have no AbstractInputSuggest: the field then simply stays a plain text input.
 */
export function attachPathSuggest(app: App, inputEl: HTMLInputElement, kind: 'file' | 'folder' | 'any', onPick?: (path: string) => void): void {
    if (typeof AbstractInputSuggest !== 'function') return;

    class PathSuggest extends AbstractInputSuggest<TAbstractFile> {
        protected getSuggestions(query: string): TAbstractFile[] {
            const candidates = app.vault.getAllLoadedFiles().filter(f => {
                if (isSyncConflictPath(f.path)) return false;
                if (f instanceof TFolder) return kind !== 'file' && !f.isRoot();
                return kind !== 'folder' && f instanceof TFile && f.extension === 'md';
            });
            const q = query.trim();
            if (!q) return candidates.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path)).slice(0, 50);
            const fuzzy = prepareFuzzySearch(q);
            return candidates
                .map(f => ({ f, result: fuzzy(f.path) }))
                .filter(x => x.result !== null)
                .sort((a, b) => b.result!.score - a.result!.score)
                .slice(0, 50)
                .map(x => x.f);
        }

        renderSuggestion(file: TAbstractFile, el: HTMLElement): void {
            el.addClass('dp-path-suggestion');
            setIcon(el.createSpan({ cls: 'dp-path-suggestion-icon' }), file instanceof TFolder ? 'folder' : 'file-text');
            const label = el.createSpan({ cls: 'dp-path-suggestion-label' });
            const q = this.getValue().trim();
            renderMatches(label, file.path, q ? prepareFuzzySearch(q)(file.path)?.matches ?? null : null);
        }

        selectSuggestion(file: TAbstractFile): void {
            if (onPick) {
                this.setValue('');
                onPick(file.path);
            } else {
                this.setValue(file.path);
                inputEl.dispatchEvent(new Event('input'));
            }
            this.close();
        }
    }
    new PathSuggest(app, inputEl);
}

export async function scanVaultTasks(app: App): Promise<TaskItem[]> {
    const files = app.vault.getMarkdownFiles().filter(f => !isSyncConflictPath(f.path) && !isExcludedPath(f.path));
    const tasks: TaskItem[] = [];
    const dailyNotesFormat = scanSettings?.dailyNotesFormat;

    let sliceStart = performance.now();
    for (let f = 0; f < files.length; f++) {
        const file = files[f];
        // Yield to the main thread after ~12ms of work so large vaults never lock the UI. A fixed yield every 50 files
        // also paid a (clamped, ≥4ms) timer for each batch of task-free notes that cost nothing to skip.
        if (performance.now() - sliceStart > 12) {
            await new Promise(resolve => window.setTimeout(resolve, 0));
            sliceStart = performance.now();
        }
        // metadataCache is in memory: notes it indexed without a single checkbox item are skipped with no file read.
        // Unindexed files (no cache yet) are still read; later re-indexes arrive via metadataCache 'changed'.
        const cache = app.metadataCache.getFileCache(file);
        if (cache && !cache.listItems?.some(item => item.task !== undefined)) continue;
        // cachedRead: served from memory for unchanged files instead of hitting the disk on every full scan
        const content = await app.vault.cachedRead(file);
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

// Per-note write queue: every read-modify-write the plugin makes (view edits, quick-add, background gcalId write-backs)
// runs one at a time per note, so rapid edits to the same note can no longer overwrite each other's changes
const fileWriteQueues = new Map<string, Promise<unknown>>();
function withFileWriteLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const run = (fileWriteQueues.get(path) ?? Promise.resolve()).catch(() => undefined).then(fn);
    fileWriteQueues.set(path, run);
    const clear = () => { if (fileWriteQueues.get(path) === run) fileWriteQueues.delete(path); };
    run.then(clear, clear);
    return run;
}

/** A task line removed by deleteTaskLines: enough to put it back where it was */
export interface RemovedTaskLine {
    filePath: string;
    lineNumber: number;
    line: string;
}

/**
 * Removes the tasks' lines from their notes (one locked read-modify-write per note). Only an exact match of the line
 * as parsed is removed (at its line number, else wherever it moved to): a line edited since is left alone and counts
 * as failed. `beforeWrite` runs right before each note is written (markSelfWrite).
 */
export async function deleteTaskLines(app: App, tasks: TaskItem[], beforeWrite?: (path: string) => void):
    Promise<{ removed: RemovedTaskLine[]; failed: number }> {
    const byFile = new Map<string, TaskItem[]>();
    tasks.forEach(t => byFile.set(t.filePath, [...(byFile.get(t.filePath) ?? []), t]));
    const removed: RemovedTaskLine[] = [];
    let failed = 0;
    await Promise.all(Array.from(byFile.entries()).map(([path, fileTasks]) => withFileWriteLock(path, async () => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || isSyncConflictPath(path)) {
            failed += fileTasks.length;
            return;
        }
        const lines = (await app.vault.read(file)).split('\n');
        const indices = new Set<number>();
        fileTasks.forEach(task => {
            let index = lines[task.lineNumber] === task.originalLine && !indices.has(task.lineNumber) ? task.lineNumber : -1;
            if (index === -1) index = lines.findIndex((l, i) => l === task.originalLine && !indices.has(i));
            if (index === -1) failed++;
            else indices.add(index);
        });
        if (indices.size === 0) return;
        // Bottom-up, so earlier indices stay valid while splicing
        Array.from(indices).sort((a, b) => b - a).forEach(i => {
            removed.push({ filePath: path, lineNumber: i, line: lines[i] });
            lines.splice(i, 1);
        });
        beforeWrite?.(path);
        await app.vault.modify(file, lines.join('\n'));
    })));
    return { removed, failed };
}

/** Undo for deleteTaskLines: re-inserts the lines top-down at their old line numbers. Returns how many came back. */
export async function restoreTaskLines(app: App, removed: RemovedTaskLine[], beforeWrite?: (path: string) => void): Promise<number> {
    const byFile = new Map<string, RemovedTaskLine[]>();
    removed.forEach(r => byFile.set(r.filePath, [...(byFile.get(r.filePath) ?? []), r]));
    let restored = 0;
    await Promise.all(Array.from(byFile.entries()).map(([path, entries]) => withFileWriteLock(path, async () => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const lines = (await app.vault.read(file)).split('\n');
        entries.sort((a, b) => a.lineNumber - b.lineNumber).forEach(r => {
            lines.splice(Math.min(r.lineNumber, lines.length), 0, r.line);
            restored++;
        });
        beforeWrite?.(path);
        await app.vault.modify(file, lines.join('\n'));
    })));
    return restored;
}

/** A rescheduled task: its line before, the same line marked cancelled, and the open copy written right below it */
export interface RescheduledTaskLine {
    filePath: string;
    original: string;
    cancelled: string;
    copy: string;
}

/**
 * Overdue Move / Fit / Unschedule: marks each task's line cancelled (`[-]` + ❌ today) and inserts an open copy right
 * below it, dated by its target (⏳ → 📅 replaced, else ⏳ added; the time is kept unless the target gives one). A null
 * date unschedules the copy: no ⏳ and no time, a 📅 stays. The gcalId moves to the copy so its event follows it;
 * a block id stays on the original. Only exact matches of the parsed line are changed (like deleteTaskLines).
 */
export interface RescheduleTarget {
    date: string | null;
    startTime?: string;
    endTime?: string;
}

export async function rescheduleTaskLines(app: App, tasks: TaskItem[], targetFor: (task: TaskItem) => RescheduleTarget,
    beforeWrite?: (path: string) => void): Promise<RescheduledTaskLine[]> {
    const today = (window as any).moment().format('YYYY-MM-DD');
    const byFile = new Map<string, TaskItem[]>();
    tasks.forEach(t => byFile.set(t.filePath, [...(byFile.get(t.filePath) ?? []), t]));
    const done: RescheduledTaskLine[] = [];
    await Promise.all(Array.from(byFile.entries()).map(([path, fileTasks]) => withFileWriteLock(path, async () => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || isSyncConflictPath(path)) return;
        const lines = (await app.vault.read(file)).split('\n');
        const indices = new Map<number, TaskItem>();
        fileTasks.forEach(task => {
            let index = lines[task.lineNumber] === task.originalLine && !indices.has(task.lineNumber) ? task.lineNumber : -1;
            if (index === -1) index = lines.findIndex((l, i) => l === task.originalLine && !indices.has(i));
            if (index !== -1) indices.set(index, task);
        });
        if (indices.size === 0) return;
        // Bottom-up, so earlier indices stay valid while inserting
        Array.from(indices.keys()).sort((a, b) => b - a).forEach(i => {
            const { date: dateStr, startTime, endTime } = targetFor(indices.get(i)!);
            const original = lines[i];
            const blockId = original.match(/\s\^[A-Za-z0-9-]+\s*$/)?.[0] ?? '';
            const body = original.slice(0, original.length - blockId.length);
            const gcalId = body.match(/\s*\[\s*gcalId::\s*[^\]]+\]/i)?.[0] ?? '';
            const cancelled = `${body.replace(/^(\s*-\s*\[)[^\]](\])/, '$1-$2').replace(gcalId, '')} ❌ ${today}${blockId}`;
            let copy = body.replace(/^(\s*-\s*\[)[^\]](\])/, '$1 $2');
            const timeRe = /\s*⏰\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?/;
            if (startTime && endTime) {
                copy = timeRe.test(copy) ? copy.replace(timeRe, ` ⏰${startTime}-${endTime}`) : `${copy.trimEnd()} ⏰${startTime}-${endTime}`;
            } else if (dateStr === null) {
                copy = copy.replace(timeRe, '');
            }
            if (dateStr === null) copy = copy.replace(/\s*⏳\s*\d{4}-\d{2}-\d{2}/, '');
            else if (/⏳\s*\d{4}-\d{2}-\d{2}/.test(copy)) copy = copy.replace(/⏳\s*\d{4}-\d{2}-\d{2}/, `⏳ ${dateStr}`);
            else if (/📅\s*\d{4}-\d{2}-\d{2}/.test(copy)) copy = copy.replace(/📅\s*\d{4}-\d{2}-\d{2}/, `📅 ${dateStr}`);
            else copy = `${copy.trimEnd()} ⏳ ${dateStr}`;
            lines.splice(i, 1, cancelled, copy);
            done.push({ filePath: path, original, cancelled, copy });
        });
        beforeWrite?.(path);
        await app.vault.modify(file, lines.join('\n'));
    })));
    return done;
}

/** Undo for rescheduleTaskLines: the cancelled line becomes the original again and its copy is removed. Returns how many came back. */
export async function undoRescheduleTaskLines(app: App, entries: RescheduledTaskLine[], beforeWrite?: (path: string) => void): Promise<number> {
    const byFile = new Map<string, RescheduledTaskLine[]>();
    entries.forEach(r => byFile.set(r.filePath, [...(byFile.get(r.filePath) ?? []), r]));
    let restored = 0;
    await Promise.all(Array.from(byFile.entries()).map(([path, fileEntries]) => withFileWriteLock(path, async () => {
        const file = app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) return;
        const lines = (await app.vault.read(file)).split('\n');
        fileEntries.forEach(r => {
            const i = lines.indexOf(r.cancelled);
            if (i === -1) return;
            lines[i] = r.original;
            const copyIndex = lines[i + 1] === r.copy ? i + 1 : lines.indexOf(r.copy);
            if (copyIndex !== -1) lines.splice(copyIndex, 1);
            restored++;
        });
        if (restored === 0) return;
        beforeWrite?.(path);
        await app.vault.modify(file, lines.join('\n'));
    })));
    return restored;
}

/** Board cards drag natively; this carries every selected card's id alongside the text/plain id of the grabbed one */
export const BOARD_DRAG_MIME = 'application/x-dayloom-task-ids';

/** Task ids of a native drag: the whole Board selection when present, else the single text/plain id */
export function readDraggedTaskIds(dataTransfer: DataTransfer | null): string[] {
    if (!dataTransfer) return [];
    try {
        const ids = JSON.parse(dataTransfer.getData(BOARD_DRAG_MIME) || 'null');
        if (Array.isArray(ids) && ids.length > 0) return ids.map(String);
    } catch {
        // not ours: fall back to the plain id
    }
    const id = dataTransfer.getData('text/plain');
    return id ? [id] : [];
}

/** Search: every whitespace-separated term must occur in the task's text (tags included) or its note's path */
export function taskMatchesSearch(task: TaskItem, terms: string[]): boolean {
    const haystack = `${task.text}\n${task.filePath}`.toLowerCase();
    return terms.every(term => haystack.includes(term));
}

/** Search terms of a query: lower-cased, split on whitespace (an empty query yields none) */
export function searchTerms(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(Boolean);
}

// 파일 내 할 일 수정 및 동기화 [GCal 자동 연동 코드를 완전히 소거한 순수 파일 동기화로 원복]
export function updateTaskInFile(
    app: App,
    task: TaskItem,
    updates: Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>>
): Promise<boolean> {
    return withFileWriteLock(task.filePath, () => updateTaskInFileUnlocked(app, task, updates));
}

async function updateTaskInFileUnlocked(
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
        // The line changed under this task object (e.g. a background sync wrote its gcalId back after the view parsed
        // it): apply the update on top of the line as it is now, so neither that link nor newer content is lost
        if (lines[targetIndex] !== task.originalLine) {
            const onDisk = parseTaskLine(lines[targetIndex], task.filePath, targetIndex, scanSettings?.dailyNotesFormat);
            if (onDisk) Object.assign(task, onDisk, { id: task.id });
        }
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

        // A bare date move lands in the date field the task already uses; explicit ⏳ / 📅 values (the edit modal) win
        if (updates.date !== undefined && updates.scheduledDate === undefined && updates.dueDate === undefined) {
            if (scheduledDateVal) scheduledDateVal = dateVal;
            else if (dueDateVal) dueDateVal = dateVal;
            else scheduledDateVal = dateVal;
        }

        const gcalEventIdVal = updates.gcalEventId !== undefined ? updates.gcalEventId : task.gcalEventId;
        // A due time means nothing without its 📅: clearing the date drops it too
        const dueTimeVal = dueDateVal ? (updates.dueTime !== undefined ? updates.dueTime : task.dueTime) ?? null : null;

        let newLine = `- [${statusCharVal}] ${textVal}`;
        if (startTimeVal && endTimeVal) {
            newLine += ` ⏰${startTimeVal}-${endTimeVal}`;
        }
        if (gcalEventIdVal) {
            newLine += ` [gcalId:: ${gcalEventIdVal}]`;
        }
        if (dueTimeVal) {
            newLine += ` [dueTime:: ${dueTimeVal}]`;
        }
        if (priorityVal && priorityVal !== 'normal') {
            newLine += ` ${PRIORITY_EMOJI[priorityVal]}`;
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
            if (dueTimeVal && dueDateVal && !scheduledDateVal) {
                nextLine += ` [dueTime:: ${dueTimeVal}]`;
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
                nextLine += ` ${PRIORITY_EMOJI[priorityVal]}`;
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
        task.dueTime = dueTimeVal;
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
/** settings.defaultTaskFile as a vault path: ".md" ensured, "Day Planner.md" when the setting is empty */
export function getDefaultTaskFilePath(settings: DayPlannerSettings): string {
    let path = (settings.defaultTaskFile || '').trim().replace(/^\/+/, '') || 'Day Planner.md';
    if (!path.toLowerCase().endsWith('.md')) path += '.md';
    return path;
}

/**
 * Enter-to-submit for a one-line input that also works with an IME (Hangul). Enter pressed while a syllable is still
 * composing only commits it: Chromium on Windows sends that Enter as one keydown flagged isComposing / keyCode 229 and
 * no second one, so ignoring it meant the user had to press Enter twice. The submit is replayed once the composition
 * ends instead. The caller clears the field on submit, which makes the macOS sequence (a composing and a plain Enter
 * keydown) harmless: the second submit finds the field empty.
 */
export function onEnterSubmit(input: HTMLInputElement, submit: () => void) {
    let pending = false;
    input.addEventListener('keydown', (e: KeyboardEvent) => {
        // During composition e.key may read "Process"; e.code still names the physical key
        const isEnter = e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
        if (!isEnter) return;
        if (e.isComposing || e.keyCode === 229) {
            pending = true; // let the IME commit the syllable first (no preventDefault: that could cancel the commit)
            return;
        }
        e.preventDefault();
        pending = false;
        submit();
    });
    input.addEventListener('compositionend', () => {
        if (!pending) return;
        pending = false;
        window.setTimeout(submit, 0); // the committed syllable is in input.value by then
    });
}

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
export function createNewTaskInFile(
    app: App,
    filePath: string,
    text: string,
    date: string | null,
    startTime: string | null,
    endTime: string | null,
    statusChar: string = ' ',
    priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest' = 'normal',
    gcalEventId: string | null = null,
    due: { date: string | null; time?: string | null } | null = null
): Promise<TaskItem | null> {
    // Same queue as edits: two quick-adds to one note must not both append to the same snapshot (and share a line number)
    return withFileWriteLock(filePath, () =>
        createNewTaskInFileUnlocked(app, filePath, text, date, startTime, endTime, statusChar, priority, gcalEventId, due));
}

async function createNewTaskInFileUnlocked(
    app: App,
    filePath: string,
    text: string,
    date: string | null,
    startTime: string | null,
    endTime: string | null,
    statusChar: string,
    priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest',
    gcalEventId: string | null,
    due: { date: string | null; time?: string | null } | null
): Promise<TaskItem | null> {
    let file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
        // A default task file in a folder that does not exist yet ("Inbox/Tasks.md"): create the folder first,
        // vault.create() rejects otherwise and the task was silently lost
        const slash = filePath.lastIndexOf('/');
        const folder = slash > 0 ? filePath.slice(0, slash) : '';
        if (folder && !app.vault.getAbstractFileByPath(folder)) {
            try {
                await app.vault.createFolder(folder);
            } catch {
                // created concurrently (or by sync) in the meantime
            }
        }
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
    if (due?.date && due.time) {
        newLine += ` [dueTime:: ${due.time}]`;
    }
    if (priority && priority !== 'normal') {
        newLine += ` ${PRIORITY_EMOJI[priority]}`;
    }
    if (date) {
        newLine += ` ⏳ ${date}`;
    }
    if (due?.date) {
        newLine += ` 📅 ${due.date}`;
    }

    const updatedContent = content.endsWith('\n') ? content + newLine + '\n' : content + '\n' + newLine + '\n';
    await app.vault.modify(file as TFile, updatedContent);
    // The appended line as a TaskItem (it sits just before the trailing newline), so callers can sync it without a rescan
    return parseTaskLine(newLine, filePath, updatedContent.split('\n').length - 2, scanSettings?.dailyNotesFormat);
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

/**
 * Overlap layout like Google Calendar's. Items that start within `sideBySideMin` of each other and overlap share the
 * width side by side (packed into as few columns as fit); an item starting later over a running one is drawn on top
 * of it, one indent step to the right, so the longer item stays visible as a strip on the left. Sets per item:
 * leftPct / widthPct (percent of the day column), leftIndent / widthIndent (multiples of the renderer's indent step in
 * px, added to them), and depth (nesting level: later-nested cards stack above their hosts).
 */
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
    leftPct?: number;
    widthPct?: number;
    leftIndent?: number;
    widthIndent?: number;
    depth?: number;
}>, sideBySideMin = 30) {
    if (timedItems.length === 0) return;
    type Item = typeof timedItems[number];
    const overlaps = (a: Item, b: Item) => a.startMin < b.endMin && a.endMin > b.startMin;

    timedItems.sort((a, b) => {
        if (a.startMin !== b.startMin) return a.startMin - b.startMin;
        return (b.endMin - b.startMin) - (a.endMin - a.startMin);
    });

    // Side-by-side groups: an item joins the latest group that started less than sideBySideMin before it and that it
    // overlaps; otherwise it opens its own group
    const groups: Item[][] = [];
    timedItems.forEach(item => {
        let group: Item[] | undefined;
        for (let g = groups.length - 1; g >= 0 && item.startMin - groups[g][0].startMin < sideBySideMin; g--) {
            if (groups[g].some(m => overlaps(m, item))) { group = groups[g]; break; }
        }
        if (group) group.push(item);
        else groups.push([item]);
    });

    // Each group nests one indent step past the rightmost earlier item it overlaps (its host), then splits the room
    // left of the column's right edge into as few columns as its members need
    const placed: Item[] = [];
    groups.forEach(group => {
        let host: Item | null = null;
        for (const p of placed) {
            if (!group.some(m => overlaps(m, p))) continue;
            if (!host || p.leftPct! > host.leftPct! || (p.leftPct === host.leftPct && p.leftIndent! > host.leftIndent!)) host = p;
        }
        const basePct = host ? host.leftPct! : 0;
        const baseIndent = host ? host.leftIndent! + 1 : 0;
        const depth = host ? host.depth! + 1 : 0;

        const columns: Item[][] = [];
        const colOf = new Map<Item, number>();
        group.forEach(item => {
            let c = 0;
            while (columns[c]?.some(m => overlaps(m, item))) c++;
            (columns[c] ??= []).push(item);
            colOf.set(item, c);
        });
        const n = columns.length;
        group.forEach(item => {
            const c = colOf.get(item)!;
            item.leftPct = basePct + c * (100 - basePct) / n;
            item.leftIndent = baseIndent * (1 - c / n);
            item.widthPct = (100 - basePct) / n;
            item.widthIndent = -baseIndent / n;
            item.depth = depth;
            placed.push(item);
        });
    });
}
