// Renderer for `dayplanner` code blocks: borrows the base view methods (copied onto its prototype below).
import { App, ItemView, MarkdownRenderChild, Menu, setIcon } from 'obsidian';
import { setFirstIcon } from '../../drawer';
import { t } from '../../i18n';
import DayPlannerPlugin from '../../main';
import { TaskItem } from '../../types';
import { attachPathSuggest, onEnterSubmit, parentNoteOf, triggerHaptic } from '../../utils';
import { DayPlannerBaseView } from './baseView';
import { capturePage, PageDirection, playPageSwipe } from './pageSwipe';
import { animateActiveTabPill, BoardMode, debounce, describeFilterRule, FILTER_OP_LABEL, FILTER_TYPES, FilterGroup, FilterRule, isFilterGroup, keepActiveTabInView, newFilterRule, parseFilterGroup, parseTimelineHours, randomFilterId, serializeFilterNode } from './shared';

export class DayPlannerCodeBlockRenderer extends MarkdownRenderChild {
    plugin: DayPlannerPlugin;
    app: App;
    tasks: TaskItem[] = [];
    currentDate: any;
    viewType: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list';
    heightStr: string;
    selectedTaskIds: Set<string> = new Set();
    savedScrollPositions: Record<string, { scrollTop: number; scrollLeft: number }> = {};
    activeDragClickOffsetMin: number = 0;
    activeDragItems: any[] = [];
    kanbanViewMode: BoardMode = 'kanban';
    ctx: any;
    filters: any;
    showFilterPanel: boolean = false;
    collapsedColumns: Set<string> = new Set();
    hourHeight: number | undefined;
    /** `hours:` from the block: the visible hours (getTimelineHours), and the text written back into the note */
    timeRange: { startHour: number; endHour: number } | undefined;
    timeRangeRaw: string | undefined;
    debouncedUpdateCodeBlock: any;
    parentNoteType: 'daily' | 'weekly' | null = null;
    parentNoteDate: string | null = null;
    contentOnlyRender: boolean = false;
    filtersDirty: boolean = false;
    filterPanelEl: HTMLElement | null = null;
    filterRefreshTimer: number | undefined;
    filterDismissCleanup: (() => void) | null = null;
    /** A background refresh found the block off screen (a note in a background tab); redrawn once it is shown again */
    staleWhileHidden = false;
    private unloaded = false;
    /** The block's `date:` as written (or 'today' / its note's date): keys the date kept across remounts */
    sourceDateStr = '';
    /** `days:` from the block: its own N-day count (getNDayCount), independent of the planner view's */
    nDays: number | undefined;
    // State the base view's methods expect: the mixin below copies methods only, so its field initialisers never run
    // here (a missing dragSources made the first timeline card throw and cut the Weekly / N-day grid short)
    dragSources = new WeakMap<HTMLElement, any>();
    gcalDayIndex: any = null;
    autoScrolledViews: Set<string> = new Set();
    scrollToTodayRequested = false;
    unsearchedTasks: TaskItem[] = [];
    searchQuery = '';
    selectionZone: string | null = null;
    activePrimaryTaskId: string = '';
    lastDragSnapKey = '';
    touchDragActive = false;
    phoneBoardColumn: Record<BoardMode, string> = { kanban: 'today', priority: 'highest', deadline: 'dueToday' };
    phoneBoardColumnIds: string[] = [];
    boardSwitcherScroll: { tabScrollLeft?: number } = {};
    zoomPopoverOpen = false;
    zoomOutsideBound = false;
    syncInProgress = false;
    navDirection: 'next' | 'prev' | null = null;
    trackerTimer: number | null = null;

