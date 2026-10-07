import { Notice, requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { GoogleCalendarConfig, GCalEvent, TaskItem } from './types';
import DayPlannerPlugin from './main';
import { scanVaultTasks, updateTaskInFile, parseTaskLine, isSyncConflictPath } from './utils';
import { TFile } from 'obsidian';

/** Marks events created by task sync; cleanup never touches events without it (classes, meetings, invites). */
const OWNED_EVENT_PROPS = { private: { dayPlannerPro: 'task' } };
/** Legacy marker: task-sync events created before OWNED_EVENT_PROPS existed carry this description prefix. */
const OWNED_DESC_PREFIX = 'Synced from Obsidian:';

function isOwnedEventItem(item: any): boolean {
    return item?.extendedProperties?.private?.dayPlannerPro === 'task'
        || (typeof item?.description === 'string' && item.description.startsWith(OWNED_DESC_PREFIX));
}

// ---------------------------------------------------------------------------------------------
// Calendar API pacing. Only task-sync calls (paced=true) share a token bucket: single edits run instantly off the
// burst, bulk sync settles at 8 req/s (480/min, under the 600/min/user quota). Personal-calendar reads and event
// edits are never queued; every call only waits while Google has actually rate-limited us.
// ---------------------------------------------------------------------------------------------
const GCAL_BURST = 30;
const GCAL_REFILL_PER_SEC = 8;
const GCAL_MAX_RETRIES = 5;       // 1s, 2s, 4s, 8s, 16s (or Retry-After)
let gcalTokens = GCAL_BURST;
let gcalTokensAt = Date.now();
let gcalQueue: Promise<void> = Promise.resolve();
let gcalCooldownUntil = 0;
const sleep = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms));

function takeGCalToken(): Promise<void> {
    const slot = gcalQueue.then(async () => {
        for (;;) {
            const now = Date.now();
            gcalTokens = Math.min(GCAL_BURST, gcalTokens + (now - gcalTokensAt) / 1000 * GCAL_REFILL_PER_SEC);
            gcalTokensAt = now;
            const wait = Math.max(gcalCooldownUntil - now, gcalTokens >= 1 ? 0 : (1 - gcalTokens) / GCAL_REFILL_PER_SEC * 1000);
            if (wait <= 0) { gcalTokens -= 1; return; }
            await sleep(wait);
        }
    });
    gcalQueue = slot;
    return slot;
}

function isRateLimited(res: RequestUrlResponse): boolean {
    if (res.status === 429) return true;
    if (res.status !== 403) return false;
    try { return /rateLimitExceeded|RATE_LIMIT_EXCEEDED|quotaExceeded/i.test(res.text); } catch { return false; }
}

/** Drop-in for requestUrl (same throw-on-error default) that retries rate-limited calls with backoff. */
async function gcalRequest(params: RequestUrlParam, paced: boolean = false): Promise<RequestUrlResponse> {
    for (let attempt = 0; ; attempt++) {
        if (paced) await takeGCalToken();
        else if (gcalCooldownUntil > Date.now()) await sleep(gcalCooldownUntil - Date.now());
        const res = await requestUrl({ ...params, throw: false });
        if (isRateLimited(res) && attempt < GCAL_MAX_RETRIES) {
            const retryAfterMs = Number(res.headers?.['retry-after'] ?? res.headers?.['Retry-After']) * 1000;
            const backoffMs = retryAfterMs > 0 ? retryAfterMs : 1000 * 2 ** attempt + Math.random() * 500;
            // Pause the whole queue, not just this call, so queued requests don't keep hitting the limit
            gcalCooldownUntil = Math.max(gcalCooldownUntil, Date.now() + backoffMs);
            continue;
        }
        if (params.throw !== false && res.status >= 400) {
            throw Object.assign(new Error(`Request failed, status ${res.status}`), { status: res.status });
        }
        return res;
    }
}

