import { 
    App, 
    Plugin, 
    PluginSettingTab, 
    Setting,
    DropdownComponent,
    WorkspaceLeaf,
    setIcon,
    Notice,
    TFile,
    TFolder,
    parseYaml,
    Platform,
    editorLivePreviewField,
    requestUrl
} from 'obsidian';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { 
    DayPlannerSettings, 
    DEFAULT_SETTINGS, 
    VIEW_TYPES,
    TaskItem,
    GCalEvent,
    ReminderType,
    TouchLayoutMode,
    GCAL_CACHE_TTL_MS,
    GCAL_MAX_CACHED_RANGES,
    IcsCalendarConfig,
    OVERDUE_MOVE_OPTIONS
} from './types';
import { overdueMoveTarget } from './drawer';
import { SidebarCalendarView } from './sidebarCalendar';
import { parseIcsEvents } from './ics';
import { STYLES } from './styles';
import { 
    scanVaultTasks, 
    isSyncConflictPath,
    sanitizeCredential,
    cleanTaskTextForDisplay,
    parseTaskLine,
    formatMinutesNice,
    setHapticsEnabled,
    setScanSettings,
    isExcludedPath,
    GCAL_ID_TAG_RE,
    attachPathSuggest,
    onEnterSubmit,
    parentNoteOf,
    timeToMinutes,
    isTouchLike,
    recordPressOrigin
} from './utils';
import { fetchSingleCalendarEvents, syncAllTasksToGCal } from './gcalApi';
import { 
    DayPlannerCombinedView, 
    DayPlannerDailyView,
    DayPlannerCodeBlockRenderer,
    openDayReview
} from './views';
import { ShortcutHelpModal, WhatsNewModal } from './modals';
import { t, setLanguage } from './i18n';
import { PillTabs } from './src/settings/pillTabs';

export class DayPlannerSettingTab extends PluginSettingTab {
    plugin: DayPlannerPlugin;

    constructor(app: App, plugin: DayPlannerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    /** Settings tab on screen; kept across display() calls (toggles that reveal dependent settings re-render the tab) */
    private activeSettingsTab = 'general';

    /**
     * Top tab bar + one panel per category. Every panel is built on each display(); switching only flips classes,
     * so it is instant and keeps the panels' state. Returns the panel bodies, keyed by tab id.
     */
    private createSettingsTabs(container: HTMLElement): Record<'general' | 'timeline' | 'gcal' | 'reminders' | 'display', HTMLElement> {
        type TabId = 'general' | 'timeline' | 'gcal' | 'reminders' | 'display';
        const tabs: Array<{ value: TabId; label: string; icon: string }> = [
            { value: 'general', label: t('settings.tab.general'), icon: 'settings' },
            { value: 'timeline', label: t('settings.tab.timeline'), icon: 'clock' },
            { value: 'gcal', label: t('settings.tab.gcal'), icon: 'cloud' },
            { value: 'reminders', label: t('settings.tab.reminders'), icon: 'bell' },
            { value: 'display', label: t('settings.tab.display'), icon: 'smartphone' }
        ];
        const panels = {} as Record<TabId, HTMLElement>;
        const show = (id: TabId) => {
            this.activeSettingsTab = id;
            tabs.forEach(tab => panels[tab.value].toggleClass('is-active', tab.value === id));
        };
        const initial = tabs.find(tab => tab.value === this.activeSettingsTab)?.value ?? 'general';
        // Same tab bar and sliding pill as the planner's view tabs (PillTabs)
        new PillTabs<TabId>(container, {
            options: tabs, value: initial, onChange: show, ariaLabel: t('settings.heading'), role: 'tablist',
            cls: 'dp-settings-tabs'
        });
        tabs.forEach(tab => { panels[tab.value] = container.createDiv({ cls: 'dp-settings-panel', attr: { role: 'tabpanel' } }); });
        show(initial);
        return panels;
    }

    /** A text setting for a vault path with Obsidian's fuzzy file / folder suggestions (utils.attachPathSuggest) */
    private addPathSetting(container: HTMLElement, name: string, desc: string, placeholder: string,
        kind: 'file' | 'folder', value: string, save: (value: string) => Promise<void>) {
        new Setting(container)
            .setName(name)
            .setDesc(desc)
            .addText(text => {
                text.setPlaceholder(placeholder)
                    .setValue(value)
                    .onChange(async (v) => save(v));
                attachPathSuggest(this.app, text.inputEl, kind);
            });
    }

    /** Mode for the next rule added in the exclusion filter (session only) */
    private exclusionInputMode: 'exclude' | 'keep' = 'exclude';

    /**
     * Excluded files & folders, in the shape of Obsidian's own search filters: one input with vault suggestions adds
     * a rule as a chip; chips show what they match (folder, note, or * pattern) and are removed with ×. A rule can
     * exclude or keep: "Keep" re-includes something inside an excluded folder ("!" prefix in the stored rule).
     * A click on a chip flips it between the two. A live count shows what the rules currently leave out.
     */
    private renderExclusionFilter(container: HTMLElement) {
        new Setting(container)
            .setName(t('settings.exclusion.name'))
            .setDesc(t('settings.exclusion.desc'))
            .setClass('dp-path-filter-setting');

        const box = container.createDiv({ cls: 'dp-path-filter' });
        const inputRow = box.createDiv({ cls: 'dp-path-filter-input-row' });
        const modeToggle = inputRow.createDiv({ cls: 'dp-path-filter-mode', attr: { role: 'group', 'aria-label': t('settings.exclusion.ruleType') } });
        const input = inputRow.createEl('input', {
            cls: 'dp-path-filter-input',
            attr: { type: 'text', placeholder: t('settings.exclusion.placeholder'), spellcheck: 'false' }
        });
        const chips = box.createDiv({ cls: 'dp-path-chips' });
        const summary = box.createDiv({ cls: 'dp-path-filter-summary' });

        const rules = () => (this.plugin.settings.excludePaths ??= []);
        const save = async () => {
            await this.plugin.saveSettings(); // a changed rule list rescans the vault and refreshes the views
            renderChips();
        };
        const addRule = async (rawPath: string) => {
            const path = rawPath.trim().replace(/^!/, '');
            if (!path) return;
            const rule = this.exclusionInputMode === 'keep' ? `!${path}` : path;
            const list = rules();
            // One rule per path: re-adding it with the other mode switches that rule instead of duplicating it
            const existing = list.findIndex(r => r.replace(/^!/, '') === path);
            if (existing >= 0) list.splice(existing, 1);
            list.push(rule);
            input.value = '';
            await save();
        };

        const renderMode = () => {
            modeToggle.empty();
            (['exclude', 'keep'] as const).forEach(mode => {
                const btn = modeToggle.createEl('button', {
                    cls: `dp-path-filter-mode-btn${this.exclusionInputMode === mode ? ' is-active' : ''}`,
                    text: mode === 'exclude' ? t('settings.exclusion.exclude') : t('settings.exclusion.keep')
                });
                btn.addEventListener('click', () => {
                    this.exclusionInputMode = mode;
                    renderMode();
                    input.focus();
                });
            });
        };

        const renderChips = () => {
            chips.empty();
            const list = rules();
            if (list.length === 0) {
                chips.createSpan({ cls: 'dp-path-chips-empty', text: t('settings.exclusion.empty') });
            }
            list.forEach((rule, index) => {
                const keep = rule.startsWith('!');
                const path = keep ? rule.slice(1) : rule;
                const target = this.app.vault.getAbstractFileByPath(path.replace(/\/+$/, ''))
                    ?? this.app.vault.getAbstractFileByPath(`${path}.md`);
                const icon = path.includes('*') ? 'asterisk' : target instanceof TFolder || path.endsWith('/') ? 'folder' : target instanceof TFile ? 'file-text' : 'help-circle';
                const chip = chips.createDiv({
                    cls: `dp-path-chip${keep ? ' is-keep' : ''}${!target && !path.includes('*') ? ' is-missing' : ''}`,
                    attr: { 'aria-label': `${keep ? t('settings.exclusion.keep') : t('settings.exclusion.exclude')}: ${path}${!target && !path.includes('*') ? t('settings.exclusion.notFound') : ''} · ${t('settings.exclusion.clickToSwitch')}` }
                });
                chip.createSpan({ cls: 'dp-path-chip-mode', text: keep ? t('settings.exclusion.keep') : t('settings.exclusion.exclude') });
                setIcon(chip.createSpan({ cls: 'dp-path-chip-icon' }), icon);
                chip.createSpan({ cls: 'dp-path-chip-label', text: path });
                chip.addEventListener('click', async () => {
                    list[index] = keep ? path : `!${path}`;
                    await save();
                });
                const remove = chip.createEl('button', { cls: 'dp-path-chip-remove', attr: { 'aria-label': t('settings.exclusion.remove', { path }) } });
                setIcon(remove, 'x');
                remove.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    list.splice(index, 1);
                    await save();
                });
            });

            const notes = this.app.vault.getMarkdownFiles().filter(f => !isSyncConflictPath(f.path));
            const excluded = notes.filter(f => isExcludedPath(f.path)).length;
            summary.setText(list.length === 0 ? '' : t('settings.exclusion.summary', { excluded, total: notes.length }));
        };

        attachPathSuggest(this.app, input, 'any', path => void addRule(path));
        onEnterSubmit(input, () => void addRule(input.value)); // typed patterns; IME-safe for Korean names
        renderMode();
        renderChips();
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('dp-settings');

        new Setting(containerEl).setName(t('settings.heading')).setHeading();

        // Panels are created up front, so each block below lands in its tab regardless of code order
        const { general, timeline, gcal, reminders, display: mobileDisplay } = this.createSettingsTabs(containerEl);