    constructor(
        containerEl: HTMLElement,
        plugin: DayPlannerPlugin,
        viewType: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list',
        dateStr?: string,
        heightStr?: string,
        ctx?: any,
        config?: any
    ) {
        super(containerEl);
        this.plugin = plugin;
        this.app = plugin.app;
        this.viewType = viewType;
        this.heightStr = heightStr || '500px';
        this.ctx = ctx;

        if (!(plugin as any).codeblockShowFiltersState) {
            (plugin as any).codeblockShowFiltersState = new Map<string, boolean>();
        }
        const sectionInfo = ctx && ctx.getSectionInfo && ctx.getSectionInfo(containerEl);
        const lineStartVal = sectionInfo ? sectionInfo.lineStart : 0;
        const blockKeyStr = ctx ? `${ctx.sourcePath}:${lineStartVal}` : '';

        this.showFilterPanel = false;
        if (blockKeyStr && (plugin as any).codeblockShowFiltersState.has(blockKeyStr)) {
            this.showFilterPanel = (plugin as any).codeblockShowFiltersState.get(blockKeyStr)!;
        } else if (config && config.showFilters === true) {
            this.showFilterPanel = true;
        }
        this.hourHeight = config && (config.hourHeight !== undefined ? parseInt(config.hourHeight, 10) : (config.hourheight !== undefined ? parseInt(config.hourheight, 10) : undefined));
        const rawDays = config ? parseInt(config.days, 10) : NaN;
        if (rawDays >= 2 && rawDays <= 14) this.nDays = rawDays;
        const rawBoard = config ? String(config.boardType ?? config.boardtype ?? '').trim().toLowerCase() : '';
        // `scheduled` is the Kanban layout's current name; `kanban` still reads
        if (rawBoard === 'priority' || rawBoard === 'kanban' || rawBoard === 'deadline') this.kanbanViewMode = rawBoard;
        else if (rawBoard === 'scheduled') this.kanbanViewMode = 'kanban';
        // An unreadable range falls back to the settings' hours but stays in the note as typed
        const rawHours = config ? config.hours : undefined;
        this.timeRange = parseTimelineHours(rawHours) ?? undefined;
        if (rawHours !== undefined && rawHours !== null && String(rawHours).trim() !== '') {
            this.timeRangeRaw = Array.isArray(rawHours) ? rawHours.join('-') : String(rawHours).trim();
        }

        // In a daily / weekly note, the block covers that day / week
        const parentNote = ctx?.sourcePath ? parentNoteOf(ctx.sourcePath, plugin.settings) : null;
        this.parentNoteType = parentNote?.type ?? null;
        this.parentNoteDate = parentNote?.date ?? null;

        if (config && config.filters) {
            this.filters = parseFilterGroup(config.filters);
        } else {
            this.filters = { kind: 'group', id: 'root', mode: 'all', children: [] };
        }

        let momentDate = (window as any).moment();
        if (this.parentNoteDate) {
            momentDate = (window as any).moment(this.parentNoteDate, 'YYYY-MM-DD');
        }
        if (dateStr && dateStr.toLowerCase() !== 'today') {
            const parsed = (window as any).moment(dateStr, 'YYYY-MM-DD', true);
            if (parsed.isValid()) {
                momentDate = parsed;
            }
        }
        // A rewrite of the block's source (tab, day click, filters...) remounts it: it comes back on the date it showed,
        // for as long as the source's own date is unchanged
        const kept = blockKeyStr ? (plugin as any).codeblockDateState?.get(blockKeyStr) : undefined;
        this.sourceDateStr = dateStr || '';
        if (kept && kept.sourceDate === this.sourceDateStr) momentDate = (window as any).moment(kept.date, 'YYYY-MM-DD');
        this.currentDate = momentDate;

        const rawCollapsed = config && (config.collapsedColumns !== undefined ? config.collapsedColumns : config.collapsedcolumns);
        if (rawCollapsed) {
            let cols: string[] = [];
            if (Array.isArray(rawCollapsed)) {
                cols = rawCollapsed;
            } else if (typeof rawCollapsed === 'string') {
                const cleanStr = rawCollapsed.replace(/[\[\]]/g, '');
                cols = cleanStr.split(',').map((s: string) => s.trim()).filter(Boolean);
            }
            this.collapsedColumns = new Set(cols);
        } else {
            this.collapsedColumns = new Set();
        }

        this.debouncedUpdateCodeBlock = debounce(async (newViewType: string, newFilters: FilterGroup) => {
            await this.updateCodeBlockInFile(newViewType, newFilters);
        }, 1500);
    }

    onload() {
        this.containerEl.empty();
        const rootEl = this.containerEl.createDiv({ cls: 'dp-container dp-codeblock-container' });
        this.registerScrollIdleClass(rootEl);

        this.containerEl.style.height = this.heightStr;
        this.containerEl.style.position = 'relative';
        this.containerEl.style.overflow = 'hidden';
        this.containerEl.style.resize = 'vertical';
        this.containerEl.style.border = '1px solid var(--background-modifier-border)';
        this.containerEl.style.borderRadius = '8px';
        this.containerEl.style.margin = '12px 0';

        this.registerDomEvent(this.containerEl, 'mouseup', () => {
            const newHeight = this.containerEl.style.height;
            if (newHeight && newHeight !== this.heightStr) {
                this.heightStr = newHeight;
                this.updateCodeBlockInFile(this.viewType, this.filters);
            }
        });

        // Vault edits arrive through the plugin's coalesced refresh (after the task cache is updated), not on every
        // metadataCache 'resolved', which fired a full redraw of each block per indexing pass while typing
        this.plugin.codeBlockRenderers.add(this);

        // Live Preview mounts the block inside an editor update (the caret leaving the block, the block scrolling into
        // view): drawing the planner there held up that keystroke / click / scroll frame. It fills in once idle instead.
        const firstRender = () => { if (!this.unloaded) void this.refreshTasks(); };
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(firstRender, { timeout: 150 });
        else window.setTimeout(firstRender, 0);
    }