const activeNotices = new Map<string, number>();
export function showRateLimitedNotice(message: string, durationMs: number = 5000, throttleMs: number = 10000) {
    const now = Date.now();
    const lastShown = activeNotices.get(message);
    if (lastShown && now - lastShown < throttleMs) {
        return;
    }
    activeNotices.set(message, now);
    new Notice(message, durationMs / 1000);
}

/**
 * Google OAuth2 Access Token을 획득/갱신하는 헬퍼 함수
 */
export async function getGoogleAccessToken(plugin: DayPlannerPlugin): Promise<string | null> {
    const { settings } = plugin;
    if (!settings.googleClientId || !settings.googleClientSecret || !settings.googleRefreshToken) {
        return null;
    }
    const now = Date.now();
    if (settings.googleAccessToken && settings.googleAccessTokenExpires > now + 60000) {
        return settings.googleAccessToken;
    }
    try {
        const response = await requestUrl({
            url: 'https://oauth2.googleapis.com/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: settings.googleClientId,
                client_secret: settings.googleClientSecret,
                refresh_token: settings.googleRefreshToken,
                grant_type: 'refresh_token'
            }).toString()
        });
        if (response.status === 200) {
            const data = response.json;
            settings.googleAccessToken = data.access_token;
            settings.googleAccessTokenExpires = Date.now() + (data.expires_in * 1000);
            await plugin.saveSettings();
            return data.access_token;
        } else {
            console.error('Failed to refresh Google Token:', response.text);
            let errMsg = response.text;
            try {
                const errJson = JSON.parse(response.text);
                if (errJson.error) {
                    errMsg = `${errJson.error}${errJson.error_description ? ': ' + errJson.error_description : ''}`;
                }
            } catch (err) {}
            showRateLimitedNotice(`❌ Google OAuth Token 갱신 실패: ${errMsg}. 플러그인 설정에서 OAuth 2.0 세팅을 확인해 주세요.`, 10000, 30000);
            return null;
        }
    } catch (e) {
        console.error('Error refreshing Google token:', e);
        showRateLimitedNotice(`❌ Google OAuth 통신 에러: ${e instanceof Error ? e.message : String(e)}`, 10000, 30000);
        return null;
    }
}

/**
 * 구글 캘린더 이벤트의 시간 및 날짜 속성을 서버로 PATCH 전송하는 API 비동기 처리 함수
 */
export async function patchGoogleCalendarEvent(
    plugin: DayPlannerPlugin,
    calendarId: string,
    eventId: string,
    dateStr: string,
    startTime: string,
    endTime: string
): Promise<boolean> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) {
        showRateLimitedNotice('⚠️ Google Calendar OAuth 정보가 비어있거나 만료되었습니다. 플러그인 설정 화면 하단의 OAuth 2.0 세팅을 확인하세요.', 5000, 30000);
        return false;
    }
    try {
        const tzOffset = (window as any).moment().format('Z');
        const startISO = `${dateStr}T${startTime}:00${tzOffset}`;
        const endISO = `${dateStr}T${endTime}:00${tzOffset}`;

        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
        const response = await gcalRequest({
            url: url,
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                start: { dateTime: startISO },
                end: { dateTime: endISO }
            })
        });

        if (response.status === 200) {
            return true;
        } else {
            console.error('Google Calendar PATCH Error:', response.text);
            showRateLimitedNotice(`❌ Google Calendar 이벤트 업데이트 실패 (${response.status}): ${response.text}`, 5000, 15000);
            return false;
        }
    } catch (e) {
        console.error('Error updating Google Calendar Event via PATCH:', e);
        showRateLimitedNotice(`❌ Google Calendar 통신 에러: ${e instanceof Error ? e.message : String(e)}`, 5000, 15000);
        return false;
    }
}

/**
 * 구글 캘린더 삭제 API 비동기 연동 처리 함수
 */
