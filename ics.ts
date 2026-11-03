import type { GCalEvent, IcsCalendarConfig } from './types';

/**
 * Subscribed calendars (.ics / webcal links: Outlook, school, holidays): the feed parsed into the same event shape
 * Google Calendar events use, read-only. Handles folded lines, all-day and timed events (UTC, floating, or a TZID:
 * IANA names, Windows names, or the file's own VTIMEZONE as a fixed offset), RRULE (DAILY / WEEKLY / MONTHLY / YEARLY
 * with INTERVAL, COUNT, UNTIL, BYDAY incl. 2MO / -1FR, BYMONTHDAY, BYMONTH), EXDATE, RECURRENCE-ID overrides and
 * cancelled events. Occurrences are expanded only inside [windowStart, windowEnd].
 */

interface IcsProp { name: string; params: Record<string, string>; value: string }
type IcsComponent = Map<string, IcsProp[]>;

/** A DTSTART / DTEND value: an all-day date, or wall-clock fields in a zone (null zone = floating, 'UTC' = Z) */
interface IcsTime { allDay: boolean; y: number; mo: number; d: number; h: number; mi: number; s: number; zone: string | null }

const WINDOWS_ZONES: Record<string, string> = {
    'korea standard time': 'Asia/Seoul', 'tokyo standard time': 'Asia/Tokyo', 'china standard time': 'Asia/Shanghai',
    'taipei standard time': 'Asia/Taipei', 'singapore standard time': 'Asia/Singapore', 'india standard time': 'Asia/Kolkata',
    'pacific standard time': 'America/Los_Angeles', 'mountain standard time': 'America/Denver',
    'central standard time': 'America/Chicago', 'eastern standard time': 'America/New_York',
    'gmt standard time': 'Europe/London', 'w. europe standard time': 'Europe/Berlin', 'romance standard time': 'Europe/Paris',
    'central europe standard time': 'Europe/Budapest', 'central european standard time': 'Europe/Warsaw',
    'aus eastern standard time': 'Australia/Sydney', 'utc': 'UTC', 'coordinated universal time': 'UTC'
};
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_MS = 86400000;
const MAX_STEPS = 20000;

function unfold(text: string): string[] {
    return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
}