    onunload() {
        this.unloaded = true;
        this.plugin.codeBlockRenderers.delete(this);
        window.clearTimeout(this.filterRefreshTimer);
        this.detachFilterDismissListeners();
        if (this.filtersDirty && this.app.workspace.getActiveFile()?.path === this.ctx?.sourcePath) {
            this.flushFilterWrite();
        }
        this.filterPanelEl = null;
        super.onunload();
    }

    async refreshContentOnly(skipIfUnchanged = false) {
        this.contentOnlyRender = true;
        try {
            await this.refreshTasks(null, false, skipIfUnchanged);
        } finally {
            this.contentOnlyRender = false;
        }
    }

    // Filter edits update the task area in place; the codeblock source is only rewritten
    // once the panel closes, since rewriting it makes Obsidian remount the whole block.
    onFilterChanged(structural: boolean = false) {
        this.filtersDirty = true;
        if (structural) this.rebuildFilterPanel();
        if (!this.showFilterPanel) this.flushFilterWrite();
        window.clearTimeout(this.filterRefreshTimer);
        this.filterRefreshTimer = window.setTimeout(() => {
            this.filterRefreshTimer = undefined;
            this.refreshContentOnly();
        }, 120);
    }

    flushFilterWrite() {
        if (!this.filtersDirty) return;
        this.filtersDirty = false;
        this.updateCodeBlockInFile(this.viewType, this.filters);
    }