export async function deleteGoogleCalendarEvent(
    plugin: DayPlannerPlugin,
    calendarId: string,
    eventId: string,
    paced: boolean = false
): Promise<boolean> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) {
        showRateLimitedNotice('⚠️ Google Calendar OAuth 정보가 비어있거나 만료되었습니다.', 5000, 30000);
        return false;
    }
    try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
        const response = await gcalRequest({
            url: url,
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }, paced);
        if (response.status === 204 || response.status === 200) {
            return true;
        } else {
            console.error('Google Calendar Delete Error:', response.text);
            showRateLimitedNotice(`❌ 구글 일정 삭제 실패 (${response.status}): ${response.text}`, 5000, 15000);
            return false;
        }
    } catch (e) {
        console.error('Error deleting Google Calendar Event:', e);
        showRateLimitedNotice(`❌ Google Calendar 통신 에러: ${e instanceof Error ? e.message : String(e)}`, 5000, 15000);
        return false;
    }
}

/**
 * 구글 캘린더 생성 및 중복 추가(Duplicate)용 API 비동기 연동 처리 함수
 */
export async function createGoogleCalendarEvent(
    plugin: DayPlannerPlugin,
    calendarId: string,
    eventData: {
        summary: string;
        description?: string;
        location?: string;
        dateStr: string;
        endDateStr?: string;
        startTimeStr?: string | null;
        endTimeStr?: string | null;
        isAllDay: boolean;
    },
    owned: boolean = false
): Promise<string | null> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) {
        showRateLimitedNotice('⚠️ Google Calendar OAuth 정보가 비어있거나 만료되었습니다.', 5000, 30000);
        return null;
    }
    try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
        const tzOffset = (window as any).moment().format('Z');

        let startBody: any = {};
        let endBody: any = {};

        const startDt = eventData.dateStr;
        const endDt = eventData.endDateStr || eventData.dateStr;

        if (eventData.isAllDay) {
            startBody = { date: startDt };
            const moment = (window as any).moment;
            const endExclusive = moment(endDt, 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD');
            endBody = { date: endExclusive };
        } else {
            const startISO = `${startDt}T${eventData.startTimeStr || '09:00'}:00${tzOffset}`;
            const endISO = `${endDt}T${eventData.endTimeStr || '10:00'}:00${tzOffset}`;
            startBody = { dateTime: startISO };
            endBody = { dateTime: endISO };
        }

        const response = await gcalRequest({
            url: url,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                summary: eventData.summary,
                description: eventData.description || '',
                location: eventData.location || '',
                start: startBody,
                end: endBody,
                ...(owned ? { extendedProperties: OWNED_EVENT_PROPS } : {})
            })
        }, owned);

        if (response.status === 200 || response.status === 201) {
            const data = response.json;
            return data.id || null;
        } else {
            console.error('Google Calendar Create Error:', response.text);
            showRateLimitedNotice(`❌ 구글 일정 생성 실패 (${response.status}): ${response.text}`, 5000, 15000);
            return null;
        }
    } catch (e) {
        console.error('Error creating Google Calendar Event:', e);
        showRateLimitedNotice(`❌ Google Calendar 통신 에러: ${e instanceof Error ? e.message : String(e)}`, 5000, 15000);
        return null;
    }
}

/**
 * 구글 캘린더 업데이트(PATCH)용 API 비동기 연동 처리 함수 (모달 수정 시 사용)
 */