function parseLine(line: string): IcsProp | null {
    let inQuotes = false, i = 0;
    for (; i < line.length; i++) {
        const c = line[i];
        if (c === '"') inQuotes = !inQuotes;
        else if (c === ':' && !inQuotes) break;
    }
    if (i >= line.length) return null;
    const [name, ...rawParams] = line.slice(0, i).split(';');
    const params: Record<string, string> = {};
    rawParams.forEach(p => {
        const eq = p.indexOf('=');
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
    });
    return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

function parseTime(prop: IcsProp | undefined): IcsTime | null {
    if (!prop) return null;
    const m = prop.value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    const allDay = !m[4] || prop.params.VALUE === 'DATE';
    return {
        allDay, y: +m[1], mo: +m[2] - 1, d: +m[3],
        h: allDay ? 0 : +m[4], mi: allDay ? 0 : +m[5], s: allDay ? 0 : +(m[6] ?? 0),
        zone: allDay ? null : m[7] ? 'UTC' : prop.params.TZID ?? null
    };
}

// ---- Time zones ----
const formatters = new Map<string, Intl.DateTimeFormat | null>();
function zoneFormatter(zone: string): Intl.DateTimeFormat | null {
    if (!formatters.has(zone)) {
        try {
            formatters.set(zone, new Intl.DateTimeFormat('en-US', {
                timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            }));
        } catch {
            formatters.set(zone, null);
        }
    }
    return formatters.get(zone) ?? null;
}

/** An IANA zone Intl knows for a TZID: as given, a Windows name, or the tail of a prefixed one (/mozilla.org/…/Europe/Berlin) */
function resolveZone(tzid: string): Intl.DateTimeFormat | null {
    const direct = zoneFormatter(tzid);
    if (direct) return direct;
    const windows = WINDOWS_ZONES[tzid.toLowerCase()];
    if (windows) return zoneFormatter(windows);
    const parts = tzid.split('/').filter(Boolean);
    for (let i = 1; i < parts.length - 1; i++) {
        const tail = zoneFormatter(parts.slice(i).join('/'));
        if (tail) return tail;
    }
    return null;
}

function zoneOffsetMs(epoch: number, f: Intl.DateTimeFormat): number {
    const p: Record<string, number> = {};
    f.formatToParts(new Date(epoch)).forEach(x => { if (x.type !== 'literal') p[x.type] = Number(x.value); });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - epoch;
}

/** Wall-clock fields in a zone → epoch ms (floating: this device's zone) */
function toEpoch(t: IcsTime, y: number, mo: number, d: number, fixedOffsets: Map<string, number>): number {
    if (t.allDay || !t.zone) return new Date(y, mo, d, t.h, t.mi, t.s).getTime();
    const guess = Date.UTC(y, mo, d, t.h, t.mi, t.s);
    if (t.zone === 'UTC') return guess;
    const f = resolveZone(t.zone);
    if (!f) {
        const fixed = fixedOffsets.get(t.zone);
        return fixed !== undefined ? guess - fixed * 60000 : new Date(y, mo, d, t.h, t.mi, t.s).getTime();
    }
    const off = zoneOffsetMs(guess, f);
    let epoch = guess - off;
    const off2 = zoneOffsetMs(epoch, f);
    if (off2 !== off) epoch = guess - off2; // across a DST change
    return epoch;
}

// ---- Recurrence ----
interface Rule {
    freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    count: number | null;
    until: number | null;
    byDay: Array<{ n: number; wd: number }>;
    byMonthDay: number[];
    byMonth: number[];
}

function parseRule(value: string, fixedOffsets: Map<string, number>): Rule | null {
    const parts: Record<string, string> = {};
    value.split(';').forEach(p => { const [k, v] = p.split('='); if (k && v) parts[k.toUpperCase()] = v; });
    const freq = parts.FREQ as Rule['freq'];
    if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
    let until: number | null = null;
    if (parts.UNTIL) {
        const t = parseTime({ name: 'UNTIL', params: {}, value: parts.UNTIL });
        if (t) until = t.allDay ? new Date(t.y, t.mo, t.d, 23, 59, 59).getTime() : toEpoch(t, t.y, t.mo, t.d, fixedOffsets);
    }
    return {
        freq,
        interval: Math.max(1, Number(parts.INTERVAL) || 1),
        count: parts.COUNT ? Number(parts.COUNT) : null,
        until,
        byDay: (parts.BYDAY ?? '').split(',').filter(Boolean).map(s => {
            const m = s.match(/^([+-]?\d+)?([A-Z]{2})$/);
            return m ? { n: m[1] ? Number(m[1]) : 0, wd: WEEKDAYS.indexOf(m[2]) } : { n: 0, wd: -1 };
        }).filter(x => x.wd >= 0),
        byMonthDay: (parts.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number).filter(n => n !== 0 && !isNaN(n)),
        byMonth: (parts.BYMONTH ?? '').split(',').filter(Boolean).map(n => Number(n) - 1).filter(n => n >= 0 && n < 12)
    };
}

/** Calendar math on UTC dates (wall dates only, no zone) */
const utcDate = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo, d));
const daysInMonth = (y: number, mo: number) => new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();

/** The days of one month a MONTHLY / YEARLY rule names (sorted) */
function monthDays(y: number, mo: number, rule: Rule, startDay: number): Date[] {
    const dim = daysInMonth(y, mo);
    const days = new Set<number>();
    if (rule.byMonthDay.length) {
        rule.byMonthDay.forEach(n => { const d = n > 0 ? n : dim + n + 1; if (d >= 1 && d <= dim) days.add(d); });
    } else if (rule.byDay.length) {
        rule.byDay.forEach(({ n, wd }) => {
            const matching: number[] = [];
            for (let d = 1; d <= dim; d++) if (utcDate(y, mo, d).getUTCDay() === wd) matching.push(d);
            if (n === 0) matching.forEach(d => days.add(d));
            else {
                const d = n > 0 ? matching[n - 1] : matching[matching.length + n];
                if (d) days.add(d);
            }
        });
    } else if (startDay <= dim) {
        days.add(startDay);
    }
    return Array.from(days).sort((a, b) => a - b).map(d => utcDate(y, mo, d));
}

