import { setIcon } from 'obsidian';

export interface GlassOption<T extends string> {
    value: T;
    label: string;
    icon?: string;
}

export interface GlassSegmentedOptions<T extends string> {
    options: GlassOption<T>[];
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
    /** 'tablist' for view tabs, 'radiogroup' for a setting */
    role?: 'tablist' | 'radiogroup';
    cls?: string;
    /** Start the thumb on this option and glide to `value` (for views that rebuild the control on every change) */
    animateFrom?: T | null;
    /** Right-click (long press on touch) on an option; the browser's own menu is suppressed */
    onContextMenu?: (value: T, evt: MouseEvent) => void;
}

/**
 * Pill segmented control with a translucent "glass" thumb that slides (and briefly stretches) between
 * options. The thumb is measured from the selected button, so options can differ in width and the
 * row can scroll sideways when they don't fit. Ported from Web Novel Helper (src/views/glass-segmented.ts).
 */
export class GlassSegmented<T extends string> {
    readonly el: HTMLElement;
    private readonly thumb: HTMLElement;
    private readonly resizeObserver: ResizeObserver;
    private options: GlassOption<T>[];
    private buttons: HTMLButtonElement[] = [];
    private value: T;
    /** Option the thumb sits on (differs from value only before the opening glide) */
    private shown: T;
    private moveTimer = 0;

    constructor(parent: HTMLElement, private readonly opts: GlassSegmentedOptions<T>) {
        const role = opts.role ?? 'radiogroup';
        this.options = opts.options;
        this.value = opts.value;
        this.shown = opts.value;
        this.el = parent.createDiv({
            cls: 'dp-glass-seg' + (opts.cls ? ` ${opts.cls}` : ''),
            attr: { role, 'aria-label': opts.ariaLabel }
        });
        this.thumb = this.el.createDiv({ cls: 'dp-glass-seg-thumb', attr: { 'aria-hidden': 'true' } });
        this.buildButtons();
        this.el.addEventListener('keydown', (e: KeyboardEvent) => {
            const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
            if (!step) return;
            e.preventDefault();
            const i = this.index(this.value);
            const n = (i + step + this.buttons.length) % this.buttons.length;
            this.select(this.options[n].value);
            this.buttons[n].focus();
        });

        // Re-measure whenever the row changes size (pane resize, a hidden tab becoming visible)
        this.resizeObserver = new ResizeObserver(() => this.placeThumb());
        this.resizeObserver.observe(this.el);

        const from = opts.animateFrom != null && opts.animateFrom !== opts.value && this.index(opts.animateFrom) !== -1
            ? opts.animateFrom : null;
        this.syncButtons(from ?? this.value);
        this.placeThumb();
        requestAnimationFrame(() => {
            this.el.addClass('is-ready'); // transitions only after the first placement
            if (from !== null) {
                this.syncButtons(this.value);
                this.glide();
            }
        });
    }

    get current(): T {
        return this.value;
    }

    /** Selects an option; `notify` = false updates the control without calling onChange */
    select(value: T, notify = true) {
        if (value === this.value || this.index(value) === -1) return;
        this.value = value;
        this.syncButtons(value);
        this.glide();
        if (notify) this.opts.onChange(value);
    }

    /** Replaces the options (a tab added, removed or moved); the thumb glides to where the selected one now sits */
    setOptions(options: GlassOption<T>[], value: T) {
        if (!options.length) return;
        this.options = options;
        this.value = options.some(o => o.value === value) ? value : options[0].value;
        this.buildButtons();
        this.syncButtons(this.value);
        this.placeThumb();
        this.revealSelected();
    }

    destroy() {
        this.resizeObserver.disconnect();
        window.clearTimeout(this.moveTimer);
    }

    private buildButtons() {
        const itemRole = this.opts.role === 'tablist' ? 'tab' : 'radio';
        this.buttons.forEach(btn => btn.remove());
        this.buttons = this.options.map(o => {
            const btn = this.el.createEl('button', {
                cls: 'dp-glass-seg-option',
                attr: { type: 'button', role: itemRole, 'aria-label': o.label, title: o.label }
            });
            if (o.icon) setIcon(btn.createSpan({ cls: 'dp-glass-seg-icon' }), o.icon);
            btn.createSpan({ cls: 'dp-glass-seg-label', text: o.label });
            btn.addEventListener('click', () => this.select(o.value));
            const onContextMenu = this.opts.onContextMenu;
            if (onContextMenu) {
                btn.addEventListener('contextmenu', (e: MouseEvent) => {
                    e.preventDefault();
                    onContextMenu(o.value, e);
                });
            }
            return btn;
        });
    }

    private index(value: T): number {
        return this.options.findIndex(o => o.value === value);
    }

    private syncButtons(shown: T) {
        this.shown = shown;
        this.options.forEach((o, i) => {
            const active = o.value === shown;
            const btn = this.buttons[i];
            btn.toggleClass('is-active', active);
            btn.setAttr(this.opts.role === 'tablist' ? 'aria-selected' : 'aria-checked', String(active));
            btn.tabIndex = active ? 0 : -1;
        });
    }

    private glide() {
        // Stretch briefly while moving, like a drop of glass
        this.el.addClass('is-moving');
        window.clearTimeout(this.moveTimer);
        this.moveTimer = window.setTimeout(() => this.el.removeClass('is-moving'), 320);
        this.placeThumb();
        this.revealSelected();
    }

    private revealSelected() {
        const btn = this.buttons[this.index(this.value)];
        if (btn && this.el.scrollWidth > this.el.clientWidth) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    private placeThumb() {
        const btn = this.buttons[this.index(this.shown)];
        if (!btn || !btn.offsetWidth) return; // hidden: measured again once it is shown
        this.thumb.style.setProperty('--thumb-x', `${btn.offsetLeft}px`);
        this.thumb.style.setProperty('--thumb-w', `${btn.offsetWidth}px`);
    }
}