export async function updateGoogleCalendarEvent(
    plugin: DayPlannerPlugin,
    calendarId: string,
    eventId: string,
    eventData: {
        summary: string;
        description?: string;
        location?: string;
        dateStr: string;
        endDateStr?: string;
        startTimeStr?: string | null;
        endTimeStr?: string | null;
        isAllDay: boolean;
    }
): Promise<boolean> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) {
        showRateLimitedNotice('⚠️ Google Calendar OAuth 정보가 비어있거나 만료되었습니다.', 5000, 30000);
        return false;
    }
    try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
        const tzOffset = (window as any).moment().format('Z');

        let startBody: any = {};
        let endBody: any = {};

        const startDt = eventData.dateStr;
        const endDt = eventData.endDateStr || eventData.dateStr;

        if (eventData.isAllDay) {
            startBody = { date: startDt };
            const moment = (window as any).moment;
            const endExclusive = moment(endDt, 'YYYY-MM-DD').add(1, 'day').format('YYYY-MM-DD');
            endBody = { date: endExclusive };
        } else {
            const startISO = `${startDt}T${eventData.startTimeStr || '09:00'}:00${tzOffset}`;
            const endISO = `${endDt}T${eventData.endTimeStr || '10:00'}:00${tzOffset}`;
            startBody = { dateTime: startISO };
            endBody = { dateTime: endISO };
        }

        const response = await gcalRequest({
            url: url,
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                summary: eventData.summary,
                description: eventData.description || '',
                location: eventData.location || '',
                start: startBody,
                end: endBody
            })
        });

        if (response.status === 200) {
            return true;
        } else {
            console.error('Google Calendar Update Error:', response.text);
            showRateLimitedNotice(`❌ 구글 일정 업데이트 실패 (${response.status}): ${response.text}`, 5000, 15000);
            return false;
        }
    } catch (e) {
        console.error('Error updating Google Calendar Event:', e);
        showRateLimitedNotice(`❌ Google Calendar 통신 에러: ${e instanceof Error ? e.message : String(e)}`, 5000, 15000);
        return false;
    }
}

/**
 * 구글 OAuth 2.0 Access Token을 사용하여 일정을 가져오는 함수
 */