        // Kept bilingual (not translated) so it can be found whatever language is on screen
        new Setting(general)
            .setName('Language / 언어')
            .setDesc(t('settings.language.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'Auto (Obsidian Default) / 자동 감지')
                .addOption('en', 'English')
                .addOption('ko', '한국어')
                .addOption('ja', '日本語')
                .addOption('zh', '简体中文')
                .setValue(this.plugin.settings.language ?? 'auto')
                .onChange(async (value) => {
                    this.plugin.settings.language = value as DayPlannerSettings['language'];
                    await this.plugin.saveSettings(); // applies the language (setLanguage)
                    this.plugin.refreshActiveViews();
                    this.plugin.updateStatusBar();
                    this.display(); // this tab, in the new language
                    new Notice(t('settings.language.changed'));
                })
            );

        new Setting(general)
            .setName(t('settings.releaseNotes.name'))
            .setDesc(t('settings.releaseNotes.desc', { version: this.plugin.manifest.version }))
            .addButton(button => button
                .setButtonText(t('settings.releaseNotes.button'))
                .onClick(() => new WhatsNewModal(this.app, this.plugin.manifest.version).open()));

        this.addPathSetting(general, t('settings.defaultTaskFile.name'),
            t('settings.defaultTaskFile.desc'),
            'Day Planner.md', 'file', this.plugin.settings.defaultTaskFile,
            async (value) => {
                this.plugin.settings.defaultTaskFile = value || 'Day Planner.md';
                await this.plugin.saveSettings();
            });

        this.renderExclusionFilter(general);

        new Setting(general).setName(t('settings.dailyNotes.heading')).setHeading();
        this.addPathSetting(general, t('settings.dailyFolder.name'),
            t('settings.dailyFolder.desc'),
            'Daily/Journal', 'folder', this.plugin.settings.dailyNotesFolder,
            async (value) => {
                this.plugin.settings.dailyNotesFolder = value.trim() || '';
                await this.plugin.saveSettings();
            });

        new Setting(general)
            .setName(t('settings.dailyFormat.name'))
            .setDesc(t('settings.dailyFormat.desc'))
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dailyNotesFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNotesFormat = value.trim() || 'YYYY-MM-DD';
                    await this.plugin.saveSettings();
                })
            );

        this.addPathSetting(general, t('settings.dailyTemplate.name'),
            t('settings.dailyTemplate.desc'),
            'Templates/Daily.md', 'file', this.plugin.settings.dailyNoteTemplate || '',
            async (value) => {
                this.plugin.settings.dailyNoteTemplate = value.trim();
                await this.plugin.saveSettings();
            });

        new Setting(general).setName(t('settings.weeklyNotes.heading')).setHeading();
        this.addPathSetting(general, t('settings.weeklyFolder.name'),
            t('settings.weeklyFolder.desc'),
            'Weekly/Plans', 'folder', this.plugin.settings.weeklyNotesFolder || '',
            async (value) => {
                this.plugin.settings.weeklyNotesFolder = value.trim() || '';
                await this.plugin.saveSettings();
            });

        new Setting(general)
            .setName(t('settings.weeklyFormat.name'))
            .setDesc(t('settings.weeklyFormat.desc'))
            .addText(text => text
                .setPlaceholder('gggg-[W]ww')
                .setValue(this.plugin.settings.weeklyNotesFormat || 'gggg-[W]ww')
                .onChange(async (value) => {
                    this.plugin.settings.weeklyNotesFormat = value.trim() || 'gggg-[W]ww';
                    await this.plugin.saveSettings();
                })
            );

        this.addPathSetting(general, t('settings.weeklyTemplate.name'),
            t('settings.weeklyTemplate.desc'),
            'Templates/Weekly.md', 'file', this.plugin.settings.weeklyNoteTemplate || '',
            async (value) => {
                this.plugin.settings.weeklyNoteTemplate = value.trim();
                await this.plugin.saveSettings();
            });

        new Setting(timeline)
            .setName(t('settings.nDay.name'))
            .setDesc(t('settings.nDay.desc'))
            .addSlider(slider => slider
                .setLimits(2, 14, 1)
                .setDynamicTooltip()
                .setValue(this.plugin.settings.nDayViewDays || 4)
                .onChange(async (value) => {
                    this.plugin.settings.nDayViewDays = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshActiveViews();
                })
            );

        new Setting(mobileDisplay)
            .setName(t('settings.hideMetadata.name'))
            .setDesc(t('settings.hideMetadata.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideBracketMetadata ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.hideBracketMetadata = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshActiveViews();
                    this.plugin.updateStatusBar();
                    document.body.toggleClass('dp-hide-gcal-id', value);
                    this.app.workspace.updateOptions(); // re-runs the Live Preview hider in open editors
                    // Reading View re-renders on next open/switch of each note
                })
            );

        new Setting(mobileDisplay)
            .setName(t('settings.shortcutButton.name'))
            .setDesc(t('settings.shortcutButton.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showShortcutButton ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.showShortcutButton = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshActiveViews();
                })
            );

        // One-finger sideways swipe: a two-way switch, planner dates on one side, Obsidian's own swipe on the other; the
        // description follows the side chosen. Stored as desktopSwipeNavigation (true = dates), read on each touch / swipe.
        type SwipeMode = 'dates' | 'obsidian';
        const swipeDesc = (mode: SwipeMode) => t(mode === 'dates' ? 'settings.swipeNavigation.descDates'
            : Platform.isMobile ? 'settings.swipeNavigation.descObsidian' : 'settings.swipeNavigation.descOff');
        const swipeMode: SwipeMode = this.plugin.settings.desktopSwipeNavigation === false ? 'obsidian' : 'dates';
        const swipeSetting = new Setting(mobileDisplay)
            .setName(t('settings.swipeNavigation.name'))
            .setDesc(swipeDesc(swipeMode));
        swipeSetting.settingEl.addClass('dp-setting-stacked');
        new PillTabs<SwipeMode>(swipeSetting.controlEl, {
            options: [
                { value: 'dates', label: t('settings.swipeNavigation.dates') },
                // Desktop touchscreens have no sidebar swipe to give back: the other side there is simply Off
                { value: 'obsidian', label: t(Platform.isMobile ? 'settings.swipeNavigation.obsidian' : 'settings.swipeNavigation.off') }
            ],
            value: swipeMode,
            ariaLabel: t('settings.swipeNavigation.name'),
            role: 'radiogroup',
            cls: 'dp-setting-switch',
            onChange: async (mode) => {
                swipeSetting.setDesc(swipeDesc(mode));
                this.plugin.settings.desktopSwipeNavigation = mode === 'dates';
                await this.plugin.saveSettings();
            }
        });

        if (!Platform.isPhone) {
            new Setting(mobileDisplay)
                .setName(t('settings.touchLayout.name'))
                .setDesc(t('settings.touchLayout.desc'))
                .addDropdown(dropdown => dropdown
                    .addOption('auto', t('settings.touchLayout.auto'))
                    .addOption('touch', t('settings.touchLayout.touch'))
                    .addOption('mouse', t('settings.touchLayout.mouse'))
                    .setValue(this.plugin.settings.touchLayout ?? 'auto')
                    .onChange(async (value) => {
                        this.plugin.settings.touchLayout = value as TouchLayoutMode;
                        await this.plugin.saveSettings();
                        this.plugin.applyTouchLayout();
                    })
                );
        }

        new Setting(reminders)
            .setName(t('settings.reminderType.name'))
            .setDesc(t('settings.reminderType.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('off', t('settings.reminderType.off'))
                .addOption('auto', t('settings.reminderType.auto'))
                .addOption('notice', t('settings.reminderType.notice'))
                .addOption('system', t('settings.reminderType.system'))
                .setValue(this.plugin.settings.reminderType ?? 'auto')
                .onChange(async (value) => {
                    this.plugin.settings.reminderType = value as ReminderType;
                    await this.plugin.saveSettings();
                    if (value === 'system' || value === 'auto') this.plugin.requestNotificationPermission();
                })
            );

        new Setting(reminders)
            .setName(t('settings.reminderTiming.name'))
            .setDesc(t('settings.reminderTiming.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('0', t('settings.reminderTiming.atStart'))
                .addOption('5', t('settings.reminderTiming.before', { n: 5 }))
                .addOption('10', t('settings.reminderTiming.before', { n: 10 }))
                .addOption('15', t('settings.reminderTiming.before', { n: 15 }))
                .addOption('30', t('settings.reminderTiming.before', { n: 30 }))
                .setValue(String(this.plugin.settings.reminderOffsetMinutes ?? 0))
                .onChange(async (value) => {
                    this.plugin.settings.reminderOffsetMinutes = Number(value);
                    await this.plugin.saveSettings();
                })
            );

        new Setting(reminders)
            .setName(t('settings.reminderSound.name'))
            .setDesc(t('settings.reminderSound.desc'))
            .addExtraButton(button => button
                .setIcon('volume-2')
                .setTooltip(t('settings.reminderSound.test'))
                .onClick(() => this.plugin.playReminderChime())
            )
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableReminderSound ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableReminderSound = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(reminders)
            .setName(t('settings.remindTasks.name'))
            .setDesc(t('settings.remindTasks.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.reminderForTasks ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.reminderForTasks = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(reminders)
            .setName(t('settings.remindGCal.name'))
            .setDesc(t('settings.remindGCal.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.reminderForGCal ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.reminderForGCal = value;
                    await this.plugin.saveSettings();
                })
            );

        // All-day tasks and date-only deadlines have no time of their own: the reminder comes at a chosen hour
        const hourChoices = (dropdown: DropdownComponent) => {
            dropdown.addOption('', t('settings.reminder.off'));
            for (let h = 5; h <= 23; h++) {
                const hh = `${String(h).padStart(2, '0')}:00`;
                dropdown.addOption(hh, hh);
            }
            return dropdown;
        };

        new Setting(reminders).setName(`⏳ ${t('settings.reminders.allDayHeading')}`).setHeading();
        new Setting(reminders)
            .setName(t('settings.allDayReminder.name'))
            .setDesc(t('settings.allDayReminder.desc'))
            .addDropdown(dropdown => hourChoices(dropdown)
                .setValue(this.plugin.settings.allDayReminderTime ?? '09:00')
                .onChange(async (value) => {
                    this.plugin.settings.allDayReminderTime = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(reminders)
            .setName(t('settings.allDayDayBefore.name'))
            .setDesc(t('settings.allDayDayBefore.desc'))
            .addDropdown(dropdown => hourChoices(dropdown)
                .setValue(this.plugin.settings.allDayReminderDayBefore ?? '')
                .onChange(async (value) => {
                    this.plugin.settings.allDayReminderDayBefore = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(reminders).setName(`📅 ${t('settings.reminders.deadlineHeading')}`).setHeading();
        new Setting(reminders)
            .setName(t('settings.dueTimeReminder.name'))
            .setDesc(t('settings.dueTimeReminder.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('-1', t('settings.reminder.off'))
                .addOption('0', t('settings.dueTimeReminder.atTime'))
                .addOption('15', t('settings.reminderTiming.before', { n: 15 }))
                .addOption('30', t('settings.reminderTiming.before', { n: 30 }))
                .addOption('60', t('settings.dueTimeReminder.hoursBefore', { n: 1 }))
                .addOption('120', t('settings.dueTimeReminder.hoursBefore', { n: 2 }))
                .addOption('1440', t('settings.dueTimeReminder.dayBefore'))
                .setValue(String(this.plugin.settings.dueReminderOffset ?? 60))
                .onChange(async (value) => {
                    this.plugin.settings.dueReminderOffset = Number(value);
                    await this.plugin.saveSettings();
                })
            );
        new Setting(reminders)
            .setName(t('settings.dueDateReminder.name'))
            .setDesc(t('settings.dueDateReminder.desc'))
            .addDropdown(dropdown => hourChoices(dropdown)
                .setValue(this.plugin.settings.dueDateReminderTime ?? '09:00')
                .onChange(async (value) => {
                    this.plugin.settings.dueDateReminderTime = value;
                    await this.plugin.saveSettings();
                })
            );
        new Setting(reminders)
            .setName(t('settings.dueDaysBefore.name'))
            .setDesc(t('settings.dueDaysBefore.desc'))
            .addDropdown(dropdown => dropdown
                .addOption('0', t('settings.dueDaysBefore.onlyOnDay'))
                .addOption('1', t('settings.dueDaysBefore.days', { n: 1 }))
                .addOption('2', t('settings.dueDaysBefore.days', { n: 2 }))
                .addOption('3', t('settings.dueDaysBefore.days', { n: 3 }))
                .setValue(String(this.plugin.settings.dueDateReminderDaysBefore ?? 0))
                .onChange(async (value) => {
                    this.plugin.settings.dueDateReminderDaysBefore = Number(value);
                    await this.plugin.saveSettings();
                })
            );

        new Setting(reminders).setName(`🌙 ${t('review.setting.heading')}`).setHeading();
        new Setting(reminders)
            .setName(t('review.setting.name'))
            .setDesc(t('review.setting.desc'))
            .addDropdown(dropdown => hourChoices(dropdown)
                .setValue(this.plugin.settings.reviewPromptTime ?? '')
                .onChange(async (value) => {
                    this.plugin.settings.reviewPromptTime = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(mobileDisplay)
            .setName(t('settings.haptics.name'))
            .setDesc(t('settings.haptics.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMobileHaptics ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableMobileHaptics = value;
                    await this.plugin.saveSettings();
                })
            );

        // 📐 타임라인 세로 간격 및 노출 시간 범위 조절 설정 UI 추가
        
        new Setting(timeline)
            .setName(t('settings.separateHeights.name'))
            .setDesc(t('settings.separateHeights.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.separateViewHeights || false)
                .onChange(async (value) => {
                    this.plugin.settings.separateViewHeights = value;
                    await this.plugin.saveSettings();
                    this.display(); // Force display refresh to show/hide separate sliders
                })
            );

        if (this.plugin.settings.separateViewHeights) {
            new Setting(timeline)
                .setName(t('settings.hourHeightMain.name'))
                .setDesc(t('settings.hourHeightMain.desc'))
                .addSlider(slider => slider
                    .setLimits(30, 180, 5)
                    .setValue(this.plugin.settings.timelineHourHeight || 60)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.timelineHourHeight = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshActiveViews();
                    })
                );

            new Setting(timeline)
                .setName(t('settings.hourHeightCompact.name'))
                .setDesc(t('settings.hourHeightCompact.desc'))
                .addSlider(slider => slider
                    .setLimits(30, 180, 5)
                    .setValue(this.plugin.settings.timelineHourHeightDaily || 60)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.timelineHourHeightDaily = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshActiveViews();
                    })
                );
        } else {
            new Setting(timeline)
                .setName(t('settings.hourHeightSynced.name'))
                .setDesc(t('settings.hourHeightSynced.desc'))
                .addSlider(slider => slider
                    .setLimits(30, 180, 5)
                    .setValue(this.plugin.settings.timelineHourHeight || 60)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.timelineHourHeight = value;
                        this.plugin.settings.timelineHourHeightDaily = value;
                        await this.plugin.saveSettings();
                        this.plugin.refreshActiveViews();
                    })
                );
        }

        new Setting(timeline)
            .setName(t('settings.startHour.name'))
            .setDesc(t('settings.startHour.desc'))
            .addDropdown(dropdown => {
                for (let i = 0; i < 24; i++) {
                    dropdown.addOption(String(i), `${String(i).padStart(2, '0')}:00`);
                }
                dropdown
                    .setValue(String(this.plugin.settings.timelineStartHour ?? 0))
                    .onChange(async (value) => {
                        const val = parseInt(value, 10);
                        if (val < this.plugin.settings.timelineEndHour) {
                            this.plugin.settings.timelineStartHour = val;
                            await this.plugin.saveSettings();
                            this.plugin.refreshActiveViews();
                        } else {
                            new Notice(t('settings.startHour.error'));
                            dropdown.setValue(String(this.plugin.settings.timelineStartHour));
                        }
                    });
            });

        new Setting(timeline)
            .setName(t('settings.endHour.name'))
            .setDesc(t('settings.endHour.desc'))
            .addDropdown(dropdown => {
                for (let i = 1; i <= 24; i++) {
                    dropdown.addOption(String(i), `${String(i).padStart(2, '0')}:00`);
                }
                dropdown
                    .setValue(String(this.plugin.settings.timelineEndHour ?? 24))
                    .onChange(async (value) => {
                        const val = parseInt(value, 10);
                        if (val > this.plugin.settings.timelineStartHour) {
                            this.plugin.settings.timelineEndHour = val;
                            await this.plugin.saveSettings();
                            this.plugin.refreshActiveViews();
                        } else {
                            new Notice(t('settings.endHour.error'));
                            dropdown.setValue(String(this.plugin.settings.timelineEndHour));
                        }
                    });
            });

        new Setting(timeline)
            .setName(t('settings.defaultDuration.name'))
            .setDesc(t('settings.defaultDuration.desc'))
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.inputEl.max = '1440';
                text.setPlaceholder('60')
                    .setValue(String(this.plugin.settings.defaultTaskDuration ?? 60))
                    .onChange(async (value) => {
                        const minutes = Math.round(Number(value));
                        if (!value.trim() || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return;
                        this.plugin.settings.defaultTaskDuration = minutes;
                        await this.plugin.saveSettings();
                    });
                // Empty or out-of-range entries are never saved: once the field is left, show the value in use
                text.inputEl.addEventListener('blur', () => text.setValue(String(this.plugin.settings.defaultTaskDuration ?? 60)));
            });

        new Setting(timeline)
            .setName(t('settings.deadlineDays.name'))
            .setDesc(t('settings.deadlineDays.desc'))
            .addText(text => {
                text.inputEl.type = 'number';
                text.inputEl.min = '1';
                text.inputEl.max = '60';
                text.setPlaceholder('7')
                    .setValue(String(this.plugin.settings.deadlineLookaheadDays ?? 7))
                    .onChange(async (value) => {
                        const days = Math.round(Number(value));
                        if (!value.trim() || !Number.isFinite(days) || days < 1 || days > 60) return;
                        this.plugin.settings.deadlineLookaheadDays = days;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.addEventListener('blur', () => text.setValue(String(this.plugin.settings.deadlineLookaheadDays ?? 7)));
            });

        // Move menu of overdue drawer cards: one switch per choice (all off hides the Move button)
        new Setting(timeline)
            .setName(t('settings.moveOptions.name'))
            .setDesc(t('settings.moveOptions.desc'))
            .setHeading();
        OVERDUE_MOVE_OPTIONS.forEach(option => {
            new Setting(timeline)
                .setName(overdueMoveTarget(option).label)
                .addToggle(toggle => toggle
                    .setValue((this.plugin.settings.overdueMoveOptions ?? []).includes(option))
                    .onChange(async (on) => {
                        const rest = (this.plugin.settings.overdueMoveOptions ?? []).filter(o => o !== option);
                        this.plugin.settings.overdueMoveOptions = on ? [...rest, option] : rest;
                        await this.plugin.saveSettings();
                        this.plugin.refreshActiveViews();
                    }));
        });

        new Setting(gcal)
            .setName(t('settings.enableGCal.name'))
            .setDesc(t('settings.enableGCal.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableGoogleCalendar)
                .onChange(async (value) => {
                    this.plugin.settings.enableGoogleCalendar = value;
                    await this.plugin.saveSettings();
                    this.display(); // Force display refresh to show/hide dependent settings
                })
            );

        if (this.plugin.settings.enableGoogleCalendar) {
            new Setting(gcal)
                .setName(t('settings.taskSyncCal.name'))
                .setDesc(t('settings.taskSyncCal.desc'))
                .addDropdown(dropdown => {
                    dropdown.addOption('', t('settings.taskSyncCal.select'));
                    const enabledCalendars = this.plugin.settings.googleCalendars.filter(c => c.enabled && c.id);
                    enabledCalendars.forEach(cal => {
                        dropdown.addOption(cal.id, cal.name || cal.id);
                    });
                    dropdown
                        .setValue(this.plugin.settings.taskSyncCalendarId || '')
                        .onChange(async (value) => {
                            this.plugin.settings.taskSyncCalendarId = value;
                            await this.plugin.saveSettings();
                        });
                });

            new Setting(gcal)
                .setName(t('settings.syncOnStartup.name'))
                .setDesc(t('settings.syncOnStartup.desc'))
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.syncOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.syncOnStartup = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        new Setting(gcal).setName(t('settings.oauth.heading')).setHeading();
        gcal.createEl('p', { 
            text: t('settings.oauth.intro')
        });

        new Setting(gcal)
            .setName(t('settings.clientId.name'))
            .setDesc(t('settings.clientId.desc'))
            .addText(text => text
                .setPlaceholder('xxxx.apps.googleusercontent.com')
                .setValue(this.plugin.settings.googleClientId || '')
                .onChange(async (value) => {
                    this.plugin.settings.googleClientId = sanitizeCredential(value);
                    await this.plugin.saveSettings();
                })
            );

        new Setting(gcal)
            .setName(t('settings.clientSecret.name'))
            .setDesc(t('settings.clientSecret.desc'))
            .addText(text => text
                .setPlaceholder('GOCSPX-xxxx')
                .setValue(this.plugin.settings.googleClientSecret || '')
                .onChange(async (value) => {
                    this.plugin.settings.googleClientSecret = sanitizeCredential(value);
                    await this.plugin.saveSettings();
                })
            );

        new Setting(gcal)
            .setName(t('settings.refreshToken.name'))
            .setDesc(t('settings.refreshToken.desc'))
            .addText(text => text
                .setPlaceholder('1//0xxxx')
                .setValue(this.plugin.settings.googleRefreshToken || '')
                .onChange(async (value) => {
                    this.plugin.settings.googleRefreshToken = sanitizeCredential(value);
                    await this.plugin.saveSettings();
                })
            );

        const calHeader = gcal.createDiv();
        calHeader.style.cssText = 'margin-top: 24px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;';
        const h4El = calHeader.createEl('h4', { text: t('settings.calendars.heading') });
        h4El.style.cssText = 'margin: 0;';
        
        const addCalBtn = calHeader.createEl('button', { text: t('settings.calendars.add'), cls: 'mod-cta' });
        addCalBtn.addEventListener('click', async () => {
            this.plugin.settings.googleCalendars.push({
                id: '',
                name: 'New Google Calendar',
                color: '#4285f4',
                enabled: true
            });
            await this.plugin.saveSettings();
            this.display();
        });

        const calsContainer = gcal.createDiv();
        calsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--background-modifier-border); padding: 12px; border-radius: 6px; background-color: var(--background-secondary-alt);';
        if (this.plugin.settings.googleCalendars.length === 0) {
            calsContainer.createEl('span', { 
                text: t('settings.calendars.empty') 
            });
        } else {
            this.plugin.settings.googleCalendars.forEach((cal, index) => {
                const row = calsContainer.createDiv();
                row.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; margin-bottom: 4px;';
                
                if (index === this.plugin.settings.googleCalendars.length - 1) {
                    row.style.borderBottom = 'none';
                    row.style.paddingBottom = '0';
                    row.style.marginBottom = '0';
                }

                const enabledToggle = row.createEl('input', { type: 'checkbox' });
                enabledToggle.checked = cal.enabled;
                enabledToggle.addEventListener('change', async () => {
                    cal.enabled = enabledToggle.checked;
                    await this.plugin.saveSettings();
                });

                const nameInput = row.createEl('input', { type: 'text', placeholder: t('settings.calendars.namePlaceholder') });
                nameInput.value = cal.name;
                nameInput.style.flex = '1';
                nameInput.style.minWidth = '100px';
                nameInput.addEventListener('change', async () => {
                    cal.name = nameInput.value;
                    await this.plugin.saveSettings();
                });

                const idInput = row.createEl('input', { type: 'text', placeholder: t('settings.calendars.idPlaceholder') });
                idInput.value = cal.id;
                idInput.style.flex = '2';
                idInput.style.minWidth = '200px';
                idInput.addEventListener('change', async () => {
                    cal.id = idInput.value.trim();
                    await this.plugin.saveSettings();
                });

                const colorInput = row.createEl('input', { type: 'color' });
                colorInput.value = cal.color;
                colorInput.style.width = '35px';
                colorInput.style.height = '28px';
                colorInput.style.padding = '0';
                colorInput.style.border = 'none';
                colorInput.style.cursor = 'pointer';
                colorInput.addEventListener('change', async () => {
                    cal.color = colorInput.value;
                    await this.plugin.saveSettings();
                });

                const delBtn = row.createEl('button', { text: t('common.delete'), cls: 'mod-warning' });
                delBtn.addEventListener('click', async () => {
                    this.plugin.settings.googleCalendars.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
        }

        // Next to the calendar colours above, so local tasks and each calendar can be balanced in one place
        new Setting(gcal)
            .setName(t('settings.taskColor.name'))
            .setDesc(t('settings.taskColor.desc'))
            .addColorPicker(color => color
                .setValue(this.plugin.settings.taskColor || '#ff9f1c')
                .onChange(async (value) => {
                    this.plugin.settings.taskColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.applyTaskColor();
                    this.plugin.refreshActiveViews();
                })
            );

        this.renderIcsSettings(gcal);
    }

    /** Subscribed calendars (.ics / webcal links): read-only, independent of the Google connection above */
    private renderIcsSettings(container: HTMLElement) {
        const plugin = this.plugin;
        const header = container.createDiv({ cls: 'dp-ics-settings-header' });
        header.createEl('h4', { text: t('ics.heading') });
        const actions = header.createDiv({ cls: 'dp-ics-settings-actions' });
        const refreshBtn = actions.createEl('button', { text: t('ics.refresh') });
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            try {
                await plugin.refreshIcsCalendars(true);
                plugin.refreshActiveViews();
                new Notice(t('ics.refreshed'));
            } finally {
                refreshBtn.disabled = false;
            }
        });
        const addBtn = actions.createEl('button', { text: t('ics.add'), cls: 'mod-cta' });
        addBtn.addEventListener('click', async () => {
            plugin.settings.icsCalendars.push({ id: `ics-${Date.now().toString(36)}`, name: t('ics.newName'), url: '', color: '#8e7cc3', enabled: true });
            await plugin.saveSettings();
            this.display();
        });
        container.createDiv({ cls: 'setting-item-description dp-ics-settings-desc', text: t('ics.desc') });

        const list = container.createDiv({ cls: 'dp-ics-settings-list' });
        if (plugin.settings.icsCalendars.length === 0) {
            list.createSpan({ cls: 'dp-ics-settings-empty', text: t('ics.empty') });
            return;
        }
        plugin.settings.icsCalendars.forEach((cal, index) => {
            const row = list.createDiv({ cls: 'dp-ics-settings-row' });
            const save = async (refetch = false) => {
                await plugin.saveSettings();
                await plugin.onIcsSettingsChanged(refetch ? cal.id : undefined);
            };
            const enabled = row.createEl('input', { type: 'checkbox' });
            enabled.checked = cal.enabled;
            enabled.addEventListener('change', () => { cal.enabled = enabled.checked; void save(true); });
            const name = row.createEl('input', { type: 'text', cls: 'dp-ics-name', placeholder: t('ics.namePlaceholder') });
            name.value = cal.name;
            name.addEventListener('change', () => { cal.name = name.value.trim(); void save(); });
            const url = row.createEl('input', { type: 'text', cls: 'dp-ics-url', placeholder: 'https://… .ics / webcal://…' });
            url.value = cal.url;
            url.addEventListener('change', () => { cal.url = url.value.trim(); void save(true); });
            const color = row.createEl('input', { type: 'color', cls: 'dp-ics-color' });
            color.value = cal.color;
            color.addEventListener('change', () => { cal.color = color.value; void save(); });
            const remove = row.createEl('button', { text: t('common.delete'), cls: 'mod-warning' });
            remove.addEventListener('click', async () => {
                plugin.settings.icsCalendars.splice(index, 1);
                await save();
                this.display();
            });
        });
    }
}
/**
 * Live Preview: hides ` [gcalId:: ...]` with a replace decoration (display only, the document text is untouched).
 * The tag reappears while the cursor or a selection touches it, so it stays editable; source mode is never affected.
 * Typing is the hot path: a keystroke only shifts the existing ranges unless the edited (or previous cursor) line holds
 * a tag; even then, edits made during IME composition are just mapped and rescanned once composition ends. A cursor
 * move rescans only when the old or new selection line holds a tag.
 */
function gcalIdHider(isEnabled: () => boolean) {
    const hide = Decoration.replace({});
    // Cheap literal probe with GCAL_ID_TAG_RE's case-insensitivity: tag-free text never reaches the global regex
    const TAG_PROBE_RE = /gcalid::/i;
    /** Whether the lines an edit touched contain a tag (typing the last ':' completes one that starts before the edit) */
    const editTouchesTag = (u: ViewUpdate): boolean => {
        const doc = u.state.doc;
        let found = false;
        u.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
            if (!found) found = TAG_PROBE_RE.test(doc.sliceString(doc.lineAt(fromB).from, doc.lineAt(toB).to));
        });
        return found;
    };
    /**
     * Whether a cursor/selection line holds a tag (it may be revealed there, so moving away must re-hide it).
     * `viewport` clamps the probe to the drawn text, so a select-all in a long note never slices the whole document.
     */
    const cursorTouchesTag = (state: EditorState, viewport?: { from: number; to: number }): boolean => state.selection.ranges.some(r => {
        let from = state.doc.lineAt(r.from).from;
        let to = state.doc.lineAt(r.to).to;
        if (viewport) {
            from = Math.max(from, viewport.from);
            to = Math.min(to, viewport.to);
            if (from > to) return false;
        }
        return TAG_PROBE_RE.test(state.doc.sliceString(from, to));
    });
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet = Decoration.none;
        /** Hider on (setting + Live Preview) at the last build */
        active = false;
        /** A tag (hidden, or revealed under the cursor) was on screen: only then can a cursor move change anything */
        hasVisibleTag = false;
        /** Decorations were mapped during composition instead of rebuilt */
        stale = false;
        constructor(view: EditorView) { this.build(view); }
        update(u: ViewUpdate) {
            const active = isEnabled() && !!u.state.field(editorLivePreviewField, false);
            if (active !== this.active || u.viewportChanged || u.transactions.some(t => t.reconfigured)) {
                this.build(u.view);
                return;
            }
            if (!active) return;
            if (u.docChanged) {
                // Typing on a tag-free line (the cursor was there too): no tag appears, disappears or changes reveal
                // state, so the existing ranges are just shifted; no viewport rescan
                const relevant = this.stale || editTouchesTag(u)
                    || (u.selectionSet && this.hasVisibleTag && cursorTouchesTag(u.startState));
                if (!relevant || u.view.composing) {
                    this.decorations = this.decorations.map(u.changes);
                    if (relevant) this.stale = true;
                    return;
                }
                this.build(u.view);
                return;
            }
            if (this.stale && !u.view.composing) {
                this.build(u.view);
                return;
            }
            // Clicks and arrow keys: only a selection leaving or entering a tag line changes what is revealed (same
            // document on both sides here, so the viewport clamps both probes)
            if (u.selectionSet && this.hasVisibleTag
                && (cursorTouchesTag(u.startState, u.view.viewport) || cursorTouchesTag(u.state, u.view.viewport))) this.build(u.view);
        }
        build(view: EditorView) {
            this.stale = false;
            this.hasVisibleTag = false;
            this.active = isEnabled() && !!view.state.field(editorLivePreviewField, false);
            if (!this.active) {
                this.decorations = Decoration.none;
                return;
            }
            const builder = new RangeSetBuilder<Decoration>();
            const selection = view.state.selection.ranges;
            for (const { from, to } of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to);
                if (!TAG_PROBE_RE.test(text)) continue;
                this.hasVisibleTag = true;
                for (const m of text.matchAll(GCAL_ID_TAG_RE)) {
                    const start = from + (m.index ?? 0);
                    const end = start + m[0].length;
                    if (selection.some(r => r.from <= end && r.to >= start)) continue;
                    builder.add(start, end, hide);
                }
            }
            this.decorations = builder.finish();
        }
    }, { decorations: v => v.decorations });
}

/** Whether a view is on screen (Obsidian's HTMLElement.isShown: attached, no display:none ancestor); unknown → shown */
const isElementShown = (el: HTMLElement): boolean => typeof (el as any).isShown === 'function' ? (el as any).isShown() : true;

/** Resolves once the main thread goes idle (capped at 2s), so the first vault scan never competes with Obsidian's boot. */
const whenIdle = () => new Promise<void>(resolve => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 2000 });
    else window.setTimeout(resolve, 1000); // iOS WebKit has no requestIdleCallback
});

/** Runs `fn` when the main thread is idle, at most `timeout` ms later (iOS WebKit has no requestIdleCallback) */
const onIdle = (fn: () => void, timeout: number) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => fn(), { timeout });
    else window.setTimeout(fn, 0);
};

