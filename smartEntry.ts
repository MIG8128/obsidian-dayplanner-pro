import type { TaskItem } from './types';
import { t, getLocale, TranslationKey } from './i18n';

/**
 * Smart quick-add: a task typed in one line ("Report tomorrow 3pm 1h !high", "회의 내일 오후 3시 30분") split into
 * its title and the date, time, length, priority and deadline the words name. English and Korean words are read
 * whatever the UI language. Text in "double quotes" is never read (the quotes are dropped); tokens already in Tasks
 * syntax stay as typed (⏳ / 📅 dates are taken as the date / deadline).
 *
 *   dates     today · tonight · tomorrow · day after tomorrow · fri / friday · next fri · this fri · next week
 *             in 3 days · 10/23 · oct 23 · 23 oct · 2026-10-23 · 오늘 · 내일 · 모레 · 글피 · 금요일 · 다음 주 금요일
 *             이번 주 금요일 · 3일 후 · 10월 23일 (next week / 다음 주 alone: its Monday)
 *   times     3pm · 3:30pm · 15:00 · at 9am · noon · 3-4pm · 15:00-16:30 · 오후 3시 · 3시 반 · 오후 3시~5시 · 정오
 *             (3시 alone, 1–6시, is the afternoon)
 *   length    1h · 30m · 1h30m · 1.5h · 90 min · for 2 hours · 1시간 · 30분 · 1시간 반
 *   priority  🔺 ⏫ 🔼 🔽 ⏬ · !highest !high !medium !low !lowest (!urgent) · !긴급 !높음 !중간 !낮음
 *   deadline  due fri · by friday 5pm · due 17:00 · 금요일까지 · 내일 오후 6시까지 · 5시까지
 *
 * A time without a date is today (or the slot's date); a time without an end lasts the default task duration; a
 * length without a time becomes a ⏱ estimate.
 */
export interface SmartEntry {
    /** The title left over (with a ⏱ estimate appended when a length came without a time) */
    text: string;
    priority: TaskItem['priority'];
    /** ⏳ scheduled date */
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    /** A length without a start time (minutes); already in `text` as ⏱ */
    estimate: number | null;
    dueDate: string | null;
    dueTime: string | null;
    /** A date, time, length, deadline or priority word was read (the preview shows) */
    recognized: boolean;
}

export interface SmartEntryOptions {
    /** "Now" (a moment); defaults to the current time */
    now?: any;
    /** Minutes a start time without an end lasts */
    defaultDuration?: number;
    /** Inline creation on a timeline slot: the slot's date and times, overridden by what the text names */
    baseDate?: string | null;
    baseStart?: string | null;
    baseEnd?: string | null;
}

const EMOJI_PRIORITY: Record<string, TaskItem['priority']> = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };
const WORD_PRIORITY: Record<string, TaskItem['priority']> = {
    highest: 'highest', urgent: 'highest', high: 'high', medium: 'medium', med: 'medium', low: 'low', lowest: 'lowest',
    '긴급': 'highest', '높음': 'high', '중간': 'medium', '낮음': 'low'
};

/** Not a letter, digit or underscore: what may sit before a word we read */
const NON_WORD = /[^\p{L}\p{N}_]/u;
/** End of an English word (Korean words take particles: 내일에, 3시에) */
const E = '(?=$|[^\\p{L}\\p{N}_])';
const EN_WEEKDAY = '(mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|saturday|sunday)';
const EN_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const KO_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const EN_MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MERIDIEM = '(am|pm|a\\.m\\.|p\\.m\\.)';
/** 오전 / 오후 … + N시 [M분 | 반]: 4 groups (period, hour, minutes, 반) */
const KO_HOUR = '(오전|오후|아침|저녁|밤|새벽|낮)?\\s*(\\d{1,2})\\s*시(?!간)(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?';
const LAST_MINUTE = 23 * 60 + 59;

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };

/** Hour (+ am / pm / 오전 / 오후 …) → minutes after midnight; null when out of range */
function clock(hour: number, minute: number, meridiem?: string | null): number | null {
    let h = hour;
    const mer = meridiem?.toLowerCase().replace(/\./g, '');
    if (mer === 'am' || mer === '오전' || mer === '아침' || mer === '새벽') h = hour === 12 ? 0 : hour;
    else if (mer === 'pm' || mer === '오후' || mer === '저녁' || mer === '밤' || mer === '낮') h = hour < 12 ? hour + 12 : hour;
    if (h > 23 || minute > 59) return null;
    return h * 60 + minute;
}

