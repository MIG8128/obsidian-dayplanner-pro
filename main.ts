import { 
    App, 
    Plugin, 
    PluginSettingTab, 
    Setting, 
    WorkspaceLeaf,
    setIcon,
    Notice,
    TFile,
    TFolder,
    parseYaml,
    Platform,
    editorLivePreviewField
} from 'obsidian';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { 
    DayPlannerSettings, 
    DEFAULT_SETTINGS, 
    VIEW_TYPES,
    TaskItem,
    GCalEvent,
    ReminderType,
    GCAL_CACHE_TTL_MS,
    GCAL_MAX_CACHED_RANGES
} from './types';
import { STYLES } from './styles';
import { 
    scanVaultTasks, 
    isSyncConflictPath,
    cleanTaskTextForDisplay,
    parseTaskLine,
    formatMinutesNice,
    setHapticsEnabled,
    setScanSettings,
    isExcludedPath,
    GCAL_ID_TAG_RE,
    attachPathSuggest,
    onEnterSubmit
} from './utils';
import { fetchSingleCalendarEvents } from './gcalApi';
import { 
    DayPlannerCombinedView, 
    DayPlannerDailyView,
    DayPlannerCodeBlockRenderer
} from './views';
import { ShortcutHelpModal } from './modals';

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
        const tabs = [
            { id: 'general', label: '⚙️ General' },
            { id: 'timeline', label: '⏱️ Timeline' },
            { id: 'gcal', label: '☁️ Google Calendar' },
            { id: 'reminders', label: '🔔 Reminders' },
            { id: 'display', label: '📱 Display' }
        ] as const;
        const bar = container.createDiv({ cls: 'dp-settings-tabs', attr: { role: 'tablist' } });
        const panels = {} as Record<typeof tabs[number]['id'], HTMLElement>;
        const buttons: HTMLElement[] = [];
        const activate = (id: string) => {
            this.activeSettingsTab = id;
            tabs.forEach((tab, i) => {
                const on = tab.id === id;
                buttons[i].toggleClass('is-active', on);
                buttons[i].setAttr('aria-selected', String(on));
                panels[tab.id].toggleClass('is-active', on);
            });
        };
        tabs.forEach(tab => {
            const btn = bar.createEl('button', { cls: 'dp-settings-tab', text: tab.label, attr: { role: 'tab' } });
            btn.addEventListener('click', () => activate(tab.id));
            buttons.push(btn);
        });
        tabs.forEach(tab => { panels[tab.id] = container.createDiv({ cls: 'dp-settings-panel', attr: { role: 'tabpanel' } }); });
        activate(tabs.some(t => t.id === this.activeSettingsTab) ? this.activeSettingsTab : 'general');
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
            .setName('Excluded Files & Folders')
            .setDesc('Notes matched here are not scanned for tasks. Pick a folder or note from the suggestions, or type a pattern: * stays within one folder, ** crosses folders (e.g. **/Templates). "Keep" re-includes something inside an excluded folder.')
            .setClass('dp-path-filter-setting');

        const box = container.createDiv({ cls: 'dp-path-filter' });
        const inputRow = box.createDiv({ cls: 'dp-path-filter-input-row' });
        const modeToggle = inputRow.createDiv({ cls: 'dp-path-filter-mode', attr: { role: 'group', 'aria-label': 'Rule type' } });
        const input = inputRow.createEl('input', {
            cls: 'dp-path-filter-input',
            attr: { type: 'text', placeholder: 'Folder, note or pattern…', spellcheck: 'false' }
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
                    text: mode === 'exclude' ? 'Exclude' : 'Keep'
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
                chips.createSpan({ cls: 'dp-path-chips-empty', text: 'No rules: every note in the vault is scanned.' });
            }
            list.forEach((rule, index) => {
                const keep = rule.startsWith('!');
                const path = keep ? rule.slice(1) : rule;
                const target = this.app.vault.getAbstractFileByPath(path.replace(/\/+$/, ''))
                    ?? this.app.vault.getAbstractFileByPath(`${path}.md`);
                const icon = path.includes('*') ? 'asterisk' : target instanceof TFolder || path.endsWith('/') ? 'folder' : target instanceof TFile ? 'file-text' : 'help-circle';
                const chip = chips.createDiv({
                    cls: `dp-path-chip${keep ? ' is-keep' : ''}${!target && !path.includes('*') ? ' is-missing' : ''}`,
                    attr: { 'aria-label': `${keep ? 'Keep' : 'Exclude'}: ${path}${!target && !path.includes('*') ? ' (not found in the vault)' : ''} · click to switch` }
                });
                chip.createSpan({ cls: 'dp-path-chip-mode', text: keep ? 'Keep' : 'Exclude' });
                setIcon(chip.createSpan({ cls: 'dp-path-chip-icon' }), icon);
                chip.createSpan({ cls: 'dp-path-chip-label', text: path });
                chip.addEventListener('click', async () => {
                    list[index] = keep ? path : `!${path}`;
                    await save();
                });
                const remove = chip.createEl('button', { cls: 'dp-path-chip-remove', attr: { 'aria-label': `Remove ${path}` } });
                setIcon(remove, 'x');
                remove.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    list.splice(index, 1);
                    await save();
                });
            });

            const notes = this.app.vault.getMarkdownFiles().filter(f => !isSyncConflictPath(f.path));
            const excluded = notes.filter(f => isExcludedPath(f.path)).length;
            summary.setText(list.length === 0 ? '' : `Leaving out ${excluded} of ${notes.length} notes.`);
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

        new Setting(containerEl).setName('Dayloom Settings').setHeading();

        // Panels are created up front, so each block below lands in its tab regardless of code order
        const { general, timeline, gcal, reminders, display: mobileDisplay } = this.createSettingsTabs(containerEl);

        this.addPathSetting(general, 'Default Task File Path',
            'The default markdown file where tasks will be added when creating them in the planner.',
            'Day Planner.md', 'file', this.plugin.settings.defaultTaskFile,
            async (value) => {
                this.plugin.settings.defaultTaskFile = value || 'Day Planner.md';
                await this.plugin.saveSettings();
            });

        this.renderExclusionFilter(general);

        new Setting(general).setName('Daily notes').setHeading();
        this.addPathSetting(general, 'Daily Notes Folder Path',
            'Obsidian folder path for your daily notes. Leave empty for root folder.',
            'Daily/Journal', 'folder', this.plugin.settings.dailyNotesFolder,
            async (value) => {
                this.plugin.settings.dailyNotesFolder = value.trim() || '';
                await this.plugin.saveSettings();
            });

        new Setting(general)
            .setName('Daily Notes File Format')
            .setDesc('File name format for daily notes (Default: YYYY-MM-DD).')
            .addText(text => text
                .setPlaceholder('YYYY-MM-DD')
                .setValue(this.plugin.settings.dailyNotesFormat)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNotesFormat = value.trim() || 'YYYY-MM-DD';
                    await this.plugin.saveSettings();
                })
            );

        this.addPathSetting(general, 'Daily Note Template',
            'Choose the markdown file in your vault to use as a template for new Daily Notes.',
            'Templates/Daily.md', 'file', this.plugin.settings.dailyNoteTemplate || '',
            async (value) => {
                this.plugin.settings.dailyNoteTemplate = value.trim();
                await this.plugin.saveSettings();
            });

        new Setting(general).setName('Weekly notes').setHeading();
        this.addPathSetting(general, 'Weekly Notes Folder Path',
            'Obsidian folder path for your weekly notes. Leave empty for root folder.',
            'Weekly/Plans', 'folder', this.plugin.settings.weeklyNotesFolder || '',
            async (value) => {
                this.plugin.settings.weeklyNotesFolder = value.trim() || '';
                await this.plugin.saveSettings();
            });

        new Setting(general)
            .setName('Weekly Notes File Format')
            .setDesc('File name format for weekly notes (Default: gggg-[W]ww).')
            .addText(text => text
                .setPlaceholder('gggg-[W]ww')
                .setValue(this.plugin.settings.weeklyNotesFormat || 'gggg-[W]ww')
                .onChange(async (value) => {
                    this.plugin.settings.weeklyNotesFormat = value.trim() || 'gggg-[W]ww';
                    await this.plugin.saveSettings();
                })
            );

        this.addPathSetting(general, 'Weekly Note Template',
            'Choose the markdown file in your vault to use as a template for new Weekly Notes.',
            'Templates/Weekly.md', 'file', this.plugin.settings.weeklyNoteTemplate || '',
            async (value) => {
                this.plugin.settings.weeklyNoteTemplate = value.trim();
                await this.plugin.saveSettings();
            });

        new Setting(timeline)
            .setName('N-day view length')
            .setDesc('Number of consecutive days to show in the N-day calendar view.')
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
            .setName('Hide Inline Metadata Fields')
            .setDesc('Hide bracketed inline fields such as [gcalId:: ...] from task titles in the planner, and the [gcalId:: ...] sync tag in Reading View and Live Preview. Files keep them; only the display is cleaned.')
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
            .setName('Show shortcut button in header')
            .setDesc('Show the keyboard shortcut (?) button in the timeline header. The ? and h keys open the shortcut list either way.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showShortcutButton ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.showShortcutButton = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshActiveViews();
                })
            );

        new Setting(reminders)
            .setName('Reminder Type')
            .setDesc('How to alert you before a task or event starts. Auto shows an in-app notice while Obsidian is focused and a system notification otherwise.')
            .addDropdown(dropdown => dropdown
                .addOption('off', 'Off')
                .addOption('auto', 'Auto')
                .addOption('notice', 'In-app notice')
                .addOption('system', 'System notification')
                .setValue(this.plugin.settings.reminderType ?? 'auto')
                .onChange(async (value) => {
                    this.plugin.settings.reminderType = value as ReminderType;
                    await this.plugin.saveSettings();
                    if (value === 'system' || value === 'auto') this.plugin.requestNotificationPermission();
                })
            );

        new Setting(reminders)
            .setName('Reminder Timing')
            .setDesc('When to alert you relative to the start time of a task or event.')
            .addDropdown(dropdown => dropdown
                .addOption('0', 'At event start time')
                .addOption('5', '5 minutes before')
                .addOption('10', '10 minutes before')
                .addOption('15', '15 minutes before')
                .addOption('30', '30 minutes before')
                .setValue(String(this.plugin.settings.reminderOffsetMinutes ?? 0))
                .onChange(async (value) => {
                    this.plugin.settings.reminderOffsetMinutes = Number(value);
                    await this.plugin.saveSettings();
                })
            );

        new Setting(reminders)
            .setName('Reminder Sound')
            .setDesc('Play a short two-tone chime with each reminder.')
            .addExtraButton(button => button
                .setIcon('volume-2')
                .setTooltip('Play test chime')
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
            .setName('Remind for Tasks')
            .setDesc('Send reminders for vault tasks with a start time (⏰HH:mm) scheduled for today.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.reminderForTasks ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.reminderForTasks = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(reminders)
            .setName('Remind for Google Calendar Events')
            .setDesc('Send reminders for timed Google Calendar events today. All-day events are skipped.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.reminderForGCal ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.reminderForGCal = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(mobileDisplay)
            .setName('Haptic Feedback')
            .setDesc('Vibrate briefly when completing tasks, switching tabs or modes, and dragging or resizing timeline items. Only on mobile devices that support vibration.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMobileHaptics ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableMobileHaptics = value;
                    await this.plugin.saveSettings();
                })
            );

        // 📐 타임라인 세로 간격 및 노출 시간 범위 조절 설정 UI 추가
        
        new Setting(timeline)
            .setName('Separate Dayloom and Dayloom Compact Heights')
            .setDesc('Enable this to adjust the zoom (hour height) of Dayloom and Dayloom Compact independently.')
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
                .setName('Timeline Hour Height (Dayloom)')
                .setDesc('Adjust the vertical spacing height (in pixels) for 1 hour on Dayloom timelines. (Default: 60px)')
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
                .setName('Timeline Hour Height (Dayloom Compact)')
                .setDesc('Adjust the vertical spacing height (in pixels) for 1 hour on Dayloom Compact timelines. (Default: 60px)')
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
                .setName('Timeline Hour Height (Synced)')
                .setDesc('Adjust the vertical spacing height (in pixels) for 1 hour on all timelines. (Default: 60px)')
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
            .setName('Timeline Start Hour')
            .setDesc('The hour at which the daily and weekly timeline starts.')
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
                            new Notice('Start hour must be before end hour.');
                            dropdown.setValue(String(this.plugin.settings.timelineStartHour));
                        }
                    });
            });

        new Setting(timeline)
            .setName('Timeline End Hour')
            .setDesc('The hour at which the daily and weekly timeline ends.')
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
                            new Notice('End hour must be after start hour.');
                            dropdown.setValue(String(this.plugin.settings.timelineEndHour));
                        }
                    });
            });

        new Setting(timeline)
            .setName('Default Task Duration (minutes)')
            .setDesc('Length of the time block an untimed task gets when you drag it onto the timeline from the side drawer or an all-day row (end time = start time + this). Any value from 1 to 1440.')
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

        new Setting(gcal)
            .setName('Enable Google Calendar Integration')
            .setDesc('When enabled, your active Google Calendar events will be fetched and shown alongside tasks.')
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
                .setName('Task Sync Google Calendar')
                .setDesc('Choose the Google Calendar to synchronize your timed vault tasks with.')
                .addDropdown(dropdown => {
                    dropdown.addOption('', 'Select a calendar...');
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
        }

        new Setting(gcal).setName('Google Calendar OAuth 2.0 (sync & editing)').setHeading();
        gcal.createEl('p', { 
            text: 'To sync calendars (including private ones) and edit/drag events directly in the timeline, you need to configure your custom OAuth 2.0 web application credentials.'
        });

        new Setting(gcal)
            .setName('Google Client ID')
            .setDesc('OAuth Web Client Application ID.')
            .addText(text => text
                .setPlaceholder('xxxx.apps.googleusercontent.com')
                .setValue(this.plugin.settings.googleClientId || '')
                .onChange(async (value) => {
                    this.plugin.settings.googleClientId = value.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(gcal)
            .setName('Google Client Secret')
            .setDesc('OAuth Web Client Secret Key.')
            .addText(text => text
                .setPlaceholder('GOCSPX-xxxx')
                .setValue(this.plugin.settings.googleClientSecret || '')
                .onChange(async (value) => {
                    this.plugin.settings.googleClientSecret = value.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(gcal)
            .setName('Google Refresh Token')
            .setDesc('Offline persistent refresh token for background writing API authorization.')
            .addText(text => text
                .setPlaceholder('1//0xxxx')
                .setValue(this.plugin.settings.googleRefreshToken || '')
                .onChange(async (value) => {
                    this.plugin.settings.googleRefreshToken = value.trim();
                    await this.plugin.saveSettings();
                })
            );

        const calHeader = gcal.createDiv();
        calHeader.style.cssText = 'margin-top: 24px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;';
        const h4El = calHeader.createEl('h4', { text: 'Google Calendars 📅' });
        h4El.style.cssText = 'margin: 0;';
        
        const addCalBtn = calHeader.createEl('button', { text: '+ Add Calendar', cls: 'mod-cta' });
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
                text: 'No Google Calendars configured yet. Click "Add Calendar" to start integrating.' 
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

                const nameInput = row.createEl('input', { type: 'text', placeholder: 'Name (e.g., Work, Personal)' });
                nameInput.value = cal.name;
                nameInput.style.flex = '1';
                nameInput.style.minWidth = '100px';
                nameInput.addEventListener('change', async () => {
                    cal.name = nameInput.value;
                    await this.plugin.saveSettings();
                });

                const idInput = row.createEl('input', { type: 'text', placeholder: 'primary or Google email address' });
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

                const delBtn = row.createEl('button', { text: 'Delete', cls: 'mod-warning' });
                delBtn.addEventListener('click', async () => {
                    this.plugin.settings.googleCalendars.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display();
                });
            });
        }

        // Next to the calendar colours above, so local tasks and each calendar can be balanced in one place
        new Setting(gcal)
            .setName('Local Task Color')
            .setDesc('Color for the highlight borders of your local (vault) tasks, shown alongside the calendar colors above.')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.taskColor || '#ff9f1c')
                .onChange(async (value) => {
                    this.plugin.settings.taskColor = value;
                    await this.plugin.saveSettings();
                    this.plugin.refreshActiveViews();
                })
            );
    }
}
/**
 * Live Preview: hides ` [gcalId:: ...]` with a replace decoration (display only, the document text is untouched).
 * The tag reappears while the cursor or a selection touches it, so it stays editable; source mode is never affected.
 */