    // While the panel is open it stays up for any interaction inside the codeblock and closes
    // on a click / keypress outside it, Escape, or focus moving out of the block.
    attachFilterDismissListeners() {
        if (this.filterDismissCleanup) return;
        const doc = this.containerEl.ownerDocument;
        // Modals/menus opened from inside the block are rendered outside it in the DOM.
        // ... and so is Obsidian's suggestion popover (path suggestions in the filter editor)
        const inPopup = (t: EventTarget | null) => t instanceof Element && !!t.closest('.modal-container, .menu, .suggestion-container');
        const inBlock = (t: EventTarget | null) => t instanceof Node && this.containerEl.contains(t);

        const onPointerDown = (e: PointerEvent) => {
            if (!inBlock(e.target) && !inPopup(e.target)) this.closeFilterPanel();
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (inPopup(e.target) || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
            if (e.key === 'Escape' || !inBlock(e.target)) this.closeFilterPanel();
        };
        const onFocusOut = (e: FocusEvent) => {
            // relatedTarget is null for clicks on non-focusable areas and window blur; only
            // react when focus actually lands somewhere outside the block.
            if (e.relatedTarget && !inBlock(e.relatedTarget) && !inPopup(e.relatedTarget)) this.closeFilterPanel();
        };

        doc.addEventListener('pointerdown', onPointerDown, true);
        doc.addEventListener('keydown', onKeyDown, true);
        this.containerEl.addEventListener('focusout', onFocusOut);
        this.filterDismissCleanup = () => {
            doc.removeEventListener('pointerdown', onPointerDown, true);
            doc.removeEventListener('keydown', onKeyDown, true);
            this.containerEl.removeEventListener('focusout', onFocusOut);
        };
    }

    detachFilterDismissListeners() {
        if (this.filterDismissCleanup) this.filterDismissCleanup();
        this.filterDismissCleanup = null;
    }

    closeFilterPanel() {
        this.detachFilterDismissListeners();
        if (!this.showFilterPanel) return;
        this.showFilterPanel = false;
        this.filterPanelEl = null;
        if (this.ctx && this.ctx.getSectionInfo) {
            const section = this.ctx.getSectionInfo(this.containerEl);
            const blockKey = `${this.ctx.sourcePath}:${section ? section.lineStart : 0}`;
            (this.plugin as any).codeblockShowFiltersState.set(blockKey, false);
        }
        this.render();
        this.flushFilterWrite();
    }

    rebuildFilterPanel() {
        const oldPanel = this.filterPanelEl;
        if (!oldPanel || !oldPanel.isConnected) return;
        const newPanel = this.renderFilterPanel(createDiv());
        if (newPanel) oldPanel.replaceWith(newPanel);
    }

    getViewType(): string {
        return `day-planner-pro-codeblock-${this.viewType}`;
    }

    getViewTabType() {
        return this.viewType;
    }

    async updateCodeBlockInFile(newViewType: string, newFilters: FilterGroup) {
        if (!this.app.workspace.getActiveFile()) return;
        const activeFile = this.app.workspace.getActiveFile()!;
        if (!this.ctx) return;
        const section = this.ctx.getSectionInfo(this.containerEl);
        if (!section) return;

        try {
            const fileContent = await this.app.vault.read(activeFile);
            const lines = fileContent.split('\n');

            let lineStart = section.lineStart;
            // Verify and adjust the start line if it shifted
            if (lineStart >= lines.length || !lines[lineStart].trim().startsWith('```')) {
                let found = false;
                for (let offset = 0; offset <= 5; offset++) {
                    if (lineStart - offset >= 0 && lines[lineStart - offset].trim().startsWith('```')) {
                        lineStart = lineStart - offset;
                        found = true;
                        break;
                    }
                    if (lineStart + offset < lines.length && lines[lineStart + offset].trim().startsWith('```')) {
                        lineStart = lineStart + offset;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    console.warn('Could not locate codeblock start line in file');
                    return;
                }
            }

            const startLine = lines[lineStart];

            // Scan down to find the exact closing backticks
            let lineEnd = -1;
            for (let i = lineStart + 1; i < lines.length; i++) {
                if (lines[i].trim().startsWith('```')) {
                    lineEnd = i;
                    break;
                }
            }
            if (lineEnd === -1) {
                console.warn('Could not locate codeblock end line in file');
                return;
            }

            const yamlLines = [];
            yamlLines.push(`type: ${newViewType}`);

            const origLines = fileContent.split('\n').slice(lineStart + 1, lineEnd);
            for (const origLine of origLines) {
                const parts = origLine.split(':');
                if (parts.length >= 2) {
                    const key = parts[0].trim().toLowerCase();
                    const val = parts.slice(1).join(':').trim();
                    if (key === 'date') {
                        yamlLines.push(`date: ${val}`);
                    }
                }
            }

            if (this.heightStr) {
                yamlLines.push(`height: ${this.heightStr}`);
            }

            if (this.hourHeight !== undefined) {
                yamlLines.push(`hourHeight: ${this.hourHeight}`);
            }
            if (this.timeRangeRaw) {
                yamlLines.push(`hours: ${this.timeRangeRaw}`);
            }
            if (this.nDays !== undefined) {
                yamlLines.push(`days: ${this.nDays}`);
            }
            if (this.kanbanViewMode !== 'kanban') {
                yamlLines.push(`boardType: ${this.kanbanViewMode}`);
            }
            if (this.collapsedColumns && this.collapsedColumns.size > 0) {
                yamlLines.push(`collapsedColumns: [${Array.from(this.collapsedColumns).join(', ')}]`);
            }

            if (newFilters.children && newFilters.children.length > 0) {
                yamlLines.push('filters:');
                yamlLines.push(`  kind: group`);
                yamlLines.push(`  mode: ${newFilters.mode}`);
                yamlLines.push('  children:');
                for (const child of newFilters.children) {
                    yamlLines.push(...serializeFilterNode(child, '    '));
                }
            }

            const plugin = this.plugin as any;
            if (!plugin.codeblockDateState) plugin.codeblockDateState = new Map<string, { date: string; sourceDate: string }>();
            plugin.codeblockDateState.set(`${this.ctx.sourcePath}:${lineStart}`, { date: this.currentDate.format('YYYY-MM-DD'), sourceDate: this.sourceDateStr });

            const newCodeBlock = [startLine, ...yamlLines, '```'].join('\n');
            const beforeBlock = lines.slice(0, lineStart).join('\n');
            const afterBlock = lines.slice(lineEnd + 1).join('\n');

            const newFileContent = [beforeBlock, newCodeBlock, afterBlock].filter(x => x !== '').join('\n');
            await this.app.vault.modify(activeFile, newFileContent);
        } catch (e) {
            console.error('Error updating codeblock in file:', e);
        }
    }

    /** Rule whose editor row is open under the filter bar (null: none) */
    filterEditingId: string | null = null;

    /**
     * Inline filter panel, in the shape of Obsidian's own filters: one wrapping bar (match mode, a chip per rule,
     * "+ Filter") and, for the chip being edited, a single editor row below it. Nested groups (older notes, or
     * "+ Filter → Group") render inline as bracketed chip groups instead of stacked boxes. It edits the same
     * FilterGroup tree as before, so the YAML written into the note (updateCodeBlockInFile) is unchanged.
     */
    renderFilterPanel(parent: HTMLElement): HTMLElement | null {
        if (!this.showFilterPanel) return null;

        const panel = parent.createDiv({ cls: 'dp-filter-panel' });
        this.filterPanelEl = panel;
        this.attachFilterDismissListeners();

        this.renderFilterBar(panel, this.filters, null);
        const editing = this.filterEditingId ? this.findFilterRule(this.filters, this.filterEditingId) : null;
        if (editing) this.renderFilterRuleEditor(panel, editing.rule);
        else this.filterEditingId = null;
        return panel;
    }

    findFilterRule(group: FilterGroup, id: string): { rule: FilterRule; parent: FilterGroup } | null {
        for (const child of group.children ?? []) {
            if (isFilterGroup(child)) {
                const found = this.findFilterRule(child, id);
                if (found) return found;
            } else if (child.id === id) {
                return { rule: child, parent: group };
            }
        }
        return null;
    }

    /** The root bar, or (with `parentGroup`) a nested group drawn inline as a bracketed chip group */
    renderFilterBar(container: HTMLElement, group: FilterGroup, parentGroup: FilterGroup | null) {
        const nested = parentGroup !== null;
        const bar = container.createDiv({ cls: nested ? 'dp-filter-chip-group' : 'dp-filter-bar' });

        const mode = bar.createEl('select', { cls: 'dropdown dp-filter-mode', attr: { 'aria-label': 'Match mode' } });
        ([['all', nested ? 'all of' : 'Match all'], ['any', nested ? 'any of' : 'Match any'], ['none', nested ? 'none of' : 'Match none']] as const)
            .forEach(([value, label]) => {
                const opt = mode.createEl('option', { value, text: label });
                if (value === group.mode) opt.selected = true;
            });
        mode.addEventListener('change', () => {
            group.mode = mode.value as FilterGroup['mode'];
            this.onFilterChanged();
        });

        (group.children ?? []).forEach(child => {
            if (isFilterGroup(child)) this.renderFilterBar(bar, child, group);
            else this.renderFilterChip(bar, child, group);
        });

        const add = bar.createEl('button', {
            cls: 'dp-filter-add',
            text: nested ? '+' : '+ Filter',
            attr: { 'aria-label': nested ? 'Add a filter to this group' : 'Add a filter' }
        });
        add.addEventListener('click', (e) => this.openAddFilterMenu(e, group));

        if (nested) {
            const remove = bar.createEl('button', { cls: 'dp-filter-chip-remove', attr: { 'aria-label': 'Remove this group' } });
            setIcon(remove, 'x');
            remove.addEventListener('click', () => {
                this.removeNodeFromGroup(this.filters, group.id!);
                this.onFilterChanged(true);
            });
        } else if (!(group.children?.length)) {
            bar.createSpan({ cls: 'dp-filter-empty', text: 'No filters: every item is shown.' });
        }
    }

    renderFilterChip(bar: HTMLElement, rule: FilterRule, group: FilterGroup) {
        rule.id ??= randomFilterId();
        const chip = bar.createDiv({
            cls: `dp-filter-chip${this.filterEditingId === rule.id ? ' is-editing' : ''}`,
            attr: { 'data-rule-id': rule.id, role: 'button', tabindex: '0', 'aria-label': `${describeFilterRule(rule)} (click to edit)` }
        });
        setFirstIcon(chip.createSpan({ cls: 'dp-filter-chip-icon' }), FILTER_TYPES.find(t => t.type === rule.type)?.icons ?? ['filter']);
        chip.createSpan({ cls: 'dp-filter-chip-label', text: describeFilterRule(rule) });
        const toggleEditor = () => {
            this.filterEditingId = this.filterEditingId === rule.id ? null : rule.id!;
            this.rebuildFilterPanel();
        };
        chip.addEventListener('click', toggleEditor);
        chip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleEditor();
            }
        });

