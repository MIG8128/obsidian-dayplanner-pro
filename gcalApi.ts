import { Notice, requestUrl } from 'obsidian';
import { GoogleCalendarConfig, GCalEvent, TaskItem } from './types';
import DayPlannerPlugin from './main';
import { scanVaultTasks, updateTaskInFile, parseTaskLine } from './utils';
import { TFile } from 'obsidian';

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
        const response = await requestUrl({
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
    eventId: string
): Promise<boolean> {
    const token = await getGoogleAccessToken(plugin);
    if (!token) {
        showRateLimitedNotice('⚠️ Google Calendar OAuth 정보가 비어있거나 만료되었습니다.', 5000, 30000);
        return false;
    }
    try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
        const response = await requestUrl({
            url: url,
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
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
    }
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

        const response = await requestUrl({
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
                end: endBody
            })
        });

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

        const response = await requestUrl({
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
export async function fetchSingleCalendarEvents(plugin: DayPlannerPlugin, cal: GoogleCalendarConfig, timeMin: Date, timeMax: Date, strict: boolean = false): Promise<GCalEvent[]> {
    if (!cal.id || !cal.enabled) return [];
    const token = await getGoogleAccessToken(plugin);
    if (!token) {
        if (strict) throw new Error('No Google access token');
        return [];
    }
    try {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?timeMin=${timeMin.toISOString()}&timeMax=${timeMax.toISOString()}&singleEvents=true&orderBy=startTime`;
        const response = await requestUrl({
            url: url,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
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

/** Serialize syncs per task line so two concurrent callers can never both `insert`. */
export function syncTaskToGCal(plugin: DayPlannerPlugin, task: TaskItem, calendarId: string): Promise<boolean> {
    const key = `${task.filePath}::${task.lineNumber}`;
    const prev = syncLocks.get(key) ?? Promise.resolve(true);
    const next = prev.catch(() => false).then(async () => {
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
    syncLocks.set(key, next);
    next.finally(() => { if (syncLocks.get(key) === next) syncLocks.delete(key); });
    return next;
}

async function syncTaskToGCalUnlocked(plugin: DayPlannerPlugin, task: TaskItem, calendarId: string): Promise<boolean> {
    if (!task.date || !task.startTime || !task.endTime) return false;
    
    const displayTitle = task.completed ? `[✓] ${task.text}` : task.text;
    const descText = `Synced from Obsidian: ${task.filePath} (line ${task.lineNumber + 1})`;

    if (task.gcalEventId) {
        // 이미 연동된 Google Calendar 일정 ID가 존재하는 경우 -> PATCH 업데이트 수행
        const success = await updateGoogleCalendarEvent(plugin, calendarId, task.gcalEventId, {
            summary: displayTitle,
            description: descText,
            dateStr: task.date,
            startTimeStr: task.startTime,
            endTimeStr: task.endTime,
            isAllDay: false
        });
        return success;
    } else {
        // 연동된 ID가 없는 신규 태스크 -> 중복 방지를 위한 일정 확인 후 생성 또는 매핑
        const timeMin = new Date(`${task.date}T00:00:00`);
        const timeMax = new Date(`${task.date}T23:59:59`);
        
        const tempCalConfig: GoogleCalendarConfig = {
            id: calendarId,
            name: 'Lookup Temp',
            color: '#4285f4',
            enabled: true
        };
        
        const existingEvents = await fetchSingleCalendarEvents(plugin, tempCalConfig, timeMin, timeMax);
        const duplicate = existingEvents.find(e => 
            e.dateStr === task.date && 
            e.startTimeStr === task.startTime &&
            (e.summary === displayTitle || e.summary === task.text)
        );
        
        if (duplicate) {
            // 구글에 일치하는 일정이 이미 존재함 -> Task 마크다운에 gcalId 메타 태그 삽입
            plugin.markSelfWrite(task.filePath);
            await updateTaskInFile(plugin.app, task, { gcalEventId: duplicate.id });
            return true;
        }
        
        // 일치하는 일정이 전혀 없음 -> 신규 일정 생성 후 gcalId 작성
        const newEventId = await createGoogleCalendarEvent(plugin, calendarId, {
            summary: displayTitle,
            description: descText,
            dateStr: task.date,
            startTimeStr: task.startTime,
            endTimeStr: task.endTime,
            isAllDay: false
        });
        
        if (newEventId) {
            plugin.markSelfWrite(task.filePath);
            const written = await updateTaskInFile(plugin.app, task, { gcalEventId: newEventId });
            if (!written) console.warn('Day Planner Pro: created GCal event but could not write gcalId back', task.filePath, task.lineNumber);
            return true;
        }
    }
    return false;
}

/**
 * Vault 내부의 모든 Timed Task들을 Google Calendar로 일괄 동기화 (백그라운드 동화 엔진)
 */
export async function syncAllTasksToGCal(plugin: DayPlannerPlugin, calendarId: string): Promise<{ created: number, updated: number, skipped: number }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    
    try {
        const tasks = await scanVaultTasks(plugin.app);
        const timedTasks = tasks.filter(t => t.date && t.startTime && t.endTime);
        
        for (const task of timedTasks) {
            const hasId = !!task.gcalEventId;
            const success = await syncTaskToGCal(plugin, task, calendarId);
            if (success) {
                if (hasId) updated++;
                else created++;
            } else {
                skipped++;
            }
        }
    } catch (e) {
        console.error('Failed to run batch vault tasks auto-sync to GCal:', e);
    }
    
    return { created, updated, skipped };
}