function gcalIdHider(isEnabled: () => boolean) {
    const hide = Decoration.replace({});
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.build(view); }
        update(u: ViewUpdate) {
            if (u.docChanged || u.viewportChanged || u.selectionSet || u.transactions.some(t => t.reconfigured)) {
                this.decorations = this.build(u.view);
            }
        }
        build(view: EditorView): DecorationSet {
            const builder = new RangeSetBuilder<Decoration>();
            if (!isEnabled() || !view.state.field(editorLivePreviewField, false)) return builder.finish();
            const selection = view.state.selection.ranges;
            for (const { from, to } of view.visibleRanges) {
                const text = view.state.doc.sliceString(from, to);
                for (const m of text.matchAll(GCAL_ID_TAG_RE)) {
                    const start = from + (m.index ?? 0);
                    const end = start + m[0].length;
                    if (selection.some(r => r.from <= end && r.to >= start)) continue;
                    builder.add(start, end, hide);
                }
            }
            return builder.finish();
        }
    }, { decorations: v => v.decorations });
}

/** Resolves once the main thread goes idle (capped at 2s), so the first vault scan never competes with Obsidian's boot. */
const whenIdle = () => new Promise<void>(resolve => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 2000 });
    else window.setTimeout(resolve, 1000); // iOS WebKit has no requestIdleCallback
});

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
    /** Mounted `dayplanner` code blocks, refreshed with the leaf views on vault changes */
    codeBlockRenderers = new Set<DayPlannerCodeBlockRenderer>();
    /** Reminder keys already fired today; reset when the date changes */
    private notifiedReminders = new Set<string>();
    private notifiedRemindersDate = '';

    /**
     * Coalesces per-file cache updates into one view refresh: trailing 250ms, forced after 1.5s of continuous changes.
     * Post-launch re-indexing fires 'changed' for hundreds of notes; refreshing per file meant hundreds of full renders.
     */
    requestViewRefresh() {
        const now = Date.now();
        if (this.viewRefreshTimer === null) this.viewRefreshFirstAt = now;
        else window.clearTimeout(this.viewRefreshTimer);
        const delay = Math.max(0, Math.min(250, this.viewRefreshFirstAt + 1500 - now));
        this.viewRefreshTimer = window.setTimeout(() => {
            this.viewRefreshTimer = null;
            this.updateStatusBar();
            // Views and code blocks whose visible tasks are unchanged keep their DOM
            this.refreshActiveViews(false, true);
            this.codeBlockRenderers.forEach(r => r.refreshContentOnly(true));
        }, delay);
    }

    /** Single shared full scan: waits for the layout (never scans during Obsidian's boot) and dedupes concurrent callers. */
    ensureTasksCache(): Promise<TaskItem[]> {
        if (this.tasksCache) return Promise.resolve(this.tasksCache);
        if (!this.scanPromise) {
            this.scanPromise = this.layoutReady
                .then(whenIdle)
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

    private get gcalCachePath(): string {
        return `${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/gcal-cache.json`;
    }

    /** Restores the last fetched events so views paint them instantly on startup; each range revalidates on first view. */
    private async loadGCalCache() {
        try {
            if (!(await this.app.vault.adapter.exists(this.gcalCachePath))) return;
            const data = JSON.parse(await this.app.vault.adapter.read(this.gcalCachePath));
            if (data?.version !== 1 || !Array.isArray(data.ranges)) return;
            for (const [key, events] of data.ranges) this.gcalRanges.set(key, { events, fetchedAt: 0 });
            this.rebuildGCalCache();
        } catch (err) {
            console.warn('Day Planner Pro: ignoring unreadable Google Calendar cache', err);
        }
    }

    private scheduleGCalCacheSave() {
        if (this.gcalCacheSaveTimer) window.clearTimeout(this.gcalCacheSaveTimer);
        this.gcalCacheSaveTimer = window.setTimeout(async () => {
            this.gcalCacheSaveTimer = null;
            try {
                const ranges = Array.from(this.gcalRanges.entries()).map(([key, r]) => [key, r.events]);
                await this.app.vault.adapter.write(this.gcalCachePath, JSON.stringify({ version: 1, ranges }));
            } catch (err) {
                console.warn('Day Planner Pro: could not save Google Calendar cache', err);
            }
        }, 2000);
    }

    private rebuildGCalCache() {
        const byId = new Map<string, GCalEvent>();
        this.gcalRanges.forEach(r => r.events.forEach(e => byId.set(`${e.calendarId}::${e.id}`, e)));
        this.gcalCache = Array.from(byId.values());
    }

    async onload() {
        // Resolves immediately when the plugin is enabled after startup
        this.layoutReady = new Promise(resolve => this.app.workspace.onLayoutReady(() => resolve()));
        await this.loadSettings();
        await this.loadGCalCache();

        const styleEl = document.createElement('style');
        styleEl.id = 'day-planner-pro-styles';
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        // Dayloom tab view + Dayloom Compact (same planner, compact shell)
        this.registerView(VIEW_TYPES.COMBINED, (leaf) => new DayPlannerCombinedView(leaf, this));
        this.registerView(VIEW_TYPES.DAILY, (leaf) => new DayPlannerDailyView(leaf, this));

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
                else new Notice('Open a Dayloom view first.');
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
                else new Notice('Open Dayloom first.');
            }
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

        // Everything heavy waits for the layout: Obsidian fires 'create' for every file while loading the vault,
        // which previously started one full scan per file during boot.
        this.app.workspace.onLayoutReady(() => this.onLayoutReadyInit());
    }

    private onLayoutReadyInit() {
        this.registerInterval(window.setInterval(() => this.updateStatusBar(), 30000));
        // registerInterval clears this on unload
        this.registerInterval(window.setInterval(() => this.checkReminders(), 15000)); // at-start alerts land within 15s
        this.checkReminders();
        // Open views await this same scan in their own refreshTasks(); re-rendering them here would paint them twice
        this.ensureTasksCache().then(() => this.updateStatusBar());

        // Centralized file modify observers (debounced per file). Cache + view refresh only: Google Calendar task sync
        // and repair run solely from the Sync button / Task Sync modal.
        const modifyTimeouts = new Map<string, number>();
        const scheduleFileUpdate = (file: TFile, run: () => Promise<void>) => {
            window.clearTimeout(modifyTimeouts.get(file.path));
            modifyTimeouts.set(file.path, window.setTimeout(() => {
                modifyTimeouts.delete(file.path);
                run();
            }, 350));
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

                if (ctx && ctx.sourcePath) {
                    const moment = (window as any).moment;
                    const fileName = ctx.sourcePath.split(/[/\\]/).pop()?.replace(/\.md$/, '') || '';
                    
                    // Check if daily note
                    let parsedDaily = moment(fileName, this.settings.dailyNotesFormat, true);
                    if (!parsedDaily.isValid()) {
                        const dailyFormats = ['YYYY-MM-DD', 'YYYY.MM.DD', 'YYYYMMDD', 'YYYY년 MM월 DD일', 'YYYY_MM_DD'];
                        for (const fmt of dailyFormats) {
                            const p = moment(fileName, fmt, true);
                            if (p.isValid()) {
                                parsedDaily = p;
                                break;
                            }
                        }
                    }
                    if (!parsedDaily.isValid()) {
                        const dailyMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
                        if (dailyMatch) {
                            parsedDaily = moment(dailyMatch[1], 'YYYY-MM-DD', true);
                        }
                    }
                    
                    // Check if weekly note
                    let parsedWeekly = moment(fileName, this.settings.weeklyNotesFormat, true);
                    if (!parsedWeekly.isValid()) {
                        const weeklyFormats = ['YYYY-[W]WW', 'YYYY-[W]ww', 'gggg-[W]ww', 'gggg-[W]WW', 'YYYY-Www', 'YYYY-Wwww'];
                        for (const fmt of weeklyFormats) {
                            const p = moment(fileName, fmt, true);
                            if (p.isValid()) {
                                parsedWeekly = p;
                                break;
                            }
                        }
                    }

                    if (parsedWeekly.isValid()) {
                        if (!viewType) viewType = 'weekly';
                        if (!dateStr) dateStr = parsedWeekly.startOf('week').format('YYYY-MM-DD');
                    } else if (parsedDaily.isValid()) {
                        if (!viewType) viewType = 'daily';
                        if (!dateStr) dateStr = parsedDaily.format('YYYY-MM-DD');
                    }
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

    async onunload() {
        const styleEl = document.getElementById('day-planner-pro-styles');
        if (styleEl) styleEl.remove();
        document.body.removeClass('dp-hide-gcal-id');
        if (this.statusBarItem) this.statusBarItem.remove();
        void this.audioCtx?.close();
    }

    /**
     * Fires each reminder once, inside the window [start - offset, start + 1 min). The minute of grace past the start
     * is what makes "at start time" (offset 0) fire at all; reminders whose start passed longer ago are skipped.
     */
    async checkReminders() {
        const type = this.settings.reminderType ?? 'auto';
        if (type === 'off') return;
        const moment = (window as any).moment;
        const now = moment();
        const todayStr = now.format('YYYY-MM-DD');
        if (this.notifiedRemindersDate !== todayStr) {
            this.notifiedRemindersDate = todayStr;
            this.notifiedReminders.clear();
        }
        const leadMs = Math.max(0, this.settings.reminderOffsetMinutes ?? 0) * 60000;
        const GRACE_MS = 60000;

        const due: Array<{ key: string; title: string; start: any }> = [];
        if (this.settings.reminderForTasks) {
            try {
                for (const t of await this.ensureTasksCache()) {
                    if (t.date !== todayStr || !t.startTime || t.statusChar === 'x' || t.statusChar === '-') continue;
                    due.push({
                        key: `task:${t.filePath}:${t.text}:${t.startTime}`,
                        title: cleanTaskTextForDisplay(t.text),
                        start: moment(`${todayStr} ${t.startTime}`, 'YYYY-MM-DD HH:mm')
                    });
                }
            } catch (err) {
                console.warn('Day Planner Pro: reminder task scan failed', err);
            }
        }
        if (this.settings.reminderForGCal && this.settings.enableGoogleCalendar) {
            this.refreshTodayGCalForReminders(now);
            for (const e of this.gcalCache) {
                if (e.isAllDay || e.dateStr !== todayStr) continue;
                due.push({ key: `gcal:${e.calendarId}:${e.id}:${e.start}`, title: e.summary || '(No title)', start: moment(e.start) });
            }
        }

        const nowMs = now.valueOf();
        let chime = false;
        for (const r of due) {
            const startMs = r.start.valueOf();
            if (this.notifiedReminders.has(r.key) || nowMs < startMs - leadMs || nowMs >= startMs + GRACE_MS) continue;
            this.notifiedReminders.add(r.key);
            const mins = Math.round((startMs - nowMs) / 60000);
            const channel = this.deliverReminder(type, r.title, r.start.format('HH:mm'), mins <= 0 ? 'Starting now' : `Starts in ${formatMinutesNice(mins)}`);
            if (channel === 'notice') chime = true;
        }
        // In-app notices only: an OS notification brings the system's own tone. Once per batch.
        if (chime && this.settings.enableReminderSound !== false) this.playReminderChime();
    }

    private audioCtx: AudioContext | null = null;

    /**
     * Playful marimba-style arpeggio, synthesized with Web Audio (no bundled audio file): E5 → G5 → C6, 110ms apart,
     * the last note ringing longest. Each note is a sine body that drops 2% into pitch (a mallet "boing"), plus the
     * marimba's bright ~3.9x partial as a 120ms strike tick; a shared 5.5Hz vibrato adds a little shimmer.
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
            master.connect(ctx.destination);
            const vibrato = ctx.createOscillator();
            const vibratoDepth = ctx.createGain();
            vibrato.frequency.value = 5.5;
            vibratoDepth.gain.value = 3; // ±3Hz
            vibrato.connect(vibratoDepth);

            let end = t0;
            ([[659.25, 0, 0.5], [783.99, 0.11, 0.5], [1046.5, 0.22, 1.1]] as const).forEach(([freq, at, len]) => {
                const t = t0 + at;
                end = Math.max(end, t + len);
                const env = ctx.createGain();
                env.gain.setValueAtTime(0.0001, t);
                env.gain.exponentialRampToValueAtTime(1, t + 0.008);
                env.gain.exponentialRampToValueAtTime(0.0001, t + len);
                env.connect(master);

                const body = ctx.createOscillator();
                body.type = 'sine';
                body.frequency.setValueAtTime(freq * 1.02, t);
                body.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
                vibratoDepth.connect(body.frequency);
                body.connect(env);

                const tick = ctx.createOscillator();
                const tickEnv = ctx.createGain();
                tick.type = 'sine';
                tick.frequency.value = freq * 3.9;
                tickEnv.gain.setValueAtTime(0.0001, t);
                tickEnv.gain.exponentialRampToValueAtTime(0.18, t + 0.004);
                tickEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
                tick.connect(tickEnv).connect(env);

                body.start(t);
                body.stop(t + len + 0.05);
                tick.start(t);
                tick.stop(t + 0.15);
            });
            vibrato.start(t0);
            vibrato.stop(end + 0.1);
            vibrato.onended = () => master.disconnect();
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
    private deliverReminder(type: ReminderType, title: string, timeStr: string, body: string): 'system' | 'notice' {
        const heading = `⏰ ${timeStr} ${title}`;
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
            const [sh, sm] = task.startTime!.split(':').map(Number);
            const [eh, em] = task.endTime!.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;

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
            const [sh, sm] = activeTask.startTime!.split(':').map(Number);
            const [eh, em] = activeTask.endTime!.split(':').map(Number);
            const startMin = sh * 60 + sm;
            const endMin = eh * 60 + em;

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

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
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
        setHapticsEnabled(this.settings.enableMobileHaptics);
        setScanSettings(this.settings);
        this.exclusionKey = JSON.stringify([this.settings.excludePaths, this.settings.excludeMatchMode]);
    }

    async saveSettings() {
        setHapticsEnabled(this.settings.enableMobileHaptics);
        setScanSettings(this.settings);
        await this.saveData(this.settings);
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
            if (viewType === VIEW_TYPES.DAILY) {
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
        const { workspace } = this.app;
        [VIEW_TYPES.COMBINED, VIEW_TYPES.DAILY].forEach(viewType => {
            workspace.getLeavesOfType(viewType).forEach(leaf => {
                const view = leaf.view as any;
                if (view && typeof view.refreshTasks === 'function') {
                    view.refreshTasks(null, forceFetchGCal, skipIfUnchanged);
                }
            });
        });
    }
}