/** 3시 alone (1–6) is the afternoon: tasks at 3 a.m. are rare */
const koreanBareHour = (hour: number) => (hour >= 1 && hour <= 6 ? hour + 12 : hour);

/** A range; am / pm / 오후 on one end reaches the other ("3-4pm", "오후 3시~5시", "11-1pm", "9am-5") */
function timeRange(h1: number, m1: number, mer1: string | undefined, h2: number, m2: number, mer2: string | undefined,
    korean = false): [number, number] | null {
    const bare = (h: number) => (korean ? koreanBareHour(h) : h);
    let end = mer2 ? clock(h2, m2, mer2) : mer1 ? clock(h2, m2, mer1) : clock(bare(h2), m2);
    let start: number | null;
    if (mer1) start = clock(h1, m1, mer1);
    else if (mer2) {
        start = clock(h1, m1, mer2);
        if (start === null || (end !== null && start >= end)) start = clock(h1, m1); // "11-1pm": 11 a.m.
    } else start = clock(bare(h1), m1);
    if (start !== null && end !== null && end <= start && mer1 && !mer2) end = clock(h2, m2, 'pm'); // "9am-5"
    return start !== null && end !== null && end > start ? [start, end] : null;
}

export function parseSmartEntry(raw: string, opts: SmartEntryOptions = {}): SmartEntry {
    const moment = (window as any).moment;
    const today = (opts.now ?? moment()).clone().startOf('day');
    const ymd = (m: any) => m.format('YYYY-MM-DD');

    let priority = 'normal' as TaskItem['priority'];
    let date = null as string | null;
    let start = null as number | null;
    let end = null as number | null;
    let length = null as number | null;
    let dueDate = null as string | null;
    let dueTime = null as number | null;
    let wordPriority = false;

    // Tasks syntax typed by hand: ⏳ / 📅 dates are taken; the other tokens and "quoted text" are kept as they are
    let s = raw
        .replace(/⏳️?\s*(\d{4}-\d{2}-\d{2})/gu, (_m, d: string) => { date = d; return ' '; })
        .replace(/📅️?\s*(\d{4}-\d{2}-\d{2})/gu, (_m, d: string) => { dueDate = d; return ' '; });
    const kept: string[] = [];
    const keep = (text: string) => { kept.push(text); return `\u0000${kept.length - 1}\u0000`; };
    s = s
        .replace(/"([^"]+)"/g, (_m, inner: string) => keep(inner))
        .replace(/(⏰\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2})?|[🛫✅❌]️?\s*\d{4}-\d{2}-\d{2}|⏱️?\s*[\d.]+\s*(?:h(?:\s*\d+\s*m(?:in)?)?|m(?:in)?)?|🔁[^⏳📅🛫✅❌⏰⏱🔺⏫🔼🔽⏬[]*|\[[^\]]*::[^\]]*\])/gu, (m: string) => keep(m));

    /** Tries `read` at every word start, left to right; what it returns (a length) is cut out, a space left */
    const scan = (read: (rest: string) => number) => {
        for (let i = 0; i < s.length; i++) {
            if (i > 0 && !NON_WORD.test(s[i - 1])) continue;
            const cut = read(s.slice(i));
            if (cut > 0) s = `${s.slice(0, i)} ${s.slice(i + cut)}`;
        }
    };

    // ---- Dates ----
    const weekStart = today.clone().startOf('week');
    const firstDay = weekStart.day();
    const inWeek = (weekOffset: number, weekday: number) =>
        weekStart.clone().add(weekOffset, 'weeks').add((weekday - firstDay + 7) % 7, 'days');
    const upcoming = (weekday: number) => today.clone().add((weekday - today.day() + 7) % 7, 'days');
    const onDay = (month: number, day: number, year?: string) => {
        const m = moment({ year: year ? Number(year.length === 2 ? `20${year}` : year) : today.year(), month, date: day });
        if (!m.isValid()) return null;
        return !year && m.isBefore(today) ? m.add(1, 'year') : m; // "3/2" in October: next March
    };
    const DATE_RULES: Array<{ re: RegExp; day: (m: RegExpMatchArray) => any }> = [
        { re: new RegExp(`^day after tomorrow${E}`, 'iu'), day: () => today.clone().add(2, 'days') },
        { re: new RegExp(`^(?:today|tonight)${E}`, 'iu'), day: () => today.clone() },
        { re: new RegExp(`^(?:tomorrow|tmrw|tmr)${E}`, 'iu'), day: () => today.clone().add(1, 'days') },
        {
            re: new RegExp(`^in\\s+(\\d+)\\s*(days?|weeks?|months?)${E}`, 'iu'),
            day: m => today.clone().add(Number(m[1]), `${m[2].toLowerCase().replace(/s$/, '')}s`)
        },
        { re: new RegExp(`^next\\s+week${E}`, 'iu'), day: () => inWeek(1, 1) }, // its Monday
        {
            re: new RegExp(`^(?:(next|this)\\s+)?${EN_WEEKDAY}${E}`, 'iu'), day: m => {
                const weekday = EN_WEEKDAYS.indexOf(m[2].slice(0, 3).toLowerCase());
                return !m[1] ? upcoming(weekday) : inWeek(m[1].toLowerCase() === 'next' ? 1 : 0, weekday);
            }
        },
        { re: new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${E}`, 'u'), day: m => onDay(Number(m[2]) - 1, Number(m[3]), m[1]) },
        {
            re: new RegExp(`^${EN_MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${E}`, 'iu'),
            day: m => onDay(EN_MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), Number(m[2]), m[3])
        },
        {
            re: new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${EN_MONTH}(?:\\s+(\\d{4}))?${E}`, 'iu'),
            day: m => onDay(EN_MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()), Number(m[1]), m[3])
        },
        { re: new RegExp(`^(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{4}|\\d{2}))?${E}`, 'u'), day: m => onDay(Number(m[1]) - 1, Number(m[2]), m[3]) },
        { re: /^(?:오늘|금일)/u, day: () => today.clone() },
        { re: /^(?:내일\s*모레|모레)/u, day: () => today.clone().add(2, 'days') },
        { re: /^내일/u, day: () => today.clone().add(1, 'days') },
        { re: /^글피/u, day: () => today.clone().add(3, 'days') },
        {
            re: /^(\d+)\s*(일|주|개월|달)\s*(?:후|뒤)/u,
            day: m => today.clone().add(Number(m[1]), m[2] === '일' ? 'days' : m[2] === '주' ? 'weeks' : 'months')
        },
        {
            re: /^(?:(이번\s*주|다음\s*주|담주)\s*)?([일월화수목금토])요일/u, day: m => {
                const weekday = KO_WEEKDAYS.indexOf(m[2]);
                return !m[1] ? upcoming(weekday) : inWeek(m[1].startsWith('이번') ? 0 : 1, weekday);
            }
        },
        { re: /^(?:다음\s*주|담주)/u, day: () => inWeek(1, 1) },
        { re: /^(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/u, day: m => onDay(Number(m[2]) - 1, Number(m[3]), m[1]) }
    ];
    /** A date at the start of `str` ("on " before it, 에 / 에는 after a Korean one included), with its length */
    const dateAt = (str: string): { day: any; len: number } | null => {
        const lead = str.match(/^on\s+/i)?.[0].length ?? 0;
        const body = str.slice(lead);
        for (const rule of DATE_RULES) {
            const m = body.match(rule.re);
            if (!m) continue;
            const day = rule.day(m);
            if (!day || !day.isValid()) return null;
            const particle = /\p{Script=Hangul}/u.test(m[0]) ? body.slice(m[0].length).match(/^(?:에는|에)(?!\p{L})/u)?.[0].length ?? 0 : 0;
            return { day, len: lead + m[0].length + particle };
        }
        return null;
    };

    // ---- Single times ----
    const TIME_RULES: Array<{ re: RegExp; at: (m: RegExpMatchArray) => number | null }> = [
        { re: new RegExp(`^(?:at\\s+|@\\s*)?(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}${E}`, 'iu'), at: m => clock(Number(m[1]), Number(m[2] ?? 0), m[3]) },
        { re: /^(?:at\s+|@\s*)?(\d{1,2}):(\d{2})(?![\d:])/iu, at: m => clock(Number(m[1]), Number(m[2])) },
        { re: new RegExp(`^(?:at\\s+)?noon${E}`, 'iu'), at: () => 12 * 60 },
        { re: /^정오(?:에)?/u, at: () => 12 * 60 },
        {
            re: new RegExp(`^${KO_HOUR}(?:에)?`, 'u'),
            at: m => clock(m[1] ? Number(m[2]) : koreanBareHour(Number(m[2])), m[4] ? 30 : Number(m[3] ?? 0), m[1])
        }
    ];
    const timeAt = (str: string): { at: number; len: number } | null => {
        for (const rule of TIME_RULES) {
            const m = str.match(rule.re);
            if (!m) continue;
            const at = rule.at(m);
            return at === null ? null : { at, len: m[0].length };
        }
        return null;
    };

    // 1. Priority words (the emojis are taken further down, wherever they sit)
    const PRIORITY_WORD = new RegExp(`^!(highest|urgent|high|medium|med|lowest|low|긴급|높음|중간|낮음)${E}`, 'iu');
    scan(rest => {
        const m = rest.match(PRIORITY_WORD);
        if (!m) return 0;
        priority = WORD_PRIORITY[m[1].toLowerCase()];
        wordPriority = true;
        return m[0].length;
    });

    // 2. Time ranges, before deadlines ("3시부터 5시까지" is a range, not a deadline at 5)
    const EN_RANGE = new RegExp(`^(?:from\\s+)?(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?\\s*(?:-|–|—|~|to|부터)\\s*(\\d{1,2})(?::(\\d{2}))?\\s*${MERIDIEM}?(?:\\s*까지)?${E}`, 'iu');
    const KO_RANGE = new RegExp(`^${KO_HOUR}\\s*(?:-|–|~|부터)\\s*${KO_HOUR}(?:\\s*까지)?`, 'u');
    scan(rest => {
        if (start !== null) return 0;
        let m = rest.match(EN_RANGE);
        // "1-2" (no colon, no am / pm) is not a time
        if (m && (m[2] || m[3] || m[5] || m[6])) {
            const r = timeRange(Number(m[1]), Number(m[2] ?? 0), m[3], Number(m[4]), Number(m[5] ?? 0), m[6]);
            if (r) { [start, end] = r; return m[0].length; }
        }
        m = rest.match(KO_RANGE);
        if (m) {
            const r = timeRange(Number(m[2]), m[4] ? 30 : Number(m[3] ?? 0), m[1], Number(m[6]), m[8] ? 30 : Number(m[7] ?? 0), m[5], true);
            if (r) { [start, end] = r; return m[0].length; }
        }
        return 0;
    });

    // 3. Deadline: due / by / until + date and / or time, or a date and / or time + 까지
    if (dueDate === null) {
        scan(rest => {
            if (dueDate !== null) return 0;
            const lead = rest.match(/^(?:due|by|until)\s+/i);
            let pos = lead ? lead[0].length : 0;
            const d = dateAt(rest.slice(pos));
            if (d) pos += d.len;
            const gap = d ? rest.slice(pos).match(/^\s*/)![0].length : 0;
            const tm = timeAt(rest.slice(pos + gap));
            if (tm) pos += gap + tm.len;
            if (!d && !tm) return 0;
            if (!lead) {
                const until = rest.slice(pos).match(/^\s*까지/u);
                if (!until) return 0;
                pos += until[0].length;
            }
            dueDate = ymd(d?.day ?? (opts.baseDate ? moment(opts.baseDate, 'YYYY-MM-DD') : today));
            dueTime = tm?.at ?? null;
            return pos;
        });
    }

    // 4. The date (the first one named; "on fri" included)
    if (date === null) {
        scan(rest => {
            if (date !== null) return 0;
            const d = dateAt(rest);
            if (!d) return 0;
            date = ymd(d.day);
            return d.len;
        });
    }

    // 5. A single time ("at 3pm", "15:00", "오후 3시 30분에") when no range named one
    scan(rest => {
        if (start !== null) return 0;
        const tm = timeAt(rest);
        if (!tm) return 0;
        start = tm.at;
        return tm.len;
    });

    // 6. Length: "1h30m", "for 2 hours", "90 min", "1시간 반", "30분 동안"
    const LENGTH_RULES: Array<{ re: RegExp; minutes: (m: RegExpMatchArray) => number }> = [
        {
            re: new RegExp(`^(?:for\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:hours?|hrs?|h)(?:\\s*(\\d+)\\s*(?:minutes?|mins?|m))?${E}`, 'iu'),
            minutes: m => parseFloat(m[1]) * 60 + Number(m[2] ?? 0)
        },
        { re: new RegExp(`^(?:for\\s+)?(\\d+)\\s*(?:minutes?|mins?|m)${E}`, 'iu'), minutes: m => Number(m[1]) },
        { re: /^(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+)\s*분|\s*(반))?(?:\s*(?:동안|간))?/u, minutes: m => parseFloat(m[1]) * 60 + (m[3] ? 30 : Number(m[2] ?? 0)) },
        { re: /^(\d+)\s*분(?:\s*(?:동안|간))?/u, minutes: m => Number(m[1]) }
    ];
    scan(rest => {
        if (length !== null) return 0;
        for (const rule of LENGTH_RULES) {
            const m = rest.match(rule.re);
            if (!m) continue;
            const minutes = Math.round(rule.minutes(m));
            if (minutes <= 0 || minutes > 24 * 60) return 0;
            length = minutes;
            return m[0].length;
        }
        return 0;
    });

    // Priority emojis anywhere, as the plain quick entry always took them
    s = s.replace(/(🔺|⏫|🔼|🔽|⏬)️?/gu, (_m: string, emoji: string) => { priority = EMOJI_PRIORITY[emoji]; return ' '; });

    // ---- Resolve ----
    const recognized = date !== null || start !== null || length !== null || dueDate !== null || wordPriority;
    let estimate: number | null = null;
    if (start === null && opts.baseStart) {
        // A slot: its own times unless the text named a length
        start = toMinutes(opts.baseStart);
        end = length === null && opts.baseEnd ? toMinutes(opts.baseEnd) : null;
    }
    if (start !== null) {
        if (end === null) end = start + (length ?? opts.defaultDuration ?? 60);
        end = Math.min(end, LAST_MINUTE);
        if (end <= start) end = Math.min(start + 1, LAST_MINUTE);
        if (date === null) date = opts.baseDate ?? ymd(today);
    } else if (length !== null) {
        estimate = length;
    }
    if (date === null && opts.baseDate) date = opts.baseDate;

    let text = s.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => kept[Number(n)])
        .replace(/\s+(?:at|on|by|from|for|due)\s*$/i, '') // a connector left dangling at the end: "Call Bob at"
        .replace(/\s+/g, ' ')
        .trim();
    if (estimate !== null) {
        const h = Math.floor(estimate / 60), m = estimate % 60;
        text = `${text} ⏱ ${h ? `${h}h` : ''}${m || !h ? `${m}m` : ''}`.trim();
    }
    return {
        text,
        priority,
        date,
        startTime: start !== null ? hhmm(start) : null,
        endTime: start !== null && end !== null ? hhmm(end) : null,
        estimate,
        dueDate,
        dueTime: dueTime !== null ? hhmm(dueTime) : null,
        recognized
    };
}