/** Wall dates of the rule's occurrences, in order, from the start date on (the caller stops the iteration) */
function* ruleDates(start: IcsTime, rule: Rule, skipToMs: number | null): Generator<Date> {
    const base = utcDate(start.y, start.mo, start.d);
    const startWd = base.getUTCDay();
    let k = 0;
    // Without COUNT, DAILY / WEEKLY rules jump close to the window instead of walking from a start years back
    if (skipToMs !== null && rule.count === null && (rule.freq === 'DAILY' || rule.freq === 'WEEKLY')) {
        const periodDays = (rule.freq === 'DAILY' ? 1 : 7) * rule.interval;
        k = Math.max(0, Math.floor((skipToMs - base.getTime()) / (periodDays * DAY_MS)) - 1);
    }
    for (let steps = 0; steps < MAX_STEPS; steps++, k++) {
        let candidates: Date[] = [];
        if (rule.freq === 'DAILY') {
            candidates = [new Date(base.getTime() + k * rule.interval * DAY_MS)];
        } else if (rule.freq === 'WEEKLY') {
            const monday = base.getTime() - ((startWd + 6) % 7) * DAY_MS + k * rule.interval * 7 * DAY_MS;
            const wds = rule.byDay.length ? rule.byDay.map(b => b.wd) : [startWd];
            candidates = Array.from(new Set(wds)).map(wd => new Date(monday + ((wd + 6) % 7) * DAY_MS)).sort((a, b) => a.getTime() - b.getTime());
        } else if (rule.freq === 'MONTHLY') {
            const total = start.mo + k * rule.interval;
            const y = start.y + Math.floor(total / 12), mo = ((total % 12) + 12) % 12;
            if (!rule.byMonth.length || rule.byMonth.includes(mo)) candidates = monthDays(y, mo, rule, start.d);
        } else {
            const y = start.y + k * rule.interval;
            const months = rule.byMonth.length ? rule.byMonth : [start.mo];
            months.slice().sort((a, b) => a - b).forEach(mo => {
                const days = rule.byMonthDay.length || rule.byDay.length ? monthDays(y, mo, rule, start.d)
                    : start.d <= daysInMonth(y, mo) ? [utcDate(y, mo, start.d)] : [];
                candidates.push(...days);
            });
        }
        for (const c of candidates) {
            if (c.getTime() < base.getTime()) continue;
            if (rule.freq === 'DAILY' && rule.byMonth.length && !rule.byMonth.includes(c.getUTCMonth())) continue;
            if (rule.freq === 'DAILY' && rule.byDay.length && !rule.byDay.some(b => b.wd === c.getUTCDay())) continue;
            yield c;
        }
    }
}