/** Quiet time after the last keystroke in any editor before note re-parses and planner redraws run */
const TYPING_IDLE_MS = 2000;

/** Startup Sync waits this long after the layout is ready, so other plugins (file sync, Tasks...) settle first */
const STARTUP_SYNC_DELAY_MS = 60 * 1000;

/** A planner leaf view or a `dayloom` code block, as the background refresh sees it */
interface RefreshTarget {
    containerEl: HTMLElement;
    staleWhileHidden: boolean;
}

export default class DayPlannerPlugin extends Plugin {
    settings!: DayPlannerSettings; // assigned by loadSettings(), the first thing onload() awaits
    // Union of all cached ranges, used for id lookups (click/edit handlers)
    gcalCache: GCalEvent[] = [];
    // Per-range cache so views/codeblocks showing different ranges never evict each other's events
    gcalRanges = new Map<string, { events: GCalEvent[]; fetchedAt: number }>();
    private gcalInflight = new Map<string, Promise<boolean>>();
    statusBarItem: HTMLElement | null = null;
    tasksCache: TaskItem[] | null = null;
    private selfWrites = new Map<string, number>();
    private exclusionKey = '';
    private gcalCacheSaveTimer: number | null = null;
    private scanPromise: Promise<TaskItem[]> | null = null;
    private layoutReady!: Promise<void>;
    private viewRefreshTimer: number | null = null;
    private viewRefreshFirstAt = 0;
    /** Bumped by each background refresh pass; an older pass still stepping through its targets stops */
    private viewRefreshPass = 0;
    /** Last keystroke in any editor: re-parses and redraws wait until typing pauses (see msUntilTypingIdle) */
    private lastEditorInputAt = 0;
    /** Mounted `dayplanner` code blocks, refreshed with the leaf views on vault changes */
    codeBlockRenderers = new Set<DayPlannerCodeBlockRenderer>();
    /** Reminder keys already fired today; reset when the date changes */
    private notifiedReminders = new Set<string>();
    private notifiedRemindersDate = '';
    /** What the status bar item currently shows (updateStatusBar skips identical rebuilds) */
    private statusBarKey = '';