        const remove = chip.createEl('button', { cls: 'dp-filter-chip-remove', attr: { 'aria-label': 'Remove this filter' } });
        setIcon(remove, 'x');
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            const index = group.children?.indexOf(rule) ?? -1;
            if (index !== -1) group.children!.splice(index, 1);
            if (this.filterEditingId === rule.id) this.filterEditingId = null;
            this.onFilterChanged(true);
        });
    }

    /** "+ Filter": pick what to filter by (opens that rule's editor), or add a nested group */
    openAddFilterMenu(e: MouseEvent, group: FilterGroup) {
        const menu = new Menu();
        (menu as any).dom?.addClass('dp-glass-menu'); // `dom` is undocumented; absent when native menus are enabled
        const add = (node: FilterRule | FilterGroup) => {
            (group.children ??= []).push(node);
            if (!isFilterGroup(node)) this.filterEditingId = node.id!;
            this.onFilterChanged(true);
        };
        FILTER_TYPES.forEach(t => menu.addItem(item => item.setTitle(t.label).setIcon(t.icons[0]).onClick(() => add(newFilterRule(t.type)))));
        menu.addSeparator();
        menu.addItem(item => item.setTitle('Group (match any of…)').setIcon('list').onClick(() =>
            add({ kind: 'group', id: randomFilterId(), mode: 'any', children: [] })));
        menu.showAtMouseEvent(e);
    }

    /** Keeps the chip of the rule being edited in step with its editor row (label and type icon) */
    refreshFilterChip(rule: FilterRule) {
        const chip = this.filterPanelEl?.querySelector<HTMLElement>(`[data-rule-id="${rule.id}"]`);
        if (!chip) return;
        chip.querySelector('.dp-filter-chip-label')?.setText(describeFilterRule(rule));
        const icon = chip.querySelector<HTMLElement>('.dp-filter-chip-icon');
        if (icon) {
            icon.empty();
            setFirstIcon(icon, FILTER_TYPES.find(t => t.type === rule.type)?.icons ?? ['filter']);
        }
        chip.setAttr('aria-label', `${describeFilterRule(rule)} (click to edit)`);
    }

    /** One row: [type] [operator] [value] [Done]. Every change filters live; the chip follows. */
    renderFilterRuleEditor(panel: HTMLElement, rule: FilterRule) {
        const row = panel.createDiv({ cls: 'dp-filter-editor' });
        const changed = () => {
            this.refreshFilterChip(rule);
            this.onFilterChanged();
        };

        const typeSelect = row.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Filter by' } });
        FILTER_TYPES.forEach(t => {
            const opt = typeSelect.createEl('option', { value: t.type, text: t.label });
            if (t.type === rule.type) opt.selected = true;
        });

        const opSelect = row.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Condition' } });
        const operatorsFor = (type: FilterRule['type']): FilterRule['operator'][] => {
            if (type === 'priority') return ['equals', 'notEquals', 'isHigher', 'isLower'];
            if (type === 'status' || type === 'itemType') return ['equals', 'notEquals'];
            if (type === 'date') return ['equals', 'notEquals', 'isBefore', 'isAfter', 'isEmpty', 'isNotEmpty'];
            if (type === 'folder' || type === 'file') return ['contains', 'notContains'];
            return ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith'];
        };
        const opLabel = (op: FilterRule['operator']) => {
            if (rule.type === 'folder') return op === 'notContains' ? 'not in' : 'in';
            if (rule.type === 'file') return op === 'notContains' ? 'does not match' : 'matches';
            return FILTER_OP_LABEL[op];
        };
        const renderOperators = () => {
            opSelect.empty();
            const ops = operatorsFor(rule.type);
            if (!ops.includes(rule.operator)) rule.operator = ops[0];
            ops.forEach(op => {
                const opt = opSelect.createEl('option', { value: op, text: opLabel(op) });
                if (op === rule.operator) opt.selected = true;
            });
        };

        const valueSlot = row.createDiv({ cls: 'dp-filter-editor-value' });
        const selectValue = (options: Array<[string, string]>) => {
            const select = valueSlot.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Value' } });
            options.forEach(([value, label]) => {
                const opt = select.createEl('option', { value, text: label });
                if (value === rule.value) opt.selected = true;
            });
            select.addEventListener('change', () => { rule.value = select.value; changed(); });
        };
        const renderValue = () => {
            valueSlot.empty();
            if (rule.type === 'status') {
                selectValue([['todo', 'To do'], ['in-progress', 'In progress'], ['completed', 'Completed'], ['cancelled', 'Cancelled']]);
            } else if (rule.type === 'priority') {
                selectValue([['highest', 'Highest 🔺'], ['high', 'High ⏫'], ['medium', 'Medium 🔼'], ['normal', 'Normal'], ['low', 'Low 🔽'], ['lowest', 'Lowest ⏬']]);
            } else if (rule.type === 'itemType') {
                selectValue([['task', 'Task'], ['gcal', 'Google Calendar appointment']]);
            } else if (rule.type === 'date') {
                if (rule.operator === 'isEmpty' || rule.operator === 'isNotEmpty') return;
                const presets = ['today', 'yesterday', 'tomorrow', 'this week', 'this month', 'this year'];
                const select = valueSlot.createEl('select', { cls: 'dropdown', attr: { 'aria-label': 'Date' } });
                [['today', 'Today'], ['yesterday', 'Yesterday'], ['tomorrow', 'Tomorrow'], ['this week', 'This week'],
                    ['this month', 'This month'], ['this year', 'This year'], ['custom', 'Specific date…']].forEach(([value, label]) => {
                    const opt = select.createEl('option', { value, text: label });
                    if (value === (presets.includes(rule.value) ? rule.value : 'custom')) opt.selected = true;
                });
                const picker = valueSlot.createEl('input', { type: 'date', attr: { 'aria-label': 'Specific date' } });
                const showPicker = !presets.includes(rule.value);
                picker.toggleClass('dp-hidden', !showPicker);
                picker.value = /^\d{4}-\d{2}-\d{2}$/.test(rule.value) ? rule.value : (window as any).moment().format('YYYY-MM-DD');
                select.addEventListener('change', () => {
                    const custom = select.value === 'custom';
                    picker.toggleClass('dp-hidden', !custom);
                    rule.value = custom ? picker.value : select.value;
                    changed();
                });
                picker.addEventListener('change', () => { rule.value = picker.value; changed(); });
            } else {
                const input = valueSlot.createEl('input', {
                    type: 'text',
                    attr: {
                        'aria-label': 'Value',
                        placeholder: rule.type === 'tag' ? 'e.g. urgent' : rule.type === 'folder' ? 'Folder…' : rule.type === 'file' ? 'Note name…' : 'Text…'
                    }
                });
                input.value = rule.value;
                // Filters live while typing: the content refresh keeps this panel (and the caret) mounted
                input.addEventListener('input', () => { rule.value = input.value; changed(); });
                onEnterSubmit(input, () => closeEditor()); // IME-safe: a composing Hangul syllable is committed first
                if (rule.type === 'folder' || rule.type === 'file') {
                    attachPathSuggest(this.app, input, rule.type, path => {
                        // Folder rules compare the folder path; file rules the note name (filename, ".md" optional)
                        input.value = rule.type === 'file' ? (path.split('/').pop() ?? path).replace(/\.md$/i, '') : path;
                        rule.value = input.value;
                        changed();
                    });
                }
                if (!rule.value) window.setTimeout(() => input.focus(), 0); // a fresh rule is ready to type into
            }
        };

        const closeEditor = () => {
            this.filterEditingId = null;
            this.rebuildFilterPanel();
        };

        renderOperators();
        renderValue();
        typeSelect.addEventListener('change', () => {
            const fresh = newFilterRule(typeSelect.value as FilterRule['type']);
            rule.type = fresh.type;
            rule.operator = fresh.operator;
            rule.value = fresh.value;
            renderOperators();
            renderValue();
            changed();
        });
        opSelect.addEventListener('change', () => {
            rule.operator = opSelect.value as FilterRule['operator'];
            renderValue();
            changed();
        });

        const done = row.createEl('button', { cls: 'dp-filter-editor-done', text: 'Done' });
        done.addEventListener('click', closeEditor);
    }

    removeNodeFromGroup(group: FilterGroup, targetId: string): boolean {
        if (!group.children) return false;
        for (let i = 0; i < group.children.length; i++) {
            const child = group.children[i];
            if (child.id === targetId) {
                group.children.splice(i, 1);
                return true;
            }
            if (child.kind === 'group' || (child as any).children !== undefined) {
                const found = this.removeNodeFromGroup(child as FilterGroup, targetId);
                if (found) return true;
            }
        }
        return false;
    }

    navigateDate(direction: number) {
        if (this.viewType === 'daily') this.currentDate.add(direction, 'day');
        if (this.viewType === 'multiDay') this.currentDate.add(direction * this.getNDayCount(), 'day');
        if (this.viewType === 'weekly') this.currentDate.add(direction, 'week');
        if (this.viewType === 'monthly') this.currentDate.add(direction, 'month');
        if (this.viewType === 'list') {
            this.currentDate.add(direction, 'month');
        }
    }

    renderRoot(rootEl: HTMLDivElement) {
        const header = rootEl.createDiv({ cls: 'dp-header' });
        this.renderNavHeader(header, false);

        const tabsContainer = header.createDiv({ cls: 'dp-tabs' });
        const tabs: { key: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list'; label: string }[] = [
            { key: 'daily', label: t('view.dailyTimeline') },
            { key: 'multiDay', label: t('view.nDay', { n: this.getNDayCount() }) },
            { key: 'weekly', label: t('view.weekly') },
            { key: 'monthly', label: t('view.monthlyCalendar') },
            { key: 'board', label: t('view.board') },
            { key: 'list', label: t('view.listView') }
        ];

        tabs.forEach(tab => {
            if (tab.key === 'multiDay') {
                const tabEl = tabsContainer.createEl('div', {
                    cls: `dp-tab dp-tab-nday ${this.viewType === 'multiDay' ? 'active' : ''}`
                });

                tabEl.addEventListener('click', async (e) => {
                    if (e.target instanceof HTMLSelectElement) return;
                    this.viewType = 'multiDay';
                    await this.refreshTasks(); // tab change: cached GCal ranges only, no forced fetch
                    this.updateCodeBlockInFile(this.viewType, this.filters);
                });

                const select = tabEl.createEl('select', {
                    cls: 'dp-tab-select'
                });

                for (let i = 2; i <= 14; i++) {
                    const opt = select.createEl('option', { value: String(i), text: String(i) });
                    opt.style.backgroundColor = 'var(--background-primary)';
                    opt.style.color = 'var(--text-normal)';
                    if (i === this.getNDayCount()) {
                        opt.selected = true;
                    }
                }

                tabEl.createSpan({ text: t('view.nDaySuffix') });

                // The block's own count, kept in its source: the planner view and other blocks keep theirs
                select.addEventListener('change', async () => {
                    this.nDays = parseInt(select.value, 10);
                    triggerHaptic('selection');
                    this.viewType = 'multiDay';
                    await this.refreshTasks();
                    this.updateCodeBlockInFile(this.viewType, this.filters);
                });
            } else {
                const btn = tabsContainer.createEl('button', {
                    cls: `dp-tab ${this.viewType === tab.key ? 'active' : ''}`,
                    text: tab.label
                });
                btn.addEventListener('click', async () => {
                    if (this.viewType !== tab.key) triggerHaptic('selection');
                    this.viewType = tab.key;
                    await this.refreshTasks(); // tab change: cached GCal ranges only, no forced fetch
                    this.updateCodeBlockInFile(this.viewType, this.filters);
                });
            }
        });
        animateActiveTabPill(tabsContainer, this as any, this.viewType);
        keepActiveTabInView(tabsContainer, this as any);

        this.renderFilterPanel(rootEl);

        const content = rootEl.createDiv({ cls: 'dp-content' });
        content.style.cssText = 'flex-grow: 1; overflow-y: auto; padding: 0; position: relative;';
        this.renderContentArea(rootEl, content);
    }

    renderContentArea(rootEl: HTMLDivElement, content: HTMLDivElement) {
        const nav = this.navDirection;
        const dir: PageDirection | null = nav === 'next' ? 'next' : nav ? 'prev' : null;
        const snap = dir ? capturePage(content, 0) : null;
        content.empty();
        rootEl.querySelector(':scope > .dp-current-task-bar')?.remove();
        this.stopCurrentTaskTracker(); // restarted below on Daily

        if (this.viewType === 'daily') {
            this.renderDailyTimeline(content);
            this.renderCurrentTaskTracker(rootEl);
        } else if (this.viewType === 'weekly') {
            this.renderWeeklyView(content);
        } else if (this.viewType === 'multiDay') {
            this.renderWeeklyView(content, this.getNDayCount(), true);
        } else if (this.viewType === 'monthly') {
            this.renderMonthlyCalendar(content);
        } else if (this.viewType === 'board') {
            this.renderKanbanBoard(content);
        } else if (this.viewType === 'list') {
            this.renderListView(content);
        }
        if (snap && dir) {
            playPageSwipe(snap, dir);
            this.navDirection = null; // a second render in the same navigation must not push again
        }
    }
}

