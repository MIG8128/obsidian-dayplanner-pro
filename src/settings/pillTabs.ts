import { setIcon } from 'obsidian';
import { animateActiveTabPill, TabPillMemo } from '../views/shared';

export interface PillTabOption<T extends string> {
    value: T;
    label: string;
    icon?: string;
}

export interface PillTabsOptions<T extends string> {
    options: PillTabOption<T>[];
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
    /** 'tablist' for a tab bar, 'radiogroup' for a setting's choice */
    role: 'tablist' | 'radiogroup';
    cls?: string;
}

/**
 * A row of choices with the planner's view-tab look and switch: .dp-tabs / .dp-tab, the selected one marked by the
 * ::before pill that slides over from the previous choice (animateActiveTabPill). Used by the settings page (its tab
 * bar and two-way switches) instead of the glass segmented control, whose blurred thumb is a separate layer that
 * iPhone painted over the selected label.
 */
export class PillTabs<T extends string> {
    readonly el: HTMLElement;
    private readonly buttons = new Map<T, HTMLButtonElement>();
    private readonly pillMemo: { tabPillMemo?: TabPillMemo } = {};
    private value: T;

    constructor(parent: HTMLElement, private readonly opts: PillTabsOptions<T>) {
        this.value = opts.value;
        this.el = parent.createDiv({
            cls: 'dp-tabs' + (opts.cls ? ` ${opts.cls}` : ''),
            attr: { role: opts.role, 'aria-label': opts.ariaLabel }
        });
        const itemRole = opts.role === 'tablist' ? 'tab' : 'radio';
        opts.options.forEach(option => {
            const btn = this.el.createEl('button', { cls: 'dp-tab', attr: { type: 'button', role: itemRole } });
            if (option.icon) setIcon(btn.createSpan({ cls: 'dp-pill-tab-icon' }), option.icon);
            btn.createSpan({ cls: 'dp-pill-tab-label', text: option.label });
            btn.addEventListener('click', () => this.select(option.value));
            this.buttons.set(option.value, btn);
        });
        // Arrow keys move between choices, as in a native tab bar / radio group
        this.el.addEventListener('keydown', (e: KeyboardEvent) => {
            const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
            if (!step) return;
            e.preventDefault();
            const values = opts.options.map(o => o.value);
            const next = values[(values.indexOf(this.value) + step + values.length) % values.length];
            this.select(next);
            this.buttons.get(next)?.focus();
        });
        this.mark();
    }

    get current(): T {
        return this.value;
    }

    /** Selects a choice; its pill slides over from the previous one. `notify` = false skips onChange. */
    select(value: T, notify = true) {
        if (value === this.value || !this.buttons.has(value)) return;
        this.value = value;
        this.mark();
        if (notify) this.opts.onChange(value);
    }

    private mark() {
        const role = this.opts.role === 'tablist' ? 'aria-selected' : 'aria-checked';
        this.buttons.forEach((btn, key) => {
            const on = key === this.value;
            btn.toggleClass('active', on);
            btn.removeClass('dp-tab-pill-slide'); // the pill animation restarts on the newly selected choice
            btn.setAttr(role, String(on));
            btn.tabIndex = on ? 0 : -1;
        });
        const active = this.buttons.get(this.value);
        if (active) void active.offsetWidth; // flush, so re-adding dp-tab-pill-slide replays the slide
        animateActiveTabPill(this.el, this.pillMemo, this.value);
    }
}