    /**
     * Coalesces per-file cache updates into one view refresh: trailing 250ms, forced after 1.5s of continuous changes.
     * Post-launch re-indexing fires 'changed' for hundreds of notes; refreshing per file meant hundreds of full renders.
     * While someone is typing in a note (autosave fires 'modify' every couple of seconds) the redraw waits until the
     * typing pauses, then runs when the main thread is idle: a planner render mid-typing froze the editor.
     * The redraw itself is sliced: one view or code block per idle callback, so a keystroke right after the pause
     * waits for at most one render (typing again postpones the rest; already redrawn ones then skip as unchanged).
     */
    requestViewRefresh() {
        const now = Date.now();
        if (this.viewRefreshTimer === null) this.viewRefreshFirstAt = now;
        else window.clearTimeout(this.viewRefreshTimer);
        const delay = Math.max(0, Math.min(250, this.viewRefreshFirstAt + 1500 - now));
        const run = () => {
            const wait = this.msUntilTypingIdle();
            if (wait > 0) {
                this.viewRefreshTimer = window.setTimeout(run, wait);
                return;
            }
            this.viewRefreshTimer = null;
            const refresh = () => {
                // Typing resumed while waiting for idle: wait for the next pause (a newer request may already be queued)
                if (this.viewRefreshTimer !== null) return;
                const waitAgain = this.msUntilTypingIdle();
                if (waitAgain > 0) {
                    this.viewRefreshTimer = window.setTimeout(run, waitAgain);
                    return;
                }
                this.updateStatusBar();
                this.refreshSidebarCalendars();
                // Views and code blocks whose visible tasks are unchanged keep their DOM
                const targets: Array<() => Promise<unknown>> = [
                    ...this.plannerViews().map(view => () => this.refreshIfShown(view, () => view.refreshTasks(null, false, true))),
                    ...Array.from(this.codeBlockRenderers, r => () => this.refreshIfShown(r, () => r.refreshContentOnly(true)))
                ];
                void this.runRefreshPass(targets);
            };
            if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(refresh, { timeout: 500 });
            else refresh();
        };
        this.viewRefreshTimer = window.setTimeout(run, delay);
    }

    /** Redraws the targets one per idle slice; typing again hands what is left to a new request after the next pause */
    private async runRefreshPass(targets: Array<() => Promise<unknown>>) {
        const pass = ++this.viewRefreshPass;
        for (let i = 0; i < targets.length; i++) {
            if (i > 0) await new Promise<void>(resolve => onIdle(resolve, 200));
            if (pass !== this.viewRefreshPass) return; // a newer pass covers every target
            if (this.msUntilTypingIdle() > 0) {
                this.requestViewRefresh();
                return;
            }
            try {
                await targets[i]();
            } catch (err) {
                console.error('Day Planner Pro: background refresh failed', err);
            }
        }
    }

    /** Off-screen targets are only marked stale (redrawn by catchUpHiddenViews when shown); isShown() reads layout */
    private async refreshIfShown(target: RefreshTarget, refresh: () => Promise<unknown>) {
        if (!isElementShown(target.containerEl)) {
            target.staleWhileHidden = true;
            return;
        }
        await refresh();
    }

    /** Sidebar calendars: a cheap month redraw, coalesced per view (tasks, events, settings or a daily note changed) */
    refreshSidebarCalendars() {
        this.app.workspace.getLeavesOfType(VIEW_TYPES.CALENDAR).forEach(leaf => {
            if (leaf.view instanceof SidebarCalendarView) leaf.view.requestRender();
        });
    }

    /** Open Dayloom / Dayloom Compact views */
    private plannerViews(): Array<RefreshTarget & { refreshTasks: (targetFile: null, forceFetchGCal: boolean, skipIfUnchanged: boolean) => Promise<void> }> {
        return [VIEW_TYPES.COMBINED, VIEW_TYPES.DAILY]
            .flatMap(viewType => this.app.workspace.getLeavesOfType(viewType))
            .map(leaf => leaf.view as any)
            .filter(view => view && typeof view.refreshTasks === 'function');
    }

    /**
     * Startup Sync (settings.syncOnStartup): the Sync button's run in an open planner view; with none open, only the
     * task push to Google Calendar (no view needs fetched events). Skipped without Google Calendar connected.
     */
    private async runStartupSync() {
        const s = this.settings;
        if (!s.syncOnStartup || !s.enableGoogleCalendar || !s.googleRefreshToken) return;
        await this.waitForTypingIdle();
        const view = this.plannerViews().find(v => typeof (v as any).runSync === 'function') as any;
        if (view) {
            await view.runSync();
            return;
        }
        const targetCalendarId = s.taskSyncCalendarId || s.googleCalendars.find(c => c.enabled && c.id)?.id;
        if (!targetCalendarId) return;
        try {
            await this.ensureTasksCache();
            await syncAllTasksToGCal(this, targetCalendarId);
        } catch (err) {
            console.error('Startup sync error:', err);
        }
    }

    /** Milliseconds until TYPING_IDLE_MS have passed since the last keystroke in any editor (0 = not typing) */
    msUntilTypingIdle(): number {
        return Math.max(0, this.lastEditorInputAt + TYPING_IDLE_MS - Date.now());
    }

    /** Resolves once typing has paused for TYPING_IDLE_MS (immediately when nobody is typing) */
    async waitForTypingIdle(): Promise<void> {
        for (let wait = this.msUntilTypingIdle(); wait > 0; wait = this.msUntilTypingIdle()) {
            await new Promise(resolve => window.setTimeout(resolve, wait));
        }
    }

    /** Drops deleted Google Calendar events from every cached range at once (views redraw without them, no refetch) */
    removeCachedEvents(keys: Set<string>) {
        this.gcalRanges.forEach(range => {
            range.events = range.events.filter(e => !keys.has(`${e.calendarId}::${e.id}`));
        });
        this.rebuildGCalCache();
        this.scheduleGCalCacheSave();
    }

    /** Single shared full scan: waits for the layout (never scans during Obsidian's boot) and dedupes concurrent callers. */
    ensureTasksCache(): Promise<TaskItem[]> {
        if (this.tasksCache) return Promise.resolve(this.tasksCache);
        if (!this.scanPromise) {
            this.scanPromise = this.layoutReady
                .then(whenIdle)
                .then(() => this.waitForTypingIdle()) // a background full scan never competes with keystrokes
                .then(() => scanVaultTasks(this.app))
                .then(tasks => {
                    if (!this.tasksCache) this.tasksCache = tasks;
                    return this.tasksCache;
                })
                .finally(() => { this.scanPromise = null; });
        }
        return this.scanPromise;
    }

    /**
     * Call right before the plugin itself writes `path` during a sync. Only in-view edits push to Google Calendar (one task
     * each, see syncEditedTaskToGCal); note edits and these self-writes never do, so sync and 'modify' cannot loop.
     */
    markSelfWrite(path: string) {
        this.selfWrites.set(path, (this.selfWrites.get(path) ?? 0) + 1);
        window.setTimeout(() => this.selfWrites.delete(path), 3000);
    }

    // Older builds kept the cache in the plugin folder, which sync tools (LiveSync, Syncthing...) carried between devices
    // and every device rewrote it: conflicts. It now lives in each device's local storage; the old file is read once, then removed.
    private get legacyGCalCachePath(): string {
        return `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/gcal-cache.json`;
    }
    private static readonly GCAL_CACHE_KEY = 'dayloom-gcal-cache';

    /** Restores the last fetched events so views paint them instantly on startup; each range revalidates on first view. */
    private async loadGCalCache() {
        try {
            const raw = this.app.loadLocalStorage(DayPlannerPlugin.GCAL_CACHE_KEY);
            let data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            const legacyPath = this.legacyGCalCachePath;
            if (await this.app.vault.adapter.exists(legacyPath)) {
                if (!data) {
                    try { data = JSON.parse(await this.app.vault.adapter.read(legacyPath)); } catch { /* unreadable: dropped */ }
                }
                try { await this.app.vault.adapter.remove(legacyPath); } catch { /* another device may have removed it */ }
            }
            if (data?.version !== 1 || !Array.isArray(data.ranges)) return;
            for (const [key, events] of data.ranges) this.gcalRanges.set(key, { events, fetchedAt: 0 });
            this.rebuildGCalCache();
            if (!raw) this.scheduleGCalCacheSave();
        } catch (err) {
            console.warn('Day Planner Pro: ignoring unreadable Google Calendar cache', err);
        }
    }

    private scheduleGCalCacheSave() {
        if (this.gcalCacheSaveTimer) window.clearTimeout(this.gcalCacheSaveTimer);
        this.gcalCacheSaveTimer = window.setTimeout(() => {
            this.gcalCacheSaveTimer = null;
            // Newest ranges last; if local storage is full, drop the oldest half and retry
            let ranges = Array.from(this.gcalRanges.entries()).map(([key, r]) => [key, r.events]);
            while (ranges.length) {
                try {
                    this.app.saveLocalStorage(DayPlannerPlugin.GCAL_CACHE_KEY, { version: 1, ranges });
                    return;
                } catch (err) {
                    if (ranges.length === 1) console.warn('Day Planner Pro: could not save Google Calendar cache', err);
                    ranges = ranges.slice(Math.ceil(ranges.length / 2));
                }
            }
        }, 2000);
    }

    private rebuildGCalCache() {
        const byId = new Map<string, GCalEvent>();
        this.gcalRanges.forEach(r => r.events.forEach(e => byId.set(`${e.calendarId}::${e.id}`, e)));
        // Subscribed events too: clicks, reminders and selections look events up here
        this.icsEvents.forEach(events => events.forEach(e => byId.set(`${e.calendarId}::${e.id}`, e)));
        this.gcalCache = Array.from(byId.values());
        this.refreshSidebarCalendars();
    }

    // ---- Subscribed calendars (.ics links, ics.ts): read-only; fetched by each device and cached in its local storage ----
    /** Parsed events per subscription id, from two months back to a year ahead */
    icsEvents = new Map<string, GCalEvent[]>();
    /** Bumped whenever icsEvents (or a subscription's name, colour or switch) changes: views key their event index on it */
    icsVersion = 0;
    private icsFetchedAt = new Map<string, number>();
    private icsInflight: Promise<boolean> | null = null;
    private icsRangeMemo = new Map<string, GCalEvent[]>();
    private static readonly ICS_CACHE_KEY = 'dayloom-ics-cache';
    private static readonly ICS_TTL_MS = 30 * 60 * 1000;

    private activeIcsCalendars(): IcsCalendarConfig[] {
        return (this.settings.icsCalendars ?? []).filter(c => c.enabled && c.url.trim());
    }

    /** Anything to show beside tasks: Google Calendar on, or an enabled subscription */
    hasCalendars(): boolean {
        return !!this.settings.enableGoogleCalendar || this.activeIcsCalendars().length > 0;
    }

