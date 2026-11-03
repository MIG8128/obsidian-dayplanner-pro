import { MOTION } from './types';

export const STYLES = `
/* Motion standard (types.ts MOTION): grow out of what was pressed with a slight overshoot, go back into it faster */
body {
    --dp-motion-in: ${MOTION.inMs}ms;
    --dp-motion-out: ${MOTION.outMs}ms;
    --dp-ease-spring: ${MOTION.spring};
    --dp-ease-exit: ${MOTION.exit};
    --dp-ease-settle: ${MOTION.settle};
}
/* Glass design tokens (declared on theme roots so modals/menus outside .dp-container inherit them, and again on the
   planner so they follow its own --background-primary, which a sidebar leaf changes to the sidebar's colour) */
/* Glass material (Apple "regular material"): translucent fill + blur(16px) saturate(180%) + hairline border
   + a 1px top highlight + two-layer shadow (contact + ambient). Blur only goes on chrome that content actually passes
   behind (modals, menus, suggestions, the sticky all-day row); never on repeated cards or grid cells. The fill is the
   theme's own background (--background-primary) made translucent, so the glass takes on any community theme
   (Catppuccin Mocha, Nord, ...) instead of a fixed white / graphite; dark keeps it dark rather than a white wash. */
.theme-dark, .theme-dark .dp-container {
    --dp-glass-bg: color-mix(in srgb, var(--background-primary) 62%, transparent);
    --dp-glass-border: rgba(255, 255, 255, 0.10);
    --dp-glass-highlight: rgba(255, 255, 255, 0.07);
    --dp-glass-shadow: 0 1px 2px rgba(0, 0, 0, 0.24), 0 6px 20px rgba(0, 0, 0, 0.22);
    --dp-glass-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.28), 0 24px 60px rgba(0, 0, 0, 0.45);
    --dp-glass-blur: blur(16px) saturate(180%);
    --dp-segment-track: rgba(255, 255, 255, 0.05);
    --dp-segment-active: rgba(255, 255, 255, 0.12);
    /* Glass segmented controls: a frosted track and a raised, glossy thumb (light from above: bright rim on top,
       darker lip below) */
    --dp-glass-track: linear-gradient(180deg, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0.04));
    --dp-glass-track-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.12),
        0 1px 3px rgba(0, 0, 0, 0.18);
    /* Glass button: the page colour at 80% with a faint shine (never a white wash), a 0.5px hairline, one soft drop
       shadow, light along the top and a slightly darker bottom edge */
    --dp-glass-thumb: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04)),
        color-mix(in srgb, var(--background-primary) 80%, transparent);
    --dp-glass-thumb-hover: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06)),
        color-mix(in srgb, color-mix(in srgb, var(--background-primary) 93%, var(--text-normal)) 85%, transparent);
    --dp-glass-thumb-shadow: 0 2px 8px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.08),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.12),
        inset 0 -1px 2px rgba(0, 0, 0, 0.10);
    /* The same shine over a coloured fill (accent / red buttons) */
    --dp-glass-gloss: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.04));
    --dp-glass-gloss-hover: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.06));
    /* Pop-ups: a faint sheen down the panel; fields sit in it as darker frosted wells */
    --dp-panel-sheen: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 160px);
    --dp-glass-well: rgba(0, 0, 0, 0.18);
    --dp-glass-well-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28), 0 1px 0 rgba(255, 255, 255, 0.05);
    --dp-card-bg: rgba(255, 255, 255, 0.06);
    --dp-card-border: rgba(255, 255, 255, 0.16);
    /* Share of an item's colour (task colour / calendar colour) in its card fill; dark needs more to show */
    --dp-item-tint: 26%;
    --dp-item-edge: 45%;
}
.theme-light, .theme-light .dp-container {
    --dp-glass-bg: color-mix(in srgb, var(--background-primary) 68%, transparent);
    --dp-glass-border: rgba(0, 0, 0, 0.08);
    --dp-glass-highlight: rgba(255, 255, 255, 0.7);
    --dp-glass-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 6px 20px rgba(0, 0, 0, 0.08);
    --dp-glass-shadow-lg: 0 2px 6px rgba(0, 0, 0, 0.08), 0 24px 60px rgba(0, 0, 0, 0.18);
    --dp-glass-blur: blur(16px) saturate(180%);
    --dp-segment-track: rgba(0, 0, 0, 0.05);
    --dp-segment-active: color-mix(in srgb, var(--background-primary) 95%, transparent);
    --dp-glass-track: linear-gradient(180deg, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0.45)), rgba(0, 0, 0, 0.03);
    --dp-glass-track-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.9),
        0 1px 3px rgba(0, 0, 0, 0.06);
    --dp-glass-thumb: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04)),
        color-mix(in srgb, var(--background-primary) 80%, transparent);
    --dp-glass-thumb-hover: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.06)),
        color-mix(in srgb, color-mix(in srgb, var(--background-primary) 93%, var(--text-normal)) 85%, transparent);
    /* Light: the hairline is the dark edge (a white one vanishes on a white page), the top light stronger */
    --dp-glass-thumb-shadow: 0 2px 8px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(0, 0, 0, 0.10),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.60), inset 0 1px 0 rgba(255, 255, 255, 0.70),
        inset 0 -1px 2px rgba(0, 0, 0, 0.06);
    --dp-glass-gloss: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.04));
    --dp-glass-gloss-hover: linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.06));
    --dp-panel-sheen: linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 160px);
    --dp-glass-well: rgba(0, 0, 0, 0.035);
    --dp-glass-well-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.07), 0 1px 0 rgba(255, 255, 255, 0.8);
    --dp-card-bg: rgba(0, 0, 0, 0.03);
    --dp-card-border: rgba(0, 0, 0, 0.14);
    /* Light: a paler fill keeps dark text readable on any colour, with a stronger edge to hold the card's shape */
    --dp-item-tint: 16%;
    --dp-item-edge: 55%;
}
/* No blur support, or the OS asks for less transparency: same surfaces, near-opaque fills, no blur */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .theme-dark, .theme-dark .dp-container { --dp-glass-bg: color-mix(in srgb, var(--background-primary) 94%, transparent); }
    .theme-light, .theme-light .dp-container { --dp-glass-bg: color-mix(in srgb, var(--background-primary) 95%, transparent); }
}
@media (prefers-reduced-transparency: reduce) {
    /* Glass buttons go solid */
    .theme-dark, .theme-light, .dp-container {
        --dp-glass-thumb: var(--background-secondary);
        --dp-glass-thumb-hover: var(--background-modifier-border);
    }
    .theme-dark, .theme-dark .dp-container { --dp-glass-bg: color-mix(in srgb, var(--background-primary) 97%, transparent); --dp-glass-blur: none; }
    .theme-light, .theme-light .dp-container { --dp-glass-bg: color-mix(in srgb, var(--background-primary) 97%, transparent); --dp-glass-blur: none; }
}

.dp-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    color: var(--text-normal);
    /* No page colour of its own: the theme's own background (colour, gradient or image) of the tab, sidebar, phone
       screen or note shows through. Only bars that content scrolls under are filled, as glass. */
    background-color: transparent;
    font-family: var(--font-interface);
    position: relative;
    overflow: hidden;
    overscroll-behavior-x: none; /* horizontal swipes page the planner; they never chain to the workspace */
    user-select: none;
    --dp-hour-height: 60px; /* 세로 1시간 간격 CSS 변수 바인딩 */
    container: dp-planner / inline-size; /* narrow layout keys off the pane width, not the device */
}
/* In a sidebar leaf (Dayloom Compact, or any planner tab docked there): the planner's page colour is the sidebar's
   own (main.ts syncSidebarBackground), so it blends in like the sidebar's other views; glass and sticky rows follow */
:is(.mod-sidedock, .workspace-drawer) .dp-container {
    --background-primary: var(--dp-sidebar-bg, var(--background-secondary));
}
/* In the main area: a note tab's own colour in the theme (main.ts syncMainBackground), like the sidebar case above */
body.dp-has-main-bg .mod-root .dp-container {
    --background-primary: var(--dp-main-bg);
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
    animation: dp-pill-slide 0.42s linear;
}
/* Glides like the glass segmented thumb: swells a little mid-way, then springs into place */
@keyframes dp-pill-slide {
    from {
        transform: translateX(var(--dp-pill-dx, 0px)) scaleX(var(--dp-pill-sx, 1));
        animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    45% {
        transform: translateX(calc(var(--dp-pill-dx, 0px) * 0.3)) scale(calc(var(--dp-pill-sx, 1) * 0.3 + 0.76), 1.12);
        animation-timing-function: cubic-bezier(0.3, 1.3, 0.4, 1);
    }
    to { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
    .dp-tabs > .dp-tab.dp-tab-pill-slide::before { animation: none; }
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
   A view switch animates both panes (src/views/viewSwitch.ts, rules below); a pane shown with nothing to switch from
   gets the 150ms reveal, removed on animationend.
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
/* Page push (src/views/pageSwipe.ts): j/k, nav arrows, Today, swipes, Board modes.
   The old page (an inert cloned ghost) and the new page move together as one strip, full width, no fade. */
.dp-page-swipe-host {
    overflow: hidden !important;
    overflow: clip !important;
}
.dp-page-swipe-pos {
    position: relative;
}
.dp-page-ghost {
    position: absolute;
    margin: 0;
    box-sizing: border-box;
    overflow: hidden;
    pointer-events: none;
    z-index: 1;
}
.dp-page-in {
    animation: dp-page-in var(--dp-page-ms, 260ms) cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-page-out {
    animation: dp-page-out var(--dp-page-ms, 260ms) cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
@keyframes dp-page-in {
    from { transform: translateX(var(--dp-page-from, 100%)); }
    to { transform: none; }
}
@keyframes dp-page-out {
    from { transform: translateX(var(--dp-page-from, 0px)); }
    to { transform: translateX(var(--dp-page-to, -100%)); }
}
/* Touch pull released short of the threshold */
.dp-page-spring {
    transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease-out;
}
/* View-type switch (src/views/viewSwitch.ts): the old pane stays over its own box while the new one arrives.
   Time scales zoom through the date (wider view: the old one shrinks into that date's column / cell / week row;
   narrower view, Monthly cell → Daily included: the new one grows out of it; a plain centre zoom when that place is
   not on screen); Board / List slide 24px in tab-bar order. Never scaled above 1, so nothing spills over the header.
   The leaving pane fades out a little faster (200ms) than the new one settles (250ms, VIEW_SWITCH_MS). */
.dp-view-switch-host {
    overflow-x: hidden;
    overflow-x: clip;
}
.dp-view-switch-pos {
    position: relative;
}
.day-planner-view-pane.dp-view-leaving {
    position: absolute;
    margin: 0;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 0;
}
.day-planner-view-pane.dp-view-arriving {
    position: relative;
    z-index: 1;
}
.dp-view-in-zoom-out { animation: dp-view-in-zoom-out 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.dp-view-in-zoom-in { animation: dp-view-in-zoom-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.dp-view-in-slide-next { animation: dp-view-in-slide-next 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.dp-view-in-slide-prev { animation: dp-view-in-slide-prev 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
.dp-view-out-zoom-out { animation: dp-view-out-zoom-out 0.2s cubic-bezier(0.4, 0, 1, 1) forwards; }
.dp-view-out-zoom-in { animation: dp-view-out-fade 0.2s cubic-bezier(0.4, 0, 1, 1) forwards; }
.dp-view-out-slide-next { animation: dp-view-out-slide-next 0.2s cubic-bezier(0.4, 0, 1, 1) forwards; }
.dp-view-out-slide-prev { animation: dp-view-out-slide-prev 0.2s cubic-bezier(0.4, 0, 1, 1) forwards; }
/* Zoom through the date (zoomTarget): the narrower pane maps onto that date's place in the wider one via --dp-zoom-t,
   shrinking into it (zoom out) or growing out of it (zoom in) */
.dp-view-out-zoom-to { transform-origin: 0 0; animation: dp-view-out-zoom-to 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
.dp-view-in-zoom-from { transform-origin: 0 0; animation: dp-view-in-zoom-from 0.25s cubic-bezier(0.2, 0.8, 0.2, 1); }
@keyframes dp-view-out-zoom-to { 60% { opacity: 1; } to { opacity: 0; transform: var(--dp-zoom-t, scale(0.94)); } }
@keyframes dp-view-in-zoom-from { from { opacity: 0; transform: var(--dp-zoom-t, scale(0.94)); } 35% { opacity: 1; } to { transform: none; } }
@keyframes dp-view-in-zoom-out { from { opacity: 0; } }
@keyframes dp-view-in-zoom-in { from { opacity: 0; transform: scale(0.94); } }
@keyframes dp-view-in-slide-next { from { opacity: 0; transform: translateX(24px); } }
@keyframes dp-view-in-slide-prev { from { opacity: 0; transform: translateX(-24px); } }
@keyframes dp-view-out-zoom-out { to { opacity: 0; transform: scale(0.94); } }
@keyframes dp-view-out-fade { to { opacity: 0; } }
@keyframes dp-view-out-slide-next { to { opacity: 0; transform: translateX(-24px); } }
@keyframes dp-view-out-slide-prev { to { opacity: 0; transform: translateX(24px); } }
/* The helpers already skip animating under reduced motion; this is the CSS-side safety net */
@media (prefers-reduced-motion: reduce) {
    .dp-page-in, .dp-page-out { animation: none; }
    .dp-page-spring { transition: none; }
    .day-planner-view-pane.dp-view-reveal,
    .dp-view-in-zoom-out, .dp-view-in-zoom-in, .dp-view-in-slide-next, .dp-view-in-slide-prev,
    .dp-view-out-zoom-out, .dp-view-out-zoom-in, .dp-view-out-slide-next, .dp-view-out-slide-prev,
    .dp-view-out-zoom-to, .dp-view-in-zoom-from,
    .notice.dayloom-reminder-notice,
    .dp-search-float.is-open,
    .is-mobile .dp-search-float.is-open,
    .dp-sync-btn:is(.is-syncing, .is-sync-settling) svg,
    .dp-timeline-current-indicator.is-arriving,
    .dp-timeline-current-indicator.is-arriving::before,
    .dp-timeline-current-indicator.is-arriving::after {
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
    /* Nothing slides under it (its scroller never scrolls sideways): the theme background shows through */
    background-color: transparent;
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
    z-index: calc(5 + 2 * var(--dp-stack, 0)) !important; /* nested cards (views.ts --dp-stack) above their hosts */
    box-sizing: border-box !important;
    word-break: break-all !important;
    overflow: hidden !important;
}
.dp-timeline-event:active {
    cursor: grabbing !important;
}
.dp-timeline-event:hover {
    transform: translateY(-1px) scale(1.01) !important;
    z-index: calc(6 + 2 * var(--dp-stack, 0)) !important; /* lifts over neighbours, never over a card nested on it */
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
/* One fill for every task and event: its colour (--dp-item-color: the Local Task Color setting, or the event's
   calendar colour, set inline) mixed into the opaque page background at the theme's --dp-item-tint */
.theme-dark .dp-timeline-event,
.theme-light .dp-timeline-event {
    --dp-item-color: var(--dp-task-color, #ff9f1c);
    background-color: color-mix(in srgb, var(--dp-item-color) var(--dp-item-tint), var(--background-primary)) !important;
    background-image: none !important;
    border: 1px solid color-mix(in srgb, var(--dp-item-color) var(--dp-item-edge), transparent) !important;
    border-left: 3px solid var(--dp-item-color) !important;
}
/* All-day chips and Monthly items: the same fill (open tasks and events carry .dp-tinted) */
.dp-grid-task-item.dp-tinted {
    --dp-item-color: var(--dp-task-color, #ff9f1c);
    background-color: color-mix(in srgb, var(--dp-item-color) var(--dp-item-tint), var(--background-primary)) !important;
    border: 1px solid color-mix(in srgb, var(--dp-item-color) var(--dp-item-edge), transparent) !important;
    border-left: 3px solid var(--dp-item-color) !important;
}
.theme-dark .dp-timeline-event {
    color: #ffffff !important;
    box-shadow: 0 0 0 1px var(--background-primary), 0 1px 3px rgba(0, 0, 0, 0.35) !important; /* small blur: cheap to raster as tiles scroll in */
}
/* Done (both themes, timeline cards, all-day chips, Monthly items): the task colour faded into the page background,
   a muted stripe of it and muted text */
.theme-dark .dp-timeline-event.completed,
.theme-light .dp-timeline-event.completed,
.dp-grid-task-item.completed {
    background-image: none !important;
    background-color: color-mix(in srgb, var(--dp-task-color, #ff9f1c) 10%, var(--background-primary)) !important;
    color: var(--text-muted) !important;
    border: 1px solid color-mix(in srgb, var(--dp-task-color, #ff9f1c) 18%, transparent) !important;
    border-left: 3px solid color-mix(in srgb, var(--dp-task-color, #ff9f1c) 45%, var(--background-primary)) !important;
}
.theme-dark .dp-timeline-event.cancelled {
    background-color: var(--background-primary) !important;
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
.theme-light .dp-timeline-event.cancelled {
    background-color: var(--background-primary) !important;
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

/* Short cards (under 35px, views.ts dp-small-handle): no bar. The whole top / bottom edge is an invisible zone with the
   ↕ cursor, like a window edge; a quarter of the card each (4-6px), so the middle still drags the card. A touch-active
   card keeps its touch bars (below). */
.dp-timeline-event:not(.is-touch-active) > .dp-resize-handle.dp-small-handle,
.dp-timeline-event:not(.is-touch-active) > .dp-resize-handle.dp-small-handle:hover {
    left: 0;
    right: 0;
    width: auto;
    height: 25%;
    min-height: 4px;
    max-height: 6px;
    transform: none;
    border-radius: 0;
    background-color: transparent;
}
.dp-timeline-event:not(.is-touch-active) > .dp-resize-handle.dp-small-handle.top {
    top: 0;
}
.dp-timeline-event:not(.is-touch-active) > .dp-resize-handle.dp-small-handle.bottom {
    bottom: 0;
}
.dp-timeline-event:not(.is-touch-active) > .dp-resize-handle.dp-small-handle::after {
    content: none;
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
/* Arrival (views.ts greetNowLine), after the glide to now: the dot swells and sends out two ripples, a glint runs
   along the line and its glow fades out (the line's own animation is the longest; its end clears the class) */
.dp-timeline-current-indicator.is-arriving {
    animation: dp-now-glow 1.5s ease-out;
}
.dp-timeline-current-indicator.is-arriving::before {
    animation: dp-now-ripple 0.7s ease-out 2;
}
.dp-timeline-current-indicator.is-arriving::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9), transparent) no-repeat;
    background-size: 25% 100%;
    animation: dp-now-glint 0.9s ease-in-out 0.1s both;
}
@keyframes dp-now-glow {
    0% { box-shadow: 0 0 0 0 transparent; }
    25% { box-shadow: 0 0 10px 1px color-mix(in srgb, var(--text-error) 70%, transparent); }
    100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes dp-now-ripple {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--text-error) 60%, transparent); transform: scale(1); }
    30% { transform: scale(1.35); }
    100% { box-shadow: 0 0 0 12px transparent; transform: scale(1); }
}
@keyframes dp-now-glint {
    from { background-position: -40% 0; }
    to { background-position: 140% 0; }
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
    background-color: transparent; /* the theme's background, like the rest of the planner */
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
/* Monthly multi-day events: one bar per week lane. A joining side gets square corners and no stripe; an empty lane
   (.dp-span-spacer) keeps the row height so the bar stays level across the week */
.dp-grid-task-item.dp-span-left {
    border-left-width: 1px !important;
    border-top-left-radius: 0 !important;
    border-bottom-left-radius: 0 !important;
}
.dp-grid-task-item.dp-span-right {
    border-top-right-radius: 0 !important;
    border-bottom-right-radius: 0 !important;
}
.dp-grid-task-item.dp-span-spacer {
    visibility: hidden;
    pointer-events: none;
}
/* Desktop Monthly: each multi-day event is one bar across its days of the week, lying over the cells (views.ts places
   it on the week's grid row); every cell of the week keeps the same lane room under its day number. 26px = item + gap */
.dp-month-span-lanes {
    flex-shrink: 0;
    height: calc(var(--dp-span-lanes) * 26px);
}
.dp-grid-task-item.dp-month-span {
    align-self: start;
    position: relative;
    z-index: 1;
    min-width: 0;
    margin: calc(var(--dp-month-lane-top, 31px) + var(--dp-span-lane) * 26px) 7px 0 !important;
}
.dp-grid-task-item.dp-month-span.dp-span-left {
    margin-left: 0 !important;
}
.dp-grid-task-item.dp-month-span.dp-span-right {
    margin-right: 0 !important;
}
/* Weekly / N-day all-day row: the same bars, lanes of 28px chips + 4px gap above each cell's own items */
.dp-weekly-allday-grid > .dp-allday-cell {
    padding-top: calc(4px + var(--dp-span-lanes, 0) * 32px);
    max-height: calc(104px + var(--dp-span-lanes, 0) * 32px);
}
.dp-grid-task-item.dp-allday-item.dp-allday-span {
    align-self: start;
    position: relative;
    z-index: 1;
    min-width: 0;
    margin: calc(4px + var(--dp-span-lane) * 32px) 4px 0 !important;
}
.dp-grid-task-item.dp-allday-item.dp-allday-span.dp-span-left {
    margin-left: 0 !important;
}
.dp-grid-task-item.dp-allday-item.dp-allday-span.dp-span-right {
    margin-right: 0 !important;
}
.dp-grid-task-item.completed {
    text-decoration: line-through;
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

/* Weekly / N-day: the day headers and the all-day row stick to the top of the hourly scroller, so they share its width
   (scrollbar included) with the day columns; above timeline cards (selected 99) and the sticky hour column (20).
   Glass like Daily's all-day bar: the grid scrolls under this one element, the theme background shows through it. */
.dp-weekly-sticky-head {
    position: sticky;
    top: 0;
    z-index: 100;
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
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
    /* No fill of its own: the page colour of the sticky head; weekends keep their soft red / blue (below) */
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
    /* A faint tint, not a solid fill: the theme's background (image too) shows through the column */
    background-color: color-mix(in srgb, var(--background-secondary) 45%, transparent);
    border-radius: 8px;
    border: 1px solid var(--background-modifier-border);
    display: flex;
    flex-direction: column;
    padding: 12px;
    transition: background-color 0.2s, border-color 0.2s;
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
/* Fold chevron at the far left, before the title: [chevron] Title ........ [count] */
.dp-kanban-col-header {
    gap: 6px;
}
.dp-kanban-column:not(.collapsed) .dp-kanban-col-title {
    flex: 1 1 auto;
    min-width: 0;
}
.dp-kanban-col-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-left: -4px;
    border-radius: var(--radius-s, 4px);
    color: var(--text-muted);
    opacity: 0.6;
    cursor: pointer;
    transition: opacity 0.15s ease, background-color 0.15s ease;
}
.dp-kanban-column.collapsed .dp-kanban-col-toggle {
    margin-left: 0;
}
.dp-kanban-col-toggle:hover {
    opacity: 1;
    background-color: var(--background-modifier-hover);
}
.dp-kanban-col-toggle svg {
    width: 14px;
    height: 14px;
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
/* Task priority in the timeline-style views (views.ts renderTaskTitle; List uses .dp-gc-item-priority): the emoji leads the title as an inline mark with
   a fixed gap. inline-block keeps it out of the title's line-through and lets it wrap / clamp with the title. */
.dp-priority-mark {
    display: inline-block;
    margin-right: 0.3em;
    font-size: 0.9em;
    font-weight: normal;
    font-style: normal;
    line-height: 1;
    text-decoration: none;
    vertical-align: baseline;
}
:is(.completed, .cancelled) .dp-priority-mark {
    opacity: 0.6;
    filter: grayscale(0.7);
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 20px;
    padding: 0 6px;
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
/* Icons only; a layout's name unfolds beside its icon while hovered or keyboard-focused */
.dp-board-toggle .dp-btn-label {
    display: inline-block;
    max-width: 0;
    margin-left: 0;
    overflow: hidden;
    opacity: 0;
    transition: max-width 0.2s cubic-bezier(0.4, 0, 0.2, 1), margin-left 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.15s ease;
}
.dp-board-toggle > .dp-board-toggle-btn:hover .dp-btn-label,
.dp-board-toggle > .dp-board-toggle-btn:focus-visible .dp-btn-label {
    max-width: 8em;
    margin-left: 4px;
    opacity: 1;
}

/* 구글 캘린더 연동일정 전용 기본 스타일 */
.dp-gcal-event {
    background-color: rgba(66, 133, 244, 0.12);
    color: var(--text-normal);
    border-left: 4px solid #4285f4;
}
/* Subscribed (.ics) events: read-only, so a pointer instead of the grab cursor and a dashed left edge */
.dp-timeline-event.dp-gcal-event.is-readonly {
    cursor: pointer !important;
    border-left-style: dashed !important;
}
/* Their details (GCalEventEditModal.renderReadOnly) */
.dp-event-readonly-source {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -4px 0 10px;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
}
.dp-event-readonly-dot {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
    border-radius: 50%;
}
.dp-event-readonly-when,
.dp-event-readonly-meta {
    margin-bottom: 6px;
}
.dp-event-readonly-desc {
    max-height: 40vh;
    overflow-y: auto;
    margin-top: 8px;
    padding: 8px 10px;
    white-space: pre-wrap;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
    background-color: var(--dp-card-bg);
    border: 1px solid var(--dp-glass-border);
    border-radius: 10px;
}
/* Settings: subscribed calendars list */
.dp-ics-settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 24px;
}
.dp-ics-settings-header h4 {
    margin: 0;
}
.dp-ics-settings-actions {
    display: flex;
    gap: 6px;
}
.dp-ics-settings-desc {
    margin: 6px 0 10px;
}
.dp-ics-settings-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    background-color: var(--background-secondary-alt);
    border: 1px solid var(--background-modifier-border);
    border-radius: 6px;
}
.dp-ics-settings-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}
.dp-ics-settings-row > input.dp-ics-name {
    flex: 1;
    min-width: 100px;
}
.dp-ics-settings-row > input.dp-ics-url {
    flex: 2;
    min-width: 200px;
}
.dp-ics-settings-row > input.dp-ics-color {
    width: 35px;
    height: 28px;
    padding: 0;
    border: none;
    cursor: pointer;
}
/* Event location and description (Daily / N-day / Weekly): secondary lines, greyed and a touch smaller than the title */
.dp-gcal-event .dp-event-meta {
    color: var(--text-muted);
    font-size: 0.92em;
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

/* In-progress tracker (Daily): a glass card with an accent wash, a live dot, and a thin progress track along the
   bottom edge (--dp-ct-progress, 0–1, set by the tracker tick). No backdrop blur: nothing scrolls behind it. */
.dp-current-task-bar {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 12px;
    padding: 9px 10px 12px 12px;
    border-radius: 12px;
    background-color: var(--dp-glass-bg);
    background-image: linear-gradient(90deg, color-mix(in srgb, var(--interactive-accent) 14%, transparent), transparent 75%);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 35%, var(--dp-glass-border));
    box-shadow: var(--dp-glass-shadow), inset 0 1px 0 var(--dp-glass-highlight);
    overflow: hidden;
    z-index: 100;
    box-sizing: border-box;
    flex-shrink: 0;
}
.dp-ct-pulse {
    position: relative;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background-color: var(--interactive-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive-accent) 22%, transparent);
    flex-shrink: 0;
}
.dp-ct-pulse::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background-color: var(--interactive-accent);
    animation: dp-ct-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
}
@keyframes dp-ct-ping {
    0% { transform: scale(1); opacity: 0.55; }
    80%, 100% { transform: scale(2.8); opacity: 0; }
}
.dp-ct-info {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.dp-ct-title {
    font-size: 0.86em;
    font-weight: 600;
    color: var(--text-normal);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dp-ct-time {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    font-size: 0.74em;
    color: var(--text-muted);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}
.dp-ct-remaining {
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text-accent);
    font-weight: 500;
}
.dp-ct-range + .dp-ct-remaining::before {
    content: '·';
    margin-right: 6px;
    color: var(--text-faint);
}
.dp-ct-percent {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 0.72em;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--text-accent);
    background-color: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 24%, transparent);
}
.dp-current-task-bar button.dp-ct-open {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 8px;
    border: none;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    cursor: pointer;
}
.dp-current-task-bar button.dp-ct-open:hover,
.dp-current-task-bar button.dp-ct-open:focus-visible {
    color: var(--text-accent);
    background-color: var(--background-modifier-hover);
}
.dp-ct-open svg {
    width: 15px;
    height: 15px;
}
.dp-ct-progress {
    position: absolute;
    left: 12px;
    right: 12px;
    bottom: 5px;
    height: 3px;
    border-radius: 2px;
    background-color: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
    overflow: hidden;
    pointer-events: none;
}
.dp-ct-progress-fill {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    transform-origin: left center;
    transform: scaleX(var(--dp-ct-progress, 0));
    background-image: linear-gradient(90deg, color-mix(in srgb, var(--interactive-accent) 55%, transparent), var(--interactive-accent));
    transition: transform 0.6s ease;
}
@media (prefers-reduced-motion: reduce) {
    .dp-ct-pulse::after { animation: none; opacity: 0; }
    .dp-ct-progress-fill { transition: none; }
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
/* -------------------------------------------------------------
   Modal footer, one standard for every planner modal (modals.ts createModalFooter / createModalButton):
   item actions (Delete, Duplicate) at the start, Cancel + the primary action at the end. One button size; the
   variant only changes the surface: primary = accent fill, secondary = neutral glass, danger = red-tinted glass.
   ------------------------------------------------------------- */
.dp-modal-buttons {
    display: flex;
    flex-wrap: wrap; /* narrow (phone) modals: the end group drops under the start group, still right-aligned */
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--background-modifier-border);
}
.dp-modal-actions-start,
.dp-modal-actions-end {
    display: flex;
    align-items: center;
    gap: 8px;
}
.dp-modal-actions-start {
    margin-right: auto;
}
.dp-modal-actions-start:empty {
    display: none;
}
.modal button.dp-modal-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 32px;
    min-width: 80px;
    margin: 0;
    padding: 0 14px;
    font-size: var(--font-ui-small, 13px);
    font-weight: var(--font-normal, 400);
    line-height: 1;
    white-space: nowrap;
    border-radius: 999px;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.18s ease,
        filter 0.15s ease, transform 0.15s ease;
}
/* Every variant answers the pointer the same way: a 1px lift with a deeper shadow, a press settles it */
.modal button.dp-modal-btn:hover:not(:disabled) {
    transform: translateY(-1px);
}
.modal button.dp-modal-btn:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
    transition-duration: 0.05s;
}
.modal button.dp-modal-btn:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: 2px;
}
.modal button.dp-modal-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.dp-modal-btn-icon {
    display: inline-flex;
}
.dp-modal-btn-icon svg {
    width: 14px;
    height: 14px;
}
.modal button.dp-modal-btn.is-secondary {
    color: var(--text-normal);
    background-color: var(--dp-card-bg);
    border: 1px solid var(--dp-glass-border);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), inset 0 1px 0 var(--dp-glass-highlight);
}
.modal button.dp-modal-btn.is-secondary:hover:not(:disabled) {
    background-color: var(--background-modifier-hover);
    border-color: var(--background-modifier-border-hover, var(--background-modifier-border));
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.10), inset 0 1px 0 var(--dp-glass-highlight);
}
.modal button.dp-modal-btn.is-primary {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    border: 1px solid transparent;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 4px 12px color-mix(in srgb, var(--interactive-accent) 28%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
/* Brightness, not --interactive-accent-hover: many themes set that equal to the accent, so hover showed nothing */
.modal button.dp-modal-btn.is-primary:hover:not(:disabled) {
    filter: brightness(1.08) saturate(1.05);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.12), 0 8px 18px color-mix(in srgb, var(--interactive-accent) 38%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, 0.18);
}
.modal button.dp-modal-btn.is-danger {
    color: var(--text-error);
    background-color: color-mix(in srgb, var(--color-red) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-red) 32%, transparent);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), inset 0 1px 0 var(--dp-glass-highlight);
}
.modal button.dp-modal-btn.is-danger:hover:not(:disabled) {
    color: var(--text-on-accent);
    background-color: var(--color-red);
    border-color: var(--color-red);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--color-red) 32%, transparent);
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
    background-color: transparent; /* the theme's background, like the rest of the planner */
}
.dp-gc-list-header {
    padding: 8px 12px;
    border-bottom: 1px solid var(--background-modifier-border);
    background-color: transparent; /* its own row above the scroller: nothing slides under it */
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
    min-width: 0; /* long titles ellipsize instead of pushing the priority pill and note badge out of view */
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.dp-gc-item {
    display: flex;
    align-items: center;
    min-width: 0;
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
.dp-gc-item.completed .dp-gc-item-title-text {
    text-decoration: line-through;
    color: var(--text-muted);
}
.dp-gc-item.cancelled .dp-gc-item-title-text {
    text-decoration: line-through;
    color: var(--text-muted);
    opacity: 0.6;
}
.dp-gc-item:is(.completed, .cancelled) .dp-gc-item-priority {
    opacity: 0.5;
    filter: grayscale(0.7);
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
/* List title row: the text takes what it needs (ellipsized), the priority pill trails right after it */
.dp-gc-item-title {
    color: var(--text-normal);
    flex-grow: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
}
.dp-gc-item-title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* Trailing priority pill: the emoji on a chip tinted by its level, one size on every List variant */
.dp-gc-item-priority {
    --dp-prio: var(--text-muted);
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    box-sizing: border-box;
    font-size: 0.7rem;
    line-height: 1;
    background-color: color-mix(in srgb, var(--dp-prio) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--dp-prio) 30%, transparent);
}
.dp-gc-item-priority.is-highest { --dp-prio: var(--color-red, #e5484d); }
.dp-gc-item-priority.is-high { --dp-prio: var(--color-orange, #f76b15); }
.dp-gc-item-priority.is-medium { --dp-prio: var(--color-yellow, #e2a336); }
.dp-gc-item-priority.is-low { --dp-prio: var(--color-blue, #3e8ef7); }
.dp-gc-item-priority.is-lowest { --dp-prio: var(--text-faint); }
.dp-gc-item-file {
    font-size: 0.78em;
    color: var(--text-muted);
    background-color: var(--background-secondary);
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    max-width: 120px;
    flex-shrink: 0; /* the title gives way first; the badge is capped by max-width */
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
/* Event details under the title (views.ts renderListView): location · calendar on one line, the description in two
   faint lines below. The mark and time stay level with the title row. */
.dp-gc-item-main {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.dp-gc-item.has-details {
    align-items: flex-start;
}
.dp-gc-item.has-details > .dp-gc-item-dot {
    margin-top: 0.5em;
}
.dp-gc-item.has-details > .dp-gc-item-time {
    margin-top: 0.12em;
}
.dp-gc-item-desc {
    min-width: 0;
    overflow: hidden;
    font-size: 0.74em;
    line-height: 1.35;
    color: var(--text-faint);
    white-space: normal;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
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
.modal.dp-whats-new-modal,
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
.modal-container:has(.dp-modal-buttons, .dp-selector-modal-tabs, .dp-shortcut-modal, .dp-whats-new-modal) > .modal-bg {
    opacity: 0.45;
}

/* What's New (release notes after an update) */
.modal.dp-whats-new-modal {
    width: min(520px, calc(100vw - 32px));
    border-radius: 16px;
}
.dp-whats-new-header {
    text-align: center;
    padding-bottom: var(--size-4-3, 12px);
    border-bottom: 1px solid var(--dp-glass-border);
}
.dp-whats-new-header h2 {
    margin: 0 0 var(--size-4-1, 4px);
    font-size: 1.3em;
}
.dp-whats-new-date {
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-muted);
}
.dp-whats-new-body {
    max-height: min(60vh, 520px);
    overflow-y: auto;
    padding: var(--size-4-2, 8px) 2px;
}
.dp-whats-new-section {
    margin-top: var(--size-4-3, 12px);
}
.dp-whats-new-section-title {
    margin-bottom: var(--size-4-2, 8px);
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--interactive-accent);
}
.dp-whats-new-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--size-4-2, 8px);
}
.dp-whats-new-item {
    display: flex;
    align-items: flex-start;
    gap: var(--size-4-3, 12px);
    padding: var(--size-4-2, 8px) var(--size-4-3, 12px);
    border: 1px solid var(--dp-glass-border);
    border-radius: 10px;
    background-color: var(--background-modifier-hover);
}
.dp-whats-new-emoji {
    flex-shrink: 0;
    font-size: 1.25em;
    line-height: 1.4;
}
.dp-whats-new-text {
    min-width: 0;
}
.dp-whats-new-item-title {
    font-weight: var(--font-semibold, 600);
}
.dp-whats-new-item-desc {
    margin-top: 2px;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
    line-height: 1.45;
}
.dp-whats-new-footer {
    display: flex;
    justify-content: center;
    padding-top: var(--size-4-3, 12px);
    border-top: 1px solid var(--dp-glass-border);
}
.dp-whats-new-modal button.dp-whats-new-ok {
    min-width: 140px;
    height: auto;
    padding: 8px 28px;
    border-radius: 999px;
    font-weight: var(--font-semibold, 600);
    box-shadow: var(--dp-glass-shadow);
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

/* Touch devices (Obsidian sets .is-mobile on <body>; touchscreen laptops get .dp-touch-screen on the view): no resize handles on idle cards. A long-press makes a card
   touch-active (position & resize mode, see setTouchActive): its top / bottom bars appear, styled like the desktop
   bars, each with a 24px-tall touch target reaching into the card (the card clips anything outside it). */
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event:not(.is-touch-active) > .dp-resize-handle {
    display: none;
}
/* A tablet with a trackpad or mouse attached: the desktop bars on hover, since a mouse cannot long-press */
@media (any-pointer: fine) {
    :is(.is-mobile, .dp-touch-screen) .dp-timeline-event:not(.is-touch-active):hover > .dp-resize-handle {
        display: block;
    }
}
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active {
    touch-action: none; /* a finger on the active card drags it instead of scrolling the timeline */
}
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active > .dp-resize-handle,
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active > .dp-resize-handle:hover {
    width: 36px;
    height: 5px;
    border-radius: 3px;
    background-color: var(--interactive-accent);
    box-shadow: 0 0 0 1px var(--dp-glass-border), 0 1px 4px rgba(0, 0, 0, 0.25);
    animation: dp-touch-handle-in 0.16s ease-out;
}
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active > .dp-resize-handle.top::after {
    top: -3px;
    bottom: -16px;
    left: -24px;
    right: -24px;
}
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active > .dp-resize-handle.bottom::after {
    top: -16px;
    bottom: -3px;
    left: -24px;
    right: -24px;
}
/* Short cards: smaller targets, so the body between them can still be dragged */
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active > .dp-resize-handle.dp-small-handle.top::after {
    bottom: -8px;
}
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active > .dp-resize-handle.dp-small-handle.bottom::after {
    top: -8px;
}
@keyframes dp-touch-handle-in {
    from { opacity: 0; }
    to { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
    :is(.is-mobile, .dp-touch-screen) .dp-timeline-event.is-touch-active > .dp-resize-handle {
        animation: none;
    }
}
/* The checkbox and the open-note arrow stay tappable where the top bar's touch target reaches them */
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event .dp-custom-cb,
:is(.is-mobile, .dp-touch-screen) .dp-timeline-event .dp-task-link-btn {
    position: relative;
    z-index: 13;
}
/* A card held by one finger (secondFinger.ts): a second finger landing anywhere on the view pages / scrolls it in
   code, never by the browser, whose pan or pinch would cancel the finger holding the card */
.dp-touch-holding,
.dp-touch-holding * {
    touch-action: none !important;
}
/* Hold-to-drag: no iOS callout or text selection on a long-pressed card */
:is(.is-mobile .dp-container, .dp-container.dp-touch-screen) :is(.dp-timeline-event, .dp-kanban-card, .dp-drawer-card, .dp-grid-task-item, .dp-allday-item) {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
}
/* Touch drag: the held card lifts (slight scale-up, deeper glass shadow) while the finger moves it */
.dp-timeline-event.dp-touch-lifted,
.dp-timeline-event.selected.dp-touch-lifted {
    transform: scale(1.04) !important;
    box-shadow: var(--dp-glass-shadow), 0 10px 24px rgba(0, 0, 0, 0.28) !important;
    z-index: 100 !important;
    touch-action: none;
}
.dp-touch-lifted:not(.dp-timeline-event) {
    transform: scale(1.04);
    box-shadow: var(--dp-glass-shadow), 0 10px 24px rgba(0, 0, 0, 0.28);
    touch-action: none;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.is-mobile .dp-tabs > .dp-tab {
    height: 30px;
}

/* -------------------------------------------------------------
   Compact shell (.dp-compact-shell root): the combined view on phones and the Sidebar Day Planner Pro view.
   .dp-phone-shell is added on phones only; desktop/tablet tabs and code blocks never match these rules.
   ------------------------------------------------------------- */
/* View navigation (.dp-bottom-bar, named for where it used to be): the top row, above the header's date and week
   strip, so it never meets Obsidian's own mobile toolbar at the bottom. Moved by flex order only: in the DOM it stays the
   last row, which the panes and the current-task bar are inserted before (views.ts).
   Two islands side by side: [Daily | List | Monthly | Board] and [⋯ More] */
.dp-container.dp-compact-shell > .dp-bottom-bar {
    order: -2;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin: 8px 12px;
    z-index: 30;
}
.dp-container.dp-compact-shell > .dp-header {
    order: -1;
}
.dp-bottom-bar > .dp-bottom-nav {
    flex: 1 1 auto;
    min-width: 0;
    width: auto; /* .dp-tabs is 100% wide; the bar's side margins inset the islands */
    gap: 2px;
    margin: 0;
    padding: 3px;
    border: 1px solid var(--dp-glass-border);
    border-radius: 12px;
    background-color: var(--dp-glass-bg);
    box-shadow: var(--dp-glass-shadow), inset 0 1px 0 var(--dp-glass-highlight); /* no blur: nothing scrolls behind this row */
    z-index: 30;
}
/* The 4 view tabs and More share the width 4 : 1, so all five buttons come out the same size */
.dp-bottom-bar > .dp-bottom-nav:not(.dp-bottom-more) {
    flex: 4 1 0;
}
.dp-bottom-bar > .dp-bottom-nav.dp-bottom-more {
    flex: 1 1 0;
}
/* Phones: the last row (timeline, current-task bar) clears Obsidian's toolbar, which overlays the view's bottom edge */
.is-phone .dp-container.dp-phone-shell {
    box-sizing: border-box; /* height: 100% includes the padding */
    padding-bottom: calc(var(--mobile-navbar-height, 48px) + env(safe-area-inset-bottom, 6px));
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
/* Phones with the < > buttons (swipes turned off): the "(Wk 41)" suffix makes room so the date itself stays readable */
.dp-phone-shell .dp-header-top.has-nav-arrows .dp-nav-date-sub {
    display: none;
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
/* Event details: the title column dissolves into the grid, details and description take rows under the time */
:is(.is-phone, .dp-compact-shell) .dp-gc-item.has-details {
    grid-template-areas: "mark title file" "mark time file" "mark details file" "mark desc file";
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item-main {
    display: contents;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item-details {
    grid-area: details;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item-desc {
    grid-area: desc;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item.has-details > .dp-gc-item-dot {
    align-self: start;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item.has-details > .dp-gc-item-time {
    margin-top: 0;
}
:is(.is-phone, .dp-compact-shell) .dp-gc-item-file {
    grid-area: file;
    align-self: center;
    max-width: 88px;
    margin-left: 0;
}
/* -------------------------------------------------------------
   Compact List agenda (one day; views.ts renderListView): no boxes. A time gutter on the left, then one faint spine
   through the day on which every item lays its colour rail, inset hairlines between rows, and a title over a quiet
   meta line. The header and the date strip already name the day, so the day column goes.
   ------------------------------------------------------------- */
.dp-gc-list-container.is-day-agenda {
    /* Sized to the 24-hour times (HH:mm, always five digits): the times start flush with the summary card's edge */
    --dp-agenda-gutter: 42px;
    --dp-agenda-gap: 8px;
    --dp-agenda-rail-x: calc(var(--dp-agenda-gutter) + var(--dp-agenda-gap)); /* left edge of the 3px rail */
}
.dp-gc-list-container.is-day-agenda .dp-gc-list-scroll {
    padding: 8px 12px 20px;
    gap: 12px;
}
.dp-gc-list-container.is-day-agenda .dp-gc-day-sidebar {
    display: none;
}
.dp-gc-list-container.is-day-agenda .dp-gc-day-row {
    border-bottom: none;
    padding-bottom: 0;
}
.dp-gc-list-container.is-day-agenda .dp-gc-day-content {
    position: relative;
    gap: 0;
}
/* The day's spine, fading out at both ends; the item rails sit on it */
.dp-gc-list-container.is-day-agenda .dp-gc-day-content::before {
    content: '';
    position: absolute;
    top: 8px;
    bottom: 8px;
    left: calc(var(--dp-agenda-rail-x) + 1px);
    width: 1px;
    background-image: linear-gradient(to bottom, transparent, var(--background-modifier-border) 10%, var(--background-modifier-border) 90%, transparent);
    pointer-events: none;
}
.dp-gc-list-container.is-day-agenda .dp-gc-item.dp-agenda-item {
    position: relative;
    display: grid;
    grid-template-columns: var(--dp-agenda-gutter) 3px 18px minmax(0, 1fr);
    grid-template-areas: "when rail mark body";
    column-gap: var(--dp-agenda-gap);
    align-items: start;
    padding: 10px 8px 10px 2px;
    border: none;
    border-radius: 10px;
    background: transparent;
    font-size: 1em;
    transition: background-color 0.15s ease;
}
.dp-gc-list-container.is-day-agenda .dp-gc-item.dp-agenda-item:hover {
    background-color: var(--background-modifier-hover);
}
/* Inset hairline between rows, starting under the titles (Apple Calendar style) */
.dp-gc-list-container.is-day-agenda .dp-agenda-item:not(:last-child)::after {
    content: '';
    position: absolute;
    left: calc(var(--dp-agenda-rail-x) + 3px + var(--dp-agenda-gap));
    right: 8px;
    bottom: 0;
    height: 1px;
    background-color: var(--background-modifier-border);
    opacity: 0.7;
    pointer-events: none;
}
.dp-agenda-when {
    grid-area: when;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding-top: 1px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    line-height: 1.25;
}
.dp-agenda-start {
    font-size: 0.8em;
    font-weight: 600;
    color: var(--text-normal);
}
.dp-agenda-start.is-allday {
    font-size: 0.72em; /* "All day" fits the narrow gutter */
    font-weight: 500;
    color: var(--text-muted);
}
.dp-agenda-end {
    font-size: 0.72em;
    color: var(--text-faint);
}
.dp-agenda-rail {
    grid-area: rail;
    align-self: stretch;
    position: relative;
    z-index: 1;
    width: 3px;
    min-height: 18px;
    border-radius: 2px;
    background-color: var(--dp-agenda-color);
    box-shadow: 0 0 8px color-mix(in srgb, var(--dp-agenda-color) 40%, transparent);
}
.dp-gc-list-container.is-day-agenda .dp-agenda-item > .dp-custom-cb,
.dp-gc-list-container.is-day-agenda .dp-agenda-item > .dp-gc-item-dot {
    grid-area: mark;
    justify-self: center;
    align-self: start;
}
.dp-gc-list-container.is-day-agenda .dp-agenda-item > .dp-gc-item-dot {
    margin-top: 5px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--dp-agenda-color) 20%, transparent);
}
.dp-agenda-body {
    grid-area: body;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.dp-gc-list-container.is-day-agenda .dp-agenda-body .dp-gc-item-title {
    align-items: flex-start;
    font-size: 0.95em;
    font-weight: 500;
    line-height: 1.3;
}
.dp-gc-list-container.is-day-agenda .dp-agenda-body .dp-gc-item-title-text {
    white-space: normal;
    word-break: break-word;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
/* Two-line titles: the pill stays level with the first line */
.dp-gc-list-container.is-day-agenda .dp-agenda-body .dp-gc-item-priority {
    margin-top: 0.05em;
}
.dp-agenda-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 0.76em;
    color: var(--text-muted);
}
.dp-agenda-meta > * {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dp-agenda-meta > * + *::before {
    content: '·';
    margin-right: 6px;
    color: var(--text-faint);
}
.dp-agenda-duration {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
}
/* The source note is a quiet link here, not a pill */
.dp-gc-list-container.is-day-agenda .dp-agenda-meta .dp-gc-item-file {
    align-self: auto;
    max-width: none;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: none;
    font-size: inherit;
    color: inherit;
}
.dp-gc-list-container.is-day-agenda .dp-agenda-meta .dp-gc-item-file:hover {
    color: var(--text-accent);
}
.dp-gc-list-container.is-day-agenda .dp-agenda-item:is(.completed, .cancelled) .dp-agenda-rail {
    background-color: var(--text-faint);
    box-shadow: none;
    opacity: 0.5;
}
/* Done: the rail keeps a faded task colour (cancelled stays grey) */
.dp-gc-list-container.is-day-agenda .dp-agenda-item.completed .dp-agenda-rail {
    background-color: color-mix(in srgb, var(--dp-agenda-color) 45%, var(--background-primary));
    opacity: 1;
}
.dp-gc-list-container.is-day-agenda .dp-agenda-item:is(.completed, .cancelled) .dp-agenda-start {
    color: var(--text-muted);
}
/* Now: the red dot sits on the spine, its rule runs under the titles */
.dp-gc-list-container.is-day-agenda .dp-gc-time-line {
    margin: 0;
    height: 12px;
}
.dp-gc-list-container.is-day-agenda .dp-gc-time-dot {
    position: relative;
    z-index: 2;
    margin-left: calc(var(--dp-agenda-rail-x) - 2.5px);
    margin-right: 0;
    box-shadow: 0 0 0 3px rgba(234, 67, 53, 0.22);
}
.dp-gc-list-container.is-day-agenda .dp-gc-time-rule {
    margin-right: 8px; /* ends with the hairlines */
    height: 1.5px;
    opacity: 0.85;
}
/* Day summary: one glass line on top */
.dp-agenda-summary {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 10px 12px;
    border-radius: 12px;
    background-color: var(--dp-glass-bg);
    border: 1px solid var(--dp-glass-border);
    box-shadow: inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-agenda-summary-line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.8em;
    font-variant-numeric: tabular-nums;
}
.dp-agenda-summary-main {
    font-weight: 600;
    color: var(--text-normal);
}
.dp-agenda-summary-sub {
    color: var(--text-muted);
}
.dp-agenda-summary-track {
    height: 3px;
    border-radius: 2px;
    background-color: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
    overflow: hidden;
}
.dp-agenda-summary-fill {
    height: 100%;
    border-radius: inherit;
    transform-origin: left center;
    transform: scaleX(var(--dp-agenda-done, 0));
    background-image: linear-gradient(90deg, color-mix(in srgb, var(--interactive-accent) 55%, transparent), var(--interactive-accent));
}
.dp-gc-list-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9em;
}
.dp-gc-list-empty-icon {
    display: inline-flex;
    color: var(--text-faint);
}
.dp-gc-list-empty-icon svg {
    width: 28px;
    height: 28px;
}

/* -------------------------------------------------------------
   Desktop side drawer (drawer.ts): hangs under the header on the right; the panes and the tracker bar make room
   with a right margin. Motion standard: the drawer springs in and pushes the panes aside (their margin animates with
   it), and on closing slides out while they widen back. No transition while the width grip is dragged.
   No blur: nothing scrolls behind it, so it gets the solid fill of the theme's own sidebars.
   ------------------------------------------------------------- */
.dp-container:not(.dp-compact-shell) > :is(.day-planner-view-pane, .dp-current-task-bar) {
    transition: margin-right var(--dp-motion-out) var(--dp-ease-settle);
}
.dp-container.dp-drawer-open:not(.dp-compact-shell) > :is(.day-planner-view-pane, .dp-current-task-bar) {
    transition: margin-right var(--dp-motion-in) var(--dp-ease-spring);
}
.dp-container.dp-drawer-resizing > :is(.day-planner-view-pane, .dp-current-task-bar) {
    transition: none;
}
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
    background-color: var(--dp-sidebar-bg, var(--background-secondary));
    border-left: 1px solid var(--background-modifier-border);
    transform: translateX(100%);
    visibility: hidden;
    transition: transform var(--dp-motion-out) var(--dp-ease-exit), visibility 0s linear var(--dp-motion-out);
}
.dp-side-drawer.is-open {
    transform: none;
    visibility: visible;
    transition: transform var(--dp-motion-in) var(--dp-ease-spring), visibility 0s;
}
/* The spring carries the drawer ~20px past its place: a hard shadow in its own colour fills the gap it leaves at
   the right edge (past the container's edge, so it is never seen at rest) */
.dp-container > .dp-side-drawer {
    box-shadow: 32px 0 0 var(--dp-sidebar-bg, var(--background-secondary));
}
/* Width grip on the drawer's left border (drawer.ts mountDrawerResizer); the accent line shows on hover / drag */
.dp-drawer-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -4px;
    width: 8px;
    z-index: 2;
    cursor: col-resize;
    touch-action: none;
}
.dp-drawer-resizer::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 2px;
    background-color: var(--interactive-accent);
    opacity: 0;
    transition: opacity 0.15s ease;
}
.dp-drawer-resizer:hover::after,
.dp-drawer-resizing .dp-drawer-resizer::after {
    opacity: 1;
}
/* While dragging: the col-resize cursor everywhere, and no text selection under the pointer */
.dp-container.dp-drawer-resizing {
    cursor: col-resize;
    user-select: none;
}
/* Drawer tier 1: mini calendar. Its month bar is the drawer header (label folds the grid, ‹ Today ›, close) */
.dp-drawer-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: var(--size-4-2, 8px) var(--size-4-2, 8px) 2px var(--size-4-2, 8px);
}
.dp-side-drawer button.dp-mc-label {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 6px;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
    color: var(--text-normal);
    background: none;
    border: none;
    box-shadow: none;
    border-radius: var(--radius-s, 4px);
    cursor: pointer;
}
.dp-side-drawer button.dp-mc-label:hover {
    background-color: var(--background-modifier-hover);
}
.dp-mc-label-text {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.dp-mc-label-chevron {
    font-size: 0.8em;
    color: var(--text-muted);
    transition: transform 0.2s ease;
}
.dp-mc-label[aria-expanded="false"] .dp-mc-label-chevron {
    transform: rotate(-90deg); /* ▾ → ▸ */
}
.dp-mc-nav {
    display: flex;
    align-items: center;
    gap: 1px;
    padding: 2px;
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    border-radius: 999px;
}
.dp-side-drawer button.dp-mc-nav-btn,
.dp-side-drawer button.dp-mc-today {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    margin: 0;
    padding: 0 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-medium, 500);
    color: var(--text-muted);
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 999px;
    cursor: pointer;
    transition: background-color 0.12s ease, color 0.12s ease;
}
.dp-side-drawer button.dp-mc-nav-btn {
    width: 22px;
    padding: 0;
}
.dp-mc-nav-btn svg {
    width: 14px;
    height: 14px;
}
.dp-side-drawer button.dp-mc-nav-btn:hover,
.dp-side-drawer button.dp-mc-today:hover {
    color: var(--text-normal);
    background-color: var(--dp-segment-active);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1), inset 0 0 0 1px var(--dp-glass-border);
}
.dp-mini-cal {
    flex-shrink: 0;
    padding: 2px var(--size-4-2, 8px) 6px;
    overflow: hidden; /* the paging slide stays inside the grid's box */
}
.dp-mc-weekdays,
.dp-mc-week {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
}
.dp-mc-weekdays {
    padding: 2px 0 4px;
    font-size: 0.68em;
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.04em;
    text-align: center;
    text-transform: uppercase;
    color: var(--text-faint);
}
.dp-mc-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.dp-side-drawer button.dp-mc-day {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 30px;
    margin: 0;
    padding: 0 0 5px; /* room for the dots under the number */
    font-size: var(--font-ui-smaller, 0.8em);
    font-variant-numeric: tabular-nums;
    color: var(--text-normal);
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.12s ease, transform 0.12s ease;
}
.dp-side-drawer button.dp-mc-day:hover {
    background-color: var(--background-modifier-hover);
}
.dp-side-drawer button.dp-mc-day:active {
    transform: scale(0.92);
}
.dp-mc-day.is-weekend {
    color: var(--text-muted);
}
.dp-mc-day.is-other-month {
    opacity: 0.45;
}
/* Days the planner shows (Daily: one; N-day / Weekly: a band), drawn as one continuous pill per row */
.dp-side-drawer button.dp-mc-day.is-in-range {
    background-color: color-mix(in srgb, var(--interactive-accent) 15%, transparent);
    border-radius: 0;
}
.dp-side-drawer button.dp-mc-day.is-in-range:hover {
    background-color: color-mix(in srgb, var(--interactive-accent) 24%, transparent);
}
.dp-side-drawer button.dp-mc-day.is-range-start,
.dp-mc-week > button.dp-mc-day.is-in-range:first-child {
    border-top-left-radius: 8px;
    border-bottom-left-radius: 8px;
}
.dp-side-drawer button.dp-mc-day.is-range-end,
.dp-mc-week > button.dp-mc-day.is-in-range:last-child {
    border-top-right-radius: 8px;
    border-bottom-right-radius: 8px;
}
.dp-mc-num {
    width: 22px;
    height: 22px;
    line-height: 22px;
    text-align: center;
    border-radius: 999px;
}
.dp-mc-day.is-today .dp-mc-num {
    font-weight: var(--font-bold, 700);
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    box-shadow: 0 2px 6px color-mix(in srgb, var(--interactive-accent) 40%, transparent);
}
.dp-mc-dots {
    position: absolute;
    left: 50%;
    bottom: 2px;
    display: flex;
    gap: 2px;
    transform: translateX(-50%);
    pointer-events: none;
}
.dp-mc-dot {
    flex-shrink: 0;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: var(--dp-mc-dot, var(--color-blue));
}
.dp-mc-dot.is-task {
    background-color: var(--dp-task-color, #ff9f1c);
}
.dp-mc-dot.is-focus {
    background-color: var(--color-red);
    box-shadow: 0 0 4px color-mix(in srgb, var(--color-red) 70%, transparent);
}
.dp-mc-dot.is-done {
    opacity: 0.4;
}
/* A drawer card held over a day: dropping reschedules it there */
.dp-side-drawer button.dp-mc-day.dp-drop-target {
    background-color: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
    outline: 2px dashed var(--interactive-accent);
    outline-offset: -2px;
}
.dp-mc-slide-next {
    animation: dp-mc-slide-next 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-mc-slide-prev {
    animation: dp-mc-slide-prev 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* Months page vertically: the next one rises from below, the previous one drops from above */
@keyframes dp-mc-slide-next {
    from { opacity: 0; transform: translateY(28px); }
}
@keyframes dp-mc-slide-prev {
    from { opacity: 0; transform: translateY(-28px); }
}
/* A wheel / two-finger scroll in progress: the month follows the fingers (pageOnWheel sets the variables) */
.dp-mc-grid,
.dp-scal-grid > button {
    translate: 0 var(--dp-wheel-pull, 0px);
    opacity: var(--dp-wheel-fade, 1);
}
.dp-mc-grid.dp-wheel-release,
.dp-scal-grid.dp-wheel-release > button {
    transition: translate 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s ease;
}

/* Sidebar calendar (sidebarCalendar.ts): a narrow month grid in Obsidian's sidebar, transparent over the theme */
.dp-scal.view-content {
    padding: var(--size-4-2, 8px) var(--size-4-2, 8px) var(--size-4-3, 12px);
    background: transparent;
}
.dp-scal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 0 2px 6px;
}
.dp-scal-title {
    min-width: 0;
    overflow: hidden;
    font-size: var(--font-ui-small, 0.875em);
    font-weight: var(--font-semibold, 600);
    white-space: nowrap;
    text-overflow: ellipsis;
    color: var(--text-normal);
}
.dp-scal-nav {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
}
.dp-scal button.dp-scal-nav-btn,
.dp-scal button.dp-scal-today {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 22px;
    margin: 0;
    padding: 0 7px;
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-muted);
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 999px;
    cursor: pointer;
}
.dp-scal button.dp-scal-nav-btn {
    width: 22px;
    padding: 0;
}
.dp-scal-nav-btn svg {
    width: 14px;
    height: 14px;
}
.dp-scal button.dp-scal-nav-btn:hover,
.dp-scal button.dp-scal-today:hover {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
}
/* Week number column, then the seven days; the cells shrink with the sidebar */
.dp-scal-grid {
    display: grid;
    grid-template-columns: minmax(16px, 0.65fr) repeat(7, minmax(0, 1fr));
    row-gap: 2px;
    overflow: hidden; /* the paging slide stays inside the calendar */
}
.dp-scal-grid.dp-scal-slide-next > button {
    animation: dp-mc-slide-next 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-scal-grid.dp-scal-slide-prev > button {
    animation: dp-mc-slide-prev 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-scal-weekday {
    padding: 2px 0 4px;
    font-size: 0.68em;
    font-weight: var(--font-semibold, 600);
    text-align: center;
    text-transform: uppercase;
    color: var(--text-faint);
}
.dp-scal button.dp-scal-wk,
.dp-scal button.dp-scal-day {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: 30px;
    margin: 0;
    padding: 0;
    font-variant-numeric: tabular-nums;
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 6px;
    cursor: pointer;
}
.dp-scal button.dp-scal-wk {
    font-size: 0.68em;
    color: var(--text-faint);
}
.dp-scal button.dp-scal-wk.has-note {
    font-weight: var(--font-semibold, 600);
    color: var(--text-muted);
}
/* The week-number column: a thin line down its right edge, through the row gaps, splitting it from the days */
.dp-scal-wk-head {
    position: relative;
}
.dp-scal button.dp-scal-wk::before,
.dp-scal-wk-head::before {
    content: '';
    position: absolute;
    top: -1px;
    bottom: -1px;
    right: 0;
    width: 1px;
    background-color: var(--background-modifier-border);
    pointer-events: none;
}
.dp-scal button.dp-scal-day {
    padding-bottom: 5px; /* room for the dots under the number */
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-normal);
}
.dp-scal button.dp-scal-wk:hover,
.dp-scal button.dp-scal-day:hover {
    background-color: var(--background-modifier-hover);
}
/* The note open in the editor */
.dp-scal button.dp-scal-wk.is-active,
.dp-scal button.dp-scal-day.is-active {
    background-color: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
}
.dp-scal-day.is-weekend {
    color: var(--text-muted);
}
.dp-scal-day.is-other-month {
    opacity: 0.4;
}
.dp-scal-num {
    position: relative;
    width: 20px;
    height: 20px;
    line-height: 20px;
    text-align: center;
    border-radius: 999px;
}
.dp-scal-day.is-today .dp-scal-num {
    font-weight: var(--font-bold, 700);
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
}
/* A past day (or week) without its daily (weekly) note: a back slash through the number */
.dp-scal-day.is-missing-note .dp-scal-num,
.dp-scal-wk.is-missing-note .dp-scal-num {
    color: var(--text-faint);
}
.dp-scal-day.is-missing-note .dp-scal-num::after,
.dp-scal-wk.is-missing-note .dp-scal-num::after {
    content: '';
    position: absolute;
    left: 2px;
    right: 2px;
    top: 50%;
    height: 1px;
    background-color: var(--text-faint);
    transform: rotate(45deg);
}
.dp-scal-dots {
    position: absolute;
    left: 50%;
    bottom: 2px;
    display: flex;
    gap: 2px;
    transform: translateX(-50%);
    pointer-events: none;
}
.dp-scal-dot {
    flex-shrink: 0;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: var(--dp-scal-dot, var(--color-blue));
}
.dp-scal-dot.is-task {
    background-color: var(--dp-task-color, #ff9f1c);
}
.dp-scal-dot.is-done {
    opacity: 0.4;
}

/* Drawer tier 2: segmented mode switcher; the thumb slides by transform */
.dp-drawer-modes {
    position: relative;
    isolation: isolate;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: repeat(var(--dp-mode-count, 2), minmax(0, 1fr));
    margin: 2px var(--size-4-2, 8px) var(--size-4-2, 8px);
    padding: 2px;
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    border-radius: 10px;
}
.dp-drawer-modes-thumb {
    position: absolute;
    z-index: -1;
    top: 2px;
    bottom: 2px;
    left: 2px;
    width: calc((100% - 4px) / var(--dp-mode-count, 2));
    background-color: var(--dp-segment-active);
    border-radius: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 3px 8px rgba(0, 0, 0, 0.08),
        inset 0 0 0 1px var(--dp-glass-border), inset 0 1px 0 var(--dp-glass-highlight);
    transform: translateX(calc(var(--dp-mode-index, 0) * 100%));
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.dp-side-drawer button.dp-drawer-mode {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    height: 28px;
    margin: 0;
    padding: 0 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-medium, 500);
    white-space: nowrap;
    color: var(--text-muted);
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 8px;
    cursor: pointer;
    transition: color 0.15s ease;
}
.dp-side-drawer button.dp-drawer-mode:hover {
    color: var(--text-normal);
}
.dp-side-drawer button.dp-drawer-mode.is-active {
    font-weight: var(--font-semibold, 600);
    color: var(--text-normal);
}
.dp-drawer-mode-icon {
    display: inline-flex;
}
.dp-drawer-mode-icon svg {
    width: 14px;
    height: 14px;
}
.dp-drawer-mode-label {
    overflow: hidden;
    text-overflow: ellipsis;
}
.dp-drawer-mode .dp-drawer-count {
    padding: 0 5px;
    line-height: 16px;
}
.dp-drawer-mode.is-active .dp-drawer-count {
    color: var(--text-accent);
    background-color: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
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
/* Drawer tier 3: the active panel; a mode switch slides the new body in from its segment's side */
.dp-drawer-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: var(--size-4-2, 8px);
    border-top: 1px solid var(--background-modifier-border);
}
.dp-drawer-enter-next {
    animation: dp-drawer-enter-next 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-drawer-enter-prev {
    animation: dp-drawer-enter-prev 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes dp-drawer-enter-next {
    from { opacity: 0; transform: translateX(16px); }
}
@keyframes dp-drawer-enter-prev {
    from { opacity: 0; transform: translateX(-16px); }
}
@media (prefers-reduced-motion: reduce) {
    .dp-mc-slide-next, .dp-mc-slide-prev, .dp-scal-slide-next > button, .dp-scal-slide-prev > button, .dp-drawer-enter-next, .dp-drawer-enter-prev,
    .dp-drawer-enter-next .dp-stats-bar-fill, .dp-drawer-enter-prev .dp-stats-bar-fill, .dp-priority-popover {
        animation: none;
    }
    .dp-drawer-modes-thumb, .dp-stats-ring-arc {
        transition: none;
    }
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
/* Invisible date input behind the Move menu's "Pick a date…": only its system picker shows, at the Move button */
.dp-date-pick-proxy {
    position: fixed;
    width: 1px;
    height: 1px;
    padding: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
}
/* A section with no task is not shown; Today and Undated reappear during a drag, as drop targets */
.dp-drawer-section.is-empty {
    display: none;
}
.dp-pointer-dragging .dp-drawer-section.is-empty[data-section="today"],
.dp-pointer-dragging .dp-drawer-section.is-empty[data-section="undated"],
.dp-drawer-section.is-empty.dp-drop-target {
    display: block;
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
.dp-grid-task-item.is-dragging,
.dp-kanban-card.is-dragging {
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
/* Smart quick-add preview (smartEntry.ts): what Enter / Save will set, as small chips under the field */
.dp-smart-preview {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
}
.dp-smart-preview.is-empty {
    display: none;
}
.dp-side-drawer .dp-smart-preview {
    margin: calc(-1 * var(--size-4-1, 4px)) 0 var(--size-4-2, 8px);
}
.dp-smart-chip {
    padding: 1px 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    line-height: 1.6;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-normal);
    background-color: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--interactive-accent) 30%, transparent);
    border-radius: 999px;
}
.dp-smart-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
}
.dp-smart-row.is-empty {
    display: none;
}
.dp-smart-row > .dp-smart-preview {
    flex: 1;
}
.dp-smart-row > button.dp-smart-apply {
    flex-shrink: 0;
    height: 24px;
    margin: 0;
    padding: 0 10px;
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-normal);
    background: var(--dp-glass-thumb);
    border: none;
    border-radius: 999px;
    box-shadow: var(--dp-glass-thumb-shadow);
    cursor: pointer;
}
.dp-smart-row > button.dp-smart-apply:hover {
    filter: brightness(1.1);
}
/* Today's free time under the quick capture: left of the working hours, booked, still to schedule */
.dp-drawer-capacity {
    margin: 0 0 var(--size-4-2, 8px);
    padding: 7px 10px 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    background-color: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 8px);
}
.dp-capacity-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
}
.dp-capacity-label {
    color: var(--text-muted);
}
.dp-capacity-value {
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
    font-variant-numeric: tabular-nums;
    color: var(--text-normal);
}
.dp-capacity-bar {
    display: flex;
    height: 6px;
    margin-top: 5px;
    overflow: hidden;
    background-color: var(--background-modifier-border);
    border-radius: 999px;
}
.dp-capacity-booked,
.dp-capacity-plan {
    flex: none;
    width: var(--dp-fill, 0%);
    height: 100%;
    transition: width 0.3s ease;
}
.dp-capacity-booked {
    background-color: var(--text-faint);
}
.dp-capacity-plan {
    background-color: var(--interactive-accent);
}
.dp-capacity-meta {
    margin-top: 4px;
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
}
.dp-capacity-warn {
    margin-top: 3px;
    font-weight: var(--font-medium, 500);
    color: var(--color-orange);
}
.dp-drawer-capacity.is-over {
    border-color: color-mix(in srgb, var(--color-orange) 45%, var(--background-modifier-border));
}
.dp-drawer-capacity.is-over .dp-capacity-plan {
    background-color: var(--color-orange);
}
.dp-drawer-capacity.is-over .dp-capacity-value {
    color: var(--color-orange);
}
/* Work left in a drawer section (timed lengths + ⏱ estimates), beside its count */
.dp-drawer-section-time {
    flex-shrink: 0;
    font-size: var(--font-ui-smaller, 0.8em);
    font-variant-numeric: tabular-nums;
    color: var(--text-faint);
}
/* ⏱ estimate on an untimed drawer card */
.dp-drawer-card-estimate {
    flex-shrink: 0;
    padding: 0 5px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    color: var(--text-muted);
    background-color: var(--background-modifier-hover);
    border-radius: 999px;
}
.dp-drawer-card.is-done .dp-drawer-card-estimate {
    opacity: 0.6;
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
    right: 30px;
    display: flex;
    flex-wrap: wrap; /* a narrow drawer: the pills take two rows instead of running off the card */
    justify-content: flex-end;
    max-width: calc(100% - 40px);
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
/* Tablets have no hover: the triage pills sit on their own row below the title */
.is-mobile .dp-drawer-card {
    flex-wrap: wrap;
    cursor: default;
}
.is-mobile .dp-side-drawer .dp-drawer-card .dp-drawer-card-actions {
    position: static;
    flex-basis: 100%;
    padding: 0 0 0 22px;
    transform: none;
    background: none;
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
    overflow: hidden;
    font-size: 0.85em;
    font-weight: var(--font-bold, 700);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-overflow: ellipsis; /* the words' extras (date, deadline, priority) follow the time */
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
.dp-grid-header.dp-drop-target,
.dp-allday-cell.dp-drop-target {
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
.dp-drawer-card-date.is-time {
    color: var(--text-muted);
}
/* 📅 deadline countdown (drawer Deadlines section, Board cards): accent, amber when missed or due today. Never red,
   which already reads as cancelled / error. */
.dp-due-chip {
    padding: 0 6px;
    border-radius: var(--radius-s, 4px);
    color: var(--text-accent);
    background-color: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
    white-space: nowrap;
}
.dp-due-chip.is-urgent {
    color: var(--color-orange);
    background-color: color-mix(in srgb, var(--color-orange) 14%, transparent);
}
.dp-badge.dp-due-chip {
    padding: 2px 6px;
    border-color: transparent;
}
/* Deadlines on the Daily / N-day / Weekly views: a dashed line at the due time (flag at its right end) or an all-day
   chip. The task colour filled solid (task cards are a tint of it); red once missed. */
.dp-deadline-marker,
.dp-deadline-chip {
    --dp-deadline-color: var(--dp-task-color, #ff9f1c);
}
.dp-deadline-marker.is-missed,
.dp-deadline-chip.is-missed {
    --dp-deadline-color: var(--color-red, #e93147);
}
/* A done task's deadline: the faded task colour of a done card, struck through; cancelled in the error colour */
.dp-deadline-marker.is-done,
.dp-deadline-chip.is-done,
.dp-gc-item.dp-gc-deadline.is-done {
    --dp-deadline-color: color-mix(in srgb, var(--dp-task-color, #ff9f1c) 35%, var(--background-modifier-border));
}
.dp-deadline-marker.is-cancelled,
.dp-deadline-chip.is-cancelled,
.dp-gc-item.dp-gc-deadline.is-cancelled {
    --dp-deadline-color: color-mix(in srgb, var(--text-error) 35%, var(--background-modifier-border));
}
.dp-deadline-marker.is-done .dp-deadline-flag,
.dp-deadline-chip.is-done,
.dp-gc-item.dp-gc-deadline.is-done {
    opacity: 0.75;
}
.dp-deadline-marker.is-done .dp-deadline-flag,
.dp-deadline-chip.is-done,
.dp-grid-task-item.dp-deadline-chip.is-done {
    color: var(--text-muted) !important;
    box-shadow: none;
    cursor: pointer;
}
.dp-deadline-marker.is-done .dp-deadline-title,
.dp-deadline-chip.is-done .dp-deadline-title,
.dp-gc-deadline.is-done .dp-gc-item-title-text {
    text-decoration: line-through;
}
.dp-deadline-marker {
    position: absolute;
    left: 0;
    right: 0;
    height: 0;
    border-top: 2px dashed var(--dp-deadline-color);
    z-index: 9;
    pointer-events: none;
}
/* The flag is one paragraph (time, then title, wrapping under the time), at most 3 lines, centred on the dashed line */
.dp-deadline-flag {
    position: absolute;
    top: 0;
    right: 2px;
    transform: translateY(-50%);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow-wrap: anywhere;
    max-width: calc(100% - 20px); /* the dashed line always shows to the flag's left */
    box-sizing: border-box;
    padding: 2px 6px;
    border-radius: var(--radius-s, 4px);
    background-color: var(--dp-deadline-color);
    color: var(--text-on-accent, #fff);
    font-size: 0.82em;
    line-height: 1.4;
    overflow: hidden;
    box-shadow: var(--shadow-s);
    cursor: pointer;
    pointer-events: auto;
}
.dp-deadline-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    margin: 1px 0;
    padding: 2px 6px;
    border-radius: var(--radius-s, 4px);
    background-color: var(--dp-deadline-color);
    color: var(--text-on-accent, #fff);
    font-size: 0.75em;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
}
/* Dragging a deadline (desktop): the item fades, a dashed preview line shows the landing time, a label follows the pointer */
.dp-deadline-flag,
.dp-deadline-chip {
    cursor: grab;
}
.dp-deadline-flag.is-dragging,
.dp-deadline-chip.is-dragging {
    opacity: 0.4;
}
.dp-deadline-marker.is-preview,
.dp-deadline-chip.is-preview {
    --dp-deadline-color: var(--dp-task-color, #ff9f1c);
    opacity: 0.7;
    pointer-events: none;
}
.dp-deadline-marker.is-preview .dp-deadline-flag {
    pointer-events: none;
    box-shadow: 0 0 0 1.5px var(--background-primary), var(--shadow-s);
}
.dp-deadline-chip.is-preview {
    outline: 1.5px dashed var(--dp-deadline-color);
    outline-offset: 1px;
}
/* Monthly: the deadline chip inside the cell's item list (beats .dp-grid-task-item's grey fill) */
.dp-grid-task-item.dp-deadline-chip {
    justify-content: flex-start !important;
    margin: 0 !important;
    border: none !important;
    background-color: var(--dp-deadline-color) !important;
    color: var(--text-on-accent, #fff) !important;
}
/* List: a deadline row on its due day, the time in the task colour */
.dp-gc-item.dp-gc-deadline {
    --dp-deadline-color: var(--dp-task-color, #ff9f1c);
}
.dp-gc-item.dp-gc-deadline.is-missed {
    --dp-deadline-color: var(--color-red, #e93147);
}
.dp-gc-deadline .dp-gc-item-time,
.dp-gc-deadline .dp-agenda-start {
    color: var(--dp-deadline-color);
    font-weight: var(--font-semibold, 600);
}
.dp-deadline-ghost {
    position: fixed;
    z-index: var(--layer-tooltip, 1000);
    padding: 2px 8px;
    border-radius: var(--radius-s, 4px);
    background-color: var(--dp-task-color, #ff9f1c);
    color: var(--text-on-accent, #fff);
    font-size: var(--font-ui-smaller, 0.8em);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    box-shadow: var(--shadow-s);
    pointer-events: none;
}
.dp-deadline-time {
    flex-shrink: 0;
    font-weight: var(--font-semibold, 600);
    font-variant-numeric: tabular-nums;
}
.dp-deadline-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
}
.dp-deadline-chip {
    white-space: nowrap;
}
.dp-deadline-flag .dp-deadline-time {
    margin-right: 4px;
    white-space: nowrap;
}
.dp-deadline-flag .dp-deadline-title {
    overflow: visible;
}
/* A task planned past its deadline (views.ts renderLateBadge): a small warning mark beside its title */
.dp-late-badge {
    flex-shrink: 0;
    margin: 0 2px;
    color: var(--text-error);
    font-size: 0.95em;
    font-weight: var(--font-semibold, 600);
    line-height: 1;
    cursor: help;
}
/* Deadlines at the same or nearby times: one stack hung on the first line (the whole stack centred on it), a row each */
.dp-deadline-marker.has-stack {
    z-index: 10;
}
.dp-deadline-stack {
    position: absolute;
    top: 0;
    right: 2px;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    max-width: calc(100% - 20px);
    pointer-events: auto;
}
.dp-deadline-stack > .dp-deadline-chip {
    max-width: 100%;
    margin: 0;
    font-size: 0.82em;
    line-height: 1.4;
    box-shadow: var(--shadow-s);
}
.dp-deadline-stack > .dp-deadline-more {
    font-weight: var(--font-semibold, 600);
}
.dp-modal-due-inputs {
    display: flex;
    gap: 6px;
}
.dp-modal-due-inputs .dp-modal-input {
    flex: 1;
    min-width: 0;
}
/* Day headings inside the Deadlines section (Missed, Today, Tomorrow, Fri, Oct 24 …) */
.dp-drawer-group-label {
    margin: 4px 4px 0;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-semibold, 600);
    color: var(--text-muted);
}
.dp-drawer-group-label:first-child {
    margin-top: 0;
}
/* Today's Tasks: done tasks stay listed (undo in place), struck through and faded */
.dp-drawer-card.is-done .dp-drawer-card-title {
    text-decoration: line-through;
    color: var(--text-faint);
}
.dp-drawer-card.is-done .dp-drawer-card-date {
    opacity: 0.6;
}
/* ↗ open in note (Today's Tasks) */
.dp-side-drawer button.dp-drawer-card-link {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    min-width: 0;
    margin: 0;
    padding: 0;
    font-size: var(--font-ui-small, 0.9em);
    line-height: 1;
    color: var(--text-faint);
    background: transparent;
    border: none;
    border-radius: 6px;
    box-shadow: none;
    cursor: pointer;
}
.dp-side-drawer button.dp-drawer-card-link:hover {
    color: var(--text-accent);
    background-color: var(--background-modifier-hover);
}

/* Priority badge on a drawer card: one click opens the picker (Obsidian Tasks emoji); faint flag when unset */
.dp-side-drawer button.dp-priority-trigger {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin: 0;
    padding: 0;
    font-size: 0.85em;
    line-height: 1;
    color: var(--text-faint);
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    box-shadow: none;
    cursor: pointer;
    transition: background-color 0.12s ease, border-color 0.12s ease, opacity 0.12s ease;
}
.dp-side-drawer button.dp-priority-trigger:hover,
.dp-side-drawer button.dp-priority-trigger:focus-visible {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
    border-color: var(--background-modifier-border);
}
.dp-side-drawer button.dp-priority-trigger.is-empty {
    opacity: 0;
}
.dp-drawer-card:hover button.dp-priority-trigger.is-empty,
.dp-drawer-card:focus-within button.dp-priority-trigger.is-empty {
    opacity: 1;
}
.is-mobile .dp-side-drawer button.dp-priority-trigger.is-empty {
    opacity: 0.45;
}
.dp-priority-trigger svg {
    width: 13px;
    height: 13px;
}

/* MIT: an open 🔺 Highest task reads as today's core focus wherever its card appears */
.dp-drawer-card.is-mit {
    overflow: hidden;
    background: linear-gradient(120deg, color-mix(in srgb, var(--color-red) 5%, var(--background-primary)), var(--background-primary) 60%);
    border-color: color-mix(in srgb, var(--color-red) 20%, var(--background-modifier-border));
    box-shadow: 0 1px 6px color-mix(in srgb, var(--color-red) 6%, transparent);
}
.dp-drawer-card.is-mit::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: linear-gradient(to bottom, var(--color-red), var(--color-orange));
    opacity: 0.55;
}
.dp-drawer-card.is-mit:hover {
    border-color: color-mix(in srgb, var(--color-red) 38%, var(--background-modifier-border));
    box-shadow: 0 2px 10px color-mix(in srgb, var(--color-red) 10%, transparent);
}
.dp-drawer-card.is-mit .dp-drawer-card-title {
    font-weight: var(--font-semibold, 600);
}
.dp-drawer-card.is-mit .dp-drawer-card-actions {
    background: linear-gradient(to right, transparent, var(--background-primary) 12px);
}
/* Today's Focus, embedded at the top of Today's Tasks: no box of its own (its cards keep the list's exact edges),
   just a small 🎯 label line above the hero cards. Empty, it only appears while a task
   is dragged (as the "make it 🔺 Highest" drop zone). */
.dp-drawer-focus-slot {
    position: relative;
    margin: 0 0 4px;
    padding: 2px 0 2px;
    border-radius: var(--radius-m, 8px);
}
.dp-drawer-focus-label {
    padding: 2px 12px 0; /* card margin 4px + card padding 8px: lines up with the checkboxes */
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.02em;
    color: color-mix(in srgb, var(--color-red) 60%, var(--text-muted));
}
.dp-drawer-focus-hint {
    padding: 0 8px 6px;
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-muted);
}
.dp-drawer-focus-slot.is-empty {
    display: none;
}
.dp-pointer-dragging .dp-drawer-focus-slot.is-empty,
.dp-drawer-focus-slot.is-empty.dp-drop-target {
    display: block;
}
.dp-drawer-focus-slot.dp-drop-target::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    border: 2px dashed color-mix(in srgb, var(--color-red) 55%, transparent);
    border-radius: inherit;
    pointer-events: none;
}
.dp-drawer-focus-slot.dp-drop-target {
    background-color: color-mix(in srgb, var(--color-red) 6%, transparent);
}
/* Focus hero card: same box as every drawer card (width, margins, radius), lifted by a translucent warm tint and a
   soft ambient glow instead of a strong border; the 🎯 FOCUS pill sits inside it. .dp-side-drawer-qualified so it also
   wins over the More sheet's glass cards. */
.dp-side-drawer .dp-drawer-card.is-focus-hero {
    background:
        linear-gradient(120deg, color-mix(in srgb, var(--color-red) 9%, transparent), color-mix(in srgb, var(--color-orange) 4%, transparent) 55%, transparent 85%),
        var(--dp-card-bg, var(--background-primary));
    border-color: color-mix(in srgb, var(--color-red) 14%, var(--dp-glass-border, var(--background-modifier-border)));
    box-shadow:
        0 2px 6px color-mix(in srgb, var(--color-red) 8%, transparent),
        0 8px 22px -6px color-mix(in srgb, var(--color-red) 18%, transparent),
        inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-side-drawer .dp-drawer-card.is-focus-hero:hover {
    border-color: color-mix(in srgb, var(--color-red) 24%, var(--dp-glass-border, var(--background-modifier-border)));
    box-shadow:
        0 2px 8px color-mix(in srgb, var(--color-red) 10%, transparent),
        0 10px 26px -6px color-mix(in srgb, var(--color-red) 24%, transparent),
        inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-side-drawer .dp-drawer-card.is-focus-hero::before {
    content: none; /* the tint and the pill mark it; no accent bar */
}
.dp-focus-pill {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 7px;
    font-size: 0.66em;
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1;
    white-space: nowrap;
    color: color-mix(in srgb, var(--color-red) 70%, var(--text-normal));
    background-color: color-mix(in srgb, var(--color-red) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-red) 18%, transparent);
    border-radius: 999px;
}

/* Priority picker: a frosted popover (in document.body, so it may overhang the drawer) */
.dp-priority-popover {
    position: fixed;
    z-index: var(--layer-menu, 65);
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 140px;
    padding: 4px;
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--dp-glass-border);
    border-radius: 10px;
    box-shadow: var(--dp-glass-shadow-lg), inset 0 1px 0 var(--dp-glass-highlight);
    transform-origin: top right;
    animation: dp-popover-in 0.14s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-priority-popover.is-above {
    transform-origin: bottom right;
}
@keyframes dp-popover-in {
    from { opacity: 0; transform: scale(0.94); }
}
.dp-priority-popover button.dp-priority-option {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    height: 28px;
    margin: 0;
    padding: 0 8px;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-normal);
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 6px;
    cursor: pointer;
}
.dp-priority-popover button.dp-priority-option:hover,
.dp-priority-popover button.dp-priority-option:focus-visible {
    background-color: var(--background-modifier-hover);
    outline: none;
}
.dp-priority-popover button.dp-priority-option.is-active {
    font-weight: var(--font-semibold, 600);
    color: var(--text-accent);
    background-color: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
}
.dp-priority-popover button.dp-priority-option.is-active::after {
    content: '✓';
    margin-left: auto;
}
.dp-priority-option-emoji {
    width: 18px;
    text-align: center;
    color: var(--text-faint);
}

/* Stats panel: ring + time tiles, meters, priority breakdown, a short note */
.dp-stats {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 2px 8px;
}
.dp-stats-day {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
}
.dp-stats-day-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.dp-stats-day-chip {
    flex-shrink: 0;
    padding: 0 7px;
    font-size: var(--font-ui-smaller, 0.8em);
    line-height: 18px;
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    border-radius: 999px;
}
.dp-stats-hero,
.dp-stats-card {
    background-color: var(--dp-card-bg);
    border: 1px solid var(--dp-glass-border);
    border-radius: 12px;
    box-shadow: inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-stats-hero {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
}
.dp-stats-ring {
    --dp-ring-from: var(--interactive-accent);
    --dp-ring-to: var(--color-purple, #a882ff);
    position: relative;
    flex-shrink: 0;
    width: 104px;
    height: 104px;
}
.dp-stats-ring.is-complete {
    --dp-ring-from: var(--color-green);
    --dp-ring-to: var(--color-cyan, #53dfdd);
}
.dp-stats-ring svg {
    width: 100%;
    height: 100%;
    transform: rotate(-90deg); /* the arc starts at 12 o'clock */
}
.dp-stats-ring-track {
    fill: none;
    stroke: var(--background-modifier-border);
}
.dp-stats-ring-arc {
    fill: none;
    stroke-linecap: round;
    transition: stroke-dashoffset 0.8s cubic-bezier(0.22, 1, 0.36, 1);
    filter: drop-shadow(0 0 3px color-mix(in srgb, var(--dp-ring-from) 45%, transparent));
}
.dp-stats-ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}
.dp-stats-ring-value {
    font-size: 1.45em;
    font-weight: var(--font-bold, 700);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1.1;
}
.dp-stats-ring-caption {
    max-width: 72px;
    font-size: 0.66em;
    line-height: 1.2;
    text-align: center;
    color: var(--text-muted);
}
.dp-stats-tiles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.dp-stats-tile-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.68em;
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
}
.dp-stats-tile-label::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: var(--text-muted);
}
.dp-stats-tile.is-completed .dp-stats-tile-label::before {
    background-color: var(--interactive-accent);
}
.dp-stats-tile.is-remaining .dp-stats-tile-label::before {
    background-color: transparent;
    box-shadow: inset 0 0 0 1.5px var(--text-faint);
}
.dp-stats-tile-value {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
    font-variant-numeric: tabular-nums;
}
.dp-stats-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 12px;
}
.dp-stats-card-title {
    font-size: 0.68em;
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
}
.dp-stats-meter-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-size: var(--font-ui-smaller, 0.8em);
}
.dp-stats-meter-label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: var(--font-medium, 500);
}
.dp-stats-meter-value {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
}
.dp-stats-bar {
    height: 6px;
    margin-top: 5px;
    overflow: hidden;
    background-color: var(--background-modifier-border);
    border-radius: 999px;
}
.dp-stats-bar-fill {
    --dp-bar-color: var(--interactive-accent);
    width: var(--dp-fill, 0%);
    height: 100%;
    background: linear-gradient(90deg, var(--dp-bar-color), color-mix(in srgb, var(--dp-bar-color) 60%, var(--color-purple, #a882ff)));
    border-radius: inherit;
    transform-origin: left center;
}
/* Bars grow in when the panel is opened, not on every data render */
.dp-drawer-enter-next .dp-stats-bar-fill,
.dp-drawer-enter-prev .dp-stats-bar-fill {
    animation: dp-stats-bar-grow 0.7s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes dp-stats-bar-grow {
    from { transform: scaleX(0); }
}
.dp-stats-meter.is-focus .dp-stats-bar-fill {
    background: linear-gradient(90deg, var(--color-red), var(--color-orange));
}
.dp-stats-priority.is-highest .dp-stats-bar-fill { --dp-bar-color: var(--color-red); }
.dp-stats-priority.is-high .dp-stats-bar-fill { --dp-bar-color: var(--color-orange); }
.dp-stats-priority.is-medium .dp-stats-bar-fill { --dp-bar-color: var(--color-yellow); }
.dp-stats-priority.is-normal .dp-stats-bar-fill { --dp-bar-color: var(--interactive-accent); }
.dp-stats-priority.is-low .dp-stats-bar-fill { --dp-bar-color: var(--color-blue); }
.dp-stats-priority.is-lowest .dp-stats-bar-fill { --dp-bar-color: var(--text-faint); }
.dp-stats-priority .dp-stats-bar {
    height: 4px;
}
.dp-stats-message {
    padding: 10px 12px;
    font-size: var(--font-ui-smaller, 0.8em);
    line-height: 1.45;
    color: var(--text-muted);
    background-color: color-mix(in srgb, var(--interactive-accent) 7%, transparent);
    border: 1px dashed color-mix(in srgb, var(--interactive-accent) 28%, transparent);
    border-radius: 10px;
}
.dp-stats-message.is-done {
    color: var(--text-normal);
    background-color: color-mix(in srgb, var(--color-green) 10%, transparent);
    border-color: color-mix(in srgb, var(--color-green) 35%, transparent);
}
.dp-stats-message.is-warning {
    color: var(--text-normal);
    background-color: color-mix(in srgb, var(--color-red) 9%, transparent);
    border-color: color-mix(in srgb, var(--color-red) 35%, transparent);
}
/* Review today (modals.ts DayReviewModal): a card per open task with its choice (glass segmented), "All:" pills above */
.dp-review-summary {
    margin-top: 2px;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
}
.dp-review-hint {
    margin-bottom: 8px;
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-muted);
}
/* Review today: today's daily note not written yet */
.dp-review-note-missing {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding: 8px 10px;
    font-size: var(--font-ui-small, 0.875em);
    color: var(--text-normal);
    background-color: color-mix(in srgb, var(--color-orange) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-orange) 35%, transparent);
    border-radius: 10px;
}
.dp-review-note-icon {
    display: flex;
    flex-shrink: 0;
    color: var(--color-orange);
}
.dp-review-note-icon svg {
    width: 16px;
    height: 16px;
}
.dp-review-note-text {
    flex: 1;
    min-width: 0;
}
.dp-review-note-missing button.dp-review-note-btn {
    flex-shrink: 0;
    height: auto;
    padding: 4px 12px;
    font-size: var(--font-ui-smaller, 0.8em);
    border-radius: 999px;
    cursor: pointer;
}
.dp-review-empty {
    padding: 20px 0;
    text-align: center;
    color: var(--text-muted);
}
.dp-review-bulk {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
}
.dp-review-bulk-label {
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-muted);
}
.dp-review-bulk > button.dp-review-bulk-btn {
    height: 24px;
    margin: 0;
    padding: 0 10px;
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-normal);
    background: var(--dp-glass-thumb);
    border: none;
    border-radius: 999px;
    box-shadow: var(--dp-glass-thumb-shadow);
    cursor: pointer;
}
.dp-review-bulk > button.dp-review-bulk-btn:hover {
    background: var(--dp-glass-thumb-hover);
}
.dp-review-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 55vh;
    overflow-y: auto;
    padding: 2px;
}
.dp-review-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    background-color: var(--dp-card-bg);
    border: 1px solid var(--dp-glass-border);
    border-radius: 12px;
    box-shadow: inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-review-row-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
}
.dp-review-time {
    flex-shrink: 0;
    font-size: var(--font-ui-smaller, 0.8em);
    font-variant-numeric: tabular-nums;
    color: var(--text-accent);
}
.dp-review-title {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-weight: var(--font-medium, 500);
}
.dp-glass-seg.dp-review-choice .dp-glass-seg-option {
    min-height: 26px;
    padding: 3px 8px;
    font-size: 11.5px;
}
/* Day / Week switch at the top of the Stats panel */
.dp-glass-seg.dp-stats-range {
    margin: 2px 2px 10px;
}
/* Week: a bar per day, stacked from the bottom (done, still planned, events), against the working hours (dashed) */
.dp-stats-week-bars {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
}
.dp-stats-week-bars > button.dp-stats-week-day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 0;
    height: auto;
    margin: 0;
    padding: 4px 0;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 8px;
    box-shadow: none;
    cursor: pointer;
    transition: background-color 0.15s ease;
}
.dp-stats-week-bars > button.dp-stats-week-day:hover {
    background-color: var(--background-modifier-hover);
}
.dp-stats-week-value {
    height: 1.3em;
    font-size: 0.62em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.dp-stats-week-col {
    position: relative;
    display: flex;
    flex-direction: column-reverse;
    width: 12px;
    height: 84px;
    overflow: hidden;
    background-color: var(--background-modifier-border);
    border-radius: 999px;
}
.dp-stats-week-seg {
    flex: none;
    transform-origin: bottom center;
}
.dp-stats-week-seg.is-done { background-color: var(--interactive-accent); }
.dp-stats-week-seg.is-planned { background-color: color-mix(in srgb, var(--interactive-accent) 42%, transparent); }
.dp-stats-week-seg.is-event { background-color: color-mix(in srgb, var(--color-blue) 70%, transparent); }
.dp-stats-week-cap {
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--dp-week-cap, 100%);
    border-top: 1.5px dashed var(--text-faint);
}
.dp-stats-week-day.is-over .dp-stats-week-value {
    color: var(--text-error);
    font-weight: var(--font-semibold, 600);
}
.dp-stats-week-day.is-over .dp-stats-week-col {
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--color-red) 55%, transparent);
}
.dp-stats-week-label {
    font-size: 0.68em;
    line-height: 1.4;
}
.dp-stats-week-day.is-today .dp-stats-week-label {
    color: var(--interactive-accent);
    font-weight: var(--font-bold, 700);
}
.dp-stats-week-bars > button.dp-stats-week-day.is-current {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
}
.dp-stats-week-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 0.68em;
    color: var(--text-muted);
}
.dp-stats-week-legend > span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}
.dp-stats-week-legend > span::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 2px;
}
.dp-stats-week-legend > .is-done::before { background-color: var(--interactive-accent); }
.dp-stats-week-legend > .is-planned::before { background-color: color-mix(in srgb, var(--interactive-accent) 42%, transparent); }
.dp-stats-week-legend > .is-event::before { background-color: color-mix(in srgb, var(--color-blue) 70%, transparent); }
.dp-stats-week-legend > .is-cap::before {
    height: 0;
    border-radius: 0;
    border-top: 1.5px dashed var(--text-faint);
}
/* The bars grow in when the panel opens or the range switches to Week */
.dp-drawer-enter-next .dp-stats-week-seg,
.dp-drawer-enter-prev .dp-stats-week-seg,
.dp-stats.dp-stats-enter .dp-stats-week-seg {
    animation: dp-stats-week-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes dp-stats-week-grow {
    from { transform: scaleY(0); }
}
@media (prefers-reduced-motion: reduce) {
    .dp-stats-week-seg { animation: none !important; }
}
/* Subtle until hovered: it is a reference, not an action */

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
/* Drop targets in Month (day cells) and the Board (columns; pointer drag and native drag-over): the drawer's look, a
   tint plus a dashed ring drawn on a layer ABOVE the cards, so cards filling the cell / column cannot hide it */
.dp-grid-cell,
.dp-kanban-column {
    position: relative;
}
:is(.dp-grid-cell, .dp-kanban-column).dp-drop-target,
.dp-kanban-column.drag-over {
    background-color: color-mix(in srgb, var(--interactive-accent) 14%, transparent); /* over the theme background */
}
:is(.dp-grid-cell, .dp-kanban-column).dp-drop-target::after,
.dp-kanban-column.drag-over::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 3;
    border: 2px dashed var(--interactive-accent);
    border-radius: inherit;
    pointer-events: none;
}
/* Set on the dragging view's container (views.ts beginPointerDrag), never on body: toggling a body class that a
   universal selector keys off restyles every element in the app, the editor's included */
.dp-pointer-dragging,
.dp-pointer-dragging * {
    cursor: grabbing !important;
}

/* Glass segmented tokens (ported from Web Novel Helper's --wnh-glass-*). Named --dp-gseg-* because --dp-glass-*
   already holds this plugin's own glass material (cards, modals, menus) */
.dp-container,
.dp-settings {
    /* A faint tint under the gloss so the glass reads on a plain background */
    --dp-gseg-btn:
        linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.1)),
        color-mix(in srgb, var(--text-normal) 7%, transparent);
    --dp-gseg-btn-hover:
        linear-gradient(180deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.15)),
        color-mix(in srgb, var(--text-normal) 11%, transparent);
    --dp-gseg-border: rgba(255, 255, 255, 0.85);
    --dp-gseg-edge: rgba(15, 23, 42, 0.1);
    --dp-gseg-highlight: rgba(255, 255, 255, 0.95);
    --dp-gseg-shadow: 0 2px 6px rgba(15, 23, 42, 0.1);
    --dp-gseg-blur: blur(12px) saturate(1.6);
}
.theme-dark .dp-container,
.theme-dark .dp-settings {
    --dp-gseg-btn:
        linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.03)),
        rgba(255, 255, 255, 0.05);
    --dp-gseg-btn-hover:
        linear-gradient(180deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.05)),
        rgba(255, 255, 255, 0.08);
    --dp-gseg-border: rgba(255, 255, 255, 0.12);
    --dp-gseg-edge: rgba(0, 0, 0, 0.4);
    --dp-gseg-highlight: rgba(255, 255, 255, 0.18);
    --dp-gseg-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
@media (prefers-reduced-transparency: reduce) {
    .dp-container, .dp-settings,
    .theme-dark .dp-container, .theme-dark .dp-settings {
        --dp-gseg-btn: var(--background-modifier-hover);
        --dp-gseg-btn-hover: var(--background-modifier-border);
        --dp-gseg-border: transparent;
        --dp-gseg-highlight: transparent;
        --dp-gseg-blur: none;
    }
}

/* Glass segmented control (glassSegmented.ts): pill track with a translucent thumb that slides between options
   and stretches briefly while moving. Position and width come from the selected button (--thumb-x / --thumb-w) */
.dp-glass-seg {
    position: relative;
    display: flex;
    padding: 3px;
    gap: 0;
    border-radius: 999px;
    background: var(--background-modifier-hover);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
    isolation: isolate;
    overflow-x: auto;
    scrollbar-width: none;
    flex-shrink: 0;
}
.dp-glass-seg::-webkit-scrollbar { display: none; }
.dp-glass-seg-thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    width: var(--thumb-w, 0px);
    transform: translateX(var(--thumb-x, 0px));
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--background-primary) 80%, transparent);
    background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04));
    -webkit-backdrop-filter: blur(10px) saturate(1.8);
    backdrop-filter: blur(10px) saturate(1.8);
    border: 0.5px solid rgba(255, 255, 255, 0.14);
    box-shadow:
        0 2px 8px rgba(0, 0, 0, 0.18),
        0 0 0 0.5px rgba(0, 0, 0, 0.08),
        inset 0 1px 0 rgba(255, 255, 255, 0.35),
        inset 0 -1px 2px rgba(0, 0, 0, 0.06);
    box-sizing: border-box;
    z-index: 0;
    pointer-events: none;
}
.dp-glass-seg.is-ready .dp-glass-seg-thumb {
    transition:
        transform 0.42s cubic-bezier(0.3, 1.3, 0.4, 1),
        width 0.42s cubic-bezier(0.3, 1.3, 0.4, 1),
        scale 0.2s ease;
}
/* While gliding the glass swells a little, then settles */
.dp-glass-seg.is-moving .dp-glass-seg-thumb {
    scale: 1.06 1.12;
}
.dp-glass-seg .dp-glass-seg-option {
    position: relative;
    z-index: 1;
    flex: 1 1 0;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: auto;
    min-height: 28px;
    padding: 5px 10px;
    border: none;
    border-radius: 999px;
    background: transparent;
    box-shadow: none;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    white-space: nowrap;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.25s;
}
.dp-glass-seg .dp-glass-seg-option:hover {
    background: transparent;
    color: var(--text-normal);
}
.dp-glass-seg .dp-glass-seg-option.is-active {
    color: var(--text-normal);
}
.dp-glass-seg .dp-glass-seg-option:focus-visible {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -2px;
    box-shadow: none;
}
.dp-glass-seg-icon { display: flex; }
.dp-glass-seg-icon svg { width: 15px; height: 15px; }
@media (prefers-reduced-motion: reduce) {
    .dp-glass-seg.is-ready .dp-glass-seg-thumb { transition: none; }
    .dp-glass-seg.is-moving .dp-glass-seg-thumb { scale: none; }
}

/* Settings page: top tab bar (DayPlannerSettingTab.createSettingsTabs) and two-way switches built with PillTabs, the
   planner's view-tab bar (.dp-tabs, sliding ::before pill) a step larger; only the active panel is shown */
.dp-settings .dp-tabs.dp-settings-tabs {
    margin-bottom: var(--size-4-4, 16px);
}
.dp-settings .dp-tabs > .dp-tab {
    height: auto;
    min-height: 32px;
    gap: 6px;
    font-size: var(--font-ui-small, 13px);
}
.dp-pill-tab-icon {
    display: inline-flex;
}
.dp-pill-tab-icon svg {
    width: 15px;
    height: 15px;
}
/* A setting whose control is a two-way switch (Sideways swipe): name and description on top, the switch full width
   below with one choice at each end; the description changes with the side chosen */
.dp-settings .setting-item.dp-setting-stacked {
    flex-wrap: wrap;
}
.dp-settings .setting-item.dp-setting-stacked > .setting-item-control {
    flex: 1 0 100%;
    justify-content: stretch;
    padding-top: var(--size-4-2, 8px);
}
.dp-settings .dp-tabs.dp-setting-switch {
    width: 100%;
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

/* Done / cancelled tasks are locked (views.ts isLockedTask): no grab hand, a click still opens the editor */
.dp-timeline-event.completed,
.dp-timeline-event.cancelled {
    cursor: pointer !important;
}

/* -------------------------------------------------------------
   Selection everywhere (Ctrl / Cmd + click, marquee): the timeline's dashed amber look, as an outline so cards with
   inline borders (monthly items, all-day chips, list rows, board cards) keep their layout
   ------------------------------------------------------------- */
.dp-container [data-select-id].selected,
.dp-container .dp-kanban-card.selected {
    outline: 2px dashed #ff9f1c;
    outline-offset: 1px;
    box-shadow: 0 0 10px rgba(255, 159, 28, 0.55);
}
/* Floating selection bar: count, Delete, clear */
.dp-selection-bar {
    position: absolute;
    left: 50%;
    bottom: 16px;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 14px;
    font-size: var(--font-ui-small, 0.9em);
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--dp-glass-border);
    border-radius: 999px;
    box-shadow: var(--dp-glass-shadow-lg), inset 0 1px 0 var(--dp-glass-highlight);
    transform: translateX(-50%);
    animation: dp-selection-bar-in 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-container.dp-drawer-open > .dp-selection-bar {
    left: calc(50% - var(--dp-drawer-w) / 2);
}
@keyframes dp-selection-bar-in {
    from { opacity: 0; transform: translate(-50%, 8px); }
}
.dp-selection-count {
    font-weight: var(--font-semibold, 600);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
.dp-selection-bar button.dp-selection-delete,
.dp-selection-bar button.dp-selection-clear {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 28px;
    margin: 0;
    padding: 0 12px;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-medium, 500);
    border: none;
    border-radius: 999px;
    box-shadow: none;
    cursor: pointer;
}
.dp-selection-bar button.dp-selection-delete {
    color: var(--text-on-accent);
    background-color: var(--color-red);
}
.dp-selection-bar button.dp-selection-delete:hover {
    filter: brightness(1.08);
}
.dp-selection-bar button.dp-selection-clear {
    width: 28px;
    padding: 0;
    justify-content: center;
    color: var(--text-muted);
    background: none;
}
.dp-selection-bar button.dp-selection-clear:hover {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
}
.dp-selection-icon,
.dp-selection-bar svg {
    display: inline-flex;
    width: 14px;
    height: 14px;
}

/* -------------------------------------------------------------
   Planner search mode: the header's top row steps aside and the field expands over its full width (views.ts
   placeSearchBar lays it over that row). Kept mounted across renders, so typing and IME composition survive.
   ------------------------------------------------------------- */
.dp-search-mode > .dp-header .dp-header-top {
    visibility: hidden;
}
.dp-search-float {
    position: absolute;
    z-index: 31; /* over the header (30) */
    display: none;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 4px 0 12px;
    box-sizing: border-box;
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--dp-glass-border);
    border-radius: 999px;
    box-shadow: var(--dp-glass-shadow), inset 0 1px 0 var(--dp-glass-highlight);
}
/* Motion standard: grows out of the toolbar's search button (views.ts openSearch sets its span in the bar as
   --dp-search-from-l / -r and its centre as --dp-search-origin-x), stretches a little past full width and settles;
   closing (.is-closing, views.ts closeSearch) draws it back into the button. The default is the row's right end. */
.dp-search-float.is-open {
    display: flex;
    transform-origin: var(--dp-search-origin-x, calc(100% - 20px)) 50%;
    animation: dp-search-expand var(--dp-motion-in) var(--dp-ease-spring);
}
.dp-search-float.is-open.is-closing {
    pointer-events: none;
    animation: dp-search-collapse var(--dp-motion-out) var(--dp-ease-exit) forwards;
}
@keyframes dp-search-expand {
    from {
        opacity: 0.4;
        transform: scaleX(0.6);
        clip-path: inset(0 var(--dp-search-from-r, 0px) 0 var(--dp-search-from-l, calc(100% - 40px)) round 999px);
    }
    to { opacity: 1; transform: none; clip-path: inset(0 0 0 0 round 999px); }
}
@keyframes dp-search-collapse {
    to {
        opacity: 0;
        transform: scaleX(0.6);
        clip-path: inset(0 var(--dp-search-from-r, 0px) 0 var(--dp-search-from-l, calc(100% - 40px)) round 999px);
    }
}
/* Mobile: the keyboard animates in at the same moment, so the bar just fades (a clip-path sweep during the viewport
   resize read as a jump). 16px text, or iOS zooms the whole app into the focused field. */
.is-mobile .dp-search-float.is-open {
    animation: dp-search-fade 0.18s ease-out;
}
.is-mobile .dp-search-float.is-open.is-closing {
    animation: dp-search-fade-out var(--dp-motion-out) ease-in forwards;
}
@keyframes dp-search-fade {
    from { opacity: 0; }
}
@keyframes dp-search-fade-out {
    to { opacity: 0; }
}
.is-mobile .dp-search-float input.dp-search-input {
    font-size: 16px;
}
/* Phone / compact, typing: the bottom bar and the task bar would dock right above the keyboard and squeeze the panes
   in between; they step aside until the field loses focus (keyboard down) */
.dp-compact-shell.dp-search-mode:has(input.dp-search-input:focus) > :is(.dp-bottom-bar, .dp-current-task-bar) {
    display: none;
}
.dp-search-float:focus-within {
    border-color: var(--interactive-accent);
    box-shadow: var(--dp-glass-shadow), 0 0 0 3px color-mix(in srgb, var(--interactive-accent) 22%, transparent);
}
.dp-search-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--text-muted);
}
.dp-search-icon svg {
    width: 15px;
    height: 15px;
}
.dp-search-float input.dp-search-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-normal);
    background: none;
    border: none;
    box-shadow: none;
    outline: none;
}
.dp-search-float input.dp-search-input::-webkit-search-cancel-button {
    display: none; /* our own × closes */
}
.dp-search-count {
    flex-shrink: 0;
    font-size: var(--font-ui-smaller, 0.8em);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--text-muted);
}
.dp-search-float.is-empty .dp-search-count {
    color: var(--text-error);
}
.dp-search-float button.dp-search-clear {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    margin: 0;
    padding: 0;
    color: var(--text-muted);
    background: none;
    border: none;
    border-radius: 999px;
    box-shadow: none;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}
.dp-search-float button.dp-search-clear:hover {
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
}
.dp-search-clear svg {
    width: 14px;
    height: 14px;
}

/* Delete confirmation */
.modal.dp-delete-modal {
    width: min(420px, calc(100vw - 32px));
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--dp-glass-border);
    border-radius: 12px;
    box-shadow: var(--dp-glass-shadow-lg), inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-delete-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 200px;
    margin: var(--size-4-2, 8px) 0;
    padding: 6px;
    overflow-y: auto;
    background-color: var(--dp-card-bg);
    border: 1px solid var(--dp-glass-border);
    border-radius: 10px;
}
.dp-delete-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    font-size: var(--font-ui-small, 0.9em);
}
.dp-delete-item-title {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.dp-delete-more {
    padding: 2px 6px;
    font-size: var(--font-ui-smaller, 0.8em);
    color: var(--text-muted);
}
.dp-delete-notes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--font-ui-smaller, 0.8em);
    line-height: 1.45;
    color: var(--text-muted);
}
.dp-delete-notes .mod-warning {
    color: var(--text-error);
}
@media (prefers-reduced-motion: reduce) {
    .dp-selection-bar, .dp-search-float.is-open {
        animation: none;
    }
}


/* -------------------------------------------------------------
   Header, decluttered: [date] … [‹ Today ›] [search · sync · zoom · help · drawer] [+]
   Two glass capsules and one accent button; every control is a pill, as on phones
   ------------------------------------------------------------- */
.dp-header-actions {
    gap: var(--size-4-2, 8px);
}
.dp-nav-buttons-group,
.dp-header-tools {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 2px;
    height: 32px;
    margin: 0;
    padding: 2px;
    box-sizing: border-box;
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    border-radius: 999px;
}
.dp-header-tools:empty {
    display: none;
}
.dp-nav-buttons-group > button,
.dp-header-tools > button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    height: 26px;
    min-width: 26px;
    margin: 0;
    padding: 0 10px;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-medium, 500);
    line-height: 1;
    color: var(--text-muted);
    background: transparent;
    border: none;
    border-radius: 999px;
    box-shadow: none;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;
}
/* Icon-only tools are round */
.dp-nav-buttons-group > button.dp-nav-arrow,
.dp-header-tools > button:is(.dp-search-btn, .dp-sync-btn, .dp-help-btn, .dp-drawer-toggle) {
    width: 26px;
    padding: 0;
}
.dp-nav-buttons-group > button:hover,
.dp-header-tools > button:hover {
    color: var(--text-normal);
    background-color: var(--dp-segment-active);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), inset 0 0 0 1px var(--dp-glass-border);
}
.dp-nav-buttons-group > button:active,
.dp-header-tools > button:active {
    transform: scale(0.94);
}
.dp-header-tools > button.is-active {
    color: var(--text-accent);
    background-color: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
}
/* Today: light and small beside the bold date pill (header-qualified to outrank Obsidian's button weight) */
.dp-header-actions .dp-nav-buttons-group > button.dp-today-btn {
    gap: 4px;
    padding: 0 8px;
    font-size: var(--font-ui-smaller, 12px);
    font-weight: var(--font-medium, 500);
    color: var(--text-normal);
}
.dp-header-actions .dp-nav-buttons-group > button.dp-today-btn svg {
    width: 13px;
    height: 13px;
}

/* Desktop / tablet header in one row: [date] [view tabs] [actions] on a three-column grid. Each side column is at
   least as wide as the widest date pill / actions group this view has drawn (--dp-head-l / --dp-head-r, kept by
   views.ts reserveHeaderSides), so the tabs never move or resize when the view changes the date text or the buttons.
   Spare room is shared equally by both sides: on a wide pane the tabs (up to 640px) sit at the header's true centre.
   Tight on room they shrink and scroll sideways; on a narrow pane (both sidebars open on a laptop) they drop to a slim
   second row. The column gap scales with the planner width. */
.dp-header-top.has-inline-tabs {
    display: grid;
    grid-template-columns:
        minmax(var(--dp-head-l, max-content), 1fr)
        minmax(0, 640px)
        minmax(var(--dp-head-r, max-content), 1fr);
    column-gap: clamp(12px, 3cqw, 40px);
}
.dp-header-top.has-inline-tabs > .dp-nav-date,
.dp-header-top.has-inline-tabs > .dp-header-actions {
    width: max-content; /* natural width: what reserveHeaderSides measures */
}
.dp-header-top.has-inline-tabs > .dp-nav-date {
    justify-self: start;
}
.dp-header-top.has-inline-tabs > .dp-header-actions {
    justify-self: end;
    margin-left: 0;
}
.dp-header-top.has-inline-tabs > .dp-tabs {
    width: 100%;
    min-width: 0;
    margin: 0;
    gap: 3px;
    padding: 3px 4px;
}
/* The zoom control opens leftward over the gap (and the tabs' end) instead of widening the actions: its layout width
   stays 26px, so hovering it never shoves the tabs aside. Width and margin share one transition, their sum constant. */
.dp-header-top.has-inline-tabs .dp-zoom-slider-floating {
    position: relative;
    z-index: 2;
    margin-left: 0;
}
@media (hover: hover) {
    .dp-header-top.has-inline-tabs .dp-zoom-slider-floating:hover {
        margin-left: -159px; /* 26px - 185px */
        background-color: var(--background-primary);
        box-shadow: var(--dp-glass-shadow);
    }
}
.dp-header-top.has-inline-tabs .dp-zoom-slider-floating:is(.is-open, :focus-within) {
    margin-left: -159px;
    background-color: var(--background-primary);
    box-shadow: var(--dp-glass-shadow);
}
/* Equal shares of the bar (basis 0), never narrower than the label: on a tight pane the segments compress to their
   text and padding, and only past that does the bar scroll */
.dp-header-top.has-inline-tabs > .dp-tabs > .dp-tab {
    flex: 1 1 0;
    min-width: max-content;
    padding: 0 clamp(8px, 1.2cqw, 16px);
    text-align: center;
}
@container dp-planner (max-width: 900px) {
    .dp-header-top.has-inline-tabs {
        display: flex;
        flex-wrap: wrap;
        row-gap: 6px;
    }
    .dp-header-top.has-inline-tabs > .dp-header-actions {
        margin-left: auto;
    }
    /* Second row: one full-width segmented control, segments sharing the width evenly */
    /* Edge to edge, aligned with the first row and the task bar (the 640px cap is for the one-row layout only) */
    .dp-header-top.has-inline-tabs > .dp-tabs {
        order: 3;
        flex: 1 0 100%;
        width: 100%;
        max-width: none;
        margin: 0;
    }
    .dp-header-top.has-inline-tabs > .dp-tabs > .dp-tab {
        flex: 1 1 0;
        min-width: 0;
        padding: 0 8px;
        text-align: center;
    }
    /* Search covers the first line only: the tabs below stay visible */
    .dp-search-mode > .dp-header .dp-header-top.has-inline-tabs > .dp-tabs {
        visibility: visible;
    }
}
.dp-nav-buttons-group svg,
.dp-header-tools svg,
.dp-zoom-toggle svg {
    width: 15px;
    height: 15px;
}
.dp-btn-icon {
    display: inline-flex;
}
/* The zoom control sits in the toolbar borderless; it still widens on hover / tap (base .dp-zoom-slider-floating) */
.dp-header-tools > .dp-zoom-slider-floating {
    margin: 0;
    background: transparent;
    border: none;
    border-radius: 999px;
}
.dp-header-tools > .dp-zoom-slider-floating:hover,
.dp-header-tools > .dp-zoom-slider-floating.is-open {
    background-color: var(--dp-segment-active);
}
.dp-zoom-toggle {
    color: var(--text-muted);
}
.dp-header-actions > button.dp-add-btn {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 32px;
    min-width: 32px;
    height: 32px;
    margin: 0;
    padding: 0;
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    border: none;
    border-radius: 999px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14), 0 4px 12px color-mix(in srgb, var(--interactive-accent) 32%, transparent);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.18s ease, filter 0.15s ease;
}
.dp-header-actions > button.dp-add-btn:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.14), 0 8px 18px color-mix(in srgb, var(--interactive-accent) 40%, transparent);
}
.dp-header-actions > button.dp-add-btn:active {
    transform: scale(0.94);
}
.dp-add-btn svg {
    width: 17px;
    height: 17px;
}
/* Compact shell (phones, sidebar): same capsules, 30px row */
.dp-compact-shell .dp-header-tools {
    height: 30px;
}
.dp-compact-shell .dp-header-tools > button {
    width: 26px;
    padding: 0;
}
/* Phones: wider < Today > capsules for an easier thumb tap */
.dp-phone-shell .dp-header-tools > button {
    width: 40px;
}
.dp-compact-shell .dp-header-actions > button.dp-add-btn {
    width: 30px;
    min-width: 30px;
    height: 30px;
    border-radius: 999px;
}
.dp-compact-shell .dp-header-tools > .dp-zoom-slider-floating.is-open {
    width: 176px;
}

/* Compact More sheet (bottom bar's 5th slot, see renderMoreSheet): utilities on top, the desktop drawer's panels below.
   Above the header, the bottom bar (both z 30) and the current-task bar (100); Obsidian modals still open over it */
/* Sheet open: the current-task bar (z 100) fades out from under it instead of floating over its cards */
.dp-compact-shell > .dp-current-task-bar {
    transition: opacity 0.18s ease;
}
.dp-container.dp-more-open > .dp-current-task-bar {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity 0.18s ease, visibility 0s linear 0.18s;
}
.dp-compact-shell .dp-bottom-nav > .dp-tab.dp-bottom-nav-more.is-active {
    color: var(--text-accent);
}
.dp-more-sheet-backdrop {
    position: absolute;
    inset: 0;
    z-index: 110; /* above the current-task bar (100), the header and the bottom bar (30) */
    background-color: rgba(0, 0, 0, 0.18); /* light dim, like the plugin's modals: the frost picks up the planner behind */
}
.dp-more-sheet-backdrop.is-entering {
    animation: dp-sheet-fade-in 0.2s ease-out;
}
.dp-more-sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 111;
    display: flex;
    flex-direction: column;
    height: min(80%, 680px);
    padding: 0 0 env(safe-area-inset-bottom, 0px);
    box-sizing: border-box;
    background-color: var(--dp-glass-bg);
    backdrop-filter: var(--dp-glass-blur);
    -webkit-backdrop-filter: var(--dp-glass-blur);
    border: 1px solid var(--dp-glass-border);
    border-bottom: none;
    border-radius: 20px 20px 0 0;
    box-shadow: var(--dp-glass-shadow-lg), inset 0 1px 0 var(--dp-glass-highlight);
    transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}
/* Phones: clear Obsidian's own bottom toolbar, which overlays the view's bottom edge */
.is-phone .dp-phone-shell > .dp-more-sheet {
    padding-bottom: calc(var(--mobile-navbar-height, 48px) + env(safe-area-inset-bottom, 6px));
}
.dp-more-sheet.is-entering {
    animation: dp-sheet-up 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.dp-more-sheet.is-dragging {
    transition: none;
}
.dp-more-sheet.is-closing {
    transform: translateY(100%) !important;
    pointer-events: none;
}
.dp-more-sheet-backdrop.is-closing {
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
}
@keyframes dp-sheet-up {
    from { transform: translateY(100%); }
}
@keyframes dp-sheet-fade-in {
    from { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
    .dp-more-sheet, .dp-more-sheet.is-entering, .dp-more-sheet-backdrop {
        animation: none;
        transition: none;
    }
}
.dp-sheet-handle {
    flex-shrink: 0;
    display: flex;
    justify-content: center;
    padding: 8px 0 6px;
    cursor: grab;
    touch-action: none;
}
.dp-sheet-grabber {
    width: 36px;
    height: 5px;
    border-radius: 999px;
    background-color: var(--background-modifier-border-hover, var(--background-modifier-border));
}
/* Section A: Search · Sync as two big tiles, the zoom slider as a full-width row under them */
.dp-sheet-actions {
    flex-shrink: 0;
    display: flex;
    gap: 8px;
    padding: 0 12px;
}
.dp-sheet-actions > button.dp-sheet-action {
    flex: 1 1 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 44px;
    margin: 0;
    padding: 0 12px;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-medium, 500);
    color: var(--text-normal);
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    border-radius: 12px;
    box-shadow: none;
    cursor: pointer;
}
.dp-sheet-actions > button.dp-sheet-action:active {
    background-color: var(--background-modifier-hover);
    transform: scale(0.98);
}
.dp-sheet-actions > button.dp-sheet-action.is-active {
    color: var(--text-accent);
}
.dp-sheet-actions svg,
.dp-sheet-zoom-label svg {
    width: 17px;
    height: 17px;
}
.dp-sheet-zoom {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 12px 0;
    padding: 0 6px 0 12px;
    height: 44px;
    background-color: var(--dp-segment-track);
    border: 1px solid var(--dp-glass-border);
    border-radius: 12px;
}
.dp-sheet-zoom-label {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
}
/* The slider stays expanded here; its tap-to-open icon is redundant */
.dp-sheet-zoom > .dp-zoom-slider-floating,
.dp-compact-shell .dp-sheet-zoom > .dp-zoom-slider-floating {
    flex: 1;
    width: auto;
    height: 32px;
    margin: 0;
    background: transparent;
    border: none;
    overflow: visible;
}
.dp-sheet-zoom .dp-zoom-toggle {
    display: none !important;
}
.dp-sheet-zoom .dp-zoom-popover {
    flex: 1;
    flex-direction: row;
}
.dp-sheet-zoom .dp-zoom-slider {
    flex: 1;
    width: auto;
    opacity: 1;
}
.dp-sheet-zoom .dp-zoom-value {
    opacity: 1;
}
/* Section B: the drawer's mode switcher and panel body, in the flow of the sheet instead of sliding in from the right */
.dp-side-drawer.dp-sheet-drawer {
    position: static;
    flex: 1;
    min-height: 0;
    width: auto;
    margin-top: 10px;
    transform: none;
    visibility: visible;
    transition: none;
    background: transparent;
    border-left: none;
}

/* Sheet interior on the frosted surface: translucent inner cards with a hairline and a top highlight (the
   stats cards' and modal sections' material) instead of the desktop drawer's opaque fills */
.dp-sheet-actions > button.dp-sheet-action,
.dp-sheet-zoom {
    background-color: var(--dp-card-bg);
    border-color: var(--dp-glass-border);
    box-shadow: inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-sheet-actions > button.dp-sheet-action:active {
    background-color: var(--dp-segment-active);
}
.dp-sheet-grabber {
    background-color: var(--dp-glass-border);
    box-shadow: inset 0 0 0 1px var(--dp-glass-border);
}
.dp-sheet-drawer .dp-drawer-body {
    border-top-color: var(--dp-glass-border);
    background: transparent;
}
.dp-sheet-drawer .dp-drawer-card {
    background-color: var(--dp-card-bg);
    border-color: var(--dp-glass-border);
    box-shadow: inset 0 1px 0 var(--dp-glass-highlight);
}
.dp-sheet-drawer input.dp-drawer-capture {
    background-color: var(--dp-card-bg);
    border-color: var(--dp-glass-border);
}
.dp-sheet-drawer button.dp-drawer-card-action {
    background-color: var(--dp-segment-track);
    border-color: var(--dp-glass-border);
}

/* Rounder controls everywhere, as on phones: view tabs and the Board mode toggle are pills */
.dp-container:not(.dp-compact-shell) .dp-tabs,
.dp-container:not(.dp-compact-shell) .dp-tabs > .dp-tab,
.dp-board-toggle,
.dp-board-toggle > .dp-board-toggle-btn {
    border-radius: 999px;
}

/* Weekday labels and week numbers in the phone date-pill style */
.dp-weekly-header-grid > .dp-grid-header.dp-day-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    height: 40px;
    margin: 2px 3px;
    padding: 0;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-medium, 500);
    background-color: var(--dp-segment-track);
    border: 1px solid transparent;
    border-radius: 12px;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.dp-weekly-header-grid > .dp-grid-header.dp-day-pill:hover {
    background-color: var(--background-modifier-hover);
    border-color: var(--dp-glass-border);
}
.dp-weekly-header-grid > .dp-grid-header.dp-day-pill:active {
    transform: scale(0.97);
}
.dp-weekly-header-grid > .dp-grid-header.dp-day-pill.today {
    color: var(--text-on-accent);
    background-color: var(--interactive-accent);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--interactive-accent) 35%, transparent);
}
.dp-weekly-header-grid > .dp-grid-header.dp-day-pill.today:hover {
    filter: brightness(1.06);
}
.dp-monthly-header-grid > .dp-grid-header {
    padding: 6px 0;
    font-size: var(--font-ui-smaller, 0.8em);
    font-weight: var(--font-semibold, 600);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    background-color: var(--dp-segment-track);
    border-radius: 999px;
}
.dp-monthly-header-grid > .dp-grid-header:not(.is-sunday):not(.is-saturday) {
    color: var(--text-muted);
}
.dp-grid-week-cell.dp-day-pill {
    gap: 1px;
    background-color: var(--dp-segment-track);
    border: 1px solid transparent;
    border-radius: 12px;
}
.dp-grid-week-cell.dp-day-pill:hover {
    background-color: var(--background-modifier-hover);
    border-color: var(--interactive-accent);
}
.dp-grid-week-cell .dp-date-pill-dow {
    font-size: 0.68em;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-faint);
}
.dp-grid-week-cell .dp-date-pill-date {
    font-size: var(--font-ui-small, 0.9em);
    color: var(--text-muted);
}

/* Drawer multi-selection (Ctrl / Cmd + click), same amber dashes as every other selection */
.dp-container .dp-drawer-card.selected {
    outline: 2px dashed #ff9f1c;
    outline-offset: 1px;
    box-shadow: 0 0 10px rgba(255, 159, 28, 0.55);
}


/* -------------------------------------------------------------
   Side drawer 4.4.2: box selection over the task list, keyboard focus, Board header, High next to Highest
   ------------------------------------------------------------- */
.dp-drawer-body {
    position: relative; /* the selection box is laid out in the list's scrolled content */
}
.dp-side-drawer:focus {
    outline: none; /* focused only so Esc reaches it, never shown */
}
.dp-drawer-plain-title {
    flex: 1;
    min-width: 0;
    padding: 0 6px;
    overflow: hidden;
    font-size: var(--font-ui-small, 0.9em);
    font-weight: var(--font-semibold, 600);
    white-space: nowrap;
    text-overflow: ellipsis;
}
/* ⏫ High: the amber sibling of the 🔺 Highest (MIT) card, one step quieter */
.dp-drawer-card.is-high {
    overflow: hidden;
    background: linear-gradient(120deg, color-mix(in srgb, var(--color-orange) 4%, var(--background-primary)), var(--background-primary) 60%);
    border-color: color-mix(in srgb, var(--color-orange) 18%, var(--background-modifier-border));
    box-shadow: 0 1px 5px color-mix(in srgb, var(--color-orange) 5%, transparent);
}
.dp-drawer-card.is-high::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 3px;
    background: linear-gradient(to bottom, var(--color-orange), var(--color-yellow));
    opacity: 0.5;
}
.dp-drawer-card.is-high:hover {
    border-color: color-mix(in srgb, var(--color-orange) 34%, var(--background-modifier-border));
    box-shadow: 0 2px 8px color-mix(in srgb, var(--color-orange) 9%, transparent);
}
.dp-drawer-card.is-high .dp-drawer-card-title {
    font-weight: var(--font-medium, 500);
}
.dp-drawer-card.is-high .dp-drawer-card-actions {
    background: linear-gradient(to right, transparent, var(--background-primary) 12px);
}
/* Their priority badge becomes a tinted pill */
.dp-side-drawer .dp-drawer-card.is-mit button.dp-priority-trigger,
.dp-side-drawer .dp-drawer-card.is-high button.dp-priority-trigger {
    border-radius: 999px;
}
.dp-side-drawer .dp-drawer-card.is-mit button.dp-priority-trigger {
    background-color: color-mix(in srgb, var(--color-red) 8%, transparent);
    border-color: color-mix(in srgb, var(--color-red) 16%, transparent);
}
.dp-side-drawer .dp-drawer-card.is-high button.dp-priority-trigger {
    background-color: color-mix(in srgb, var(--color-orange) 8%, transparent);
    border-color: color-mix(in srgb, var(--color-orange) 16%, transparent);
}
/* Done (Today's Tasks keeps them for undo): settled and grey whatever the priority. No red / amber well, accent bar
   or glow, a neutral hairline, dimmed card and a desaturated badge. Wins over .is-mit / .is-high and the sheet glass. */
.dp-side-drawer .dp-drawer-card.is-done,
.dp-side-drawer .dp-drawer-card.is-done:hover {
    background: var(--dp-segment-track);
    border-color: var(--background-modifier-border);
    box-shadow: none;
    opacity: 0.55;
}
.dp-side-drawer .dp-drawer-card.is-done:hover {
    opacity: 0.75; /* still clearly clickable (undo, edit) */
}
.dp-side-drawer .dp-drawer-card.is-done::before {
    content: none;
}
.dp-side-drawer .dp-drawer-card.is-done .dp-drawer-card-title {
    font-weight: var(--font-normal, 400);
    color: var(--text-muted);
}
.dp-side-drawer .dp-drawer-card.is-done button.dp-priority-trigger {
    background-color: transparent;
    border-color: transparent;
    filter: grayscale(1);
    opacity: 0.6;
}


/* -------------------------------------------------------------
   4.4.3: all-day items in the drawer card's proportions; hosts for the new box selections
   ------------------------------------------------------------- */
/* All-day row (Daily, Weekly, N-day): compact rounded cards like the side drawer's, readable text */
.dp-allday-cell {
    gap: 4px;
    max-height: 104px; /* three cards, then the row scrolls */
}
.dp-grid-task-item.dp-allday-item {
    gap: 6px;
    height: 28px !important;
    min-height: 28px !important;
    max-height: 28px !important;
    margin: 0 !important;
    padding: 0 8px !important;
    font-size: var(--font-ui-smaller, 0.8em) !important;
    line-height: 1.3 !important;
    border-radius: var(--radius-m, 8px) !important;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}
.dp-grid-task-item.dp-allday-item .dp-custom-cb {
    width: 14px;
    height: 14px;
    margin-right: 0;
    font-size: 9px;
}
/* The selection box is laid out inside these (the board scrolls sideways: content coordinates) */
.dp-weekly-allday-grid,
.dp-kanban-board {
    position: relative;
}

/* -------------------------------------------------------------
   Touch layout (body.dp-touch-ui, main.ts applyTouchLayout): tablets, and a touchscreen computer while a finger is
   in use. The mouse layout, scaled for a fingertip as on iPad: ~38-46px tap targets, 18-22px icons, roomier cards,
   and the controls a mouse finds by hovering stay on screen. Same pill shapes as the mouse layout. Phones never get the class (their compact shell is
   sized for a thumb already); the compact sidebar view gets a smaller step so its one header row still fits.
   ------------------------------------------------------------- */
/* Header: [date] … [‹ Today ›] [tools] [+] */
body.dp-touch-ui .dp-header {
    padding: 12px 14px;
    gap: 10px;
}
body.dp-touch-ui .dp-nav-date {
    height: 40px;
    padding: 0 16px 0 14px;
    gap: 8px;
    font-size: 1.05em;
}
body.dp-touch-ui .dp-nav-date-icon svg {
    width: 18px;
    height: 18px;
}
body.dp-touch-ui .dp-header-actions {
    gap: 10px;
}
body.dp-touch-ui .dp-nav-buttons-group,
body.dp-touch-ui .dp-header-tools {
    height: 46px;
    gap: 4px;
    padding: 3px;
}
body.dp-touch-ui .dp-nav-buttons-group > button,
body.dp-touch-ui .dp-header-tools > button {
    height: 38px;
    min-width: 38px;
    padding: 0 14px;
    font-size: var(--font-ui-medium, 15px);
}
body.dp-touch-ui .dp-nav-buttons-group > button.dp-nav-arrow,
body.dp-touch-ui .dp-header-tools > button:is(.dp-search-btn, .dp-sync-btn, .dp-help-btn, .dp-drawer-toggle) {
    width: 38px;
    padding: 0;
}
body.dp-touch-ui .dp-header-actions .dp-nav-buttons-group > button.dp-today-btn {
    gap: 6px;
    padding: 0 14px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-header-actions .dp-nav-buttons-group > button.dp-today-btn svg {
    width: 17px;
    height: 17px;
}
body.dp-touch-ui .dp-nav-buttons-group svg,
body.dp-touch-ui .dp-header-tools svg,
body.dp-touch-ui .dp-zoom-toggle svg {
    width: 20px;
    height: 20px;
}
body.dp-touch-ui .dp-header-actions > button.dp-add-btn {
    width: 46px;
    min-width: 46px;
    height: 46px;
}
body.dp-touch-ui .dp-add-btn svg {
    width: 22px;
    height: 22px;
}
/* Zoom: a 38px button that opens to the same slider, with a thumb-sized handle */
body.dp-touch-ui .dp-zoom-slider-floating {
    width: 38px;
    height: 38px;
}
body.dp-touch-ui .dp-zoom-slider-floating span:first-child {
    width: 36px;
    height: 36px;
}
body.dp-touch-ui .dp-zoom-slider-floating:is(.is-open, :focus-within) {
    width: 197px;
}
body.dp-touch-ui .dp-zoom-slider {
    width: 92px;
    --slider-thumb-width: 22px; /* Obsidian's range-input thumb, centred on the track from these */
    --slider-thumb-height: 22px;
}
/* A finger leaves a sticky :hover behind: only a tap (.is-open) opens the zoom slider in touch layout */
@media (hover: hover) {
    body.dp-touch-ui .dp-zoom-slider-floating:hover:not(.is-open, :focus-within) {
        width: 38px;
    }
    body.dp-touch-ui .dp-zoom-slider-floating:hover:not(.is-open, :focus-within) :is(.dp-zoom-slider, .dp-zoom-value) {
        opacity: 0;
    }
    body.dp-touch-ui .dp-header-top.has-inline-tabs .dp-zoom-slider-floating:hover:not(.is-open, :focus-within) {
        margin-left: 0;
        background-color: transparent;
        box-shadow: none;
    }
}
body.dp-touch-ui .dp-header-top.has-inline-tabs .dp-zoom-slider-floating:is(.is-open, :focus-within) {
    margin-left: -159px; /* 38px - 197px */
}
/* View tabs (the compact view's bottom bar is sized below) */
body.dp-touch-ui .dp-tabs:not(.dp-bottom-nav) {
    padding: 4px;
    gap: 4px;
}
body.dp-touch-ui .dp-tabs:not(.dp-bottom-nav) > .dp-tab {
    height: 38px;
    font-size: 0.92em;
}
body.dp-touch-ui .dp-header-top.has-inline-tabs > .dp-tabs > .dp-tab {
    padding: 0 clamp(10px, 1.4cqw, 18px);
}
body.dp-touch-ui .dp-tab .dp-tab-select {
    width: 3.6ch;
    height: 26px;
    line-height: 26px;
}
body.dp-touch-ui .dp-board-toggle {
    height: 38px;
    padding: 3px;
}
body.dp-touch-ui .dp-board-toggle > .dp-board-toggle-btn {
    height: 30px;
    padding: 0 12px;
    font-size: 0.85em;
}
/* Search: the field over the header row, with a bigger × */
body.dp-touch-ui .dp-search-float {
    height: 44px;
    padding: 0 4px 0 16px;
}
body.dp-touch-ui .dp-search-icon svg {
    width: 18px;
    height: 18px;
}
body.dp-touch-ui .dp-search-float input.dp-search-input {
    font-size: 16px;
}
body.dp-touch-ui .dp-search-float button.dp-search-clear {
    width: 36px;
    height: 36px;
}
body.dp-touch-ui .dp-search-clear svg {
    width: 18px;
    height: 18px;
}
/* Current-task bar */
body.dp-touch-ui .dp-current-task-bar button.dp-ct-open {
    width: 38px;
    height: 38px;
}
body.dp-touch-ui .dp-ct-open svg {
    width: 20px;
    height: 20px;
}

/* Checkboxes: a bigger circle, and a tap a few px outside it still counts */
body.dp-touch-ui .dp-custom-cb {
    position: relative;
    width: 22px;
    height: 22px;
    font-size: 13px;
}
body.dp-touch-ui .dp-custom-cb::after {
    content: '';
    position: absolute;
    inset: -7px;
    border-radius: 50%;
}
body.dp-touch-ui .dp-timeline-event .dp-custom-cb {
    width: 20px;
    height: 20px;
}
body.dp-touch-ui .dp-timeline-event .dp-custom-cb::after {
    inset: -5px;
}
body.dp-touch-ui .dp-task-link-btn {
    padding: 2px 6px !important;
    font-size: 1.1em !important;
}

/* Timeline, list and calendar items */
body.dp-touch-ui .dp-grid-task-item {
    height: 28px !important;
    min-height: 28px !important;
    max-height: 28px !important;
    line-height: 24px !important;
    padding: 2px 8px !important;
    font-size: 0.82em !important;
}
body.dp-touch-ui .dp-grid-task-item.dp-allday-item .dp-custom-cb {
    width: 18px;
    height: 18px;
    font-size: 11px;
}
body.dp-touch-ui .dp-gc-item {
    padding: 9px 8px;
    font-size: 1em;
}
body.dp-touch-ui .dp-gc-list-container.is-day-agenda .dp-gc-item.dp-agenda-item {
    padding-top: 12px;
    padding-bottom: 12px;
}
body.dp-touch-ui .dp-weekly-header-grid > .dp-grid-header.dp-day-pill {
    height: 48px;
}

/* Board */
body.dp-touch-ui .dp-kanban-card {
    padding: 14px;
    font-size: 1.02em;
}
body.dp-touch-ui .dp-kanban-col-toggle {
    width: 34px;
    height: 34px;
}
body.dp-touch-ui .dp-kanban-col-toggle svg {
    width: 20px;
    height: 20px;
}
body.dp-touch-ui .dp-kanban-col-count {
    padding: 4px 10px;
}

/* Side drawer: month bar, mini calendar, panel switch, sections and cards */
body.dp-touch-ui .dp-drawer-resizer {
    left: -10px;
    width: 20px;
}
body.dp-touch-ui .dp-drawer-resizer::after {
    left: 9px;
}
body.dp-touch-ui .dp-drawer-header {
    gap: 6px;
    padding: 10px 10px 4px;
}
body.dp-touch-ui .dp-side-drawer button.dp-mc-label {
    height: 38px;
    padding: 0 6px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-mc-nav {
    gap: 2px;
    padding: 3px;
}
body.dp-touch-ui .dp-side-drawer button.dp-mc-nav-btn,
body.dp-touch-ui .dp-side-drawer button.dp-mc-today {
    height: 34px;
    padding: 0 10px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-side-drawer button.dp-mc-nav-btn {
    width: 34px;
    padding: 0;
}
body.dp-touch-ui .dp-mc-nav-btn svg {
    width: 18px;
    height: 18px;
}
body.dp-touch-ui .dp-mini-cal {
    padding: 4px 10px 8px;
}
/* The day grid itself stays as in the mouse layout: its range band is one continuous pill per week row */
body.dp-touch-ui .dp-drawer-modes {
    margin: 4px 10px 10px;
    padding: 3px;
    border-radius: 12px;
}
body.dp-touch-ui .dp-drawer-modes-thumb {
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px) / var(--dp-mode-count, 2));
    border-radius: 9px;
}
body.dp-touch-ui .dp-side-drawer button.dp-drawer-mode {
    height: 38px;
    gap: 6px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-drawer-mode-icon svg {
    width: 18px;
    height: 18px;
}
body.dp-touch-ui .dp-side-drawer button.dp-drawer-section-toggle {
    padding: 10px 6px;
    font-size: var(--font-ui-medium, 15px);
}
body.dp-touch-ui .dp-drawer-chevron {
    width: 16px;
}
body.dp-touch-ui .dp-side-drawer button.dp-drawer-section-action {
    height: 32px;
    padding: 0 14px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-side-drawer input.dp-drawer-capture {
    height: 42px;
    padding: 0 14px;
    font-size: 16px;
}
body.dp-touch-ui .dp-drawer-list {
    gap: 8px;
}
body.dp-touch-ui .dp-drawer-card {
    gap: 10px;
    padding: 11px 10px;
    font-size: var(--font-ui-medium, 15px);
}
body.dp-touch-ui .dp-side-drawer button.dp-drawer-card-link,
body.dp-touch-ui .dp-side-drawer button.dp-priority-trigger {
    width: 34px;
    height: 34px;
    font-size: 1em;
}
body.dp-touch-ui .dp-priority-trigger svg {
    width: 17px;
    height: 17px;
}
/* No hover on a finger: the faint flag and the triage pills stay visible, the pills on their own row (as on tablets) */
body.dp-touch-ui .dp-side-drawer button.dp-priority-trigger.is-empty {
    opacity: 0.45;
}
body.dp-touch-ui .dp-drawer-card {
    flex-wrap: wrap;
}
body.dp-touch-ui .dp-side-drawer .dp-drawer-card .dp-drawer-card-actions {
    position: static;
    flex-basis: 100%;
    gap: 6px;
    padding: 0 0 0 32px;
    transform: none;
    background: none;
    opacity: 1;
    pointer-events: auto;
}
body.dp-touch-ui .dp-side-drawer button.dp-drawer-card-action {
    height: 32px;
    padding: 0 12px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-priority-popover {
    min-width: 180px;
    padding: 6px;
}
body.dp-touch-ui .dp-priority-popover button.dp-priority-option {
    height: 42px;
    padding: 0 12px;
    gap: 10px;
    font-size: var(--font-ui-medium, 15px);
}

/* Selection bar */
body.dp-touch-ui .dp-selection-bar {
    gap: 8px;
    padding: 5px 5px 5px 18px;
    font-size: var(--font-ui-medium, 15px);
}
body.dp-touch-ui .dp-selection-bar button.dp-selection-delete,
body.dp-touch-ui .dp-selection-bar button.dp-selection-clear {
    height: 40px;
    padding: 0 16px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-selection-bar button.dp-selection-clear {
    width: 40px;
    padding: 0;
}
body.dp-touch-ui .dp-selection-icon,
body.dp-touch-ui .dp-selection-bar svg {
    width: 18px;
    height: 18px;
}

/* Inline-view filters (dayloom code blocks) */
body.dp-touch-ui .dp-filter-chip,
body.dp-touch-ui .dp-filter-panel button.dp-filter-add {
    height: 34px;
    font-size: var(--font-ui-small, 14px);
}
body.dp-touch-ui .dp-filter-chip {
    padding: 0 4px 0 12px;
}
body.dp-touch-ui .dp-filter-panel button.dp-filter-chip-remove {
    width: 26px;
    height: 26px;
}
body.dp-touch-ui .dp-filter-chip-remove svg {
    width: 14px;
    height: 14px;
}

/* Dayloom's dialogs and its settings tab */
body.dp-touch-ui .modal button.dp-modal-btn {
    height: 44px;
    padding: 0 20px;
    font-size: var(--font-ui-medium, 15px);
}
body.dp-touch-ui :is(.dp-modal-input, .dp-modal-select) {
    height: 40px;
    padding: 6px 10px;
    font-size: 16px;
}
body.dp-touch-ui .dp-modal-priority-option {
    padding: 12px;
    font-size: 1em;
}
body.dp-touch-ui .dp-modal-radio-circle {
    width: 20px;
    height: 20px;
}
body.dp-touch-ui .dp-selector-modal-tab {
    padding: 12px;
    font-size: 1em;
}
body.dp-touch-ui .dp-selector-modal-search {
    height: 44px;
    font-size: 16px;
}
body.dp-touch-ui .dp-selector-modal-item {
    padding: 14px 16px;
    font-size: 1em;
}
body.dp-touch-ui .dp-settings .dp-tabs > .dp-tab {
    min-height: 40px;
    padding: 0 16px;
}
/* Narrow settings (phones, a narrow split-view window): five icon + label tabs in one row overlapped each other, so
   each tab stacks its icon over a smaller label that may wrap at spaces; longer labels get more of the width (on the
   very narrowest screens the row scrolls sideways rather than split a word) */
@media (max-width: 520px) {
    .dp-settings .dp-tabs.dp-settings-tabs > .dp-tab,
    body.dp-touch-ui .dp-settings .dp-tabs.dp-settings-tabs > .dp-tab {
        flex: 1 1 auto;
        min-width: min-content; /* never narrower than its longest word: words stay whole */
        flex-direction: column;
        gap: 3px;
        min-height: 48px;
        padding: 6px 3px;
        font-size: 11px;
        line-height: 1.15;
        white-space: normal;
        text-align: center;
    }
    .dp-settings .dp-tabs.dp-settings-tabs .dp-pill-tab-label {
        word-break: keep-all; /* Korean / Japanese / Chinese wrap at spaces too, not inside a word */
    }
}

/* Compact sidebar view (Dayloom Compact on a tablet or touch laptop): one step up, its header row still fits */
body.dp-touch-ui .dp-compact-shell .dp-header-tools {
    height: 40px;
}
body.dp-touch-ui .dp-compact-shell .dp-header-tools > button {
    width: 34px;
    height: 34px;
    min-width: 34px;
    padding: 0;
}
body.dp-touch-ui .dp-compact-shell .dp-header-actions > button {
    width: 36px;
    min-width: 36px;
    height: 36px;
}
body.dp-touch-ui .dp-compact-shell .dp-header-actions > button.dp-add-btn {
    width: 40px;
    min-width: 40px;
    height: 40px;
}
body.dp-touch-ui .dp-compact-shell .dp-header-actions > .dp-zoom-slider-floating,
body.dp-touch-ui .dp-compact-shell .dp-zoom-slider-floating {
    width: 34px;
    height: 34px;
}
body.dp-touch-ui .dp-compact-shell .dp-zoom-slider-floating span:first-child {
    width: 32px;
    height: 32px;
}
body.dp-touch-ui .dp-compact-shell :is(.dp-header-actions > .dp-zoom-slider-floating, .dp-header-tools > .dp-zoom-slider-floating).is-open {
    width: 176px;
}
body.dp-touch-ui .dp-compact-shell .dp-header-top > .dp-nav-date.dp-header-date-compact {
    height: 36px;
}
body.dp-touch-ui .dp-compact-shell .dp-header {
    padding: 10px 12px;
}
body.dp-touch-ui .dp-compact-shell .dp-bottom-nav > .dp-tab {
    padding: 6px 8px;
    font-size: 12px;
}
body.dp-touch-ui .dp-compact-shell .dp-bottom-nav-icon svg {
    width: 22px;
    height: 22px;
}
body.dp-touch-ui .dp-compact-shell .dp-date-strip > .dp-date-pill {
    height: 48px;
}
body.dp-touch-ui .dp-compact-shell .dp-board-toggle > .dp-board-toggle-btn {
    width: 36px;
    height: 30px;
}


/* Glass segmented controls, one material for all: view tabs, glass segmented controls (settings, drawer), Board
   layout toggle, drawer modes, header tool groups, zoom pills and the mini calendar's nav. Frosted track (every
   rounded wrapper of buttons / icons), glossy thumb. */
.dp-tabs:not(.dp-bottom-nav),
.dp-glass-seg,
.dp-board-toggle,
.dp-drawer-modes,
.dp-nav-buttons-group,
.dp-header-tools,
.dp-mc-nav,
.dp-zoom-slider-floating,
.dp-sheet-zoom {
    background: var(--dp-glass-track);
    border-color: transparent;
    box-shadow: var(--dp-glass-track-shadow);
}
.dp-tabs > .dp-tab.active::before,
.dp-glass-seg-thumb,
.dp-board-toggle > .dp-board-toggle-btn.active,
.dp-drawer-modes-thumb,
.dp-nav-buttons-group > button:hover,
.dp-header-tools > button:hover,
.dp-side-drawer button.dp-mc-nav-btn:hover,
.dp-side-drawer button.dp-mc-today:hover {
    background: var(--dp-glass-thumb);
    border: none;
    box-shadow: var(--dp-glass-thumb-shadow);
}


/* Standalone buttons in the same glass: neutral ones take the glossy thumb, the accent ones (primary, Add) a gloss
   over the accent, Delete a red-tinted glass */
.modal button.dp-modal-btn.is-secondary,
.dp-side-drawer button.dp-drawer-card-action,
.dp-sheet-drawer button.dp-drawer-card-action,
.dp-sheet-actions > button.dp-sheet-action {
    background: var(--dp-glass-thumb);
    border: none;
    box-shadow: var(--dp-glass-thumb-shadow);
}
.modal button.dp-modal-btn.is-secondary:hover:not(:disabled),
.dp-sheet-actions > button.dp-sheet-action:hover {
    background: var(--dp-glass-thumb-hover);
    border: none;
    box-shadow: var(--dp-glass-thumb-shadow);
}
.modal button.dp-modal-btn.is-primary,
.dp-header-actions > button.dp-add-btn,
.dp-side-drawer button.dp-drawer-card-action:hover {
    color: var(--text-on-accent);
    background: var(--dp-glass-gloss), var(--interactive-accent);
    border: none;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--interactive-accent) 35%, transparent), 0 0 0 0.5px rgba(0, 0, 0, 0.08),
        inset 0 0 0 0.5px rgba(255, 255, 255, 0.20), inset 0 1px 0 rgba(255, 255, 255, 0.22),
        inset 0 -1px 2px rgba(0, 0, 0, 0.12);
}
/* Brightness, not --interactive-accent-hover: many themes set that equal to the accent, so hover showed nothing */
.modal button.dp-modal-btn.is-primary:hover:not(:disabled),
.dp-header-actions > button.dp-add-btn:hover {
    background: var(--dp-glass-gloss-hover), var(--interactive-accent);
    filter: brightness(1.06);
}
.modal button.dp-modal-btn.is-danger {
    background: var(--dp-glass-gloss), color-mix(in srgb, var(--color-red) 14%, transparent);
    border: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12), inset 0 0 0 0.5px color-mix(in srgb, var(--color-red) 45%, transparent),
        inset 0 1px 0 rgba(255, 255, 255, 0.14), inset 0 -1px 2px rgba(0, 0, 0, 0.08);
}
.modal button.dp-modal-btn.is-danger:hover:not(:disabled) {
    background: var(--dp-glass-gloss-hover), var(--color-red);
    border: none;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--color-red) 35%, transparent), inset 0 0 0 0.5px rgba(255, 255, 255, 0.20),
        inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 2px rgba(0, 0, 0, 0.12);
}

/* Sheet zoom row: one glossy tile like Search / Sync; the slider inside sits flat on it (no nested track), and stays
   full-width when tapped, focused or hovered */
.dp-sheet-zoom {
    background: var(--dp-glass-thumb);
    border: none;
    box-shadow: var(--dp-glass-thumb-shadow);
    padding-right: 12px;
}
.dp-sheet-zoom-label {
    color: var(--text-normal);
}
.dp-sheet-zoom > .dp-zoom-slider-floating,
.dp-sheet-zoom > .dp-zoom-slider-floating:is(.is-open, :focus-within, :hover),
body.dp-touch-ui .dp-sheet-zoom > .dp-zoom-slider-floating,
body.dp-touch-ui .dp-sheet-zoom > .dp-zoom-slider-floating:is(.is-open, :focus-within, :hover) {
    width: auto;
    margin: 0;
    background: transparent;
    border: none;
    box-shadow: none;
}
.dp-sheet-zoom .dp-zoom-value {
    width: auto;
    min-width: 44px;
}
@media (hover: hover) {
    body.dp-touch-ui .dp-sheet-zoom > .dp-zoom-slider-floating:hover :is(.dp-zoom-slider, .dp-zoom-value) {
        opacity: 1;
    }
}

/* -------------------------------------------------------------
   Glass pop-ups (task / event editors, every planner modal, quick menus): a faint sheen down the frosted panel,
   fields sunk into it as wells, sections and option cards in the button glass. Fields set background-color only:
   Obsidian draws the dropdown arrow as the select's background-image.
   ------------------------------------------------------------- */
.modal:has(.dp-modal-buttons, .dp-selector-modal-tabs),
.modal.dp-shortcut-modal,
.modal.dp-whats-new-modal,
.menu.dp-glass-menu {
    background-image: var(--dp-panel-sheen);
}
.modal :is(.dp-modal-header, .dp-modal-buttons) {
    border-color: var(--dp-glass-border);
}
.modal :is(.dp-modal-input, .dp-modal-select, .dp-modal-textarea, .dp-modal-file-input) {
    background-color: var(--dp-glass-well);
    border: 1px solid var(--dp-glass-border);
    border-radius: 8px;
    box-shadow: var(--dp-glass-well-shadow);
}
.modal :is(.dp-modal-input, .dp-modal-select, .dp-modal-textarea):focus {
    border-color: var(--interactive-accent);
    box-shadow: var(--dp-glass-well-shadow), 0 0 0 1px var(--interactive-accent);
}
.modal :is(.dp-modal-tasks-section, .dp-modal-priority-option, .dp-modal-choice-card, .dp-whats-new-item, .dp-review-row, .dp-kbd) {
    background: var(--dp-glass-thumb);
    border: none;
    box-shadow: var(--dp-glass-thumb-shadow);
}
.modal :is(.dp-modal-priority-option, .dp-modal-choice-card):hover {
    background: var(--dp-glass-thumb-hover);
}

/* Sync (views.ts setSyncSpin): the icon turns while a sync runs (a button redrawn mid-sync joins in phase through
   --dp-sync-phase); at the end the turn in progress completes and one last eased turn overshoots a little and settles */
.dp-sync-btn svg {
    transform-origin: 50% 50%;
}
.dp-sync-btn.is-syncing svg {
    animation: dp-sync-spin ${MOTION.spinTurnMs}ms linear var(--dp-sync-phase, 0ms) infinite;
}
.dp-sync-btn.is-sync-settling svg {
    animation: dp-sync-settle ${MOTION.spinSettleMs}ms ${MOTION.spinSettle};
}
@keyframes dp-sync-spin {
    to { transform: rotate(360deg); }
}
@keyframes dp-sync-settle {
    to { transform: rotate(360deg); }
}

`;