// strict: throw on failure instead of returning [], so callers can keep their cached events
export async function fetchSingleCalendarEvents(plugin: DayPlannerPlugin, cal: GoogleCalendarConfig, timeMin: Date, timeMax: Date, strict: boolean = false, paced: boolean = false): Promise<GCalEvent[]> {
    if (!cal.id || !cal.enabled) return [];
    const token = await getGoogleAccessToken(plugin);
    if (!token) {
        if (strict) throw new Error('No Google access token');
        return [];
    }
    try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime`;
        const response = await gcalRequest({
            url: url,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }, paced);

        if (response.status !== 200) {
            console.error(`GCal [${cal.name}] Response Error (Code: ${response.status})`, response.text);
            if (strict) throw new Error(`GCal response ${response.status}`);
            return [];
        }
        
        const data = response.json;
        const events: GCalEvent[] = [];

        if (data && data.items) {
            for (const item of data.items) {
                const start = item.start?.dateTime || item.start?.date;
                const end = item.end?.dateTime || item.end?.date;
                if (!start || !end) continue;

                const isAllDay = !item.start?.dateTime;
                let dateStr = '';
                let startTimeStr: string | null = null;
                let endTimeStr: string | null = null;

                if (isAllDay) {
                    dateStr = item.start.date;
                } else {
                    const startDate = new Date(item.start.dateTime);
                    const endDate = new Date(item.end.dateTime);

                    const y = startDate.getFullYear();
                    const m = String(startDate.getMonth() + 1).padStart(2, '0');
                    const d = String(startDate.getDate()).padStart(2, '0');
                    dateStr = `${y}-${m}-${d}`;

                    startTimeStr = `${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`;
                    endTimeStr = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
                }

                events.push({
                    id: item.id,
                    calendarId: cal.id,
                    summary: item.summary || 'No Title',
                    start,
                    end,
                    isAllDay,
                    startTimeStr,
                    endTimeStr,
                    dateStr,
                    color: cal.color,
                    calendarName: cal.name,
                    location: item.location || '',
                    description: item.description || ''
                });
            }
        }
        return events;
    } catch (e) {
        console.error(`Google Calendar [${cal.name}] Fetch Error:`, e);
        if (strict) throw e;
        return [];
    }
}

/**
 * 단일 Obsidian TaskItem을 Google Calendar와 양방향 동기화 처리
 */
const syncLocks = new Map<string, Promise<boolean>>();
const syncGenerations = new Map<string, { generation: number; task: TaskItem }>();
/** eventId -> signature of what was last written to it this session; unchanged tasks are not re-PATCHed. */
const lastSyncedSignature = new Map<string, string>();

/** Runs `fn` after every earlier request for this task line settles, so one line's requests reach Google in edit order. */
function runInLineLock(key: string, fn: () => Promise<boolean>): Promise<boolean> {
    const next = (syncLocks.get(key) ?? Promise.resolve(true)).catch(() => false).then(fn);
    syncLocks.set(key, next);
    const clear = () => { if (syncLocks.get(key) === next) syncLocks.delete(key); };
    next.then(clear, clear);
    return next;
}

/** Serialize syncs per task line so two concurrent callers can never both `insert`. */
export function syncTaskToGCal(plugin: DayPlannerPlugin, task: TaskItem, calendarId: string): Promise<boolean> {
    const key = `${task.filePath}::${task.lineNumber}`;
    const generation = (syncGenerations.get(key)?.generation ?? 0) + 1;
    syncGenerations.set(key, { generation, task });
    const next = runInLineLock(key, async () => {
        // A newer edit of this same task is queued behind us: skip, it sends the latest content in one request.
        // A different task on this line (lines shifted, or the Sync button's own scan) is never skipped.
        const latest = syncGenerations.get(key);
        if (latest && latest.generation !== generation && latest.task === task) return true;
        // Pick up an ID written back by the previous (just-finished) sync of this line
        if (!task.gcalEventId) {
            const file = plugin.app.vault.getAbstractFileByPath(task.filePath);
            if (file instanceof TFile) {
                const line = (await plugin.app.vault.read(file)).split('\n')[task.lineNumber];
                const fresh = line ? parseTaskLine(line, task.filePath, task.lineNumber, plugin.settings.dailyNotesFormat) : null;
                if (fresh?.gcalEventId) {
                    task.gcalEventId = fresh.gcalEventId;
                    task.originalLine = fresh.originalLine;
                }
            }
        }
        return syncTaskToGCalUnlocked(plugin, task, calendarId);
    });
    const clear = () => { if (syncGenerations.get(key)?.generation === generation) syncGenerations.delete(key); };
    next.then(clear, clear);
    return next;
}

/**
 * Background push of ONE task edited in a planner view: PATCH its linked event, INSERT one when it is newly timed
 * (after Sync's one-day duplicate lookup), or DELETE its own event when the edit removed its date/time.
 * No vault scan and no calendar-wide listing; the Sync button stays the full reconciliation. Never throws.
 */
export function syncEditedTaskToGCal(plugin: DayPlannerPlugin, task: TaskItem, wasTimed: boolean): void {
    const { settings } = plugin;
    if (!settings.enableGoogleCalendar || !settings.googleRefreshToken) return;
    const calendarId = settings.taskSyncCalendarId || settings.googleCalendars.find(c => c.enabled && c.id)?.id;
    if (!calendarId) return;
    let run: Promise<boolean> | null = null;
    if (task.date && task.startTime && task.endTime) {
        run = syncTaskToGCal(plugin, task, calendarId);
    } else if (wasTimed && task.gcalEventId) {
        // Keep the gcalId: re-timing the task later PATCHes (status: confirmed) and revives this same event.
        // Queued behind this line's in-flight PATCH, which would otherwise land after the DELETE and revive it.
        const eventId = task.gcalEventId;
        lastSyncedSignature.delete(eventId);
        run = runInLineLock(`${task.filePath}::${task.lineNumber}`, () => deleteOwnedGCalEvent(plugin, calendarId, eventId));
    }
    run?.catch(err => console.error('Day Planner Pro: background task sync failed', err));
}

/** PATCH a task-linked event. 'gone' = the event no longer exists on this calendar, so the task must be re-linked. */
async function patchSyncedEvent(plugin: DayPlannerPlugin, calendarId: string, eventId: string, task: TaskItem, summary: string, description: string): Promise<'ok' | 'gone' | 'error'> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) return 'error';
    try {
        const tzOffset = (window as any).moment().format('Z');
        const response = await gcalRequest({
            url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary,
                description,
                start: { dateTime: `${task.date}T${task.startTime}:00${tzOffset}` },
                end: { dateTime: `${task.date}T${task.endTime}:00${tzOffset}` },
                // Revives an event deleted while the task was cut from one note and pasted into another
                status: 'confirmed'
            }),
            throw: false
        }, true);
        if (response.status === 200) return 'ok';
        if (response.status === 404 || response.status === 410) return 'gone';
        console.error('Google Calendar PATCH Error:', response.text);
        showRateLimitedNotice(`❌ Google Calendar event update failed (${response.status}): ${response.text}`, 5000, 15000);
        return 'error';
    } catch (e) {
        console.error('Error updating synced Google Calendar event:', e);
        showRateLimitedNotice(`❌ Google Calendar network error: ${e instanceof Error ? e.message : String(e)}`, 5000, 15000);
        return 'error';
    }
}

/**
 * Deletes a task-sync event only if task sync created it. Resolves true when the event is gone afterwards
 * (deleted now or already deleted); false when it is someone else's event or the request failed.
 */
export async function deleteOwnedGCalEvent(plugin: DayPlannerPlugin, calendarId: string, eventId: string): Promise<boolean> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) return false;
    try {
        const res = await gcalRequest({
            url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
            throw: false
        }, true);
        if (res.status === 404 || res.status === 410 || (res.status === 200 && res.json?.status === 'cancelled')) return true;
        if (res.status !== 200) return false;
        if (!isOwnedEventItem(res.json)) {
            console.warn('Day Planner Pro: not deleting a calendar event that task sync did not create', eventId);
            return false;
        }
    } catch (e) {
        console.error('Day Planner Pro: could not verify event ownership before delete', e);
        return false;
    }
    return deleteGoogleCalendarEvent(plugin, calendarId, eventId, true);
}

/** Every task-sync event in [timeMin, timeMax] by id (other events are dropped). Throws rather than return a partial listing. */
async function listOwnedEvents(plugin: DayPlannerPlugin, calendarId: string, timeMin: string, timeMax: string): Promise<Map<string, any>> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) throw new Error('No Google access token');
    const owned = new Map<string, any>();
    let pageToken: string | undefined;
    do {
        const res = await gcalRequest({
            url: `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=2500${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        }, true);
        for (const item of res.json?.items || []) {
            if (isOwnedEventItem(item)) owned.set(item.id, item);
        }
        pageToken = res.json?.nextPageToken;
    } while (pageToken);
    return owned;
}