const EMOJI_FOR: Record<string, string> = { highest: '🔺', high: '⏫', medium: '🔼', low: '🔽', lowest: '⏬' };

/** What Enter / Save will set, as short chips for the preview: ⏳ day, ⏰ time, ⏱ length, 📅 deadline, priority */
export function describeSmartEntry(entry: SmartEntry): string[] {
    const moment = (window as any).moment;
    const code = { en: 'en', ko: 'ko', ja: 'ja', zh: 'zh-cn' }[getLocale()];
    const now = moment();
    const day = (d: string) => {
        if (d === now.format('YYYY-MM-DD')) return t('common.today');
        if (d === now.clone().add(1, 'day').format('YYYY-MM-DD')) return t('smart.tomorrow');
        const m = moment(d, 'YYYY-MM-DD');
        return (moment.locales?.().includes(code) ? m.locale(code) : m).format('ddd, MMM D');
    };
    const duration = (minutes: number) => {
        const h = Math.floor(minutes / 60), m = minutes % 60;
        return h === 0 ? t('duration.m', { m }) : m === 0 ? t('duration.h', { h }) : t('duration.hm', { h, m });
    };
    const chips: string[] = [];
    if (entry.date) chips.push(`⏳ ${day(entry.date)}`);
    if (entry.startTime && entry.endTime) chips.push(`⏰ ${entry.startTime}–${entry.endTime}`);
    if (entry.estimate) chips.push(`⏱ ${duration(entry.estimate)}`);
    if (entry.dueDate) chips.push(`📅 ${day(entry.dueDate)}${entry.dueTime ? ` ${entry.dueTime}` : ''}`);
    if (entry.priority !== 'normal') chips.push(`${EMOJI_FOR[entry.priority]} ${t(`priority.${entry.priority}` as TranslationKey)}`);
    return chips;
}
