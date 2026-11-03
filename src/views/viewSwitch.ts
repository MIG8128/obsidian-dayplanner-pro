import { playOnce, prefersReducedMotion, REVEAL_CLASS } from './shared';

/**
 * View-type switch (Daily / N-day / Weekly / Monthly / Board / List tabs). The old pane stays on screen over its own
 * box while the new one arrives, then is hidden (panes are kept alive, so nothing is rebuilt for the animation):
 *   - between time scales the calendar zooms through the date on screen: to a wider view the old one shrinks into
 *     that date's place in it (a day into its column or cell, a week into its row), to a narrower one the new one
 *     grows out of that place (zoomTarget); when the place is not on screen, a plain zoom about the centre;
 *   - to or from Board / List the whole view is pushed vertically, like the date push turned upright: a tab to the
 *     right rises from below and pushes the old view up, a tab to the left comes down from above (clipped to the
 *     view area, so neither passes over the header or the bottom bar).
 * Nothing scales above 1 or leaves its box, so no pane spills over the header. Reduced motion: an instant switch.
 */
export type ViewSwitchMotion = 'zoom-out' | 'zoom-in' | 'slide-next' | 'slide-prev';

export const VIEW_SWITCH_MS = 250;

/** Tabs that show the calendar at a time scale, narrowest first */
const TIME_SCALE: Record<string, number> = { daily: 0, multiDay: 1, weekly: 2, monthly: 3 };

export function viewSwitchMotion(from: string, to: string, tabOrder: string[]): ViewSwitchMotion {
    const a = TIME_SCALE[from];
    const b = TIME_SCALE[to];
    if (a !== undefined && b !== undefined) return b > a ? 'zoom-out' : 'zoom-in';
    return tabOrder.indexOf(to) > tabOrder.indexOf(from) ? 'slide-next' : 'slide-prev';
}

const running = new WeakMap<HTMLElement, () => void>();

export interface ViewSwitchOptions {
    /** Fills or refreshes the incoming pane once it is shown, before anything is measured */
    prepare?: () => void;
    /** The dates the narrower of the two views shows: the zoom shrinks into / grows out of them in the wider view */
    zoomDates?: string[];
}

type Box = { left: number; top: number; width: number; height: number };

/** Where `dates` sit in the wider view (Weekly / N-day columns with their headers, Monthly cells), as one box
 *  clipped to the pane's visible area; null when none is on screen */
function zoomTarget(wide: HTMLElement, dates: string[]): Box | null {
    const wanted = new Set(dates);
    const els = Array.from(wide.querySelectorAll<HTMLElement>('.dp-weekly-day-col[data-date], .dp-grid-header[data-date], .dp-grid-cell[data-date]'))
        .filter(el => wanted.has(el.dataset.date ?? ''));
    if (els.length === 0) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    els.forEach(el => {
        const r = el.getBoundingClientRect();
        left = Math.min(left, r.left); top = Math.min(top, r.top);
        right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
    });
    const pane = wide.getBoundingClientRect();
    left = Math.max(left, pane.left); top = Math.max(top, pane.top);
    right = Math.min(right, pane.right); bottom = Math.min(bottom, pane.bottom);
    return right - left >= 8 && bottom - top >= 8 ? { left, top, width: right - left, height: bottom - top } : null;
}

/** The transform that lays a pane occupying `from` exactly over `to` (transform-origin: top left) */
const boxTransform = (from: Box, to: Box) =>
    `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width}, ${to.height / from.height})`;

/** Ends a running switch inside `host` at once: the old pane hidden, the new one at rest. */
export function finishViewSwitch(host: HTMLElement | null | undefined): void {
    if (host) running.get(host)?.();
}

/**
 * Shows `incoming` and hides every other pane beside it. When another pane was showing and `motion` is given, that
 * pane leaves with it while `incoming` arrives; otherwise a newly shown pane gets the plain reveal.
 */