    /** The enabled subscriptions' events overlapping [from, to] (memoised until they change) */
    icsEventsBetween(from: Date, to: Date): GCalEvent[] {
        const key = `${this.icsVersion}|${from.getTime()}|${to.getTime()}`;
        const hit = this.icsRangeMemo.get(key);
        if (hit) return hit;
        if (this.icsRangeMemo.size > 24) this.icsRangeMemo.clear();
        const moment = (window as any).moment;
        const fromStr = moment(from).format('YYYY-MM-DD'), toStr = moment(to).format('YYYY-MM-DD');
        const enabled = new Set(this.activeIcsCalendars().map(c => c.id));
        const events: GCalEvent[] = [];
        this.icsEvents.forEach((list, id) => {
            if (enabled.has(id)) list.forEach(e => { if (e.dateStr <= toStr && e.end.slice(0, 10) >= fromStr) events.push(e); });
        });
        this.icsRangeMemo.set(key, events);
        return events;
    }

    /** Every cached event touching [from, to] (YYYY-MM-DD) once: Google's month ranges overlap, plus the subscriptions */
    forEachCalendarEvent(from: string, to: string, fn: (e: GCalEvent) => void) {
        const seen = new Set<string>();
        const visit = (e: GCalEvent) => {
            const key = `${e.calendarId}|${e.id}`;
            if (seen.has(key) || e.dateStr > to || (e.end ?? '').slice(0, 10) < from) return;
            seen.add(key);
            fn(e);
        };
        if (this.settings.enableGoogleCalendar) this.gcalRanges.forEach(range => range.events.forEach(visit));
        const moment = (window as any).moment;
        this.icsEventsBetween(moment(from, 'YYYY-MM-DD').toDate(), moment(to, 'YYYY-MM-DD').toDate()).forEach(visit);
    }

    private loadIcsCache() {
        try {
            const raw = this.app.loadLocalStorage(DayPlannerPlugin.ICS_CACHE_KEY);
            const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (data?.version !== 1 || typeof data.calendars !== 'object') return;
            Object.entries(data.calendars).forEach(([id, events]) => {
                if (Array.isArray(events)) this.icsEvents.set(id, events as GCalEvent[]); // stale: refetched on the first check
            });
            this.icsVersion++;
            this.rebuildGCalCache();
        } catch (err) {
            console.warn('Day Planner Pro: ignoring an unreadable subscribed-calendar cache', err);
        }
    }

    private saveIcsCache() {
        const calendars: Record<string, GCalEvent[]> = {};
        this.icsEvents.forEach((events, id) => { calendars[id] = events; });
        try {
            this.app.saveLocalStorage(DayPlannerPlugin.ICS_CACHE_KEY, { version: 1, calendars });
        } catch (err) {
            console.warn('Day Planner Pro: subscribed calendars are too large to cache on this device', err);
        }
    }

