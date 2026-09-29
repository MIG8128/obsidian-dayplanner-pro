// Day Planner Pro에서 공통으로 사용할 할 일 인터페이스
export interface TaskItem {
    id: string;             // 파일 경로 + 줄 번호를 조합한 고유 ID
    filePath: string;       // 할 일이 위치한 파일 경로
    lineNumber: number;     // 파일 내부의 줄 번호
    originalLine: string;   // 원래 마크다운 텍스트 원본 (일치 여부 확인용)
    completed: boolean;     // 완료 여부 (- [x] 이면 true)
    statusChar: string;     // 할 일 체크박스 내부의 문자 (e.g. ' ', 'x', '/', '-')
    text: string;           // 순수 할 일 텍스트 내용
    startTime: string | null; // e.g. "09:30" 형태의 시작 시간
    endTime: string | null;   // e.g. "10:30" 형태의 종료 시간
    date: string | null;      // ⏳ YYYY-MM-DD 형태의 날짜
    priority: 'lowest' | 'low' | 'normal' | 'medium' | 'high' | 'highest'; // 중요도 데이터 필드
    
    // Tasks 플러그인 상호 호환 전용 메타데이터 필드
    recurrence: string | null;     // 🔁 반복 주기 정보 (e.g., "every day", "every week")
    dueDate: string | null;        // 📅 마감일 정보 (YYYY-MM-DD)
    scheduledDate: string | null;  // ⏳ 예정일 정보 (YYYY-MM-DD)
    startDate: string | null;      // 🛫 시작일 정보 (YYYY-MM-DD)
    completionDate: string | null; // ✅ 완료일 정보 (YYYY-MM-DD)
    cancelledDate: string | null;  // ❌ 취소일 정보 (YYYY-MM-DD)
    gcalEventId?: string | null;   // 동기화된 구글 캘린더 일정 ID
}

// 구글 캘린더 연동 상세 설정 인터페이스
export interface GoogleCalendarConfig {
    id: string;             // 구글 캘린더 ID (primary 혹은 이메일)
    name: string;           // 사용자 지정 이름 (업무, 개인 등)
    color: string;          // 캘린더 전용 색상 (HEX)
    enabled: boolean;       // 연동 활성화 상태
}

// 구글 캘린더 API 연동용 일정 인터페이스
export interface GCalEvent {
    id: string;
    calendarId: string;       // 해당 일정이 속한 구글 캘린더 ID (쓰기 연동에 필수)
    summary: string;
    start: string;            // ISO datetime 또는 YYYY-MM-DD
    end: string;
    isAllDay: boolean;
    startTimeStr: string | null; // e.g. "09:30"
    endTimeStr: string | null;   // e.g. "10:30"
    dateStr: string;             // YYYY-MM-DD
    color?: string;              // 캘린더 전용 고유 색상 HEX
    calendarName?: string;       // 캘린더 이름
    location?: string;           // 장소 및 위치 정보
    description?: string;        // 상세 설명 (교수명, 강의 주제 등)
}

// Day Planner 플러그인 설정 인터페이스
export interface DayPlannerSettings {
    defaultTaskFile: string; // 새로운 태스크 생성 시 저장할 기본 마크다운 파일 경로
    enableGoogleCalendar: boolean; // 구글 캘린더 연동 활성화 여부
    googleClientId: string; // 구글 OAuth 2.0 Web Client ID (일정 수정/쓰기에 사용)
    googleClientSecret: string; // 구글 OAuth 2.0 Client Secret
    googleRefreshToken: string; // 구글 OAuth 2.0 Refresh Token
    googleAccessToken: string; // 캐싱용 임시 Access Token
    googleAccessTokenExpires: number; // Access Token 만료 타임스탬프
    googleCalendars: GoogleCalendarConfig[]; // 등록된 멀티 구글 캘린더 목록
    dailyNotesFolder: string; // 일기가 저장될 폴더 경로
    dailyNotesFormat: string; // 일기 파일명 포맷 (기본: YYYY-MM-DD)
    weeklyNotesFolder: string; // 주간 노트 폴더 경로
    weeklyNotesFormat: string; // 주간 노트 파일명 포맷 (기본: gggg-[W]ww)
    taskColor: string; // 로컬 마크다운 태스크 테마 색상 (기본: 주황색)
    timelineHourHeight: number; // 타임라인 일간/주간 뷰 1시간 세로 높이 설정 (px 단위)
    separateViewHeights: boolean; // 일간 뷰와 통합 뷰 높이 개별 설정 여부
    timelineHourHeightDaily: number; // 일간 뷰 전용 타임라인 1시간 세로 높이 설정
    timelineStartHour: number;  // 타임라인 시작 시간 (0 - 23)
    timelineEndHour: number;    // 타임라인 종료 시간 (1 - 24)
    taskSyncCalendarId: string; // 로컬 태스크를 동기화할 구글 캘린더 ID
    excludePaths: string[]; // 할 일 검색에서 제외할 폴더 및 파일 경로 목록
    dailyNoteTemplate: string; // 데일리 노트 생성 시 사용할 템플릿 파일 경로
    excludeMatchMode: 'any' | 'all';
    nDayViewDays: number;
    weeklyNoteTemplate: string; // 주간 노트 생성 시 사용할 템플릿 파일 경로
    collapsedColumns?: string[];
    enableMobileHaptics: boolean; // Vibration feedback on supported mobile devices
}

// 기본 설정 값 정의
export const DEFAULT_SETTINGS: DayPlannerSettings = {
    defaultTaskFile: 'Day Planner.md',
    enableGoogleCalendar: false,
    googleClientId: '',
    googleClientSecret: '',
    googleRefreshToken: '',
    googleAccessToken: '',
    googleAccessTokenExpires: 0,
    googleCalendars: [],
    dailyNotesFolder: '',
    dailyNotesFormat: 'YYYY-MM-DD',
    weeklyNotesFolder: '',
    weeklyNotesFormat: 'gggg-[W]ww',
    taskColor: '#ff9f1c',
    timelineHourHeight: 60, // 기본 1시간 = 60px
    separateViewHeights: false,
    timelineHourHeightDaily: 60,
    timelineStartHour: 0,
    timelineEndHour: 24,
    taskSyncCalendarId: '',
    excludePaths: [],
    dailyNoteTemplate: '',
    excludeMatchMode: 'any',
    weeklyNoteTemplate: '',
    nDayViewDays: 4,
    collapsedColumns: [],
    enableMobileHaptics: true
};

// 뷰 타입 상수 정의
export const VIEW_TYPES = {
    COMBINED: 'day-planner-pro-view',
    DAILY: 'day-planner-pro-daily'
};

export const GCAL_CACHE_TTL_MS = 5 * 60 * 1000;
export const GCAL_MAX_CACHED_RANGES = 24;
