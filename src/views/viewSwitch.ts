import { playOnce, prefersReducedMotion, REVEAL_CLASS } from './shared';

/**
 * View-type switch (Daily / N-day / Weekly / Monthly / Board / List tabs). The old pane stays on screen over its own
 * box while the new one arrives, then is hidden (panes are kept alive, so nothing is rebuilt for the animation):
 *   - between time scales the calendar zooms: to a wider view the old one shrinks away (zoom out), to a narrower one
 *     the new one grows in from the grid (zoom in);
 *   - to or from Board / List the panes slide a short way, in tab-bar order (a tab to the right comes from the right).
 * Nothing scales above 1, so no pane spills over the header. Reduced motion: an instant switch.
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

/** Ends a running switch inside `host` at once: the old pane hidden, the new one at rest. */
export function finishViewSwitch(host: HTMLElement | null | undefined): void {
    if (host) running.get(host)?.();
}

/**
 * Shows `incoming` and hides every other pane beside it. When another pane was showing and `motion` is given, that
 * pane leaves with it while `incoming` arrives; otherwise a newly shown pane gets the plain reveal.
 */
export function switchViewPane(incoming: HTMLElement, motion: ViewSwitchMotion | null): void {
    const host = incoming.parentElement;
    if (!host) return;
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
    if (wasVisible) return;
    if (!animate || !outgoing || !rect || !motion) {
        if (!prefersReducedMotion()) playOnce(incoming, REVEAL_CLASS);
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
    outgoing.addClass('dp-view-leaving', `dp-view-out-${motion}`);
    incoming.addClass('dp-view-arriving', `dp-view-in-${motion}`);

    let done = false;
    const finish = (): void => {
        if (done) return;
        done = true;
        if (running.get(host) === finish) running.delete(host);
        window.clearTimeout(timer);
        incoming.removeEventListener('animationend', onEnd);
        incoming.removeClass('dp-view-arriving', `dp-view-in-${motion}`);
        outgoing.removeClass('dp-view-leaving', `dp-view-out-${motion}`);
        outgoing.removeAttribute('inert'); // a cached pane: it must be usable when shown again
        ['top', 'left', 'width', 'height'].forEach(prop => outgoing.style.removeProperty(prop));
        // Hidden unless a newer switch (or render) already made it the shown pane again
        if (!outgoing.hasClass('is-active')) outgoing.addClass('is-hidden');
        host.removeClass('dp-view-switch-host');
        if (addedPos) host.removeClass('dp-view-switch-pos');
    };
    const onEnd = (e: AnimationEvent): void => {
        if (e.target === incoming && e.animationName.startsWith('dp-view-in-')) finish();
    };
    incoming.addEventListener('animationend', onEnd);
    const timer = window.setTimeout(finish, VIEW_SWITCH_MS + 150);
    running.set(host, finish);
}