    /**
     * Fetches the subscriptions older than the TTL (all of them with `force`, e.g. the Sync button) and parses them.
     * Resolves true when any events changed; a failed fetch keeps that calendar's last events.
     */
    refreshIcsCalendars(force = false): Promise<boolean> {
        if (this.icsInflight) return this.icsInflight;
        this.icsInflight = (async () => {
            let changed = false;
            const known = new Set((this.settings.icsCalendars ?? []).map(c => c.id));
            for (const id of Array.from(this.icsEvents.keys())) {
                if (!known.has(id)) { this.icsEvents.delete(id); changed = true; } // subscription removed
            }
            const moment = (window as any).moment;
            const windowStart = moment().subtract(2, 'months').startOf('month').valueOf();
            const windowEnd = moment().add(12, 'months').endOf('month').valueOf();
            for (const cal of this.activeIcsCalendars()) {
                if (!force && Date.now() - (this.icsFetchedAt.get(cal.id) ?? 0) < DayPlannerPlugin.ICS_TTL_MS) continue;
                this.icsFetchedAt.set(cal.id, Date.now()); // a failure also waits for the TTL before the next try
                try {
                    const url = cal.url.trim().replace(/^webcals?:\/\//i, 'https://');
                    const res = await requestUrl({ url, method: 'GET', throw: false });
                    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
                    const events = parseIcsEvents(res.text, cal, windowStart, windowEnd);
                    const prev = this.icsEvents.get(cal.id);
                    if (!prev || JSON.stringify(prev) !== JSON.stringify(events)) {
                        this.icsEvents.set(cal.id, events);
                        changed = true;
                    }
                } catch (err) {
                    console.warn(`Day Planner Pro: could not load the subscribed calendar "${cal.name}"`, err);
                    if (force) new Notice(t('ics.failed', { name: cal.name || cal.url }));
                }
            }
            if (changed) {
                this.icsVersion++;
                this.rebuildGCalCache();
                this.saveIcsCache();
            }
            return changed;
        })().finally(() => { this.icsInflight = null; });
        return this.icsInflight;
    }

    /** Settings changed a subscription: names and colours apply to the cached events at once, new links are fetched */
    async onIcsSettingsChanged(refetchId?: string) {
        const byId = new Map((this.settings.icsCalendars ?? []).map(c => [c.id, c]));
        this.icsEvents.forEach((events, id) => {
            const cal = byId.get(id);
            if (cal) events.forEach(e => { e.color = cal.color; e.calendarName = cal.name; });
        });
        if (refetchId) this.icsFetchedAt.delete(refetchId);
        this.icsVersion++;
        this.rebuildGCalCache();
        this.refreshActiveViews();
        if (await this.refreshIcsCalendars()) this.refreshActiveViews();
    }

    async onload() {
        // Resolves immediately when the plugin is enabled after startup
        this.layoutReady = new Promise(resolve => this.app.workspace.onLayoutReady(() => resolve()));
        await this.loadSettings();
        await this.showWhatsNewAfterUpdate();
        await this.loadGCalCache();
        this.loadIcsCache(); // this device's copy of the subscribed calendars, refetched once the layout is ready

        const styleEl = document.createElement('style');
        styleEl.id = 'day-planner-pro-styles';
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        // Dayloom tab view + Dayloom Compact (same planner, compact shell)
        this.registerView(VIEW_TYPES.COMBINED, (leaf) => new DayPlannerCombinedView(leaf, this));
        this.registerView(VIEW_TYPES.DAILY, (leaf) => new DayPlannerDailyView(leaf, this));
        this.registerView(VIEW_TYPES.CALENDAR, (leaf) => new SidebarCalendarView(leaf, this));

        this.addRibbonIcon('calendar-glyph', 'Open Dayloom', () => {
            this.activateView(VIEW_TYPES.COMBINED);
        });
        // Dayloom Compact: compact 5-tab shell in the right sidebar (the right drawer on tablets)
        this.addRibbonIcon('calendar-clock', 'Open Dayloom Compact', () => {
            this.activateView(VIEW_TYPES.DAILY);
        });

        this.addCommand({
            id: 'open-day-planner-pro-combined',
            name: 'Open Dayloom',
            callback: () => this.activateView(VIEW_TYPES.COMBINED)
        });
        this.addCommand({
            id: 'open-day-planner-pro-daily',
            name: 'Open Dayloom Compact',
            callback: () => this.activateView(VIEW_TYPES.DAILY)
        });
        this.addCommand({
            id: 'open-sidebar-calendar',
            name: 'Open Dayloom Calendar (sidebar)',
            callback: () => this.activateView(VIEW_TYPES.CALENDAR)
        });
        this.addCommand({
            id: 'go-to-today',
            name: 'Go to Today',
            callback: async () => {
                // Prefer the focused planner view, else the first open one; same animated path as the Today button
                const active = this.app.workspace.getActiveViewOfType(DayPlannerCombinedView)
                    ?? this.app.workspace.getActiveViewOfType(DayPlannerDailyView);
                const view = active ?? [VIEW_TYPES.COMBINED, VIEW_TYPES.DAILY]
                    .flatMap(t => this.app.workspace.getLeavesOfType(t))
                    .map(leaf => leaf.view)
                    .find((v): v is DayPlannerCombinedView | DayPlannerDailyView =>
                        v instanceof DayPlannerCombinedView || v instanceof DayPlannerDailyView);
                if (view) await view.goToToday();
                else new Notice(t('notice.openViewFirst'));
            }
        });
        this.addCommand({
            id: 'insert-inline-view',
            name: 'Insert Inline View (dayloom block)',
            editorCallback: (editor) => {
                const codeblock = "```dayloom\ntype: daily\nheight: 500px\n```\n";
                editor.replaceSelection(codeblock);
            }
        });
        this.addCommand({
            id: 'toggle-side-drawer',
            name: 'Toggle Side Drawer',
            callback: () => {
                // The focused Dayloom tab, else the first open one (the sidebar view is compact: no drawer)
                const view = this.app.workspace.getActiveViewOfType(DayPlannerCombinedView)
                    ?? this.app.workspace.getLeavesOfType(VIEW_TYPES.COMBINED).map(leaf => leaf.view)
                        .find((v): v is DayPlannerCombinedView => v instanceof DayPlannerCombinedView);
                if (view) void view.toggleSideDrawer();
                else new Notice(t('notice.openDayloomFirst'));
            }
        });
        this.addCommand({
            id: 'review-today',
            name: 'Review Today',
            callback: () => void openDayReview(this)
        });
        this.addCommand({
            id: 'show-whats-new',
            name: "What's New (Release Notes)",
            callback: () => new WhatsNewModal(this.app, this.manifest.version).open()
        });
        this.addCommand({
            id: 'show-keyboard-shortcuts',
            name: 'Show Keyboard Shortcuts',
            callback: () => ShortcutHelpModal.toggle(this.app, this)
        });

        this.addSettingTab(new DayPlannerSettingTab(this.app, this));

        this.statusBarItem = this.addStatusBarItem();

        // Codeblock processors are cheap to register; their renders await ensureTasksCache (i.e. layout ready)
        this.registerCodeBlockProcessors();

        // Notes: hide the [gcalId:: ...] sync tag in Reading View and Live Preview (files keep it for Google Calendar sync)
        this.registerEditorExtension(gcalIdHider(() => this.settings.hideBracketMetadata !== false));
        this.registerMarkdownPostProcessor((el) => {
            if (this.settings.hideBracketMetadata === false || !el.textContent?.includes('gcalId::')) return;
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const hits: Text[] = [];
            while (walker.nextNode()) {
                const node = walker.currentNode as Text;
                if (node.data.includes('gcalId::')) hits.push(node);
            }
            hits.forEach(node => { node.data = node.data.replace(GCAL_ID_TAG_RE, ''); }); // rendered DOM only
        });
        document.body.toggleClass('dp-hide-gcal-id', this.settings.hideBracketMetadata !== false);
        this.applyTaskColor();
        this.initTouchLayout();
        this.blockSidebarSwipe();

        // Everything heavy waits for the layout: Obsidian fires 'create' for every file while loading the vault,
        // which previously started one full scan per file during boot.
        this.app.workspace.onLayoutReady(() => this.onLayoutReadyInit());
    }

    /**
     * Mobile, "Swipe to change dates" on: a one-finger sideways swipe on the main area no longer opens Obsidian's
     * sidebars, anywhere in Obsidian. Obsidian turns sideways swipes into workspace 'swipe' events; those starting in
     * the root split are dropped. Swiping an open sidebar closed, pull-down and two-finger back/forward still work.
     */
    private blockSidebarSwipe() {
        if (!Platform.isMobile) return;
        const workspace = this.app.workspace as any;
        const original = workspace.trigger;
        const plugin = this;
        workspace.trigger = function (this: any, name: string, ...args: any[]) {
            const e = args[0];
            if (name === 'swipe' && e?.points === 1 && e.direction === 'x' && plugin.settings.desktopSwipeNavigation !== false
                && e.targetEl instanceof Node && workspace.rootSplit?.containerEl?.contains(e.targetEl)) return;
            return original.call(this, name, ...args);
        };
        this.register(() => { workspace.trigger = original; });
    }

    /**
     * Theme backgrounds the planner copies (themes often paint Obsidian's surfaces with their own selectors, not the
     * --background-* variables). One entry per surface: the <body> variable it sets (plus an optional body class for
     * CSS that cannot fall back to the variable it replaces, see styles.ts), the workspace element hosting it, the
     * leaf type to sample, and whether the search may go past the host up to the page (mobile themes often paint the
     * app container or <body> instead). Add or change a surface here; syncThemeBackgrounds does the rest.
     */
    private static readonly THEME_SURFACES: Array<{
        variable: string; bodyClass?: string; leafType: string; upToPage: boolean; host: (ws: any) => HTMLElement | undefined;
    }> = [
        // Side drawer and planner tabs docked in a sidebar (desktop splits, mobile drawers)
        { variable: '--dp-sidebar-bg', leafType: 'file-explorer', upToPage: false, host: ws => ws.rightSplit?.containerEl ?? ws.leftSplit?.containerEl },
        // Planner tabs in the main area: a note tab's colour
        { variable: '--dp-main-bg', bodyClass: 'dp-has-main-bg', leafType: 'markdown', upToPage: true, host: ws => ws.rootSplit?.containerEl }
    ];

    /**
     * Reads each THEME_SURFACES colour from a hidden sample leaf inside its host (so it works whether or not such a tab is
     * open, e.g. a phone showing only the planner): the first opaque fill from the leaf upward. Re-read on every theme /
     * snippet / light-dark change.
     */
    private syncThemeBackgrounds() {
        const opaque = (color: string) => !!color && color !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(color);
        for (const surface of DayPlannerPlugin.THEME_SURFACES) {
            const host = surface.host(this.app.workspace);
            let color = '';
            if (host) {
                // Same nesting as a real tab, so the theme's selectors match it; display: none keeps it off screen
                const probe = host.createDiv({ cls: 'workspace-tabs', attr: { style: 'display: none', 'aria-hidden': 'true' } });
                const leaf = probe.createDiv({ cls: 'workspace-tab-container' }).createDiv({ cls: 'workspace-leaf' });
                const sample = leaf.createDiv({ cls: 'workspace-leaf-content', attr: { 'data-type': surface.leafType } })
                    .createDiv({ cls: 'view-content' });
                const stop = surface.upToPage ? document.documentElement : host;
                for (let el: HTMLElement | null = sample; el; el = el.parentElement) {
                    const bg = getComputedStyle(el).backgroundColor;
                    if (opaque(bg)) { color = bg; break; }
                    if (el === stop) break;
                }
                probe.remove();
            }
            if (color) document.body.style.setProperty(surface.variable, color);
            else document.body.style.removeProperty(surface.variable);
            if (surface.bodyClass) document.body.toggleClass(surface.bodyClass, !!color);
        }
    }

    private onLayoutReadyInit() {
        this.syncThemeBackgrounds();
        this.registerEvent(this.app.workspace.on('css-change', () => this.syncThemeBackgrounds()));
        this.register(() => DayPlannerPlugin.THEME_SURFACES.forEach(surface => {
            document.body.style.removeProperty(surface.variable);
            if (surface.bodyClass) document.body.removeClass(surface.bodyClass);
        }));
        // Skipped mid-typing; the next tick (or the post-typing refresh) catches up
        this.registerInterval(window.setInterval(() => { if (this.msUntilTypingIdle() === 0) this.updateStatusBar(); }, 30000));
        // registerInterval clears this on unload
        this.registerInterval(window.setInterval(() => this.checkReminders(), 15000)); // at-start alerts land within 15s
        this.checkReminders();
        // Open views await this same scan in their own refreshTasks(); re-rendering them here would paint them twice
        this.ensureTasksCache().then(() => this.updateStatusBar());
        // Subscribed calendars: at start, then every 5 minutes (each one refetched when older than 30 minutes)
        const refreshIcs = () => void this.refreshIcsCalendars().then(changed => { if (changed) this.refreshActiveViews(); });
        refreshIcs();
        this.registerInterval(window.setInterval(refreshIcs, 5 * 60 * 1000));
        // One Sync a minute after startup: vault files synced in by other plugins have landed by then (fewer conflicts)
        const startupSyncTimer = window.setTimeout(() => void this.runStartupSync(), STARTUP_SYNC_DELAY_MS);
        this.register(() => window.clearTimeout(startupSyncTimer));

        // Typing in a note postpones background planner redraws (requestViewRefresh)
        this.registerEvent(this.app.workspace.on('editor-change', () => { this.lastEditorInputAt = Date.now(); }));
        // A planner tab or code block skipped while hidden (refreshIfShown) catches up when it comes back on screen.
        // These events fire inside clicks and focus changes, where isShown() would force a layout and the catch-up
        // render would hold the click's frame: the check runs once the main thread is idle, coalesced per burst.
        let catchUpQueued = false;
        const catchUpHiddenViews = () => {
            if (catchUpQueued) return;
            catchUpQueued = true;
            onIdle(() => {
                catchUpQueued = false;
                const shownAgain = (target: RefreshTarget) => target.staleWhileHidden && isElementShown(target.containerEl);
                this.plannerViews().filter(shownAgain).forEach(view => {
                    view.staleWhileHidden = false;
                    void view.refreshTasks(null, false, true);
                });
                Array.from(this.codeBlockRenderers).filter(shownAgain).forEach(r => {
                    r.staleWhileHidden = false;
                    void r.refreshContentOnly(true);
                });
            }, 300);
        };
        this.registerEvent(this.app.workspace.on('active-leaf-change', catchUpHiddenViews));
        this.registerEvent(this.app.workspace.on('layout-change', catchUpHiddenViews));

        // Centralized file modify observers (debounced per file). Cache + view refresh only: Google Calendar task sync
        // and repair run solely from the Sync button / Task Sync modal.
        // While anyone types (autosave fires 'modify' + 'changed' every ~2s), re-reading and re-parsing the note waits
        // until TYPING_IDLE_MS after the last keystroke: one parse per pause instead of one per autosave.
        const modifyTimeouts = new Map<string, number>();
        const scheduleFileUpdate = (file: TFile, run: () => Promise<void>) => {
            window.clearTimeout(modifyTimeouts.get(file.path));
            const fire = () => {
                const wait = this.msUntilTypingIdle();
                if (wait > 0) {
                    modifyTimeouts.set(file.path, window.setTimeout(fire, wait));
                    return;
                }
                modifyTimeouts.delete(file.path);
                run();
            };
            modifyTimeouts.set(file.path, window.setTimeout(fire, 350));
        };
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (file instanceof TFile && file.extension === 'md' && !isSyncConflictPath(file.path)) {
                scheduleFileUpdate(file, () => this.updateCacheForFile(file));
            }
        }));

        // Re-indexed notes (external/Syncthing edits reconciled after launch): the startup scan may have skipped
        // them from a stale cache entry. Shares the per-file debounce with 'modify', so an edit is handled once.
        this.registerEvent(this.app.metadataCache.on('changed', (file) => {
            if (file.extension === 'md' && !isSyncConflictPath(file.path)) {
                scheduleFileUpdate(file, () => this.updateCacheForFile(file));
            }
        }));

        this.registerEvent(this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md' && !isSyncConflictPath(file.path)) {
                this.refreshSidebarCalendars(); // a new daily note takes away its day's slash
                scheduleFileUpdate(file, () => this.updateCacheForFile(file));
            }
        }));

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (file instanceof TFile && this.tasksCache) {
                // Keep the snapshot keyed by the new path so the next edit diffs against it instead of re-syncing everything
                this.tasksCache.forEach(t => {
                    if (t.filePath === oldPath) { t.filePath = file.path; t.id = `${file.path}:${t.lineNumber}`; }
                });
            }
            if (file instanceof TFile) this.refreshSidebarCalendars(); // a daily note renamed in or out of place
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md' && !isSyncConflictPath(file.path)) {
                // Events of deleted tasks are removed by the next manual Sync (orphan cleanup)
                if (this.tasksCache) this.tasksCache = this.tasksCache.filter(t => t.filePath !== file.path);
                this.requestViewRefresh();
            }
        }));
    }

    // Codeblock processors: `dayloom` (current) plus the legacy `dayplanner` / `dayplanner-pro`, which keep working
    private registerCodeBlockProcessors() {
        ['dayloom', 'dayplanner', 'dayplanner-pro'].forEach(lang => {
            this.registerMarkdownCodeBlockProcessor(lang, async (source, el, ctx) => {
                let config: any = {};
                try {
                    config = parseYaml(source);
                } catch (e) {
                    // Manual parser fallback
                    const lines = source.split('\n');
                    for (const line of lines) {
                        const parts = line.split(':');
                        if (parts.length >= 2) {
                            const key = parts[0].trim().toLowerCase();
                            const val = parts.slice(1).join(':').trim();
                            config[key] = val;
                        }
                    }
                }

                if (!config) config = {};
                
                let viewType = (config.type || '').trim() as 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | '';
                let dateStr = config.date ? String(config.date).trim() : '';

                // In a daily / weekly note, the block shows that day / week unless it says otherwise
                const parentNote = ctx?.sourcePath ? parentNoteOf(ctx.sourcePath, this.settings) : null;
                if (parentNote) {
                    if (!viewType) viewType = parentNote.type;
                    if (!dateStr) dateStr = parentNote.date;
                }

                // Fallbacks
                if (!viewType) viewType = 'daily';
                if (!dateStr) dateStr = 'today';

                let heightStr = '500px';
                if (config.height) {
                    heightStr = String(config.height).trim();
                    if (!heightStr.endsWith('px') && !heightStr.endsWith('%') && !heightStr.endsWith('vh') && /^\d+$/.test(heightStr)) {
                        heightStr += 'px';
                    }
                }

                const renderer = new DayPlannerCodeBlockRenderer(el, this, viewType, dateStr, heightStr, ctx, config);
                ctx.addChild(renderer);
            });
        });
    }

    async updateCacheForFile(file: TFile) {
        if (isSyncConflictPath(file.path)) return;
        if (!this.tasksCache) {
            await this.ensureTasksCache();
        } else {
            // Re-indexed note that has no checkbox and had no tasks: nothing to read or redraw. A stale index entry
            // right after an edit is safe to trust: Obsidian re-indexes the note and 'changed' schedules another pass.
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache && !cache.listItems?.some(item => item.task !== undefined)
                && !this.tasksCache.some(t => t.filePath === file.path)) return;
            const fileTasks: TaskItem[] = [];
            // Excluded notes contribute no tasks (and drop any they had before the rule was added)
            if (!isExcludedPath(file.path)) {
                const lines = (await this.app.vault.cachedRead(file)).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const parsed = parseTaskLine(lines[i], file.path, i, this.settings.dailyNotesFormat);
                    if (parsed) fileTasks.push(parsed);
                }
            }
            this.tasksCache = this.tasksCache.filter(t => t.filePath !== file.path).concat(fileTasks);
        }
        this.requestViewRefresh();
    }

    // ---- Touch layout (body.dp-touch-ui, styles.ts): finger-sized controls while a finger is in use ----
    /** Windows (main + popouts) whose <body> carries the touch layout class */
    private inputWindows = new Set<Window>();
    /** Auto mode's reading of the last input: true after a finger, false after a mouse, trackpad or pen */
    private autoTouch = false;
    private touchSwitchTimer: number | null = null;
    private lastTouchAt = 0;
    private mouseTravel = 0;
    private lastMouseMoveAt = 0;

    private initTouchLayout() {
        // Tablets start in touch; a computer only when its main pointer is a finger (no mouse or trackpad)
        this.autoTouch = Platform.isMobile || window.matchMedia('(pointer: coarse)').matches;
        this.watchInputWindow(window);
        this.registerEvent(this.app.workspace.on('window-open', (_leafWin, win) => {
            this.watchInputWindow(win);
            this.applyTouchLayout();
        }));
        this.registerEvent(this.app.workspace.on('window-close', (_leafWin, win) => {
            this.inputWindows.delete(win);
        }));
        this.applyTouchLayout();
    }

    /**
     * Auto mode follows the kind of pointer that was used last. The switch waits until the tap or click is over, so the
     * press lands on the layout it started on: a mouse click switches right after its click event, a finger a moment
     * after lifting (its tap is hit-tested after pointerup). Moving the mouse switches back before the next click.
     */
    private watchInputWindow(win: Window) {
        this.inputWindows.add(win);
        const onRelease = (e: PointerEvent) => {
            const touch = isTouchLike(e);
            if (touch) this.lastTouchAt = performance.now();
            if (this.touchSwitchTimer !== null) window.clearTimeout(this.touchSwitchTimer);
            this.touchSwitchTimer = null;
            if (touch === this.autoTouch) return;
            this.touchSwitchTimer = window.setTimeout(() => {
                this.touchSwitchTimer = null;
                this.autoTouch = touch;
                this.applyTouchLayout();
            }, touch ? 250 : 0);
        };
        this.registerDomEvent(win, 'pointerup', onRelease, { capture: true, passive: true });
        // What was pressed: the pop-up it opens grows out of it (motion standard, modals.ts PlannerModal)
        this.registerDomEvent(win, 'pointerdown', recordPressOrigin, { capture: true, passive: true });
        this.registerDomEvent(win, 'pointercancel', (e: PointerEvent) => {
            if (isTouchLike(e)) onRelease(e); // a finger that scrolled
        }, { capture: true, passive: true });
        this.registerDomEvent(win, 'pointermove', (e: PointerEvent) => {
            if (!this.autoTouch || e.pointerType !== 'mouse') return;
            const now = performance.now();
            if (now - this.lastTouchAt < 1000) return; // Windows moves the cursor to a tap: not the mouse
            if (now - this.lastMouseMoveAt > 300) this.mouseTravel = 0; // a deliberate move, not a bump of the trackpad
            this.lastMouseMoveAt = now;
            this.mouseTravel += Math.abs(e.movementX) + Math.abs(e.movementY);
            if (this.mouseTravel < 30) return;
            this.autoTouch = false;
            this.applyTouchLayout();
        }, { passive: true });
    }

    /** Touch layout setting: always touch, always mouse, or (Auto) the last input. Phones keep their compact shell's sizes. */
    applyTouchLayout() {
        const mode = this.settings.touchLayout ?? 'auto';
        const on = !Platform.isPhone && (mode === 'touch' || (mode === 'auto' && this.autoTouch));
        let changed = false;
        this.inputWindows.forEach(win => {
            const body = win.document.body;
            if (body.hasClass('dp-touch-ui') === on) return;
            body.toggleClass('dp-touch-ui', on);
            changed = true;
        });
        if (!changed) return;
        // The header's controls changed size: its side columns are measured again
        [VIEW_TYPES.COMBINED, VIEW_TYPES.DAILY]
            .flatMap(viewType => this.app.workspace.getLeavesOfType(viewType))
            .forEach(leaf => {
                if (leaf.view instanceof DayPlannerCombinedView) leaf.view.resetHeaderSides();
            });
    }

    /** Local Task Color as --dp-task-color on <body>: the fill and stripe of every task card, chip and Monthly item */
    applyTaskColor() {
        document.body.style.setProperty('--dp-task-color', this.settings.taskColor || '#ff9f1c');
    }

    async onunload() {
        const styleEl = document.getElementById('day-planner-pro-styles');
        if (styleEl) styleEl.remove();
        document.body.removeClass('dp-hide-gcal-id');
        document.body.style.removeProperty('--dp-task-color');
        this.inputWindows.forEach(win => win.document.body.removeClass('dp-touch-ui'));
        if (this.statusBarItem) this.statusBarItem.remove();
        void this.audioCtx?.close();
    }

    /**
     * Fires each reminder once, inside the window [start - offset, start + 1 min). The minute of grace past the start
     * is what makes "at start time" (offset 0) fire at all; reminders whose start passed longer ago are skipped.
     */
    /** Evening review prompt: the day it last opened, per device (local storage, not data.json) */
    private static readonly REVIEW_PROMPT_KEY = 'dayloom-review-prompted';
    private reviewPromptBusy = false;

    /**
     * Evening review (Settings): from the set time on, "Review today" opens once a day on this device while today
     * still has open tasks or no daily note. Never in the middle of typing; a day with neither is checked again on the next tick.
     */
    private async checkReviewPrompt() {
        const at = this.settings.reviewPromptTime;
        if (!at || this.reviewPromptBusy || this.msUntilTypingIdle() > 0) return;
        const now = (window as any).moment();
        if (now.format('HH:mm') < at) return;
        const todayStr = now.format('YYYY-MM-DD');
        let last: unknown = null;
        try { last = this.app.loadLocalStorage(DayPlannerPlugin.REVIEW_PROMPT_KEY); } catch { /* storage blocked */ }
        if (last === todayStr) return;
        this.reviewPromptBusy = true;
        try {
            if (await openDayReview(this, true)) {
                try { this.app.saveLocalStorage(DayPlannerPlugin.REVIEW_PROMPT_KEY, todayStr); } catch { /* storage blocked */ }
            }
        } finally {
            this.reviewPromptBusy = false;
        }
    }

    async checkReminders() {
        void this.checkReviewPrompt(); // its own setting: runs even with reminders off
        const type = this.settings.reminderType ?? 'auto';
        if (type === 'off') return;
        const moment = (window as any).moment;
        const now = moment();
        const todayStr = now.format('YYYY-MM-DD');
        if (this.notifiedRemindersDate !== todayStr) {
            this.notifiedRemindersDate = todayStr;
            this.notifiedReminders.clear();
        }
        const tomorrowStr = now.clone().add(1, 'day').format('YYYY-MM-DD');
        const s = this.settings;
        const leadMs = Math.max(0, s.reminderOffsetMinutes ?? 0) * 60000;
        const GRACE_MS = 60000;
        // An hour-of-day reminder (all-day task, date-only deadline) still goes out if Obsidian opens a little late
        const LATE_MS = 30 * 60000;
        const at = (dateStr: string, hhmm: string) => moment(`${dateStr} ${hhmm}`, 'YYYY-MM-DD HH:mm');
        const minsUntil = (m: any) => Math.round((m.valueOf() - now.valueOf()) / 60000);

        // Each reminder fires once inside [fireAt, until). Runs every 15s: titles are cleaned only for the ones that fire.
        type Reminder = { key: string; icon: string; label: string; title: () => string; body: () => string; fireAt: any; until: any };
        const due: Reminder[] = [];
        const dueTimeLead = s.dueReminderOffset ?? 60;
        const wantsTasks = s.reminderForTasks || !!s.allDayReminderTime || !!s.allDayReminderDayBefore
            || dueTimeLead >= 0 || !!s.dueDateReminderTime;
        if (wantsTasks) {
            try {
                for (const task of await this.ensureTasksCache()) {
                    if (task.statusChar === '-') continue;
                    // A done task keeps only its deadline reminder, which says it is done (a check, not a nudge)
                    const done = task.statusChar === 'x';
                    const id = `${task.filePath}:${task.text}`;
                    const title = () => cleanTaskTextForDisplay(task.text);
                    // Timed tasks: from the lead time until a minute past the start
                    if (!done && s.reminderForTasks && task.date === todayStr && task.startTime) {
                        const start = at(todayStr, task.startTime);
                        due.push({
                            key: `task:${id}:${task.startTime}`, icon: '⏰', label: task.startTime, title,
                            body: () => minsUntil(start) <= 0 ? 'Starting now' : `Starts in ${formatMinutesNice(minsUntil(start))}`,
                            fireAt: start.clone().subtract(leadMs, 'ms'), until: start.clone().add(GRACE_MS, 'ms')
                        });
                    }
                    // All-day tasks (a date, no ⏰): on the day and / or the day before, at the chosen hour. One whose
                    // day is its 📅 day gets the deadline reminder below instead (when that one is on), not both.
                    const deadlineCovers = task.date === task.dueDate && (task.dueTime ? dueTimeLead >= 0 : !!s.dueDateReminderTime);
                    if (!done && task.date && !task.startTime && !deadlineCovers) {
                        for (const [when, dateStr, body] of [
                            [s.allDayReminderTime, todayStr, t('reminder.allDayToday')],
                            [s.allDayReminderDayBefore, tomorrowStr, t('reminder.allDayTomorrow')]
                        ] as const) {
                            if (!when || task.date !== dateStr) continue;
                            const fireAt = at(todayStr, when);
                            due.push({
                                key: `allday:${id}:${task.date}:${dateStr === todayStr ? 0 : 1}`, icon: '⏳',
                                label: dateStr === todayStr ? t('common.today') : t('common.tomorrow'), title, body: () => body,
                                fireAt, until: fireAt.clone().add(LATE_MS, 'ms')
                            });
                        }
                    }
                    if (!task.dueDate) continue;
                    if (task.dueTime) {
                        // Deadline with a time: the chosen lead before it (a day before at most), until a minute past it
                        if (dueTimeLead < 0 || (task.dueDate !== todayStr && task.dueDate !== tomorrowStr)) continue;
                        const dueAt = at(task.dueDate, task.dueTime);
                        const fireAt = dueAt.clone().subtract(dueTimeLead, 'minutes');
                        // Never past the end of the day it fires on: the notified set is cleared at midnight
                        const until = moment.min(dueAt.clone().add(GRACE_MS, 'ms'), fireAt.clone().endOf('day'));
                        due.push({
                            key: `due:${id}:${task.dueDate}:${task.dueTime}`, icon: done ? '✅' : '📅', label: task.dueTime, title,
                            body: () => done ? t('reminder.dueDone')
                                : minsUntil(dueAt) <= 0 ? t('reminder.dueNow') : t('reminder.dueIn', { time: formatMinutesNice(minsUntil(dueAt)) }),
                            fireAt, until
                        });
                    } else if (s.dueDateReminderTime) {
                        // Date-only deadline: on the due day, plus the chosen number of days before, at the chosen hour
                        const daysLeft = moment(task.dueDate, 'YYYY-MM-DD').diff(moment(todayStr, 'YYYY-MM-DD'), 'days');
                        if (daysLeft !== 0 && !(daysLeft > 0 && daysLeft === s.dueDateReminderDaysBefore)) continue;
                        const fireAt = at(todayStr, s.dueDateReminderTime);
                        due.push({
                            key: `due:${id}:${task.dueDate}:${daysLeft}d`, icon: done ? '✅' : '📅',
                            label: daysLeft === 0 ? t('common.today') : moment(task.dueDate, 'YYYY-MM-DD').format('ddd M/D'), title,
                            body: () => done ? t('reminder.dueDone') : daysLeft === 0 ? t('reminder.dueToday')
                                : daysLeft === 1 ? t('reminder.dueTomorrow') : t('reminder.dueInDays', { n: daysLeft }),
                            fireAt, until: fireAt.clone().add(LATE_MS, 'ms')
                        });
                    }
                }
            } catch (err) {
                console.warn('Day Planner Pro: reminder task scan failed', err);
            }
        }
        if (s.reminderForGCal && s.enableGoogleCalendar) {
            this.refreshTodayGCalForReminders(now);
            for (const e of this.gcalCache) {
                if (e.isAllDay || e.dateStr !== todayStr) continue;
                const start = moment(e.start);
                due.push({
                    key: `gcal:${e.calendarId}:${e.id}:${e.start}`, icon: '⏰', label: start.format('HH:mm'),
                    title: () => e.summary || '(No title)',
                    body: () => minsUntil(start) <= 0 ? 'Starting now' : `Starts in ${formatMinutesNice(minsUntil(start))}`,
                    fireAt: start.clone().subtract(leadMs, 'ms'), until: start.clone().add(GRACE_MS, 'ms')
                });
            }
        }

        const nowMs = now.valueOf();
        let chime = false;
        for (const r of due) {
            if (this.notifiedReminders.has(r.key) || nowMs < r.fireAt.valueOf() || nowMs >= r.until.valueOf()) continue;
            this.notifiedReminders.add(r.key);
            const channel = this.deliverReminder(type, r.title(), r.label, r.body(), r.icon);
            if (channel === 'notice') chime = true;
        }
        // In-app notices only: an OS notification brings the system's own tone. Once per batch.
        if (chime && this.settings.enableReminderSound !== false) this.playReminderChime();
    }

    private audioCtx: AudioContext | null = null;

    /**
     * Warm felt-mallet notification, synthesized with Web Audio (no bundled audio file): a slow F major arpeggio
     * (F4 → A4 → C5) in the low-mid register. Each note is a soft-attack sine with a faint 2x / 3x overtone and a
     * slightly detuned twin for body, through a dark low-pass, so it hums rather than rings. A soft echo adds room.
     */
    playReminderChime() {
        try {
            const Ctx: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
            if (!Ctx) return;
            this.audioCtx ??= new Ctx();
            const ctx = this.audioCtx;
            if (ctx.state === 'suspended') void ctx.resume();
            const t0 = ctx.currentTime + 0.03;

            const master = ctx.createGain();
            master.gain.value = 0.22;
            const tone = ctx.createBiquadFilter();
            tone.type = 'lowpass';
            tone.frequency.value = 1800; // dark and round, no edge
            tone.Q.value = 0.5;
            tone.connect(master).connect(ctx.destination);

            // Room: a soft 230ms echo, each repeat darker and softer
            const delay = ctx.createDelay(1);
            delay.delayTime.value = 0.23;
            const feedback = ctx.createGain();
            feedback.gain.value = 0.25;
            const echoTone = ctx.createBiquadFilter();
            echoTone.type = 'lowpass';
            echoTone.frequency.value = 1200;
            const wet = ctx.createGain();
            wet.gain.value = 0.3;
            delay.connect(echoTone).connect(feedback).connect(delay);
            echoTone.connect(wet).connect(master);

            // [ratio, level, decay seconds]; 1.003 = a few cents sharp, a gentle chorus that warms the fundamental
            const partials = [[1, 1, 1.8], [1.003, 0.5, 1.8], [2, 0.12, 0.7], [3, 0.03, 0.35]] as const;
            let end = t0;
            ([[349.23, 0, 0.9], [440, 0.18, 0.8], [523.25, 0.36, 0.85]] as const).forEach(([freq, at, level]) => {
                const t = t0 + at;
                const voice = ctx.createGain();
                voice.gain.value = level;
                voice.connect(tone);
                voice.connect(delay);
                partials.forEach(([ratio, amp, decay]) => {
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.value = freq * ratio;
                    const env = ctx.createGain();
                    env.gain.setValueAtTime(0.0001, t);
                    env.gain.exponentialRampToValueAtTime(amp, t + 0.03); // a felt mallet, not a strike
                    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
                    osc.connect(env).connect(voice);
                    osc.start(t);
                    osc.stop(t + decay + 0.05);
                    end = Math.max(end, t + decay);
                });
            });
            // Let the echo tail fade out, then release the graph
            window.setTimeout(() => {
                master.disconnect();
                delay.disconnect();
                feedback.disconnect();
            }, (end - ctx.currentTime + 1.5) * 1000);
        } catch (err) {
            console.warn('Day Planner Pro: reminder chime failed', err);
        }
    }

    /** Keeps today's events fresh even when no planner view is open; runs in the background at most once per TTL. */
    private refreshTodayGCalForReminders(now: any) {
        const cacheKey = `reminders:${now.format('YYYY-MM-DD')}`;
        const cached = this.gcalRanges.get(cacheKey);
        if (cached && Date.now() - cached.fetchedAt < GCAL_CACHE_TTL_MS) return;
        this.fetchGCalRange(cacheKey, now.clone().startOf('day').toDate(), now.clone().endOf('day').toDate())
            .catch(err => console.warn('Day Planner Pro: reminder GCal refresh failed', err));
    }

    /** Shows one reminder and returns the channel it actually went out on (the caller chimes for 'notice' only). */
    private deliverReminder(type: ReminderType, title: string, timeStr: string, body: string, icon = '⏰'): 'system' | 'notice' {
        const heading = `${icon} ${timeStr} ${title}`;
        // Visible AND focused: a minimized/hidden window can still report focus. activeDocument (= document unless an
        // Obsidian popout window is in front) keeps a focused popout from counting as "away".
        const doc = activeDocument ?? document;
        const isAppFocused = doc.visibilityState === 'visible' && doc.hasFocus();
        const canNotify = typeof window.Notification !== 'undefined';
        const useSystem = canNotify && (type === 'system' || (type === 'auto' && !isAppFocused));
        if (useSystem && Notification.permission === 'granted') {
            try {
                new Notification(heading, { body });
                return 'system';
            } catch (err) {
                console.warn('Day Planner Pro: system notification failed, falling back to Notice', err);
            }
        } else if (useSystem && Notification.permission === 'default') {
            this.requestNotificationPermission();
        }
        const notice = new Notice(createFragment(f => {
            f.createDiv({ cls: 'dayloom-reminder-title', text: heading });
            f.createDiv({ cls: 'dayloom-reminder-body', text: body });
        }), 12000);
        notice.noticeEl.addClass('dayloom-reminder-notice');
        return 'notice';
    }

    requestNotificationPermission() {
        if (typeof window.Notification === 'undefined' || Notification.permission !== 'default') return;
        try {
            Notification.requestPermission().catch(() => { /* user dismissed */ });
        } catch {
            // Older WebViews only support the callback form
        }
    }

    async updateStatusBar() {
        if (!this.statusBarItem) return;

        const now = (window as any).moment();
        const todayStr = now.format('YYYY-MM-DD');
        const currentMinutes = now.hour() * 60 + now.minute();

        const todayTasks = (await this.ensureTasksCache()).filter(t => t.date === todayStr && t.startTime && t.endTime);

        let activeTask: TaskItem | null = null;
        let nextTask: TaskItem | null = null;
        let minNextDiff = Infinity;

        for (const task of todayTasks) {
            const startMin = timeToMinutes(task.startTime!);
            const endMin = timeToMinutes(task.endTime!);

            if (currentMinutes >= startMin && currentMinutes < endMin) {
                activeTask = task;
            } else if (startMin > currentMinutes) {
                const diff = startMin - currentMinutes;
                if (diff < minNextDiff) {
                    minNextDiff = diff;
                    nextTask = task;
                }
            }
        }

        // Called on every view refresh and every 30s: rebuild the item only when what it shows changed
        const hideMeta = this.settings.hideBracketMetadata !== false;
        const statusKey = activeTask
            ? `a|${activeTask.text}|${activeTask.startTime}|${activeTask.endTime}|${activeTask.statusChar}|${currentMinutes}|${hideMeta}`
            : nextTask ? `n|${nextTask.text}|${nextTask.startTime}|${nextTask.endTime}|${minNextDiff}|${hideMeta}` : 'done';
        if (statusKey === this.statusBarKey) return;
        this.statusBarKey = statusKey;

        const getProgressColor = (percent: number, statusChar: string): string => {
            if (statusChar === 'x') {
                return '#10b981'; // Green for completed
            }
            if (statusChar === '-') {
                return '#ef4444'; // Red for canceled
            }
            let hue = 210; // Blue
            if (percent <= 50) {
                const t = percent / 50;
                hue = 210 - t * (210 - 55); // Interpolate Blue -> Yellow
            } else {
                const t = (percent - 50) / 50;
                hue = 55 - t * (55 - 25); // Interpolate Yellow -> Orange
            }
            return `hsl(${Math.round(hue)}, 95%, 50%)`;
        };

        this.statusBarItem.empty();
        this.statusBarItem.addClass('dp-status-bar-item');

        if (activeTask) {
            const startMin = timeToMinutes(activeTask.startTime!);
            const endMin = timeToMinutes(activeTask.endTime!);

            const duration = endMin - startMin;
            const elapsed = currentMinutes - startMin;
            const remaining = endMin - currentMinutes;
            const percent = Math.min(100, Math.max(0, Math.round((elapsed / duration) * 100)));

            const cleanTitle = cleanTaskTextForDisplay(activeTask.text);

            this.statusBarItem.createEl('span', { text: `📅 [Progress: ${cleanTitle}] ${formatMinutesNice(remaining)} remaining` });

            const progressContainer = this.statusBarItem.createDiv({ cls: 'dp-status-progress-container' });
            const progressBar = progressContainer.createDiv({ cls: 'dp-status-progress-bar' });
            progressBar.style.width = activeTask.statusChar === 'x' ? '100%' : `${percent}%`;
            progressBar.style.backgroundColor = getProgressColor(percent, activeTask.statusChar);

            this.statusBarItem.createEl('span', { text: ` ${percent}%` });
            this.statusBarItem.title = `Current Task: ${activeTask.startTime} ~ ${activeTask.endTime}`;
        } else if (nextTask) {
            const cleanTitle = cleanTaskTextForDisplay(nextTask.text);
            this.statusBarItem.setText(`📅 [Upcoming: ${cleanTitle}] ${formatMinutesNice(minNextDiff)} until start`);
            this.statusBarItem.title = `Next Task: ${nextTask.startTime} ~ ${nextTask.endTime}`;
        } else {
            this.statusBarItem.setText('📅 Dayloom: Complete');
            this.statusBarItem.title = 'All tasks for today are completed or no tasks scheduled.';
        }
    }

    /** Settings were on disk at load (false = a fresh install): tells an update from a first run (showWhatsNewAfterUpdate) */
    private hadSavedSettings = false;

    /**
     * "What's New" once after an update, when the layout is ready; never on a fresh install. Settings saved by a
     * version from before this check have no lastVersion: with saved settings that is an update too. Test builds
     * (4th segment, 4.4.4.1 → 4.4.4.2) only record their version: the notes open when the release (x.y.z) changes.
     */
    private async showWhatsNewAfterUpdate() {
        const current = this.manifest.version;
        const previous = this.settings.lastVersion;
        if (previous === current) return;
        const release = (version: string) => version.split('.').slice(0, 3).join('.');
        const updated = previous ? release(previous) !== release(current) : this.hadSavedSettings;
        this.settings.lastVersion = current;
        try {
            await this.persistSettings();
        } catch (err) {
            console.warn('Day Planner Pro: could not record the plugin version', err);
        }
        if (updated) this.app.workspace.onLayoutReady(() => new WhatsNewModal(this.app, current).open());
    }

    /** JSON of the settings as last loaded or written: saving unchanged settings skips the disk write (persistSettings) */
    private savedSettingsJson = '';
    /** data.json existed but could not be parsed (e.g. caught mid-sync): saving would replace it with the defaults */
    private settingsUnreadable = false;

    /** loadData(), retried on the raw text without a BOM / surrounding whitespace another device's editor may add */
    private async readSettingsData(): Promise<any> {
        try {
            return await this.loadData();
        } catch (err) {
            try {
                const raw = await this.app.vault.adapter.read(`${this.manifest.dir}/data.json`);
                return JSON.parse(raw.replace(/^﻿/, '').trim());
            } catch {
                throw err;
            }
        }
    }

    async loadSettings() {
        let data: any = null;
        try {
            data = await this.readSettingsData();
            this.settingsUnreadable = false;
        } catch (err) {
            console.error('Day Planner Pro: data.json could not be parsed; running on defaults without saving', err);
            new Notice('Day Planner Pro: the settings file (data.json) could not be read, possibly mid-sync. Defaults are in use and changes will not be saved until it is readable again.', 15000);
            this.settingsUnreadable = true;
        }
        this.applySettingsData(data);
        this.hadSavedSettings = !!data || this.settingsUnreadable;
    }

    /** Merges stored data over the defaults and runs the migrations (startup and onExternalSettingsChange) */
    private applySettingsData(data: any) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) data = null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
        // Own array: the default's must never be pushed to
        this.settings.icsCalendars = Array.isArray(this.settings.icsCalendars) ? this.settings.icsCalendars.map(c => ({ ...c })) : [];
        // Access tokens stay in memory since 4.4.5.1 (gcalApi.ts); copies older versions stored are dropped on the next save
        delete (this.settings as any).googleAccessToken;
        delete (this.settings as any).googleAccessTokenExpires;
        // Superseded by reminderOffsetMinutes; its stored 10 was the old default, so the new at-start default applies
        delete (this.settings as any).reminderMinutesBefore;
        // showHelpButton (3.99.5) was renamed showShortcutButton (4.0.0): keep a button the user already hid hidden
        if ((data as any)?.showHelpButton === false && (data as any)?.showShortcutButton === undefined) {
            this.settings.showShortcutButton = false;
        }
        delete (this.settings as any).showHelpButton;

        if (data && (data as any).googleCalendarId && (!this.settings.googleCalendars || this.settings.googleCalendars.length === 0)) {
            this.settings.googleCalendars = [{
                id: (data as any).googleCalendarId,
                name: 'Default Calendar',
                color: '#4285f4',
                enabled: true
            }];
        }
        this.sanitizeSettings();
        // Unreadable file: nothing matches, and persistSettings refuses to write until a readable copy arrives
        this.savedSettingsJson = this.settingsUnreadable ? '' : JSON.stringify(this.settings);
        setHapticsEnabled(this.settings.enableMobileHaptics);
        setScanSettings(this.settings);
        setLanguage(this.settings.language);
        this.exclusionKey = JSON.stringify([this.settings.excludePaths, this.settings.excludeMatchMode]);
    }

    /** Credentials and calendar IDs pasted with stray whitespace / CRLF (older versions only trimmed typed input) */
    private sanitizeSettings() {
        const s = this.settings;
        s.googleClientId = sanitizeCredential(s.googleClientId);
        s.googleClientSecret = sanitizeCredential(s.googleClientSecret);
        s.googleRefreshToken = sanitizeCredential(s.googleRefreshToken);
        if (!Array.isArray(s.googleCalendars)) s.googleCalendars = [];
        s.googleCalendars.forEach(c => { if (typeof c.id === 'string') c.id = c.id.trim(); });
        if (typeof s.taskSyncCalendarId === 'string') s.taskSyncCalendarId = s.taskSyncCalendarId.trim();
    }

    /**
     * Writes data.json only when the settings changed. Every device shares this file through Syncthing, so even a
     * byte-identical rewrite is a concurrent modification that can fork a .sync-conflict copy. saveData serializes
     * with JSON.stringify (LF line endings on every platform), so equal JSON here means equal bytes on disk.
     */
    private async persistSettings() {
        if (this.settingsUnreadable) return;
        this.sanitizeSettings();
        const json = JSON.stringify(this.settings);
        if (json === this.savedSettingsJson) return;
        await this.saveData(this.settings);
        this.savedSettingsJson = json;
    }

    /**
     * Obsidian 1.5.7+: data.json changed on disk (Syncthing delivered another device's edit). Adopt it, or the next
     * save here would overwrite it with this device's stale copy. A file caught mid-sync is skipped: Obsidian fires
     * again once the complete file lands.
     */
    async onExternalSettingsChange() {
        let data: any;
        try {
            data = await this.readSettingsData();
        } catch (err) {
            console.warn('Day Planner Pro: ignoring an unreadable external data.json change', err);
            return;
        }
        const exclusionKey = this.exclusionKey;
        const icsKey = JSON.stringify(this.settings.icsCalendars);
        this.settingsUnreadable = false;
        this.applySettingsData(data);
        if (this.exclusionKey !== exclusionKey) {
            await this.waitForTypingIdle(); // synced in the background, possibly mid-typing
            this.tasksCache = await scanVaultTasks(this.app);
            this.updateStatusBar();
        }
        this.refreshActiveViews();
        // Subscriptions added, renamed or recoloured on another device
        if (JSON.stringify(this.settings.icsCalendars) !== icsKey) void this.onIcsSettingsChanged();
    }

    async saveSettings() {
        setHapticsEnabled(this.settings.enableMobileHaptics);
        setScanSettings(this.settings);
        setLanguage(this.settings.language);
        await this.persistSettings();
        this.refreshSidebarCalendars(); // calendar colours, task colour, note folders and formats
        // Exclusion rules changed: rescan so newly excluded notes disappear (and re-included ones return) right away
        const exclusionKey = JSON.stringify([this.settings.excludePaths, this.settings.excludeMatchMode]);
        if (exclusionKey !== this.exclusionKey) {
            this.exclusionKey = exclusionKey;
            this.tasksCache = await scanVaultTasks(this.app);
            this.updateStatusBar();
            this.refreshActiveViews();
        }
    }

    /**
     * 뷰 활성화 및 타겟 탭 지정을 포함한 고급 뷰 포커스 내비게이터
     */
    async activateView(viewType: string, tab?: 'daily' | 'weekly' | 'multiDay' | 'monthly' | 'board' | 'list') {
        // Phones: the combined view is the single planner shell (bottom tabs, date strip, swipes); "Daily" opens its Daily tab
        if (Platform.isPhone && viewType === VIEW_TYPES.DAILY) {
            viewType = VIEW_TYPES.COMBINED;
            tab = 'daily';
        }
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(viewType);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            if (viewType === VIEW_TYPES.DAILY || viewType === VIEW_TYPES.CALENDAR) {
                // Right sidebar (desktop) / right drawer (mobile); fall back to a tab if no sidebar leaf is available
                leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf('tab');
            } else {
                leaf = workspace.getLeaf('tab');
            }
            if (leaf) {
                await leaf.setViewState({
                    type: viewType,
                    active: true,
                });
            }
        }

        if (leaf) {
            // Expands a collapsed sidebar on desktop and slides the drawer open on mobile
            await workspace.revealLeaf(leaf);
            if (viewType === VIEW_TYPES.COMBINED && tab) {
                const combinedView = leaf.view as DayPlannerCombinedView;
                if (combinedView && typeof combinedView.activeTab !== 'undefined') {
                    combinedView.activeTab = tab;
                    await combinedView.refreshTasks(null, true);
                }
            }
        }
    }

    /** Fetches one range into gcalRanges. Resolves true only if the events actually changed. On failure the old events are kept. */
    fetchGCalRange(cacheKey: string, timeMin: Date, timeMax: Date): Promise<boolean> {
        const inflight = this.gcalInflight.get(cacheKey);
        if (inflight) return inflight;
        const promise = (async () => {
            const prev = this.gcalRanges.get(cacheKey);
            let events: GCalEvent[];
            try {
                const results = await Promise.all(this.settings.googleCalendars
                    .filter(cal => cal.enabled && cal.id && cal.id !== this.settings.taskSyncCalendarId)
                    .map(cal => fetchSingleCalendarEvents(this, cal, timeMin, timeMax, true)));
                events = results.flat();
            } catch (err) {
                console.error('Day Planner Pro: GCal fetch failed, keeping cached events', err);
                // Back off until the TTL expires instead of retrying on every edit
                if (prev) prev.fetchedAt = Date.now();
                return false;
            }
            const changed = !prev || JSON.stringify(prev.events) !== JSON.stringify(events);
            this.gcalRanges.delete(cacheKey);
            // Keep the old array reference when nothing changed
            this.gcalRanges.set(cacheKey, { events: prev && !changed ? prev.events : events, fetchedAt: Date.now() });
            while (this.gcalRanges.size > GCAL_MAX_CACHED_RANGES) {
                this.gcalRanges.delete(this.gcalRanges.keys().next().value as string);
            }
            if (changed) {
                this.rebuildGCalCache();
                this.scheduleGCalCacheSave();
            }
            return changed;
        })();
        this.gcalInflight.set(cacheKey, promise);
        promise.finally(() => this.gcalInflight.delete(cacheKey));
        return promise;
    }

    refreshActiveViews(forceFetchGCal: boolean = false, skipIfUnchanged: boolean = false) {
        this.plannerViews().forEach(view => {
            // Background refresh of a planner nobody can see (a tab behind the note being edited): redraw it when it
            // is shown again instead (catchUpHiddenViews)
            if (skipIfUnchanged) void this.refreshIfShown(view, () => view.refreshTasks(null, forceFetchGCal, true));
            else void view.refreshTasks(null, forceFetchGCal, false);
        });
    }
}
