export const STYLES = `
/* Glass design tokens (declared on theme roots so modals/menus outside .dp-container inherit them) */
.theme-dark {
    --dp-glass-bg: rgba(25, 27, 38, 0.75);
    --dp-glass-border: rgba(255, 255, 255, 0.1);
    --dp-glass-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    --dp-segment-track: rgba(255, 255, 255, 0.05);
    --dp-segment-active: rgba(255, 255, 255, 0.12);
    --dp-card-bg: rgba(255, 255, 255, 0.06);
    --dp-card-border: rgba(255, 255, 255, 0.16);
}
.theme-light {
    --dp-glass-bg: rgba(255, 255, 255, 0.72);
    --dp-glass-border: rgba(0, 0, 0, 0.08);
    --dp-glass-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    --dp-segment-track: rgba(0, 0, 0, 0.05);
    --dp-segment-active: rgba(255, 255, 255, 0.95);
    --dp-card-bg: rgba(0, 0, 0, 0.03);
    --dp-card-border: rgba(0, 0, 0, 0.14);
}

.dp-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    color: var(--text-normal);
    background-color: var(--background-primary);
    font-family: var(--font-interface);
    position: relative;
    overflow: hidden;
    user-select: none;
    --dp-hour-height: 60px; /* 세로 1시간 간격 CSS 변수 바인딩 */
    container: dp-planner / inline-size; /* narrow layout keys off the pane width, not the device */
}

/* 상단 컨트롤 헤더 */
.dp-header {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    gap: 8px;
    position: relative;
    z-index: 30; /* above sticky hour column so the ambient shadow stays visible */
    border-bottom: 1px solid var(--dp-glass-border);
    background-color: var(--dp-glass-bg);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    box-shadow: var(--dp-glass-shadow);
}
.dp-header-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
}
.dp-title {
    font-size: 0.8em;
    font-weight: normal;
    color: var(--text-muted);
    opacity: 0.5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dp-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    width: 100%;
}
.dp-nav-buttons-group {
    display: flex;
    gap: 3px;
}
.dp-nav-buttons-group button {
    padding: 3px 8px;
    font-size: 0.8em;
    height: 26px;
}
/* Header date: segments are either note links (.dp-nav-date-link) or plain labels (.dp-nav-date-static) */
.dp-nav-date {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    font-weight: bold;
    font-size: 1.15em;
    color: var(--text-normal);
    cursor: default;
    border-bottom: 2px solid var(--interactive-accent);
    padding: 2px 4px;
    text-align: right;
    white-space: nowrap;
}
.dp-nav-date-static {
    cursor: default;
}
.dp-nav-date-link {
    cursor: pointer;
    padding: 0 2px;
    border-radius: 4px;
    transition: color 0.15s ease-in-out, background-color 0.15s ease-in-out;
}
.dp-nav-date-link:hover {
    color: var(--text-accent);
    background-color: var(--background-modifier-hover);
}

/* Segmented control: transparent track, rounded pill items, no divider lines */
.dp-tabs {
    position: relative; /* offsetParent for the sliding pill's FLIP measurements */
    display: flex;
    align-items: center;
    gap: 2px;
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    padding: 3px;
    border-radius: 10px;
    width: 100%;
    box-sizing: border-box;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch; /* momentum swipe on iOS */
    overscroll-behavior-x: contain;    /* swiping past the ends doesn't drag the workspace / trigger back-swipe */
}
.dp-tabs::-webkit-scrollbar {
    display: none;
}
/* Reset Obsidian's native button chrome so <button> tabs and the n-day <div> tab align identically.
   Parent-qualified: Obsidian's "button:not(.clickable-icon)" (0,1,1) outranks a bare ".dp-tab" (0,1,0). */
.dp-tabs > .dp-tab {
    position: relative;
    isolation: isolate; /* keeps the ::before pill behind the label */
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    min-height: 0;
    margin: 0;
    padding: 0 10px;
    box-sizing: border-box;
    border-radius: 8px;
    cursor: pointer;
    font-size: 0.8em;
    font-weight: 500;
    line-height: 1;
    background: transparent;
    border: none;
    box-shadow: none;
    color: var(--text-muted);
    white-space: nowrap;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.dp-tabs > .dp-tab:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
    box-shadow: none;
}
.dp-tabs > .dp-tab.active,
.dp-tabs > .dp-tab.active:hover {
    background-color: transparent;
    color: var(--text-normal);
    font-weight: 600;
}
/* Highlight pill: drawn as a pseudo-element so it can slide in from the previous tab */
.dp-tabs > .dp-tab.active::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background-color: var(--dp-segment-active);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), inset 0 0 0 1px var(--dp-glass-border);
    transform-origin: left center;
}
.dp-tabs > .dp-tab.dp-tab-pill-slide::before {
    animation: dp-pill-slide 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
@keyframes dp-pill-slide {
    from { transform: translateX(var(--dp-pill-dx, 0px)) scaleX(var(--dp-pill-sx, 1)); }
    to { transform: none; }
}

/* 뷰 영역 공통 */
.dp-content {
    flex-grow: 1;
    overflow: auto;
    padding: 12px;
    position: relative;
}

/* Keep-alive view panes (combined view): cached panes are hidden, never destroyed.
   The 150ms reveal is added by applyViewReveal() only when a pane becomes visible, and removed on animationend.
   Only opacity/transform are animated (compositor-only). The resting state is transform: none
   (not translateY(0)) so an idle pane never becomes a containing block / stacking context for its contents. */
.day-planner-view-pane.dp-view-reveal {
    animation: dp-pane-enter 0.15s ease-out;
}
/* !important: view-specific pane layouts (e.g. ".dp-content:has(> .dp-kanban-board) { display: flex }", same
   specificity and later in this sheet) must never re-show a hidden pane */
.day-planner-view-pane.is-hidden {
    display: none !important;
}
@keyframes dp-pane-enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
}
/* Directional slide (applySlideTransition): date pagination, Today, Board Kanban ↔ Priority (compositor-only).
   Starts partly opaque (never 0) so there is no blank frame; the translate carries the direction. */
.dp-slide-from-right {
    animation: dp-slide-from-right 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-slide-from-left {
    animation: dp-slide-from-left 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes dp-slide-from-right {
    from { opacity: 0.5; transform: translateX(32px); }
    to { opacity: 1; transform: none; }
}
@keyframes dp-slide-from-left {
    from { opacity: 0.5; transform: translateX(-32px); }
    to { opacity: 1; transform: none; }
}
/* Applied to the scroll host only while sliding, and only when it has no horizontal overflow of its own */
.dp-slide-host {
    overflow-x: hidden !important;
}
/* The helpers already skip animating under reduced motion; this is the CSS-side safety net */
@media (prefers-reduced-motion: reduce) {
    .day-planner-view-pane.dp-view-reveal,
    .dp-slide-from-right,
    .dp-slide-from-left {
        animation: none;
    }
}

/* 1. 타임라인 (Daily) 뷰 */
.dp-timeline-wrapper {
    position: relative;
    display: flex;
    min-height: calc(var(--dp-hours-count, 24) * var(--dp-hour-height)); /* 설정된 시작~종료 시간 범위만큼만 높이 확보 */
}
/* Daily all-day section: sticks to the top of the .dp-content scroller while the hourly grid scrolls under it.
   top/margin of -12px cancel the scroller's padding so no cards peek through above the pinned block;
   z-index sits above timeline cards (selected cards use 99) and the sticky hour column (20). */
.dp-daily-allday {
    position: sticky;
    top: -12px;
    z-index: 100;
    display: grid;
    grid-template-columns: 48px 1fr; /* 48px = hour column, same as .dp-weekly-allday-grid's label column */
    margin: -12px -12px 8px;
    padding: 0 12px;
    background-color: var(--background-secondary-alt);
    border-bottom: 1px solid var(--background-modifier-border);
}
/* Inline code blocks render the daily timeline in an unpadded scroller */
.dp-codeblock-container .dp-daily-allday {
    top: 0;
    margin: 0 0 8px;
    padding: 0;
}

/* Shared all-day row pieces: Daily, Weekly and N-day all use these */
.dp-allday-label {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75em;
    font-weight: bold;
    color: var(--text-muted);
    border-right: 1px solid var(--background-modifier-border);
}
.dp-allday-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 40px;
    max-height: 80px;
    overflow-y: auto;
    padding: 4px;
    border-right: 1px solid var(--background-modifier-border);
}
/* Compact variant of .dp-grid-task-item (its base rules use !important, so these must too) */
.dp-grid-task-item.dp-allday-item {
    font-size: 0.7em !important;
    padding: 2px 4px !important;
    margin: 0 !important;
}
.dp-grid-task-item.dp-allday-item .dp-custom-cb {
    width: 12px;
    height: 12px;
    margin-right: 4px;
    font-size: 8px;
    border-width: 1.5px;
}
.dp-timeline-hours {
    width: 48px;
    flex-shrink: 0;
    border-right: 1px solid var(--background-modifier-border);
    position: sticky;
    left: 0;
    z-index: 20;
    background-color: var(--background-primary);
}
.dp-timeline-hour-mark {
    height: var(--dp-hour-height); /* 동적 높이 적용 */
    font-size: 0.72em;
    color: var(--text-muted);
    text-align: right;
    padding-right: 6px;
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    padding-top: 2px;
}
.dp-timeline-events {
    flex-grow: 1;
    position: relative;
    background-size: 100% var(--dp-hour-height); /* 배경 그리드 점선 동적 설정 */
    background-image: linear-gradient(to bottom, rgba(128, 128, 128, 0.35) 1px, transparent 1px);
}

/* 공통 타임라인 이벤트 스타일 (lightweight glass: no backdrop-filter for 60fps scrolling) */
.dp-timeline-event {
    position: absolute !important;
    padding: 10px 8px !important;
    border-radius: 8px !important;
    font-size: 0.82em !important;
    cursor: grab !important;
    opacity: 0.98 !important;
    transition: transform 0.1s, box-shadow 0.1s !important;
    border-left: 5px solid var(--interactive-accent) !important;
    display: flex !important;
    flex-direction: column !important;
    z-index: 5 !important;
    box-sizing: border-box !important;
    word-break: break-all !important;
    overflow: hidden !important;
}
.dp-timeline-event:active {
    cursor: grabbing !important;
}
.dp-timeline-event:hover {
    transform: translateY(-1px) scale(1.01) !important;
    z-index: 10 !important;
}

/* 다크 모드 테마 설정 */
/* Surface = translucent tint layered on an opaque base, so hour grid lines don't bleed through the card.
   The 1px background-coloured ring carves a visible gap between back-to-back / adjacent events. */
.theme-dark .dp-timeline-event,
.theme-light .dp-timeline-event {
    background-color: var(--background-primary) !important;
    background-image: linear-gradient(var(--dp-card-bg), var(--dp-card-bg)) !important;
    border: 1px solid var(--dp-card-border) !important;
    border-left: 3px solid var(--interactive-accent) !important;
}
.theme-dark .dp-timeline-event {
    color: #ffffff !important;
    box-shadow: 0 0 0 1px var(--background-primary), 0 2px 8px rgba(0, 0, 0, 0.35) !important;
}
.theme-dark .dp-timeline-event.completed {
    background-image: linear-gradient(rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0.025)) !important;
    color: var(--text-muted) !important;
    border-color: rgba(255, 255, 255, 0.06) !important;
    border-left-color: var(--text-muted) !important;
}
.theme-dark .dp-timeline-event.cancelled {
    background-image: linear-gradient(rgba(235, 87, 87, 0.06), rgba(235, 87, 87, 0.06)) !important;
    color: var(--text-muted) !important;
    border-color: rgba(255, 255, 255, 0.06) !important;
    border-left-color: var(--text-error) !important;
}

/* 라이트 모드 테마 설정 */
.theme-light .dp-timeline-event {
    color: #1c1c1e !important;
    box-shadow: 0 0 0 1px var(--background-primary), 0 2px 6px rgba(0, 0, 0, 0.08) !important;
}
.theme-light .dp-timeline-event.completed {
    background-image: none !important;
    background-color: #f4f4f5 !important;
    color: #a1a1aa !important;
    border-color: #d4d4d8 !important;
    border-left-color: #a1a1aa !important;
}
.theme-light .dp-timeline-event.cancelled {
    background-image: linear-gradient(rgba(239, 68, 68, 0.05), rgba(239, 68, 68, 0.05)) !important;
    color: #a1a1aa !important;
    border-color: #fca5a5 !important;
    border-left-color: #ef4444 !important;
}
.theme-light .dp-gcal-event {
    color: #1c1c1e !important;
}

.dp-timeline-event.selected {
    border: 2.5px dashed #ff9f1c !important;
    box-shadow: 0 0 15px rgba(255, 159, 28, 0.8) !important;
    transform: scale(0.97) !important;
    z-index: 99 !important;
}

/* Resize Handle 디자인 */
.dp-resize-handle {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 30px;
    height: 5px;
    background-color: rgba(128, 128, 128, 0.6);
    border-radius: 3px;
    cursor: ns-resize;
    z-index: 12;
    transition: background-color 0.15s, width 0.15s;
    touch-action: none;
}
.dp-resize-handle::after {
    content: '';
    position: absolute;
    top: -8px;
    bottom: -8px;
    left: -12px;
    right: -12px;
}
.dp-resize-handle:hover {
    background-color: var(--interactive-accent);
    width: 50px;
}
.dp-resize-handle.top {
    top: 3px;
}
.dp-resize-handle.bottom {
    bottom: 3px;
}

/* Small Card Resize Handle adjustments */
.dp-resize-handle.dp-small-handle {
    width: 20px;
    height: 2px;
    border-radius: 1px;
}
.dp-resize-handle.dp-small-handle.top {
    top: 1px;
}
.dp-resize-handle.dp-small-handle.bottom {
    bottom: 1px;
}
.dp-resize-handle.dp-small-handle::after {
    top: -2px;
    bottom: -2px;
    left: -4px;
    right: -4px;
}
.dp-resize-handle.dp-small-handle:hover {
    width: 30px;
}

/* 다중 드래그 선택 영역(Marquee) 스타일 */
.dp-selection-marquee {
    position: absolute;
    border: 2px dashed var(--interactive-accent);
    background-color: rgba(255, 159, 28, 0.15);
    z-index: 2000;
    pointer-events: none;
    border-radius: 4px;
    box-sizing: border-box;
}

/* 현재 시간 표시선 */
.dp-timeline-current-indicator {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background-color: var(--text-error);
    z-index: 10;
}
.dp-timeline-current-indicator::before {
    content: '';
    position: absolute;
    left: 0;
    top: -4px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: var(--text-error);
}

/* 2. 주간 및 월간 달력 영역 */
.dp-weekly-scroll-wrapper {
    width: 100%;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
}
.dp-monthly-scroll-wrapper {
    width: 100%;
    height: 100%;
    overflow-x: auto;
    overflow-y: auto;
}

/* Monthly: container fills the pane; week rows split the remaining height evenly (--dp-week-count set in views.ts).
   The 96px floor only kicks in on very short panes, where the scroll wrapper takes over. */
.dp-monthly-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-width: 800px;
}
.dp-grid-calendar {
    display: grid;
    grid-template-columns: 40px repeat(7, 1fr);
    grid-template-rows: repeat(var(--dp-week-count, 5), minmax(96px, 1fr));
    gap: 8px;
    flex: 1 1 0;
    width: 100%;
}
.dp-monthly-header-grid {
    display: grid;
    grid-template-columns: 40px repeat(7, 1fr);
    gap: 8px;
    margin-bottom: 4px;
    width: 100%;
    flex-shrink: 0;
}
.dp-grid-header {
    font-weight: bold;
    text-align: center;
    padding: 8px 0;
    background-color: var(--background-secondary);
    border-radius: 4px;
    font-size: 0.9em;
}
.dp-grid-header.today {
    color: var(--text-accent);
}
.dp-grid-cell {
    border: 1px solid var(--background-modifier-border);
    background-color: var(--background-primary);
    border-radius: 6px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    box-sizing: border-box;
}
.dp-grid-cell.today {
    border: 2px solid var(--interactive-accent);
}
.dp-grid-cell-num {
    font-size: 0.8em;
    color: var(--text-muted);
    margin-bottom: 6px;
    font-weight: bold;
}
.dp-grid-task-list {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 2px;
}
.dp-grid-task-item {
    font-size: 0.75em !important;
    padding: 2px 6px !important;
    border-radius: 4px !important;
    background-color: var(--background-secondary) !important;
    border: 1px solid var(--background-modifier-border) !important;
    cursor: pointer !important;
    height: 22px !important;
    min-height: 22px !important;
    max-height: 22px !important;
    line-height: 18px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    box-sizing: border-box !important;
    margin-bottom: 2px !important;
    flex-shrink: 0 !important;
    overflow: hidden !important;
    white-space: nowrap !important;
}
.dp-grid-task-item span.dp-task-text {
    flex-grow: 1 !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    margin-right: 4px !important;
    display: inline-block !important;
}
.dp-grid-task-item.completed {
    text-decoration: line-through;
    opacity: 0.5;
}
.dp-grid-task-item.cancelled {
    text-decoration: line-through !important;
    opacity: 0.55 !important;
    background-color: rgba(235, 87, 87, 0.03) !important;
}

/* 월간 주차 셀 스타일 */
.dp-grid-week-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: var(--background-secondary-alt);
    border-radius: 6px;
    border: 1px dashed var(--background-modifier-border);
    box-sizing: border-box;
    cursor: pointer;
    transition: background-color 0.15s ease-in-out, border-color 0.15s ease-in-out;
}
.dp-grid-week-cell:hover {
    background-color: var(--background-modifier-hover);
    border-color: var(--interactive-accent);
}

/* 이동 링크 버튼 스타일 */
.dp-task-link-btn {
    color: var(--text-accent) !important;
    font-size: 0.9em !important;
    cursor: pointer !important;
    padding: 0 2px !important;
    transition: color 0.1s, transform 0.1s !important;
    user-select: none !important;
    display: inline-block !important;
    flex-shrink: 0 !important;
}
.dp-task-link-btn:hover {
    color: var(--interactive-accent) !important;
    transform: scale(1.15) !important;
}

/* 3. 주간 타임라인 그리드 뷰 구현용 스타일 */
.dp-weekly-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 900px;
}
.dp-weekly-days-wrapper {
    display: flex;
    flex-grow: 1;
    position: relative;
    background-size: 100% var(--dp-hour-height); /* 동적 세로 간격 */
    background-image: linear-gradient(to bottom, rgba(128, 128, 128, 0.35) 1px, transparent 1px);
}
.dp-weekly-day-col {
    flex: 1;
    position: relative;
    border-right: 1px solid var(--background-modifier-border);
    box-sizing: border-box;
}
.dp-weekly-day-col.today {
    background-color: var(--background-modifier-hover);
}

.dp-weekly-header-grid {
    display: grid;
    grid-template-columns: 48px repeat(7, 1fr);
    gap: 0;
    margin-bottom: 4px;
}
.dp-weekly-allday-grid {
    display: grid;
    grid-template-columns: 48px repeat(7, 1fr);
    gap: 0;
    border-bottom: 1px solid var(--background-modifier-border);
    background-color: var(--background-secondary-alt);
}

/* 4. 칸반 보드 (Board) 뷰 */
/* Board tab: .dp-content becomes a locked flex column so the board fits the pane exactly */
.dp-content:has(> .dp-kanban-board) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
.dp-kanban-board {
    display: flex;
    gap: 16px;
    flex: 1 1 0;
    min-height: 0;
    height: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    align-items: stretch;
}
.dp-kanban-column {
    flex: 1;
    min-width: 250px;
    max-width: 320px;
    height: 100%;
    min-height: 0;
    box-sizing: border-box;
    background-color: var(--background-secondary);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    padding: 12px;
    transition: background-color 0.2s, border-color 0.2s;
}
.dp-kanban-column.drag-over {
    background-color: var(--background-modifier-hover);
    border: 2px dashed var(--interactive-accent);
}
.dp-kanban-col-header {
    flex-shrink: 0;
    font-weight: bold;
    font-size: 1em;
    margin-bottom: 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid var(--background-modifier-border);
    padding-bottom: 6px;
}
.dp-kanban-col-count {
    background-color: var(--background-modifier-border);
    font-size: 0.8em;
    padding: 2px 8px;
    border-radius: 12px;
    color: var(--text-muted);
}
.dp-kanban-cards {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 2px 4px 4px 2px; /* room for card borders/hover shadow so the native scrollbar never clips them */
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.dp-kanban-card {
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    cursor: grab;
    transition: transform 0.1s, box-shadow 0.1s;
}
.dp-kanban-card:active {
    cursor: grabbing;
}
.dp-kanban-card:hover {
    box-shadow: 0 3px 6px rgba(0,0,0,0.1);
    border-color: var(--interactive-accent);
}
.dp-kanban-card.completed {
    opacity: 0.6;
    text-decoration: line-through;
}
.dp-kanban-card.cancelled {
    opacity: 0.55 !important;
    text-decoration: line-through !important;
    background-color: rgba(235, 87, 87, 0.03) !important;
    border-left-color: var(--text-error) !important;
}
.dp-kanban-card-title {
    font-size: 0.9em;
    font-weight: 500;
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
}
.dp-kanban-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    font-size: 0.75em;
    color: var(--text-muted);
}
.dp-kanban-card-file {
    width: 100%;
    color: var(--text-muted);
    opacity: 0.75;
    font-size: 0.92em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dp-badge {
    padding: 2px 6px;
    border-radius: 4px;
    background-color: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
}
.dp-badge-time {
    background-color: rgba(255, 165, 0, 0.1);
    color: var(--text-warning);
}
.dp-badge-date {
    background-color: rgba(0, 128, 255, 0.1);
    color: var(--text-accent);
}
.dp-badge-priority {
    font-weight: bold;
    font-size: 0.8em;
}

/* 프리미엄 반응형 커스텀 체크박스 스타일 */
.dp-custom-cb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 11px;
    font-weight: bold;
    user-select: none;
    flex-shrink: 0;
    transition: all 0.15s ease-in-out;
}
.dp-custom-cb.status-todo {
    border: 2px solid var(--text-muted);
    background-color: transparent;
}
.dp-custom-cb.status-todo:hover {
    border-color: var(--interactive-accent);
    background-color: rgba(var(--interactive-accent-rgb), 0.1);
}
.dp-custom-cb.status-inprogress {
    border: 2px solid var(--interactive-accent);
    background: linear-gradient(90deg, var(--interactive-accent) 50%, transparent 50%);
    color: transparent;
}
.dp-custom-cb.status-done {
    border: 2px solid var(--interactive-accent);
    background-color: var(--interactive-accent);
    color: white;
}
.dp-custom-cb.status-cancelled {
    border: 2px solid var(--text-error);
    background-color: rgba(235, 87, 87, 0.15);
    color: var(--text-error);
}

/* Board mode toggle: compact segmented control inside the header actions (same height as Sync/Filter/+) */
.dp-board-toggle {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 26px;
    padding: 2px;
    margin-right: 4px;
    box-sizing: border-box;
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    border-radius: 8px;
    flex-shrink: 0;
}
.dp-board-toggle > .dp-board-toggle-btn {
    height: 20px;
    padding: 0 8px;
    margin: 0;
    font-size: 0.75em;
    line-height: 1;
    border-radius: 6px;
    border: none;
    box-shadow: none;
    cursor: pointer;
    background: transparent;
    color: var(--text-muted);
    white-space: nowrap;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.dp-board-toggle > .dp-board-toggle-btn:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
    box-shadow: none;
}
.dp-board-toggle > .dp-board-toggle-btn.active {
    background-color: var(--dp-segment-active);
    color: var(--text-normal);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), inset 0 0 0 1px var(--dp-glass-border);
}

/* 구글 캘린더 연동일정 전용 기본 스타일 */
.dp-gcal-event {
    background-color: rgba(66, 133, 244, 0.12);
    color: var(--text-normal);
    border-left: 4px solid #4285f4;
}
.dp-sync-indicator {
    font-size: 0.8em;
    color: var(--text-muted);
    background: var(--background-modifier-border);
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
}
.dp-sync-indicator:hover {
    background-color: var(--background-modifier-hover);
}

.dp-current-task-bar {
    position: relative;
    background-color: var(--background-secondary-alt);
    border: 2px solid var(--interactive-accent);
    border-radius: 8px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 -4px 15px rgba(0, 0, 0, 0.1);
    z-index: 100;
    margin: 8px 12px;
    box-sizing: border-box;
    flex-shrink: 0;
}
.theme-dark .dp-current-task-bar {
    background-color: #121214;
    box-shadow: 0 -4px 15px rgba(0, 0, 0, 0.4);
}
.dp-ct-status-icon {
    color: var(--text-error);
    font-size: 1.1em;
    animation: dp-pulse 1.8s infinite;
    flex-shrink: 0;
}
@keyframes dp-pulse {
    0% { opacity: 0.4; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1.15); }
    100% { opacity: 0.4; transform: scale(0.9); }
}
.dp-ct-info {
    flex-grow: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.dp-ct-title {
    font-size: 0.85em;
    font-weight: bold;
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.theme-dark .dp-ct-title {
    color: #ffffff;
}
.dp-ct-time {
    font-size: 0.74em;
    color: var(--text-muted);
    white-space: nowrap;
}
/* Status Bar Progress Bar */
.dp-status-bar-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.dp-status-progress-container {
    display: inline-block;
    vertical-align: middle;
    width: 100px;
    height: 10px;
    background-color: var(--background-modifier-border);
    border-radius: 5px;
    overflow: hidden;
    margin: 0 4px;
    position: relative;
}
.dp-status-progress-bar {
    height: 100%;
    border-radius: 5px;
    transition: width 0.4s ease, background-color 0.4s ease;
}

/* Task Edit Modal Custom Style Tokens */
.dp-task-modal {
    max-width: 520px;
}
.dp-modal-header {
    border-bottom: 1px solid var(--background-modifier-border);
    padding-bottom: 8px;
    margin-bottom: 10px;
}
.dp-modal-header h2 {
    margin: 0;
    font-size: 1.25em;
}
.dp-modal-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.dp-modal-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 12px;
}
.is-phone .dp-modal-grid {
    grid-template-columns: minmax(0, 1fr);
}
.dp-modal-row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}
.dp-modal-row-label {
    font-weight: 600;
    font-size: 0.82em;
    color: var(--text-muted);
}
.dp-modal-tasks-section {
    padding: 8px 10px;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 8px);
    background-color: var(--background-secondary);
}
.dp-modal-tasks-section > summary {
    font-size: 0.85em;
    font-weight: 600;
    color: var(--text-accent);
    cursor: pointer;
}
.dp-modal-tasks-section[open] > summary {
    margin-bottom: 8px;
}
.dp-modal-options-row {
    display: flex;
    align-items: flex-end;
    gap: 12px;
}
.dp-modal-options-row > .dp-modal-row {
    flex: 1;
}
.dp-modal-static-value {
    font-size: 0.9em;
    color: var(--text-normal);
    line-height: 30px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dp-modal-checkbox {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    font-size: 0.9em;
    white-space: nowrap;
    cursor: pointer;
}
.dp-modal-checkbox input {
    margin: 0;
}
.dp-modal-collapse {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.18s ease, opacity 0.18s ease, margin-top 0.18s ease;
}
.dp-modal-collapse > * {
    overflow: hidden;
    min-height: 0;
}
.dp-modal-collapse.is-collapsed {
    grid-template-rows: 0fr;
    opacity: 0;
    margin-top: -10px; /* .dp-modal-form gap 상쇄 */
    pointer-events: none;
}
.dp-modal-row-desc {
    font-size: 0.8em;
    color: var(--text-muted);
    margin-top: -2px;
}
.dp-modal-textarea {
    width: 100%;
    min-height: 64px;
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    color: var(--text-normal);
    padding: 6px 10px;
    font-family: var(--font-interface);
    font-size: 0.95em;
    resize: vertical;
    box-sizing: border-box;
}
.dp-modal-textarea:focus, .dp-modal-input:focus, .dp-modal-select:focus {
    border-color: var(--interactive-accent);
    outline: none;
    box-shadow: 0 0 0 1px var(--interactive-accent);
}
.dp-modal-priority-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    padding: 4px 0;
}
.dp-modal-priority-option {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 0.9em;
    user-select: none;
    background-color: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    padding: 8px 10px;
    transition: all 0.15s ease-in-out;
}
.dp-modal-priority-option:hover {
    border-color: var(--interactive-accent);
    background-color: rgba(var(--interactive-accent-rgb), 0.05);
}

.dp-modal-radio-circle {
    width: 16px;
    height: 16px;
    border: 2px solid var(--text-muted);
    border-radius: 50%;
    display: inline-block;
    box-sizing: border-box;
    flex-shrink: 0;
    transition: all 0.15s ease-in-out;
    background-color: var(--background-primary);
}

.dp-modal-input, .dp-modal-select {
    width: 100%;
    min-width: 0;
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    color: var(--text-normal);
    padding: 4px 8px;
    font-family: var(--font-interface);
    height: 30px;
    box-sizing: border-box;
    font-size: 0.9em;
}
.dp-modal-file-row button {
    height: 30px;
    flex-shrink: 0;
}
.dp-modal-file-row {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
}
.dp-modal-file-input {
    flex-grow: 1;
    background-color: var(--background-secondary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s, 4px);
    color: var(--text-muted);
    padding: 4px 8px;
    font-family: var(--font-interface);
    height: 30px;
    min-width: 0;
    box-sizing: border-box;
    cursor: not-allowed;
    font-size: 0.9em;
}
.dp-modal-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
    border-top: 1px solid var(--background-modifier-border);
    padding-top: 10px;
}

/* Consolidated Add Modal choice screen styles */
.dp-modal-choice-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 24px;
}
.dp-modal-choice-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 24px 16px;
    cursor: pointer;
    background-color: var(--background-secondary);
    transition: all 0.15s ease-in-out;
    text-align: center;
}
.dp-modal-choice-card:hover {
    border-color: var(--interactive-accent);
    background-color: rgba(var(--interactive-accent-rgb), 0.05);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.dp-modal-choice-icon {
    font-size: 2.2em;
    margin-bottom: 12px;
}
.dp-modal-choice-title {
    font-weight: bold;
    font-size: 1.15em;
    color: var(--text-normal);
    margin-bottom: 8px;
}
.dp-modal-choice-desc {
    font-size: 0.85em;
    color: var(--text-muted);
    line-height: 1.4;
}

/* Premium Filter Group & Exclude Paths styling */
.dp-filter-card {
    background-color: var(--background-secondary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: 8px;
    padding: 16px;
    margin-top: 12px;
    margin-bottom: 16px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}
.dp-filter-header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.9em;
    color: var(--text-normal);
    font-weight: 500;
}
.dp-filter-select {
    background-color: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 2px 8px;
    font-weight: bold;
    color: var(--text-normal);
    cursor: pointer;
}
.dp-filter-divider {
    border: 0;
    border-top: 1px solid var(--background-modifier-border);
    margin: 12px 0;
    opacity: 0.7;
}
.dp-filter-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
}
.dp-filter-item {
    display: flex;
    align-items: center;
    gap: 8px;
}
.dp-filter-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-accent);
    opacity: 0.8;
}
.dp-filter-item-input {
    flex: 1;
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 4px;
    padding: 6px 10px;
    color: var(--text-normal);
    font-size: 0.9em;
    height: 32px;
    box-sizing: border-box;
}
.dp-filter-item-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
}
.dp-filter-item-delete:hover {
    background-color: var(--background-modifier-error-hover);
    color: var(--text-error);
}
.dp-filter-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
}
.dp-filter-footer button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.dp-filter-btn-icon {
    display: inline-flex;
}
.dp-filter-btn-icon svg {
    width: 14px;
    height: 14px;
}

/* Settings tab: native sizing */
.dp-settings .dp-filter-setting {
    border-bottom: none;
    padding-bottom: 0;
}
.dp-settings .dp-filter-card {
    margin-top: 8px;
    padding: 12px;
    box-shadow: none;
    background-color: var(--background-primary-alt);
}
.dp-settings .setting-item-control:has(> input[type="text"]) {
    flex: 0 1 50%;
    min-width: 200px;
}
.dp-settings .setting-item-control > input[type="text"] {
    width: 100%;
}

/* File/Folder Selector Modal styling */
.dp-selector-modal-tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    padding-bottom: 8px;
}
.dp-selector-modal-tab {
    flex: 1;
    text-align: center;
    padding: 8px;
    cursor: pointer;
    border-radius: 6px;
    background-color: var(--background-secondary);
    font-size: 0.9em;
    color: var(--text-muted);
    transition: all 0.15s ease;
}
.dp-selector-modal-tab:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
}
.dp-selector-modal-tab.active {
    background-color: var(--interactive-accent);
    color: white;
    font-weight: bold;
}
.dp-selector-modal-search {
    width: 100%;
    margin-bottom: 12px;
    height: 36px;
    box-sizing: border-box;
}
.dp-selector-modal-list {
    max-height: 350px;
    overflow-y: auto;
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
    background-color: var(--background-primary);
}
.dp-selector-modal-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    border-bottom: 1px solid var(--background-modifier-border);
    transition: background-color 0.1s ease;
    font-size: 0.92em;
}
.dp-selector-modal-item:last-child {
    border-bottom: none;
}
.dp-selector-modal-item:hover {
    background-color: var(--background-modifier-hover);
}
.dp-selector-modal-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-accent);
}
.dp-selector-modal-item-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Autocomplete suggestion styles */
.dp-sugg-container {
    position: absolute;
    background-color: var(--dp-glass-bg);
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    border: 1px solid var(--dp-glass-border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    max-height: 220px;
    overflow-y: auto;
    z-index: 1000;
    margin-top: 4px;
}
.dp-sugg-item {
    padding: 8px 12px;
    cursor: pointer;
    font-size: 0.9em;
    color: var(--text-normal);
    transition: background-color 0.1s ease;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dp-sugg-item:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
}

/* Zoom control: first item of the header actions (same contextual slot as .dp-board-toggle); expands leftward on hover */
.dp-zoom-slider-floating {
    width: 26px;
    height: 26px;
    margin-right: 4px;
    flex-shrink: 0;
    border-radius: 8px;
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
    justify-content: flex-start;
    padding: 0;
    overflow: hidden;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
}
/* Center the icon in collapsed state */
.dp-zoom-slider-floating span:first-child {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 1.1em;
    cursor: pointer;
}
.dp-zoom-slider {
    width: 80px;
    height: 4px;
    cursor: pointer;
    padding: 0;
    margin: 0;
    background: var(--background-modifier-border);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.2s ease;
}
.dp-zoom-value {
    font-size: 0.8em;
    font-weight: bold;
    width: 45px;
    text-align: right;
    color: var(--text-muted);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.2s ease;
    padding-left: 8px;
    box-sizing: border-box;
}
.dp-zoom-slider-floating:hover,
.dp-zoom-slider-floating:focus-within {
    width: 185px;
    background-color: var(--background-modifier-hover);
}
.dp-zoom-slider-floating:hover .dp-zoom-slider,
.dp-zoom-slider-floating:focus-within .dp-zoom-slider,
.dp-zoom-slider-floating:hover .dp-zoom-value,
.dp-zoom-slider-floating:focus-within .dp-zoom-value {
    opacity: 1;
}

/* -------------------------------------------------------------
   N-day View selector and general Tab selector updates
   ------------------------------------------------------------- */
.dp-tabs > .dp-tab-nday {
    gap: 2px;
}
/* Inline day-count chip that sits inside the segment pill.
   Parent-qualified so Obsidian's select/dropdown chrome (height, arrow image, padding, shadow) can't leak in. */
.dp-tab .dp-tab-select {
    background: var(--dp-segment-track);
    background-image: none;
    border: none;
    border-radius: 5px;
    box-shadow: inset 0 0 0 1px var(--dp-glass-border);
    font: inherit;
    color: inherit;
    padding: 0 3px;
    cursor: pointer;
    outline: none;
    margin: 0;
    text-align: center;
    text-align-last: center;
    width: 3.2ch;
    min-width: 0;
    height: 18px;
    min-height: 0;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    line-height: 18px;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.dp-tab .dp-tab-select:hover,
.dp-tab .dp-tab-select:focus-visible {
    background-color: var(--background-modifier-hover);
    box-shadow: inset 0 0 0 1px var(--interactive-accent);
}

/* Fill the leaf: no Obsidian view padding, container stretches to the bottom */
.workspace-leaf-content[data-type="day-planner-pro-view"] > .view-content,
.workspace-leaf-content[data-type="day-planner-pro-daily"] > .view-content {
    padding: 0;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
}
.workspace-leaf-content > .view-content > .dp-container {
    flex: 1;
    min-height: 0;
    height: 100%;
}

/* -------------------------------------------------------------
   Google Calendar Schedule List View Styles
   ------------------------------------------------------------- */
.dp-gc-list-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--background-primary);
}
.dp-gc-list-header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    background-color: var(--background-secondary-alt);
}
.dp-gc-search {
    width: 100%;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid var(--background-modifier-border);
    background-color: var(--background-primary);
    font-size: 0.88em;
    color: var(--text-normal);
}
.dp-gc-list-scroll {
    flex-grow: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
}
.dp-gc-day-row {
    display: flex;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--background-modifier-border-hover);
}
.dp-gc-day-sidebar {
    width: 110px;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    flex-shrink: 0;
}
.dp-gc-day-number {
    font-size: 1.25em;
    font-weight: bold;
    color: var(--text-normal);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
/* List view: day heading opens that day's daily note */
.dp-gc-day-link {
    cursor: pointer;
}
.dp-gc-day-link:hover .dp-gc-day-meta {
    color: var(--text-accent);
    text-decoration: underline;
}
.dp-gc-day-row:not(.is-today) .dp-gc-day-link:hover .dp-gc-day-number {
    color: var(--text-accent);
}
.dp-gc-day-row.is-today .dp-gc-day-number {
    background-color: var(--interactive-accent);
    color: white;
    border-radius: 50%;
}
.dp-gc-day-meta {
    font-size: 0.88em;
    color: var(--text-muted);
    font-weight: 500;
    margin-top: 6px;
    white-space: nowrap;
}
.dp-gc-day-content {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.dp-gc-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.92em;
    transition: background-color 0.1s ease;
}
.dp-gc-item:hover {
    background-color: var(--background-modifier-hover);
}
.dp-gc-item.completed .dp-gc-item-title {
    text-decoration: line-through;
    color: var(--text-muted);
}
.dp-gc-item.cancelled .dp-gc-item-title {
    text-decoration: line-through;
    color: var(--text-muted);
    opacity: 0.6;
}
.dp-gc-item-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.dp-gc-item-time {
    font-size: 0.85em;
    color: var(--text-muted);
    width: 140px;
    flex-shrink: 0;
    white-space: nowrap;
}
.dp-gc-item-title {
    color: var(--text-normal);
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dp-gc-item-file {
    font-size: 0.78em;
    color: var(--text-muted);
    background-color: var(--background-secondary);
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid var(--background-modifier-border);
    margin-left: auto;
}
.dp-gc-item-file:hover {
    color: var(--text-accent);
    text-decoration: underline;
}

/* Time Indicator Line */
.dp-gc-time-line {
    display: flex;
    align-items: center;
    width: 100%;
    height: 10px;
    margin: 4px 0;
    position: relative;
}
.dp-gc-time-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #ea4335;
    flex-shrink: 0;
    margin-right: 6px;
}
.dp-gc-time-rule {
    flex-grow: 1;
    height: 2px;
    background-color: #ea4335;
}

/* -------------------------------------------------------------
   Collapsible Filter Panel Styles
   ------------------------------------------------------------- */
/* No backdrop-filter here: it would become a backdrop root and stop the nested .dp-sugg-container from blurring */
.dp-filter-panel {
    border: 1px solid var(--dp-glass-border);
    border-radius: 8px;
    padding: 8px 12px;
    background-color: var(--dp-glass-bg);
    box-shadow: var(--dp-glass-shadow);
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: slideDown 0.2s ease-out;
}
@keyframes slideDown {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}

/* -------------------------------------------------------------
   Frosted modals & quick-add menus (scoped to this plugin's UI only)
   ------------------------------------------------------------- */
.modal:has(.dp-modal-buttons, .dp-selector-modal-tabs),
.menu.dp-glass-menu {
    background-color: var(--dp-glass-bg);
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    border: 1px solid var(--dp-glass-border);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}
.modal:has(.dp-modal-buttons, .dp-selector-modal-tabs) {
    border-radius: 12px;
}
/* Lighter dimming so the frost actually picks up the workspace behind it */
.modal-container:has(.dp-modal-buttons, .dp-selector-modal-tabs) > .modal-bg {
    opacity: 0.45;
}

/* -------------------------------------------------------------
   Narrow layout: one rule set for a ~300px desktop sidebar and a phone,
   driven by the planner's own width (container query), not device checks
   ------------------------------------------------------------- */
@container dp-planner (max-width: 400px) {
    .dp-header {
        padding: 8px 10px;
        gap: 6px;
    }
    .dp-title {
        display: none;
    }
    .dp-nav {
        gap: 6px;
    }
    .dp-nav-date {
        font-size: 1em;
    }
    .dp-tabs > .dp-tab {
        padding: 0 8px;
        font-size: 0.75em;
    }
    .dp-timeline-hour-mark {
        font-size: 0.66em;
    }
    .dp-timeline-event {
        padding: 6px !important;
        font-size: 0.78em !important;
    }
    .dp-current-task-bar {
        margin: 6px 8px;
        padding: 6px 10px;
        gap: 8px;
    }
}

/* Touch devices: finger-sized hit areas (Obsidian sets .is-mobile on <body>) */
.is-mobile .dp-resize-handle::after {
    top: -12px;
    bottom: -12px;
    left: -16px;
    right: -16px;
}
.is-mobile .dp-resize-handle.dp-small-handle::after {
    top: -8px;
    bottom: -8px;
    left: -10px;
    right: -10px;
}
.is-mobile .dp-nav-buttons-group button {
    height: 32px;
    padding: 4px 10px;
}
.is-mobile .dp-tabs > .dp-tab {
    height: 30px;
}

/* -------------------------------------------------------------
   Phone shell: the combined view on phones only (.is-phone body + .dp-phone-shell root).
   Desktop, tablets, the sidebar Daily view and code blocks never match these rules.
   ------------------------------------------------------------- */
/* Bottom navigation: last row of the view, clear of the home indicator */
.is-phone .dp-phone-shell > .dp-bottom-nav {
    flex-shrink: 0;
    gap: 2px;
    padding: 6px 8px max(6px, env(safe-area-inset-bottom, 12px));
    border: none;
    border-top: 1px solid var(--dp-glass-border);
    border-radius: 0;
    background-color: var(--dp-glass-bg);
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.08);
    z-index: 30;
}
.is-phone .dp-bottom-nav > .dp-tab {
    flex: 1 1 0;
    min-width: 0;
    height: 48px;
    padding: 0 2px;
    flex-direction: column;
    gap: 3px;
    border-radius: 10px;
    font-size: 0.68em;
}
.is-phone .dp-bottom-nav > .dp-tab.active {
    color: var(--text-accent);
}
.dp-bottom-nav-icon {
    display: inline-flex;
}
.dp-bottom-nav-icon svg {
    width: 20px;
    height: 20px;
}
.dp-bottom-nav-label {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Daily / 2-Day: 7-day date strip under the header nav */
.is-phone .dp-date-strip {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
}
.is-phone .dp-date-strip > .dp-date-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    height: 40px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 10px;
    box-shadow: none;
    background-color: var(--dp-segment-track);
    color: var(--text-muted);
    font-size: 0.72em;
    line-height: 1.1;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.is-phone .dp-date-strip > .dp-date-pill.is-today {
    color: var(--text-accent);
    font-weight: 600;
}
.is-phone .dp-date-strip > .dp-date-pill.is-shown {
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
}
.dp-date-pill-dow {
    font-size: 0.85em;
    opacity: 0.8;
}
.dp-date-pill-date {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

/* Long-press drag lifts the card instead of opening the iOS callout / text selection */
.is-phone .dp-phone-shell .dp-timeline-event {
    -webkit-touch-callout: none;
}
/* 2-Day fits the screen (the inline min-width is sized for desktop), so the pane never scrolls sideways */
.is-phone .dp-phone-shell .dp-weekly-container {
    min-width: 0 !important;
}

/* Monthly: 7 columns, compact cells, max 2 chips (+N); the whole cell is the tap target */
.is-phone .dp-monthly-compact {
    min-width: 0;
}
.is-phone .dp-monthly-compact .dp-monthly-header-grid,
.is-phone .dp-monthly-compact .dp-grid-calendar {
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
}
.is-phone .dp-monthly-compact .dp-grid-calendar {
    grid-template-rows: repeat(var(--dp-week-count, 5), minmax(64px, 1fr));
}
.is-phone .dp-monthly-compact .dp-grid-header {
    padding: 4px 0;
    font-size: 0.72em;
}
.is-phone .dp-monthly-compact .dp-grid-cell {
    padding: 3px;
    cursor: pointer;
}
.is-phone .dp-monthly-compact .dp-grid-cell-num {
    margin-bottom: 2px;
    font-size: 0.72em;
}
.is-phone .dp-monthly-compact .dp-grid-task-list {
    gap: 2px;
    padding-right: 0;
    overflow: hidden;
    pointer-events: none;
}
.is-phone .dp-monthly-compact .dp-grid-task-item {
    height: 16px !important;
    min-height: 16px !important;
    max-height: 16px !important;
    line-height: 14px !important;
    font-size: 0.6em !important;
    padding: 0 3px !important;
    margin-bottom: 0 !important;
}
.is-phone .dp-monthly-compact .dp-task-link-btn {
    display: none !important;
}
.dp-grid-more {
    font-size: 0.6em;
    line-height: 1.2;
    color: var(--text-muted);
    padding-left: 2px;
}

/* Board: one full-width column, chosen from the switcher above it */
.is-phone .dp-phone-shell .dp-board-col-switcher {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    margin-bottom: 10px;
    padding: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    overscroll-behavior-x: contain;
}
.dp-board-col-switcher::-webkit-scrollbar {
    display: none;
}
.is-phone .dp-board-col-switcher > .dp-board-col-tab {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    margin: 0;
    padding: 0 12px;
    border: 1px solid var(--dp-glass-border);
    border-radius: 16px;
    box-shadow: none;
    background-color: var(--dp-segment-track);
    color: var(--text-muted);
    font-size: 0.8em;
    white-space: nowrap;
}
.is-phone .dp-board-col-switcher > .dp-board-col-tab.active {
    background-color: var(--interactive-accent);
    border-color: transparent;
    color: var(--text-on-accent);
    font-weight: 600;
}
.dp-board-col-tab-count {
    font-size: 0.85em;
    opacity: 0.75;
}
.is-phone .dp-phone-shell .dp-kanban-column {
    min-width: 0;
    max-width: none;
    width: 100%;
}
.is-phone .dp-phone-shell .dp-kanban-col-toggle {
    display: none;
}

/* List: time stacked under the title, and nothing wider than the screen (keeps month swipes unambiguous) */
.is-phone .dp-gc-list-container,
.is-phone .dp-gc-list-scroll {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
    box-sizing: border-box;
}
.is-phone .dp-gc-list-scroll {
    padding: 10px 12px;
}
.is-phone .dp-gc-day-row {
    gap: 10px;
    min-width: 0;
}
.is-phone .dp-gc-day-sidebar {
    width: 44px;
    flex-direction: column;
    align-items: center;
    gap: 0;
}
.is-phone .dp-gc-day-meta {
    margin-top: 2px;
    font-size: 0.72em;
}
.is-phone .dp-gc-day-content {
    min-width: 0;
}
.is-phone .dp-gc-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "mark title file" "mark time file";
    column-gap: 10px;
    row-gap: 1px;
    min-width: 0;
}
.is-phone .dp-gc-item > .dp-custom-cb,
.is-phone .dp-gc-item > .dp-gc-item-dot {
    grid-area: mark;
    align-self: center;
}
.is-phone .dp-gc-item-title {
    grid-area: title;
    min-width: 0;
}
.is-phone .dp-gc-item-time {
    grid-area: time;
    width: auto;
    font-size: 0.78em;
}
.is-phone .dp-gc-item-file {
    grid-area: file;
    align-self: center;
    max-width: 88px;
    margin-left: 0;
}
`;