// Type-side view of the runtime mixin below: the renderer really has these base-view methods on its prototype
export interface DayPlannerCodeBlockRenderer extends Pick<DayPlannerBaseView,
    'refreshTasks' | 'render' | 'renderNavHeader' | 'renderDailyTimeline' | 'renderCurrentTaskTracker' | 'stopCurrentTaskTracker' |
    'renderWeeklyView' | 'renderMonthlyCalendar' | 'renderKanbanBoard' | 'renderListView' | 'registerScrollIdleClass' | 'getNDayCount'> {}

// Copy all methods of DayPlannerBaseView and its layer classes (src/views/*) onto DayPlannerCodeBlockRenderer's prototype,
// lowest layer first so overrides in later layers win
const baseViewLayers: object[] = [];
for (let proto = DayPlannerBaseView.prototype; proto && proto !== ItemView.prototype; proto = Object.getPrototypeOf(proto)) {
    baseViewLayers.unshift(proto);
}
for (const proto of baseViewLayers) for (const key of Object.getOwnPropertyNames(proto)) {
    if (
        key === 'constructor' ||
        key === 'onload' ||
        key === 'onunload' ||
        key === 'renderRoot' ||
        key === 'getViewType' ||
        key === 'getViewTabType' ||
        key === 'navigateDate'
    ) {
        continue;
    }

    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (descriptor) {
        Object.defineProperty(DayPlannerCodeBlockRenderer.prototype, key, descriptor);
    }
}
