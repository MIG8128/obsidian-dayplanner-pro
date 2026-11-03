/**
 * Second-finger gestures during a touch card drag (phones, tablets, touchscreen PCs). While one finger holds a card:
 *   - a second finger sliding sideways pages the view, like j/k (the held card comes along and drops on the new day);
 *     every further PAGE_AT px of the same slide pages again;
 *   - sliding up / down scrolls the timeline (or calendar) under the held card, 1:1 with the finger.
 * The browser's own scrolling and pinch-zoom stay blocked for the whole drag: a native scroll would cancel the dragging
 * finger. A second-finger tap (no travel) is left alone (beginPointerDrag clicks tabs / arrows for it).
 */
export interface SecondFingerHost {
    containerEl: HTMLElement;
    getViewTabType(): string;
    navigateWithSlide(direction: number): Promise<void>;
}

const LOCK = 10;     // px of travel before the slide's axis is decided
const PAGE_AT = 60;  // px of sideways travel per page

/** The element that scrolls vertically under `target`, else the visible view's main scroller */
function scrollerFor(host: SecondFingerHost, target: EventTarget | null): HTMLElement | null {
    const scrollsY = (el: HTMLElement) =>
        el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY);
    for (let el = target instanceof HTMLElement ? target : null; el && host.containerEl.contains(el); el = el.parentElement) {
        if (el.closest('.dp-page-ghost')) break;
        if (scrollsY(el)) return el;
    }
    const candidates = host.containerEl.querySelectorAll<HTMLElement>('.dp-weekly-scroll-wrapper, .dp-monthly-scroll-wrapper, .dp-content');
    return Array.from(candidates).find(el => !el.closest('.is-hidden, .dp-page-ghost') && scrollsY(el)) ?? null;
}

/** Starts listening; returns the function that stops. `onMoved` re-aims the drag after a scroll or a page (and counts
 *  as moving the card: released without finger 1 moving, it still lands on the new slot or day). */
export function attachSecondFingerGestures(host: SecondFingerHost, onMoved: () => void): () => void {
    const doc = host.containerEl.ownerDocument;
    // touch-action is fixed when a finger lands: a second finger landing on the view during the drag gets none, so
    // the browser starts no pan or pinch of its own (one would cancel both fingers), even after a page re-renders
    // the element it landed on (its touchmoves then no longer reach the document, where holdStill blocks them)
    host.containerEl.addClass('dp-touch-holding');
    let finger: { id: number; el: EventTarget; startX: number; startY: number; lastY: number; axis: 'x' | 'y' | null; scroller: HTMLElement | null } | null = null;
    let paging = false;

    const onMove = (e: Event) => {
        const te = e as TouchEvent;
        if (te.cancelable) te.preventDefault();
        if (!finger) return;
        const touch = Array.from(te.touches).find(t => t.identifier === finger!.id);
        if (!touch || !Array.from(te.changedTouches).some(t => t.identifier === finger!.id)) return;
        te.stopPropagation(); // Obsidian's own edge swipes (sidebars) never see the second finger
        const dx = touch.clientX - finger.startX;
        if (!finger.axis) {
            const dy = touch.clientY - finger.startY;
            if (Math.hypot(dx, dy) <= LOCK) return;
            finger.axis = Math.abs(dx) > Math.abs(dy) * 1.5 ? 'x' : 'y';
            finger.lastY = touch.clientY; // scrolling starts from here: no jump by the lock distance
        }
        if (finger.axis === 'y') {
            if (!finger.scroller?.isConnected) finger.scroller = scrollerFor(host, null); // re-rendered by a page
            if (finger.scroller) {
                finger.scroller.scrollTop -= touch.clientY - finger.lastY; // content follows the finger
                onMoved();
            }
            finger.lastY = touch.clientY;
        } else if (!paging && Math.abs(dx) >= PAGE_AT && host.getViewTabType() !== 'board') {
            paging = true;
            finger.startX = touch.clientX; // the next PAGE_AT px of this slide pages again
            void host.navigateWithSlide(dx < 0 ? 1 : -1).finally(() => { // slide left → next, like a swipe
                paging = false;
                onMoved();
            });
        }
    };
    const stopFollowing = () => {
        if (!finger) return;
        finger.el.removeEventListener('touchmove', onMove);
        finger.el.removeEventListener('touchend', onEnd);
        finger.el.removeEventListener('touchcancel', onEnd);
        finger = null;
    };
    const onEnd = (e: Event) => {
        if (finger && Array.from((e as TouchEvent).changedTouches).some(t => t.identifier === finger!.id)) stopFollowing();
    };
    const onStart = (e: TouchEvent) => {
        if (finger || e.touches.length < 2) return;
        const touch = e.changedTouches[0];
        // Touch events keep going to the element a finger landed on, even once a page re-render removed it from the
        // document: the finger is followed there, not on the document
        finger = { id: touch.identifier, el: touch.target, startX: touch.clientX, startY: touch.clientY, lastY: touch.clientY, axis: null, scroller: scrollerFor(host, touch.target) };
        touch.target.addEventListener('touchmove', onMove, { passive: false });
        touch.target.addEventListener('touchend', onEnd);
        touch.target.addEventListener('touchcancel', onEnd);
    };

    doc.addEventListener('touchstart', onStart, { capture: true, passive: true });
    return () => {
        stopFollowing();
        doc.removeEventListener('touchstart', onStart, true);
        host.containerEl.removeClass('dp-touch-holding');
    };
}