/** gcalIds in every note, including excluded folders, so a task merely hidden from the planner keeps its event. */
async function collectReferencedGCalIds(plugin: DayPlannerPlugin): Promise<Set<string>> {
    const referenced = new Set<string>();
    for (const file of plugin.app.vault.getMarkdownFiles()) {
        if (isSyncConflictPath(file.path)) continue;
        const content = await plugin.app.vault.cachedRead(file);
        const re = /\[\s*gcalId::\s*([^\]]+)\]/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) referenced.add(m[1].trim());
    }
    return referenced;
}

function localDateTimeParts(dateTime?: string): { date: string; time: string } | null {
    if (!dateTime) return null;
    const moment = (window as any).moment;
    const m = moment(dateTime);
    return m.isValid() ? { date: m.format('YYYY-MM-DD'), time: m.format('HH:mm') } : null;
}

/** True when the event already shows exactly what the task says, so verification needs no request for it. */
function eventMatchesTask(item: any, task: TaskItem): boolean {
    const start = localDateTimeParts(item.start?.dateTime);
    const end = localDateTimeParts(item.end?.dateTime);
    const title = task.completed ? `[✓] ${task.text}` : task.text;
    return !!start && !!end && item.status !== 'cancelled' && item.summary === title
        && start.date === task.date && start.time === task.startTime && end.time === task.endTime;
}