export function switchViewPane(incoming: HTMLElement, motion: ViewSwitchMotion | null, opts: ViewSwitchOptions = {}): void {
    const host = incoming.parentElement;
    if (!host) { opts.prepare?.(); return; }
    finishViewSwitch(host); // fast d / w / m presses: the previous switch ends now, never stacked
    const panes = Array.from(host.querySelectorAll<HTMLElement>(':scope > .day-planner-view-pane'));
    const wasVisible = incoming.hasClass('is-active') && !incoming.hasClass('is-hidden');
    const outgoing = panes.find(p => p !== incoming && p.hasClass('is-active') && !p.hasClass('is-hidden')) ?? null;
    const animate = !!motion && !!outgoing && !wasVisible && outgoing.offsetWidth > 0 && !prefersReducedMotion();
    // Measured before anything moves: the old pane keeps exactly this box while it leaves
    const hostRect = host.getBoundingClientRect();
    const rect = animate ? outgoing!.getBoundingClientRect() : null;

    // Strict mutual exclusion: exactly one pane shown, every other one hidden (the leaving one once it has left)
    panes.forEach(p => {
        if (p === incoming || (animate && p === outgoing)) return;
        p.removeClass('is-active', REVEAL_CLASS);
        p.addClass('is-hidden');
    });
    incoming.removeClass('is-hidden');
    incoming.addClass('is-active');
    if (wasVisible || !animate || !outgoing || !rect || !motion) {
        opts.prepare?.();
        if (!wasVisible && !prefersReducedMotion()) playOnce(incoming, REVEAL_CLASS);
        return;
    }

    const addedPos = getComputedStyle(host).position === 'static';
    host.addClass('dp-view-switch-host');
    if (addedPos) host.addClass('dp-view-switch-pos');
    outgoing.removeClass('is-active', REVEAL_CLASS);
    outgoing.style.top = `${rect.top - hostRect.top - host.clientTop + host.scrollTop}px`;
    outgoing.style.left = `${rect.left - hostRect.left - host.clientLeft + host.scrollLeft}px`;
    outgoing.style.width = `${rect.width}px`;
    outgoing.style.height = `${rect.height}px`;
    outgoing.setAttribute('inert', '');
    outgoing.addClass('dp-view-leaving'); // out of the flow now, so the incoming pane is measured at its full size
    opts.prepare?.(); // the incoming pane has the full space: render / restore it before measuring

    // Zoom through the date: the narrower pane shrinks into (or grows out of) that date's place in the wider one
    let outCls = `dp-view-out-${motion}`;
    let inCls = `dp-view-in-${motion}`;
    let shaped: HTMLElement | null = null;
    if ((motion === 'zoom-out' || motion === 'zoom-in') && opts.zoomDates?.length) {
        const zoomOut = motion === 'zoom-out';
        const target = zoomTarget(zoomOut ? incoming : outgoing, opts.zoomDates);
        const narrow = zoomOut ? outgoing : incoming;
        const narrowBox = zoomOut ? rect : incoming.getBoundingClientRect();
        if (target && narrowBox.width > 0 && narrowBox.height > 0) {
            narrow.style.setProperty('--dp-zoom-t', boxTransform(narrowBox, target));
            shaped = narrow;
            if (zoomOut) outCls = 'dp-view-out-zoom-to';
            else inCls = 'dp-view-in-zoom-from';
        }
    }
    outgoing.addClass(outCls);
    incoming.addClass('dp-view-arriving', inCls);
    const inAnimation = inCls; // each class plays keyframes of the same name (styles.ts)

    let done = false;
    const finish = (): void => {
        if (done) return;
        done = true;
        if (running.get(host) === finish) running.delete(host);
        window.clearTimeout(timer);
        incoming.removeEventListener('animationend', onEnd);
        incoming.removeClass('dp-view-arriving', inCls);
        outgoing.removeClass('dp-view-leaving', outCls);
        shaped?.style.removeProperty('--dp-zoom-t');
        outgoing.removeAttribute('inert'); // a cached pane: it must be usable when shown again
        ['top', 'left', 'width', 'height'].forEach(prop => outgoing.style.removeProperty(prop));
        // Hidden unless a newer switch (or render) already made it the shown pane again
        if (!outgoing.hasClass('is-active')) outgoing.addClass('is-hidden');
        host.removeClass('dp-view-switch-host');
        if (addedPos) host.removeClass('dp-view-switch-pos');
    };
    const onEnd = (e: AnimationEvent): void => {
        if (e.target === incoming && e.animationName === inAnimation) finish();
    };
    incoming.addEventListener('animationend', onEnd);
    const timer = window.setTimeout(finish, VIEW_SWITCH_MS + 150);
    running.set(host, finish);
}
