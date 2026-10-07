export const STYLES = `
/* Glass design tokens (declared on theme roots so modals/menus outside .dp-container inherit them) */
/* Glass material (Apple "regular material"): neutral translucent fill + blur(16px) saturate(180%) + hairline border
   + a 1px top highlight + two-layer shadow (contact + ambient). Blur only goes on chrome that content actually passes
   behind (modals, menus, suggestions, the sticky all-day row); never on repeated cards or grid cells. Dark uses a
   graphite fill rather than a white tint: a white wash over a dark, dimmed workspace loses text contrast. */
.theme-dark {
    --dp-glass-bg: rgba(30, 30, 34, 0.62);
    --dp-glass-border: rgba(255, 255, 255, 0.10);
    --dp-glass-highlight: rgba(255, 255, 255, 0.07);
    --dp-glass-shadow: 0 1px 2px rgba(0, 0, 0, 0.24), 0 6px 20px rgba(0, 0, 0, 0.22);
    --dp-glass-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.28), 0 24px 60px rgba(0, 0, 0, 0.45);
    --dp-glass-blur: blur(16px) saturate(180%);
    --dp-segment-track: rgba(255, 255, 255, 0.05);
    --dp-segment-active: rgba(255, 255, 255, 0.12);
    --dp-card-bg: rgba(255, 255, 255, 0.06);
    --dp-card-border: rgba(255, 255, 255, 0.16);
}
.theme-light {
    --dp-glass-bg: rgba(255, 255, 255, 0.68);
    --dp-glass-border: rgba(0, 0, 0, 0.08);
    --dp-glass-highlight: rgba(255, 255, 255, 0.7);
    --dp-glass-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 20px rgba(0, 0, 0, 0.08);
    --dp-glass-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.08), 0 24px 60px rgba(0, 0, 0, 0.18);
    --dp-glass-blur: blur(16px) saturate(180%);
    --dp-segment-track: rgba(0, 0, 0, 0.05);
    --dp-segment-active: rgba(255, 255, 255, 0.95);
    --dp-card-bg: rgba(0, 0, 0, 0.03);
    --dp-card-border: rgba(0, 0, 0, 0.14);
}
/* No blur support, or the OS asks for less transparency: same surfaces, near-opaque fills, no blur */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .theme-dark { --dp-glass-bg: rgba(30, 30, 34, 0.94); }
    .theme-light { --dp-glass-bg: rgba(255, 255, 255, 0.95); }
}
@media (prefers-reduced-transparency: reduce) {
    .theme-dark { --dp-glass-bg: rgba(30, 30, 34, 0.97); --dp-glass-blur: none; }
    .theme-light { --dp-glass-bg: rgba(255, 255, 255, 0.97); --dp-glass-blur: none; }
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
    overscroll-behavior-x: none; /* horizontal swipes page the planner; they never chain to the workspace */
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
    /* No backdrop-filter: nothing ever scrolls behind the header (it is a flex row above the panes), so the blur only
       re-filtered a flat background on the GPU every frame the header repainted, e.g. through each pill slide */
    box-shadow: var(--dp-glass-shadow), inset 0 1px 0 var(--dp-glass-highlight);
}
/* One row above the tabs: [date pill] ... [🔍] [< 📅 Today >] [Sync] [+]. Wraps (actions drop below) only when a
   narrow non-compact host, e.g. a code block, cannot fit both; the compact shell forces nowrap */
.dp-header-top {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--size-4-2, 8px);
}
/* Pinned right even when it is the row's only item (or wrapped onto its own line) */
.dp-header-actions {
    display: flex;
    align-items: center;
    gap: var(--size-4-1, 4px);
    margin-left: auto;
}
/* < 📅 Today > reads as one control: tight inner gap, a little more air than its neighbours outside */
.dp-nav-buttons-group {
    display: flex;
    gap: 2px;
    margin: 0 var(--size-4-1, 4px);
}
.dp-nav-buttons-group button {
    padding: 0 var(--size-4-2, 8px);
}
/* Header date: segments are either note links (.dp-nav-date-link) or plain labels (.dp-nav-date-static) */
/* Pill button: [📅 2026-10-06 (Wk 41)]. Clickable pills (.is-clickable) open the linked note */
.dp-nav-date {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px 0 10px;
    box-sizing: border-box;
    font-size: 1em;
    font-weight: 600;
    color: var(--text-normal);
    background-color: var(--interactive-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    box-shadow: var(--input-shadow, 0 1px 2px rgba(0, 0, 0, 0.06));
    cursor: default;
    white-space: nowrap;
    user-select: none;
    transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.08s ease;
}
.dp-nav-date.is-clickable {
    cursor: pointer;
}
.dp-nav-date.is-clickable:hover {
    background-color: var(--interactive-hover);
    border-color: var(--background-modifier-border-hover);
}
.dp-nav-date.is-clickable:active {
    transform: scale(0.97);
    background-color: var(--background-modifier-active-hover, var(--interactive-hover));
    box-shadow: none;
}
.dp-nav-date-icon {
    display: inline-flex;
    color: var(--text-muted);
}
.dp-nav-date-icon svg {
    width: 14px;
    height: 14px;
}
.dp-nav-date.is-clickable:hover .dp-nav-date-icon {
    color: var(--interactive-accent);
}
.dp-nav-date-static,
.dp-nav-date-link {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
}
.dp-nav-date-main {
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
}
.dp-nav-date-sub {
    font-size: 0.85em;
    font-weight: 500;
    color: var(--text-muted);
}
.dp-nav-date-link {
    cursor: pointer;
    border-radius: var(--radius-s, 4px);
    transition: color 0.15s ease;
}
.dp-nav-date-link:hover,
.dp-nav-date-link:hover .dp-nav-date-sub {
    color: var(--text-accent);
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
    /* Raised segmented-control thumb: contact shadow + soft ambient + hairline + top highlight */
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 3px 8px rgba(0, 0, 0, 0.08),
        inset 0 0 0 1px var(--dp-glass-border), inset 0 1px 0 var(--dp-glass-highlight);
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
/* GPU-composited (threaded) scrolling at every display scale: below 150% Chromium keeps a scroller without an opaque
   background on the main thread to preserve LCD text (grayscale AA is the trade-off there), repainting every card and
   sticky row each frame. Leaf views only; code blocks scroll inside the note's own scroller. */
.day-planner-view-pane,
.day-planner-view-pane :is(.dp-content, .dp-weekly-scroll-wrapper, .dp-monthly-scroll-wrapper, .dp-grid-task-list,
    .dp-kanban-board, .dp-kanban-cards, .dp-gc-list-scroll) {
    will-change: scroll-position;
}

/* Keep-alive view panes (combined view): cached panes are hidden, never destroyed.
   The 150ms reveal is added by applyViewReveal() only when a pane becomes visible, and removed on animationend.
   Only opacity/transform are animated (compositor-only). The resting state is transform: none
   (not translateY(0)) so an idle pane never becomes a containing block / stacking context for its contents. */
.day-planner-view-pane.dp-view-reveal {
    animation: dp-pane-enter 0.15s ease-out;
}
/* Sized by the leaf, not its content: an auto basis laid the whole pane out twice per show or re-render
   (once at content height only to measure its flex base size) */
.day-planner-view-pane {
    flex-basis: 0;
}
/* content-visibility skips a hidden pane but keeps its computed style and layout, so switching back to a cached tab
   only repaints it (display: none tore both down and rebuilt the whole pane on every switch).
   Zero flex size and padding keep a hidden pane out of the visible one's space. */
.day-planner-view-pane.is-hidden {
    content-visibility: hidden;
    flex: 0 0 0;
    padding: 0;
}
/* Mobile keeps display: none (older iOS WebKit has no content-visibility). !important: view-specific pane layouts
   (e.g. ".dp-content:has(> .dp-kanban-board) { display: flex }") must never re-show a hidden pane */
.is-mobile .day-planner-view-pane.is-hidden {
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
/* Monthly cell → Daily (phone focusDay): the day zooms in from the grid */
@keyframes dayPlannerZoomIn {
    from { transform: scale(0.92); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}
.dp-zoom-in {
    animation: dayPlannerZoomIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
/* Applied to the scroll host only while sliding, and only when it has no horizontal overflow of its own */
.dp-slide-host {
    overflow-x: hidden !important;
}
/* The helpers already skip animating under reduced motion; this is the CSS-side safety net */
@media (prefers-reduced-motion: reduce) {
    .day-planner-view-pane.dp-view-reveal,
    .dp-zoom-in,
    .dp-slide-from-right,
    .dp-slide-from-left,
    .notice.dayloom-reminder-notice {
        animation: none;
    }
}

/* Reminder notice: larger and accent-framed so a start-time alert is hard to miss (shown for 12s) */
.notice.dayloom-reminder-notice {
    position: relative;
    z-index: calc(var(--layer-notice, 60) + 1);
    min-width: min(300px, calc(100vw - 32px));
    max-width: min(440px, calc(100vw - 32px));
    padding: var(--size-4-4, 16px) var(--size-4-5, 20px);
    color: var(--text-normal);
    background-color: var(--background-primary);
    border: 1px solid var(--interactive-accent);
    border-left-width: 4px;
    border-radius: var(--radius-l, 12px);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive-accent) 22%, transparent),
        var(--shadow-l, 0 8px 24px rgba(0, 0, 0, 0.25));
    animation: dayloom-reminder-in 0.25s ease-out;
}
.dayloom-reminder-title {
    font-size: var(--font-ui-large, 1.15em);
    font-weight: var(--font-semibold, 600);
    line-height: 1.35;
    font-variant-numeric: tabular-nums;
}
.dayloom-reminder-body {
    margin-top: var(--size-4-1, 4px);
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
}
@keyframes dayloom-reminder-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
    to { opacity: 1; transform: none; }
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
    /* Real glass: the hourly grid scrolls under this one sticky bar (a single element, so the blur stays cheap) */
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border-bottom: 1px solid var(--dp-glass-border);
    box-shadow: 0 6px 16px -10px rgba(0, 0, 0, 0.35); /* soft lip: lifts the bar off the grid sliding underneath */
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
    /* No opacity < 1 here: it made every card its own offscreen compositing group, re-blended on each raster */
    transition: transform 0.1s !important;
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
/* While a scroller moves (.dp-is-scrolling, set on it in views.ts): cards sliding under a stationary cursor would flip
   :hover every few frames (transform + z-index restack + repaint). Hit-testing resumes 150ms after the scroll settles.
   No transitions meanwhile: the card hovered when the scroll starts snaps back instead of animating its transform,
   which promoted it to its own GPU layer (splitting the scrolling layer) right as the scroll began. */
@media (hover: hover) {
    .dp-is-scrolling .dp-timeline-event,
    .dp-is-scrolling .dp-grid-task-item,
    .dp-is-scrolling .dp-kanban-card,
    .dp-is-scrolling .dp-grid-week-cell {
        pointer-events: none;
        transition: none !important;
    }
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
    box-shadow: 0 0 0 1px var(--background-primary), 0 1px 3px rgba(0, 0, 0, 0.35) !important; /* small blur: cheap to raster as tiles scroll in */
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
    box-shadow: 0 0 0 1px var(--background-primary), 0 1px 3px rgba(0, 0, 0, 0.08) !important;
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

/* Weekend accents (weekendCls in views.ts): soft red Sunday, soft blue Saturday on headers, columns, cells and pills.
   Built on the theme's own red/blue so they follow light/dark and custom themes; today's accent always wins. */
.dp-container {
    --dp-sun-rgb: var(--color-red-rgb, 233, 49, 71);
    --dp-sat-rgb: var(--color-blue-rgb, 8, 109, 221);
}
.dp-grid-header.is-sunday:not(.today),
.dp-grid-cell.is-sunday .dp-grid-cell-num {
    color: rgba(var(--dp-sun-rgb), 0.85);
}
.dp-grid-header.is-saturday:not(.today),
.dp-grid-cell.is-saturday .dp-grid-cell-num {
    color: rgba(var(--dp-sat-rgb), 0.85);
}
.dp-grid-header.is-sunday,
.dp-grid-cell.is-sunday,
.dp-allday-cell.is-sunday {
    background-image: linear-gradient(rgba(var(--dp-sun-rgb), 0.06), rgba(var(--dp-sun-rgb), 0.06));
}
.dp-grid-header.is-saturday,
.dp-grid-cell.is-saturday,
.dp-allday-cell.is-saturday {
    background-image: linear-gradient(rgba(var(--dp-sat-rgb), 0.06), rgba(var(--dp-sat-rgb), 0.06));
}
.dp-weekly-day-col.is-sunday:not(.today) {
    background-color: rgba(var(--dp-sun-rgb), 0.035);
}
.dp-weekly-day-col.is-saturday:not(.today) {
    background-color: rgba(var(--dp-sat-rgb), 0.035);
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

/* Settings → Excluded files & folders: one input (vault suggestions) + rule chips, like Obsidian's search filters */
.dp-settings .dp-path-filter-setting {
    border-bottom: none;
    padding-bottom: 0;
}
.dp-path-filter {
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2, 8px);
    margin: var(--size-4-2, 8px) 0 var(--size-4-4, 16px);
}
.dp-path-filter-input-row {
    display: flex;
    align-items: center;
    gap: var(--size-4-2, 8px);
}
.dp-path-filter-mode {
    display: inline-flex;
    flex-shrink: 0;
    padding: 2px;
    background-color: var(--background-modifier-hover);
    border-radius: var(--radius-m, 8px);
}
.dp-settings button.dp-path-filter-mode-btn {
    height: 26px;
    padding: 0 10px;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
    background: transparent;
    border: none;
    box-shadow: none;
    border-radius: var(--radius-s, 6px);
}
.dp-settings button.dp-path-filter-mode-btn.is-active {
    color: var(--text-normal);
    background-color: var(--background-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.dp-settings input.dp-path-filter-input {
    flex: 1;
    min-width: 0;
    height: 32px;
}
.dp-path-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.dp-path-chips-empty,
.dp-path-filter-summary {
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-muted);
}
.dp-path-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    height: 26px;
    padding: 0 4px 0 4px;
    box-sizing: border-box;
    font-size: var(--font-ui-small, 0.9em);
    background-color: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    cursor: pointer;
    transition: border-color 0.15s ease, background-color 0.15s ease;
}
.dp-path-chip:hover {
    border-color: var(--interactive-accent);
}
.dp-path-chip-mode {
    flex-shrink: 0;
    padding: 0 6px;
    font-size: 0.8em;
    font-weight: var(--font-semibold, 600);
    line-height: 18px;
    color: var(--text-error);
    background-color: color-mix(in srgb, var(--text-error) 12%, transparent);
    border-radius: 999px;
}
.dp-path-chip.is-keep .dp-path-chip-mode {
    color: var(--text-success, var(--color-green));
    background-color: color-mix(in srgb, var(--color-green, #3eb370) 14%, transparent);
}
.dp-path-chip-icon {
    display: inline-flex;
    color: var(--text-muted);
}
.dp-path-chip-icon svg {
    width: 14px;
    height: 14px;
}
.dp-path-chip-label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.dp-path-chip.is-missing .dp-path-chip-label {
    color: var(--text-faint);
    text-decoration: line-through dotted;
}
.dp-settings button.dp-path-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: none;
    box-shadow: none;
    border-radius: 999px;
}
.dp-settings button.dp-path-chip-remove:hover {
    color: var(--text-error);
    background-color: var(--background-modifier-error-hover, var(--background-modifier-hover));
}
.dp-path-chip-remove svg {
    width: 12px;
    height: 12px;
}

/* Vault path suggestions (utils.attachPathSuggest): icon + fuzzy-highlighted path */
.dp-path-suggestion {
    display: flex;
    align-items: center;
    gap: 6px;
}
.dp-path-suggestion-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--text-muted);
}
.dp-path-suggestion-icon svg {
    width: 14px;
    height: 14px;
}
.dp-path-suggestion-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Settings: native sizing */
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
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--dp-glass-border);
    border-radius: 8px;
    box-shadow: var(--dp-glass-shadow), inset 0 1px 0 var(--dp-glass-highlight);
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
/* Slider + value; row-reverse keeps the original order (value · slider · 🔍) */
.dp-zoom-popover {
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
    flex-shrink: 0;
}
/* Hover expansion only where hover exists: touch browsers emulate a sticky :hover that would never close */
@media (hover: hover) {
    .dp-zoom-slider-floating:hover {
        width: 185px;
        background-color: var(--background-modifier-hover);
    }
    .dp-zoom-slider-floating:hover .dp-zoom-slider,
    .dp-zoom-slider-floating:hover .dp-zoom-value {
        opacity: 1;
    }
}
/* Tap toggle (.is-open) and keyboard focus expand it on every device */
.dp-zoom-slider-floating.is-open,
.dp-zoom-slider-floating:focus-within {
    width: 185px;
    background-color: var(--background-modifier-hover);
}
.dp-zoom-slider-floating.is-open .dp-zoom-slider,
.dp-zoom-slider-floating:focus-within .dp-zoom-slider,
.dp-zoom-slider-floating.is-open .dp-zoom-value,
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

/* Notes (Reading View / Live Preview): Dataview renders [gcalId:: ...] as a "gcalId: <id>" badge; hide it too.
   body.dp-hide-gcal-id follows the "Hide Inline Metadata Fields" setting. */
body.dp-hide-gcal-id .dataview.inline-field:has(> .inline-field-key[data-dv-norm-key="gcalid"]),
body.dp-hide-gcal-id .dataview.inline-field:has(> .inline-field-key[data-dv-key="gcalId"]) {
    display: none;
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
/* Inline (code block) filters, Obsidian-style: one wrapping bar of chips + a single editor row while a chip is edited.
   No backdrop-filter here: it would become a backdrop root and stop nested popovers from blurring. */
.dp-filter-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
    padding: 6px 8px;
    border: 1px solid var(--dp-glass-border);
    border-radius: var(--radius-m, 8px);
    background-color: var(--dp-glass-bg);
    box-shadow: var(--dp-glass-shadow);
    animation: slideDown 0.2s ease-out;
}
.dp-filter-bar,
.dp-filter-chip-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
}
/* A nested group: its chips in brackets, inline with the rest of the bar */
.dp-filter-chip-group {
    padding: 1px 4px;
    border: 1px dashed var(--background-modifier-border-hover);
    border-radius: 999px;
}
.dp-filter-chip-group::before {
    content: '(';
    color: var(--text-faint);
}
.dp-filter-chip-group::after {
    content: ')';
    color: var(--text-faint);
}
.dp-filter-panel select.dp-filter-mode {
    height: 24px;
    padding: 0 22px 0 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-semibold, 600);
}
.dp-filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 100%;
    height: 24px;
    padding: 0 3px 0 8px;
    box-sizing: border-box;
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-normal);
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    cursor: pointer;
    transition: border-color 0.15s ease, background-color 0.15s ease;
}
.dp-filter-chip:hover,
.dp-filter-chip:focus-visible {
    border-color: var(--interactive-accent);
}
.dp-filter-chip.is-editing {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    border-color: var(--interactive-accent);
}
.dp-filter-chip-icon {
    display: inline-flex;
    color: var(--text-muted);
}
.dp-filter-chip.is-editing .dp-filter-chip-icon {
    color: inherit;
}
.dp-filter-chip-icon svg {
    width: 12px;
    height: 12px;
}
.dp-filter-chip-label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.dp-filter-panel button.dp-filter-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    color: inherit;
    background: transparent;
    border: none;
    box-shadow: none;
    border-radius: 999px;
    opacity: 0.6;
}
.dp-filter-panel button.dp-filter-chip-remove:hover {
    opacity: 1;
    background-color: var(--background-modifier-hover);
}
.dp-filter-chip-remove svg {
    width: 11px;
    height: 11px;
}
.dp-filter-panel button.dp-filter-add {
    height: 24px;
    padding: 0 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-medium, 500);
    color: var(--text-accent);
    background: transparent;
    border: 1px dashed var(--background-modifier-border-hover);
    box-shadow: none;
    border-radius: 999px;
}
.dp-filter-panel button.dp-filter-add:hover {
    border-color: var(--interactive-accent);
    background-color: var(--background-modifier-hover);
}
.dp-filter-empty {
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-faint);
}
.dp-filter-editor {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-top: 6px;
    border-top: 1px solid var(--background-modifier-border);
}
.dp-filter-editor select,
.dp-filter-editor input {
    height: 26px;
    font-size: var(--font-ui-smaller, 0.8em);
}
.dp-filter-editor-value {
    display: flex;
    flex: 1 1 140px;
    gap: 6px;
    min-width: 0;
}
.dp-filter-editor-value input[type="text"] {
    flex: 1;
    min-width: 0;
}
.dp-filter-editor .dp-hidden {
    display: none;
}
.dp-filter-panel button.dp-filter-editor-done {
    height: 26px;
    padding: 0 10px;
    font-size: var(--font-ui-smaller, 0.8em);
}
@keyframes slideDown {
    from { opacity: 0; transform: translateY(-5px); }
    to { opacity: 1; transform: translateY(0); }
}

/* -------------------------------------------------------------
   Frosted modals & quick-add menus (scoped to this plugin's UI only)
   ------------------------------------------------------------- */
.modal:has(.dp-modal-buttons, .dp-selector-modal-tabs),
.modal.dp-shortcut-modal,
.menu.dp-glass-menu {
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--dp-glass-border);
    box-shadow: var(--dp-glass-shadow-lg), inset 0 1px 0 var(--dp-glass-highlight);
}
.modal:has(.dp-modal-buttons, .dp-selector-modal-tabs),
.modal.dp-shortcut-modal {
    border-radius: 12px;
}
/* Lighter dimming so the frost actually picks up the workspace behind it */
.modal-container:has(.dp-modal-buttons, .dp-selector-modal-tabs, .dp-shortcut-modal) > .modal-bg {
    opacity: 0.45;
}

/* Keyboard shortcut help (?) */
.modal.dp-shortcut-modal {
    width: min(460px, calc(100vw - 32px));
}
.dp-shortcut-section + .dp-shortcut-section {
    margin-top: var(--size-4-4, 16px);
}
.dp-shortcut-section-title {
    margin-bottom: var(--size-4-1, 4px);
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
}
.dp-shortcut-row {
    display: flex;
    align-items: center;
    gap: var(--size-4-3, 12px);
    padding: var(--size-4-1, 4px) 0;
    border-bottom: 1px solid var(--dp-glass-border);
}
.dp-shortcut-row:last-child {
    border-bottom: none;
}
.dp-shortcut-keys {
    display: flex;
    gap: var(--size-4-1, 4px);
    min-width: 64px;
}
.dp-kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 6px;
    box-sizing: border-box;
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-normal);
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-bottom-width: 2px;
    border-radius: var(--radius-s, 4px);
}
.dp-shortcut-desc {
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-normal);
}
/* Footer: the "hide the header button" option, on the modal's frosted surface behind a hairline */
.dp-shortcut-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-1, 4px) var(--size-4-3, 12px);
    margin: var(--size-4-4, 16px) calc(-1 * var(--size-4-2, 8px)) 0;
    padding: var(--size-4-2, 8px) var(--size-4-3, 12px);
    background-color: color-mix(in srgb, var(--background-primary) 35%, transparent);
    border: 1px solid var(--dp-glass-border);
    border-radius: var(--radius-m, 8px);
    box-shadow: inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-shortcut-footer-option {
    display: inline-flex;
    align-items: center;
    gap: var(--size-4-2, 8px);
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-normal);
    cursor: pointer;
    user-select: none;
}
.dp-shortcut-footer-option input[type="checkbox"] {
    margin: 0;
    accent-color: var(--interactive-accent);
    cursor: pointer;
}
.dp-shortcut-footer-hint {
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-faint);
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
    .dp-nav-date {
        font-size: 0.92em;
        padding: 0 10px 0 8px;
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
.is-mobile .dp-tabs > .dp-tab {
    height: 30px;
}

/* -------------------------------------------------------------
   Compact shell (.dp-compact-shell root): the combined view on phones and the Sidebar Day Planner Pro view.
   .dp-phone-shell is added on phones only; desktop/tablet tabs and code blocks never match these rules.
   ------------------------------------------------------------- */
/* Bottom navigation: floating pill lifted above Obsidian's own mobile toolbar (which overlays the view's bottom edge) */
.dp-container.dp-compact-shell > .dp-bottom-nav {
    flex-shrink: 0;
    width: auto; /* .dp-tabs is 100% wide; auto lets the side margins inset the pill */
    gap: 2px;
    margin: 0 12px 0;
    padding: 3px;
    border: 1px solid var(--dp-glass-border);
    border-radius: 12px;
    background-color: var(--dp-glass-bg);
    box-shadow: var(--dp-glass-shadow), inset 0 1px 0 var(--dp-glass-highlight); /* no blur: nothing scrolls behind this row */
    z-index: 30;
}
.is-phone .dp-phone-shell > .dp-bottom-nav {
    margin-bottom: calc(var(--mobile-navbar-height, 48px) + env(safe-area-inset-bottom, 6px));
}
.dp-compact-shell .dp-bottom-nav > .dp-tab {
    flex: 1 1 0;
    min-width: 0;
    height: auto;
    padding: 4px 8px;
    flex-direction: column;
    gap: 2px;
    border-radius: 9px;
    font-size: 11px;
}
.dp-compact-shell .dp-bottom-nav > .dp-tab.active {
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

/* Compact header controls are icon-only: labels hidden, action buttons square (Today, Sync, +) */
.dp-compact-shell .dp-header-actions .dp-btn-label {
    display: none;
}
.dp-compact-shell .dp-header-actions > button {
    flex-shrink: 0;
    width: 30px;
    min-width: 30px;
    height: 30px;
    margin: 0;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    font-size: 0.95em;
    line-height: 1;
}
/* The zoom control is the desktop one (tap toggles .is-open, which expands it inline to the left); collapsed it is
   the same 30px square as its neighbours, and open it still fits a phone-width actions row */
.dp-compact-shell .dp-header-actions > .dp-zoom-slider-floating {
    height: 30px;
    width: 30px;
    margin: 0;
}
.dp-compact-shell .dp-header-actions > .dp-zoom-slider-floating.is-open {
    width: 176px;
}
.dp-compact-shell .dp-zoom-slider-floating span:first-child {
    width: 28px;
    height: 28px;
}
.dp-compact-shell .dp-board-toggle {
    height: 30px;
}
.dp-compact-shell .dp-board-toggle > .dp-board-toggle-btn {
    width: 30px;
    height: 24px;
    padding: 0;
    font-size: 0.95em;
}

/* Single header row (phone views, compact Board): [date pill] ... [🔍] [📅] [Sync] [+]; never wraps: the actions
   never shrink, the date pill gives way (clipped) on the narrowest screens */
.dp-compact-shell .dp-header-top {
    flex-wrap: nowrap;
    justify-content: space-between;
    align-items: center;
    gap: var(--size-4-2, 8px);
}
.dp-compact-shell .dp-header-top > .dp-nav-date.dp-header-date-compact {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    padding: 0 var(--size-4-3, 12px) 0 var(--size-4-2, 8px);
    font-size: var(--font-ui-small, 0.9em);
}
.dp-compact-shell .dp-header-top > .dp-header-actions {
    flex-shrink: 0;
}
/* Daily / 2-Day: 7-day date strip under the header nav */
.dp-compact-shell .dp-date-strip {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 4px;
}
.dp-compact-shell .dp-date-strip > .dp-date-pill {
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
.dp-compact-shell .dp-date-strip > .dp-date-pill.is-today {
    color: var(--text-accent);
    font-weight: 600;
}
.dp-compact-shell .dp-date-strip > .dp-date-pill.is-shown {
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
}
/* Date strip weekends: tinted pill and coloured weekday; the shown day(s) keep the solid accent fill */
.dp-compact-shell .dp-date-strip > .dp-date-pill.is-sunday:not(.is-shown) {
    background-color: rgba(var(--dp-sun-rgb), 0.1);
}
.dp-compact-shell .dp-date-strip > .dp-date-pill.is-saturday:not(.is-shown) {
    background-color: rgba(var(--dp-sat-rgb), 0.1);
}
.dp-compact-shell .dp-date-strip > .dp-date-pill.is-sunday:not(.is-shown):not(.is-today) {
    color: rgba(var(--dp-sun-rgb), 0.9);
}
.dp-compact-shell .dp-date-strip > .dp-date-pill.is-saturday:not(.is-shown):not(.is-today) {
    color: rgba(var(--dp-sat-rgb), 0.9);
}
.dp-date-pill-dow {
    font-size: 0.85em;
    opacity: 0.8;
    white-space: nowrap; /* 3-letter labels (Sun, Wed) stay on one line in ~45px phone pills */
    letter-spacing: -0.01em;
}
.dp-date-pill-date {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

/* Long-press drag lifts the card instead of opening the iOS callout / text selection */
.dp-container.dp-compact-shell .dp-timeline-event {
    -webkit-touch-callout: none;
}
/* 2-Day fits the screen (the inline min-width is sized for desktop), so the pane never scrolls sideways */
.dp-container.dp-compact-shell .dp-weekly-container {
    min-width: 0 !important;
}
/* 2-Day: the date strip above already marks both days, so the column date row is redundant */
.dp-container.dp-compact-shell .dp-weekly-header-grid {
    display: none;
}

/* Monthly: 7 columns, compact cells, as many chips as fit (+N), no inner scrolling; the whole cell is the tap target */
.dp-compact-shell .dp-monthly-compact {
    min-width: 0;
}
.dp-compact-shell .dp-monthly-compact .dp-monthly-header-grid,
.dp-compact-shell .dp-monthly-compact .dp-grid-calendar {
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 3px;
}
.dp-compact-shell .dp-monthly-compact .dp-grid-calendar {
    grid-template-rows: repeat(var(--dp-week-count, 5), minmax(64px, 1fr));
}
.dp-compact-shell .dp-monthly-compact .dp-grid-header {
    padding: 4px 0;
    font-size: 0.72em;
}
.dp-compact-shell .dp-monthly-compact .dp-grid-cell {
    padding: 3px;
    cursor: pointer;
}
.dp-compact-shell .dp-monthly-compact .dp-grid-cell-num {
    margin-bottom: 2px;
    font-size: 0.72em;
}
.dp-compact-shell .dp-monthly-compact .dp-grid-task-list {
    gap: 2px;
    padding-right: 0;
    overflow: hidden;
    pointer-events: none;
}
.dp-compact-shell .dp-monthly-compact .dp-grid-task-item {
    height: 16px !important;
    min-height: 16px !important;
    max-height: 16px !important;
    line-height: 14px !important;
    font-size: 0.6em !important;
    padding: 0 3px !important;
    margin-bottom: 0 !important;
}
.dp-compact-shell .dp-monthly-compact .dp-grid-task-item.dp-chip-overflow {
    display: none !important; /* past the cell's height (fitMonthlyChips); counted in the +N badge instead */
}
.dp-compact-shell .dp-monthly-compact .dp-task-link-btn {
    display: none !important;
}
.dp-grid-more {
    font-size: 0.6em;
    line-height: 1.2;
    color: var(--text-muted);
    padding-left: 2px;
}

/* Board: one full-width column, chosen from the switcher above it */
.dp-container.dp-compact-shell .dp-board-col-switcher {
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
.dp-compact-shell .dp-board-col-switcher > .dp-board-col-tab {
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
.dp-compact-shell .dp-board-col-switcher > .dp-board-col-tab.active {
    background-color: var(--interactive-accent);
    border-color: transparent;
    color: var(--text-on-accent);
    font-weight: 600;
}
.dp-board-col-tab-count {
    font-size: 0.85em;
    opacity: 0.75;
}
.dp-container.dp-compact-shell .dp-kanban-column {
    min-width: 0;
    max-width: none;
    width: 100%;
}
.dp-container.dp-compact-shell .dp-kanban-col-toggle {
    display: none;
}

/* List: time stacked under the title, and nothing wider than the screen (keeps month swipes unambiguous) */
:is(.is-phone, .dp-compact-shell) .dp-gc-list-container,
:is(.is-phone, .dp-compact-shell) .dp-gc-list-scroll {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
    box-sizing: border-box;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-list-scroll {
    padding: 10px 12px;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-day-row {
    gap: 10px;
    min-width: 0;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-day-sidebar {
    width: 44px;
    flex-direction: column;
    align-items: center;
    gap: 0;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-day-meta {
    margin-top: 2px;
    font-size: 0.72em;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-day-content {
    min-width: 0;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas: "mark title file" "mark time file";
    column-gap: 10px;
    row-gap: 1px;
    min-width: 0;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item > .dp-custom-cb,
:is(.is-phone, .dp-compact-shell) .dp-gc-item > .dp-gc-item-dot {
    grid-area: mark;
    align-self: center;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item-title {
    grid-area: title;
    min-width: 0;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item-time {
    grid-area: time;
    width: auto;
    font-size: 0.78em;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item-file {
    grid-area: file;
    align-self: center;
    max-width: 88px;
    margin-left: 0;
}

/* -------------------------------------------------------------
   Desktop side drawer (drawer.ts): hangs under the header on the right; the panes and the tracker bar make room
   with a right margin. Sliding is transform-only; the panes reflow once per toggle (no animated layout).
   No blur: nothing scrolls behind it, so it gets a solid secondary surface.
   ------------------------------------------------------------- */
.dp-container {
    --dp-drawer-w: 272px;
}
.dp-container.dp-drawer-open > .day-planner-view-pane {
    margin-right: var(--dp-drawer-w);
}
.dp-container.dp-drawer-open > .dp-current-task-bar {
    margin-right: calc(var(--dp-drawer-w) + 12px);
}
.dp-side-drawer {
    position: absolute;
    top: var(--dp-header-h, 0px);
    right: 0;
    bottom: 0;
    z-index: 26; /* under the header (30) and its shadow */
    width: var(--dp-drawer-w);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    background-color: var(--background-secondary);
    border-left: 1px solid var(--background-modifier-border);
    transform: translateX(100%);
    visibility: hidden;
    transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 0.22s;
}
.dp-side-drawer.is-open {
    transform: none;
    visibility: visible;
    transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s;
}
.dp-drawer-header {
    display: flex;
    align-items: center;
    gap: var(--size-4-2, 8px);
    padding: var(--size-4-2, 8px) var(--size-4-2, 8px) var(--size-4-2, 8px) var(--size-4-3, 12px);
    border-bottom: 1px solid var(--background-modifier-border);
}
.dp-drawer-tabs {
    display: flex;
    gap: 2px;
}
.dp-drawer-tab.is-active {
    color: var(--text-accent);
    background-color: var(--background-modifier-hover);
}
.dp-drawer-title {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
    white-space: nowrap;
}
.dp-drawer-title-icon {
    display: inline-flex;
    color: var(--text-muted);
}
.dp-drawer-title-icon svg {
    width: 15px;
    height: 15px;
}
.dp-drawer-count {
    padding: 0 6px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-medium, 500);
    line-height: 18px;
    color: var(--text-muted);
    background-color: var(--background-modifier-hover);
    border-radius: 999px;
}
.dp-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--size-4-2, 8px);
}
/* The body stacks capture → Overdue → Undated; Undated grows into all remaining height, so its unschedule drop zone
   (and highlight) reaches the drawer's bottom edge. Longer lists simply scroll the body. */
.dp-drawer-body {
    display: flex;
    flex-direction: column;
}
.dp-drawer-body > * {
    flex-shrink: 0;
}
.dp-drawer-section[data-section="undated"] {
    flex: 1 0 auto;
}
.dp-drawer-empty {
    margin: 2px 4px var(--size-4-2, 8px);
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-faint);
}
.dp-drawer-empty {
    margin-top: var(--size-4-4, 16px);
    text-align: center;
}
.dp-drawer-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.dp-drawer-card {
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    margin: 0;
    padding: 7px 8px;
    font-size: var(--font-ui-small, 0.9em);
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 8px);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
    cursor: grab;
    transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.dp-drawer-card:hover {
    border-color: var(--interactive-accent);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}
.dp-drawer-card.is-dragging,
.dp-grid-task-item.is-dragging {
    opacity: 0.4 !important; /* monthly items carry an inline opacity for done / cancelled */
}
/* Unschedule drop zone: the Undated section (the whole drawer only if that section is missing) */
/* The outline is drawn on a layer ABOVE the cards: an inset box-shadow paints beneath child elements, so cards
   running edge to edge covered it and seemed to push through the drop zone's border */
.dp-drawer-section {
    position: relative; /* the drawer itself is already absolutely positioned */
}
.dp-side-drawer.dp-drop-target::after,
.dp-drawer-section.dp-drop-target::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    border: 2px dashed var(--interactive-accent);
    border-radius: inherit;
    pointer-events: none;
}
.dp-side-drawer.dp-drop-target .dp-drawer-body,
.dp-drawer-section.dp-drop-target {
    background-color: color-mix(in srgb, var(--interactive-accent) 8%, transparent);
}

/* Accordion sections (Overdue / Undated): header = chevron, title, count pill; the body folds via grid rows */
.dp-drawer-section {
    border-radius: var(--radius-m, 8px);
}
.dp-drawer-section + .dp-drawer-section {
    margin-top: var(--size-4-2, 8px);
}
.dp-drawer-section-header {
    display: flex;
    align-items: center;
    gap: 4px;
}
.dp-side-drawer button.dp-drawer-section-action {
    flex-shrink: 0;
    height: 22px;
    padding: 0 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-medium, 500);
    color: var(--text-accent);
    background-color: transparent;
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    box-shadow: none;
    cursor: pointer;
}
.dp-side-drawer button.dp-drawer-section-action:hover {
    background-color: var(--background-modifier-hover);
    border-color: var(--interactive-accent);
}
.dp-side-drawer button.dp-drawer-section-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    width: 100%;
    height: auto;
    padding: 6px 4px;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
    color: var(--text-normal);
    background: none;
    border: none;
    box-shadow: none;
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
}
.dp-side-drawer button.dp-drawer-section-toggle:hover {
    background-color: var(--background-modifier-hover);
}
.dp-drawer-chevron {
    width: 12px;
    color: var(--text-muted);
    transition: transform 0.2s ease;
}
.dp-drawer-section.is-collapsed .dp-drawer-chevron {
    transform: rotate(-90deg); /* ▾ → ▸ */
}
.dp-drawer-section-title {
    flex: 1;
    min-width: 0;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dp-drawer-section-body {
    display: grid;
    grid-template-rows: 1fr;
    transition: grid-template-rows 0.22s ease;
}
.dp-drawer-section.is-collapsed > .dp-drawer-section-body {
    grid-template-rows: 0fr;
}
.dp-drawer-section-inner {
    min-height: 0;
    overflow: hidden;
    padding: 2px 6px 6px; /* side inset: cards sit inside the drop zone's 2px outline, never on it */
}
.dp-drawer-section.is-collapsed .dp-drawer-section-inner {
    visibility: hidden; /* folded cards leave the tab order */
    transition: visibility 0s linear 0.22s;
}
.dp-drawer-section .dp-drawer-empty {
    margin: 4px 4px 6px;
}
/* Quick capture line at the top of the Tasks panel */
.dp-side-drawer input.dp-drawer-capture {
    width: 100%;
    height: 30px;
    margin-bottom: var(--size-4-2, 8px);
    padding: 0 10px;
    box-sizing: border-box;
    font-size: var(--font-ui-small, 0.9em);
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 8px);
}
.dp-side-drawer input.dp-drawer-capture:focus {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--interactive-accent) 25%, transparent);
}

/* Keyboard focus on a drawer card (Enter edits, f fits it in) */
.dp-drawer-card {
    position: relative;
}
.dp-drawer-card:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 1px;
}

/* Overdue triage: a pill row fades in over the card's right side on hover / keyboard focus */
.dp-drawer-card-actions {
    position: absolute;
    top: 50%;
    right: 4px;
    display: flex;
    gap: 3px;
    padding: 2px 2px 2px 14px;
    transform: translateY(-50%);
    background: linear-gradient(to right, transparent, var(--background-primary) 12px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
}
.dp-drawer-card:hover .dp-drawer-card-actions,
.dp-drawer-card:focus-within .dp-drawer-card-actions {
    opacity: 1;
    pointer-events: auto;
}
.dp-side-drawer button.dp-drawer-card-action {
    height: 20px;
    padding: 0 6px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-medium, 500);
    color: var(--text-normal);
    background-color: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: 999px;
    box-shadow: none;
    cursor: pointer;
}
.dp-side-drawer button.dp-drawer-card-action:hover {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    border-color: var(--interactive-accent);
}

/* Inline task creation (double-click an empty slot): an editable card at the snapped slot */
.dp-timeline-event.dp-inline-create {
    z-index: 60 !important;
    gap: 2px;
    padding: 4px 6px !important;
    cursor: text !important;
    border-style: dashed !important;
    border-color: var(--interactive-accent) !important;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18) !important;
}
.dp-timeline-event.dp-inline-create:hover {
    transform: none !important;
}
.dp-inline-create-time {
    font-size: 0.85em;
    font-weight: var(--font-bold, 700);
    font-variant-numeric: tabular-nums;
    color: var(--interactive-accent);
}
.dp-timeline-event input.dp-inline-create-input {
    width: 100%;
    min-width: 0;
    height: auto;
    padding: 0;
    font: inherit;
    font-weight: var(--font-semibold, 600);
    color: inherit;
    background: transparent;
    border: none;
    box-shadow: none;
}

/* "Fit it in" drop target: a Weekly / N-day day header */
.dp-grid-header.dp-drop-target {
    outline: 2px dashed var(--interactive-accent);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
}
.dp-drawer-card-date {
    flex-shrink: 0;
    font-size: var(--font-ui-smaller, 0.8em);
    font-variant-numeric: tabular-nums;
    color: var(--text-error);
}
.dp-drawer-card .dp-custom-cb {
    flex-shrink: 0;
}
.dp-drawer-card-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-height: 1.35;
    word-break: break-word;
}
.dp-drawer-card .dp-badge-priority {
    flex-shrink: 0;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
}
/* Subtle until hovered: it is a reference, not an action */
.dp-header-actions > button.dp-help-btn {
    color: var(--text-muted);
}
.dp-header-actions > button.dp-help-btn:hover {
    color: var(--text-normal);
}
.dp-header-actions > button.dp-drawer-toggle.is-active {
    color: var(--text-accent);
    background-color: var(--background-modifier-hover);
}

/* Desktop pointer drag (views.ts beginPointerDrag): floating title chip, drop-target day cell, grabbing cursor */
.dp-drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--layer-dragged-item, 1000);
    max-width: 220px; /* narrowed further in views.ts to fit the drawer / view it is over */
    box-sizing: border-box;
    padding: 4px 10px;
    overflow: hidden;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-normal);
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--interactive-accent);
    border-radius: 999px;
    box-shadow: var(--dp-glass-shadow);
    pointer-events: none;
}
/* Snap preview container: always exactly the hovered column's width (width = 100% of the column it is appended to,
   i.e. its clientWidth), never wider. Height comes from the absolutely positioned card inside, so no overflow clip. */
.dp-drag-preview {
    position: absolute;
    left: 0;
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    z-index: 1000;
    opacity: 0.85;
    pointer-events: none;
}
/* 1:1 clone: the preview copies the card's classes, .selected included, whose scale(0.97) (around the centre) drew
   the preview 3% short and 1.5% of its height lower than the slot it snaps to. The clone stays unscaled. */
.dp-drag-preview > .dp-timeline-event {
    transform: none !important;
    transition: none !important;
}
.dp-drag-ghost.is-over-timeline {
    display: none;
}
.dp-drag-time {
    flex-shrink: 0;
    font-size: 0.8em;
    font-weight: var(--font-bold, 700);
    font-variant-numeric: tabular-nums;
    color: var(--interactive-accent);
}
.dp-grid-cell.dp-drop-target {
    outline: 2px dashed var(--interactive-accent);
    outline-offset: -2px;
    background-color: color-mix(in srgb, var(--interactive-accent) 10%, transparent);
}
body.dp-pointer-dragging,
body.dp-pointer-dragging * {
    cursor: grabbing !important;
}

/* Settings tab: top tab bar (DayPlannerSettingTab.createSettingsTabs); only the active panel is shown */
.dp-settings .dp-settings-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-bottom: var(--size-4-4, 16px);
    padding: 3px;
    background-color: var(--background-modifier-hover);
    border-radius: var(--radius-m, 8px);
}
.dp-settings button.dp-settings-tab {
    flex: 1 1 auto;
    height: 30px;
    padding: 0 12px;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-medium, 500);
    color: var(--text-muted);
    white-space: nowrap;
    background: transparent;
    border: none;
    box-shadow: none;
    border-radius: var(--radius-s, 6px);
    transition: color 0.15s ease, background-color 0.15s ease;
}
.dp-settings button.dp-settings-tab:hover {
    color: var(--text-normal);
}
.dp-settings button.dp-settings-tab.is-active {
    color: var(--text-normal);
    font-weight: var(--font-semibold, 600);
    background-color: var(--background-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}
.dp-settings .dp-settings-panel {
    display: none;
}
.dp-settings .dp-settings-panel.is-active {
    display: block;
    animation: dp-settings-panel-in 0.15s ease-out;
}
@keyframes dp-settings-panel-in {
    from { opacity: 0; transform: translateY(3px); }
    to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
    .dp-settings .dp-settings-panel.is-active {
        animation: none;
    }
}

/* Progressive disclosure: once a timeline card's content box drops under ~85px (a card ~105px wide), location,
   description, the open-note arrow and the priority badge go; the title stays as one bold, ellipsized line.
   Each card is its own size container, so overlapping (side-by-side) events collapse as well as narrow columns. */
.dp-timeline-event {
    container: dp-card / inline-size;
}
@container dp-card (max-width: 85px) {
    .dp-event-meta,
    .dp-event-main .dp-task-link-btn,
    .dp-event-main .dp-badge-priority {
        display: none !important;
    }
    .dp-event-main {
        display: flex;
        align-items: flex-start;
        min-width: 0;
    }
    /* Up to three wrapped lines before the ellipsis (a single line hid most of a title in an 84px day column) */
    .dp-event-title,
    .dp-event-main .dp-task-text {
        min-width: 0;
        overflow: hidden;
        white-space: normal;
        word-break: break-word;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        font-weight: var(--font-bold, 700);
        line-height: 1.25;
    }
    .dp-event-main .dp-task-text {
        flex: 1;
    }
}

/* Done / cancelled tasks are locked (views.ts isLockedTask): no grab hand, a click still opens the editor */
.dp-timeline-event.completed,
.dp-timeline-event.cancelled {
    cursor: pointer !important;
}
`;