async function syncTaskToGCalUnlocked(plugin: DayPlannerPlugin, task: TaskItem, calendarId: string): Promise<boolean> {
    if (!task.date || !task.startTime || !task.endTime) return false;

    const displayTitle = task.completed ? `[✓] ${task.text}` : task.text;
    const descText = `${OWNED_DESC_PREFIX} ${task.filePath} (line ${task.lineNumber + 1})`;
    const signature = `${calendarId}|${task.date}|${task.startTime}|${task.endTime}|${displayTitle}|${descText}`;

    if (task.gcalEventId) {
        // Already written this exact content: no request (batch sync would otherwise PATCH every linked task)
        if (lastSyncedSignature.get(task.gcalEventId) === signature) return true;
        // 이미 연동된 Google Calendar 일정 ID가 존재하는 경우 -> PATCH 업데이트 수행
        const result = await patchSyncedEvent(plugin, calendarId, task.gcalEventId, task, displayTitle, descText);
        if (result === 'ok') lastSyncedSignature.set(task.gcalEventId, signature);
        if (result !== 'gone') return result === 'ok';
        // Purged event or changed sync calendar: re-link below instead of staying desynced forever
        lastSyncedSignature.delete(task.gcalEventId);
        task.gcalEventId = null;
    }

    // 연동된 ID가 없는 신규 태스크 -> 중복 방지를 위한 일정 확인 후 생성 또는 매핑
    const timeMin = new Date(`${task.date}T00:00:00`);
    const timeMax = new Date(`${task.date}T23:59:59`);

    const tempCalConfig: GoogleCalendarConfig = {
        id: calendarId,
        name: 'Lookup Temp',
        color: '#4285f4',
        enabled: true
    };

    let existingEvents: GCalEvent[];
    try {
        // strict: a failed lookup must not fall through to creating a duplicate
        existingEvents = await fetchSingleCalendarEvents(plugin, tempCalConfig, timeMin, timeMax, true, true);
    } catch {
        return false;
    }
    const linkedIds = new Set((plugin.tasksCache || []).map(t => t.gcalEventId).filter(Boolean));
    const duplicate = existingEvents.find(e =>
        e.dateStr === task.date &&
        e.startTimeStr === task.startTime &&
        (e.summary === displayTitle || e.summary === task.text) &&
        (e.description ?? '').startsWith(OWNED_DESC_PREFIX) && // never adopt a personal/external event
        !linkedIds.has(e.id)                            // nor one another task already owns
    );

    if (duplicate) {
        // 구글에 일치하는 일정이 이미 존재함 -> Task 마크다운에 gcalId 메타 태그 삽입
        plugin.markSelfWrite(task.filePath);
        await updateTaskInFile(plugin.app, task, { gcalEventId: duplicate.id });
        const ok = (await patchSyncedEvent(plugin, calendarId, duplicate.id, task, displayTitle, descText)) === 'ok';
        if (ok) lastSyncedSignature.set(duplicate.id, signature);
        return ok;
    }

    // 일치하는 일정이 전혀 없음 -> 신규 일정 생성 후 gcalId 작성
    const newEventId = await createGoogleCalendarEvent(plugin, calendarId, {
        summary: displayTitle,
        description: descText,
        dateStr: task.date,
        startTimeStr: task.startTime,
        endTimeStr: task.endTime,
        isAllDay: false
    }, true);

    if (newEventId) {
        lastSyncedSignature.set(newEventId, signature);
        plugin.markSelfWrite(task.filePath);
        const written = await updateTaskInFile(plugin.app, task, { gcalEventId: newEventId });
        if (!written) console.warn('Day Planner Pro: created GCal event but could not write gcalId back', task.filePath, task.lineNumber);
        return true;
    }
    return false;
}

export interface TaskSyncReport {
    created: number;   // unlinked tasks that got a new event
    updated: number;   // linked events that were missing or out of date
    repaired: number;  // broken mappings fixed: shared gcalIds split, ghost events re-adopted
    removed: number;   // orphaned ghost events deleted
    orphans: number;   // orphaned ghost events found (deleted only in full mode)
    upToDate: number;
    skipped: number;
}

/**
 * Verifies task <-> event links against ONE listing of the task-sync calendar (task-sync events only) and sends requests
 * only for what is wrong. Vault → Google Calendar, tasks dated from 60 days ago to a year ahead.
 * repairOnly: fix existing links, but create no events for unlinked tasks and delete nothing (safe unattended at startup).
 */