// ---- Events ----
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const utcYmd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function isoLocal(epoch: number): string {
    const d = new Date(epoch);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    return `${ymd(d)}T${hm(d)}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function parseDurationMs(value: string | undefined): number | null {
    const m = value?.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
    if (!m) return null;
    const ms = ((+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * 24 * 3600 + +(m[4] ?? 0) * 3600 + +(m[5] ?? 0) * 60 + +(m[6] ?? 0)) * 1000;
    return m[1] === '-' ? -ms : ms;
}

export function parseIcsEvents(text: string, cal: IcsCalendarConfig, windowStart: number, windowEnd: number): GCalEvent[] {
    const events: IcsComponent[] = [];
    const fixedOffsets = new Map<string, number>(); // VTIMEZONE TZID → its standard offset (minutes), when Intl lacks it
    const stack: string[] = [];
    let current: IcsComponent | null = null;
    let tzid: string | null = null;
    for (const line of unfold(text)) {
        if (!line) continue;
        const prop = parseLine(line);
        if (!prop) continue;
        if (prop.name === 'BEGIN') {
            stack.push(prop.value.toUpperCase());
            if (prop.value.toUpperCase() === 'VEVENT') current = new Map();
            continue;
        }
        if (prop.name === 'END') {
            const ended = stack.pop();
            if (ended === 'VEVENT' && current) { events.push(current); current = null; }
            if (ended === 'VTIMEZONE') tzid = null;
            continue;
        }
        const inside = stack[stack.length - 1];
        if (inside === 'VEVENT' && current) {
            const list = current.get(prop.name) ?? [];
            list.push(prop);
            current.set(prop.name, list);
        } else if (stack.includes('VTIMEZONE')) {
            if (prop.name === 'TZID') tzid = prop.value;
            if (inside === 'STANDARD' && prop.name === 'TZOFFSETTO' && tzid) {
                const m = prop.value.match(/^([+-])(\d{2})(\d{2})/);
                if (m) fixedOffsets.set(tzid, (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]));
            }
        }
    }

    const first = (c: IcsComponent, name: string) => c.get(name)?.[0];
    // RECURRENCE-ID overrides replace one occurrence of their series
    const overridden = new Map<string, Set<number>>();
    const epochOf = (t: IcsTime) => toEpoch(t, t.y, t.mo, t.d, fixedOffsets);
    events.forEach(c => {
        const rid = parseTime(first(c, 'RECURRENCE-ID'));
        const uid = first(c, 'UID')?.value;
        if (rid && uid) {
            if (!overridden.has(uid)) overridden.set(uid, new Set());
            overridden.get(uid)!.add(epochOf(rid));
        }
    });

    const out: GCalEvent[] = [];
    const calendarId = `ics:${cal.id}`;
    events.forEach((c, index) => {
        if (first(c, 'STATUS')?.value.toUpperCase() === 'CANCELLED') return;
        const start = parseTime(first(c, 'DTSTART'));
        if (!start) return;
        const uid = first(c, 'UID')?.value ?? `event-${index}`;
        const end = parseTime(first(c, 'DTEND'));
        const startEpoch = epochOf(start);
        let lengthMs: number;
        if (end) lengthMs = epochOf(end) - startEpoch;
        else lengthMs = parseDurationMs(first(c, 'DURATION')?.value) ?? (start.allDay ? DAY_MS : 0);
        if (lengthMs < 0) lengthMs = 0;
        const allDayDays = start.allDay ? Math.max(1, Math.round(lengthMs / DAY_MS)) : 0;
        const summary = unescapeText(first(c, 'SUMMARY')?.value ?? '') || 'No Title';
        const location = unescapeText(first(c, 'LOCATION')?.value ?? '');
        const description = unescapeText(first(c, 'DESCRIPTION')?.value ?? '');

        const emit = (y: number, mo: number, d: number, idSuffix: string) => {
            if (start.allDay) {
                const s = utcDate(y, mo, d), e = new Date(s.getTime() + allDayDays * DAY_MS);
                const sMs = new Date(y, mo, d).getTime();
                if (sMs + allDayDays * DAY_MS <= windowStart || sMs > windowEnd) return;
                out.push({
                    id: `${uid}${idSuffix}`, calendarId, summary, start: utcYmd(s), end: utcYmd(e), isAllDay: true,
                    startTimeStr: null, endTimeStr: null, dateStr: utcYmd(s), color: cal.color, calendarName: cal.name,
                    location, description, readOnly: true
                });
                return;
            }
            const sMs = toEpoch(start, y, mo, d, fixedOffsets);
            const eMs = sMs + lengthMs;
            if (eMs <= windowStart || sMs > windowEnd) return;
            const sDate = new Date(sMs), eDate = new Date(eMs);
            out.push({
                id: `${uid}${idSuffix}`, calendarId, summary, start: isoLocal(sMs), end: isoLocal(eMs), isAllDay: false,
                startTimeStr: hm(sDate), endTimeStr: hm(eDate), dateStr: ymd(sDate), color: cal.color, calendarName: cal.name,
                location, description, readOnly: true
            });
        };

        const ruleProp = first(c, 'RRULE');
        const isOverride = !!first(c, 'RECURRENCE-ID');
        const rule = ruleProp && !isOverride ? parseRule(ruleProp.value, fixedOffsets) : null;
        if (!rule) {
            emit(start.y, start.mo, start.d, isOverride ? `_${startEpoch}` : '');
            return;
        }
        const excluded = new Set<number>();
        (c.get('EXDATE') ?? []).forEach(p => p.value.split(',').forEach(v => {
            const t = parseTime({ ...p, value: v });
            if (!t) return;
            // A date-only EXDATE on a timed series removes that day's occurrence
            excluded.add(t.allDay && !start.allDay ? toEpoch(start, t.y, t.mo, t.d, fixedOffsets) : epochOf(t));
        }));
        const replaced = overridden.get(uid);
        let count = 0;
        for (const day of ruleDates(start, rule, windowStart - lengthMs - 7 * DAY_MS)) {
            const y = day.getUTCFullYear(), mo = day.getUTCMonth(), d = day.getUTCDate();
            const occurrence = toEpoch(start, y, mo, d, fixedOffsets);
            if (rule.until !== null && occurrence > rule.until) break;
            if (rule.count !== null && count >= rule.count) break;
            count++;
            if (occurrence > windowEnd) break;
            if (excluded.has(occurrence) || replaced?.has(occurrence)) continue;
            emit(y, mo, d, `_${occurrence}`);
        }
    });
    return out;
}
