// Page push for date / board paging: the old page (a cloned, inert "ghost") and the new page move as one strip.
export const PAGE_SWIPE_MS = 260;
export type PageDirection = 'next' | 'prev';

export interface PageSnapshot {
    content: HTMLElement;
    ghost: HTMLElement;
    scrolls: Array<[number, number, number]>;
    startPx: number;
}

const running = new WeakMap<HTMLElement, () => void>();

function reducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Ends a running push on this host at once (ghost removed, new page at rest). */
export function finishPageSwipe(host: HTMLElement | null | undefined): void {
    if (host) running.get(host)?.();
}

/** Ends every running push inside root; call at the start of every render. */
export function finishAllPageSwipes(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('.dp-page-ghost').forEach((ghost) => {
        const host = ghost.parentElement;
        if (host && running.has(host)) finishPageSwipe(host);
        else ghost.remove();
    });
}

/** Call right BEFORE the content element is emptied for a navigation re-render. */
export function capturePage(content: HTMLElement, startPx = 0): PageSnapshot | null {
    const host = content.parentElement;
    finishPageSwipe(host);
    if (!host || reducedMotion() || !content.isConnected || content.clientWidth === 0) return null;
    const scrolls: Array<[number, number, number]> = [];
    const nodes = [content, ...Array.from(content.querySelectorAll<HTMLElement>('*'))];
    nodes.forEach((el, i) => {
        if (el.scrollTop !== 0 || el.scrollLeft !== 0) scrolls.push([i, el.scrollTop, el.scrollLeft]);
    });
    const ghost = content.cloneNode(true) as HTMLElement;
    ghost.classList.remove('day-planner-view-pane', 'is-active', 'dp-view-reveal', 'dp-page-in', 'dp-page-spring');
    ghost.classList.add('dp-page-ghost');
    ghost.setAttribute('inert', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.removeProperty('transform');
    content.classList.remove('dp-page-spring');
    content.style.removeProperty('transform');
    content.style.removeProperty('opacity');
    return { content, ghost, scrolls, startPx };
}

/** Call right AFTER the new page has been rendered into the same content element. */
export function playPageSwipe(snap: PageSnapshot | null, dir: PageDirection): void {
    if (!snap) return;
    const { content, ghost, scrolls, startPx } = snap;
    const host = content.parentElement;
    if (!host || !content.isConnected || content.clientWidth === 0) return;
    const hostRect = host.getBoundingClientRect();
    const rect = content.getBoundingClientRect();
    const addedPos = getComputedStyle(host).position === 'static';
    host.classList.add('dp-page-swipe-host');
    if (addedPos) host.classList.add('dp-page-swipe-pos');
    ghost.style.top = `${rect.top - hostRect.top - host.clientTop + host.scrollTop}px`;
    ghost.style.left = `${rect.left - hostRect.left - host.clientLeft + host.scrollLeft}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    content.after(ghost);
    const ghostNodes = [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>('*'))];
    for (const [i, top, left] of scrolls) {
        const el = ghostNodes[i];
        if (el) { el.scrollTop = top; el.scrollLeft = left; }
    }
    const sign = dir === 'next' ? -1 : 1;
    const ms = `${PAGE_SWIPE_MS}ms`;
    ghost.style.setProperty('--dp-page-ms', ms);
    ghost.style.setProperty('--dp-page-from', `${startPx}px`);
    ghost.style.setProperty('--dp-page-to', `${sign * rect.width}px`);
    content.style.setProperty('--dp-page-ms', ms);
    content.style.setProperty('--dp-page-from', `${startPx - sign * rect.width}px`);
    ghost.classList.add('dp-page-out');
    content.classList.add('dp-page-in');

    let done = false;
    const finish = (): void => {
        if (done) return;
        done = true;
        if (running.get(host) === finish) running.delete(host);
        window.clearTimeout(timer);
        content.removeEventListener('animationend', onEnd);
        ghost.remove();
        content.classList.remove('dp-page-in');
        content.style.removeProperty('--dp-page-ms');
        content.style.removeProperty('--dp-page-from');
        host.classList.remove('dp-page-swipe-host');
        if (addedPos) host.classList.remove('dp-page-swipe-pos');
    };
    const onEnd = (e: AnimationEvent): void => {
        if (e.target === content && e.animationName === 'dp-page-in') finish();
    };
    content.addEventListener('animationend', onEnd);
    const timer = window.setTimeout(finish, PAGE_SWIPE_MS + 150);
    running.set(host, finish);
}

/** Touch pull: the page follows the finger. */
export function pullPage(content: HTMLElement, dx: number): void {
    if (reducedMotion()) return;
    content.classList.remove('dp-page-spring');
    const w = content.clientWidth || 1;
    content.style.transform = `translateX(${dx}px)`;
    content.style.opacity = String(1 - Math.min(0.35, (Math.abs(dx) / w) * 0.6));
}

/** Touch released too early (or cancelled): spring back. No-op if the page isn't pulled. */
export function springBackPage(content: HTMLElement | null | undefined): void {
    if (!content || !content.style.transform) return;
    content.classList.add('dp-page-spring');
    content.style.removeProperty('transform');
    content.style.removeProperty('opacity');
    window.setTimeout(() => content.classList.remove('dp-page-spring'), 250);
}