export async function syncAllTasksToGCal(plugin: DayPlannerPlugin, calendarId: string, repairOnly: boolean = false): Promise<TaskSyncReport> {
    const report: TaskSyncReport = { created: 0, updated: 0, repaired: 0, removed: 0, orphans: 0, upToDate: 0, skipped: 0 };
    try {
        const moment = (window as any).moment;
        const windowStart = moment().subtract(60, 'days');
        const windowEnd = moment().add(365, 'days');
        const owned = await listOwnedEvents(plugin, calendarId, windowStart.toISOString(), windowEnd.toISOString());
        const allTasks = await scanVaultTasks(plugin.app);

        // 1. One event per task: a copied line shares its gcalId with the original, so both would PATCH one event.
        //    Keep the task the event matches (else the first); unlink the others so they get their own event.
        const byId = new Map<string, TaskItem[]>();
        for (const t of allTasks) {
            if (t.gcalEventId) byId.set(t.gcalEventId, [...(byId.get(t.gcalEventId) ?? []), t]);
        }
        const unlinkedByRepair = new Set<TaskItem>();
        for (const [id, group] of byId) {
            if (group.length < 2) continue;
            const item = owned.get(id);
            const keep = group.find(t => item && eventMatchesTask(item, t)) ?? group[0];
            for (const t of group) {
                if (t === keep) continue;
                plugin.markSelfWrite(t.filePath);
                if (await updateTaskInFile(plugin.app, t, { gcalEventId: null })) {
                    report.repaired++;
                    unlinkedByRepair.add(t);
                }
            }
        }

        // 2. Check each timed task in the window against the listing
        const fromStr = windowStart.format('YYYY-MM-DD');
        const toStr = windowEnd.format('YYYY-MM-DD');
        const timed = allTasks.filter(t => t.date && t.startTime && t.endTime && t.date >= fromStr && t.date <= toStr);
        const claimed = new Set(allTasks.map(t => t.gcalEventId).filter((id): id is string => !!id));
        for (const task of timed) {
            if (task.gcalEventId) {
                const item = owned.get(task.gcalEventId);
                if (item && eventMatchesTask(item, task)) {
                    lastSyncedSignature.delete(task.gcalEventId); // content verified; let the next edit PATCH freely
                    report.upToDate++;
                    continue;
                }
                // Event missing (deleted/purged → relinked) or drifted from the task: force a PATCH
                lastSyncedSignature.delete(task.gcalEventId);
                if (await syncTaskToGCal(plugin, task, calendarId)) report.updated++; else report.skipped++;
                continue;
            }
            if (repairOnly && !unlinkedByRepair.has(task)) continue;
            // Unlinked: re-adopt an unclaimed ghost event of this exact task before creating a new one
            const ghost = [...owned.values()].find(item => !claimed.has(item.id) && eventMatchesTask(item, task));
            if (ghost) {
                claimed.add(ghost.id);
                plugin.markSelfWrite(task.filePath);
                if (await updateTaskInFile(plugin.app, task, { gcalEventId: ghost.id })) report.repaired++;
                continue;
            }
            if (await syncTaskToGCal(plugin, task, calendarId)) report.created++; else report.skipped++;
        }

        // 3. Ghost events no note references. Skip ones under 5 minutes old: their gcalId may not be written back
        //    (or synced across devices) yet.
        const referenced = await collectReferencedGCalIds(plugin);
        const orphanIds = [...owned.values()]
            .filter(item => !referenced.has(item.id) && Date.now() - Date.parse(item.created || '') > 5 * 60 * 1000)
            .map(item => item.id as string);
        report.orphans = orphanIds.length;
        if (!repairOnly) {
            for (const id of orphanIds) {
                if (await deleteGoogleCalendarEvent(plugin, calendarId, id, true)) report.removed++;
            }
        }
    } catch (e) {
        console.error('Day Planner Pro: task sync verification failed:', e);
        throw e;
    }
    return report;
}