import { 
    App, 
    Plugin, 
    PluginSettingTab, 
    Setting, 
    WorkspaceLeaf,
    setIcon,
    Notice,
    TFile,
    parseYaml,
    Platform
} from 'obsidian';
import { 
    DayPlannerSettings, 
    DEFAULT_SETTINGS, 
    VIEW_TYPES,
    TaskItem,
    GCalEvent,
    GCAL_MAX_CACHED_RANGES
} from './types';
import { STYLES } from './styles';
import { 
    scanVaultTasks, 
    isSyncConflictPath,
    cleanTaskTextForDisplay,
    parseTaskLine,
    formatMinutesNice,
    setHapticsEnabled
} from './utils';
import {
    deleteGoogleCalendarEvent,
    syncTaskToGCal,
    fetchSingleCalendarEvents
} from './gcalApi';
import { 
    DayPlannerCombinedView, 
    DayPlannerDailyView,
    DayPlannerCodeBlockRenderer
} from './views';
import { PathSelectorModal } from './modals';

export class DayPlannerSettingTab extends PluginSettingTab {
    plugin: DayPlannerPlugin;

    constructor(app: App, plugin: DayPlannerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    addTemplateSuggestSetting(
        containerEl: HTMLElement, 
        name: string, 
        desc: string, 
        value: string, 
        onChange: (value: string) => Promise<void>
    ) {
        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(desc);

        setting.addText(text => {
            const inputEl = text.inputEl;
            inputEl.value = value;
            inputEl.placeholder = 'Search template files...';

            // Create suggestion container
            const suggContainer = document.createElement('div');
            suggContainer.className = 'dp-sugg-container';
            suggContainer.style.display = 'none';
            
            // Append suggestion container to the control element
            const controlEl = inputEl.parentElement;
            if (controlEl) {
                controlEl.style.position = 'relative';
                document.body.appendChild(suggContainer);
            }

            const positionSuggestions = () => {
                const rect = inputEl.getBoundingClientRect();
                const maxHeight = Math.min(280, window.innerHeight - rect.bottom - 12);
                suggContainer.style.position = 'fixed';
                suggContainer.style.left = `${rect.left}px`;
                suggContainer.style.top = `${rect.bottom + 4}px`;
                suggContainer.style.width = `${rect.width}px`;
                suggContainer.style.maxHeight = `${Math.max(140, maxHeight)}px`;
                suggContainer.style.zIndex = '1000';
            };

            const updateSuggestions = () => {
                suggContainer.empty();
                const query = inputEl.value.toLowerCase().trim();
                const allMarkdownFiles = this.app.vault.getMarkdownFiles().filter(f => !isSyncConflictPath(f.path));
                
                const filtered = query === '' 
                    ? allMarkdownFiles 
                    : allMarkdownFiles.filter(f => f.path.toLowerCase().includes(query));
                
                if (filtered.length === 0) {
                    const noItem = suggContainer.createDiv({ 
                        cls: 'dp-sugg-item'
                    });
                    noItem.setText('No matching files found');
                    positionSuggestions();
                    suggContainer.style.display = 'block';
                    return;
                }

                // Show only top 10 matches to keep it clean and performant
                filtered.slice(0, 10).forEach(file => {
                    const item = suggContainer.createDiv({ 
                        cls: 'dp-sugg-item'
                    });
                    item.setText(file.path);
                    
                    item.addEventListener('mousedown', async (e) => {
                        // Prevent input blur before mousedown click registers
                        e.preventDefault();
                        inputEl.value = file.path;
                        suggContainer.style.display = 'none';
                        await onChange(file.path);
                    });
                });
                
                positionSuggestions();
                suggContainer.style.display = 'block';
            };

            inputEl.addEventListener('input', () => {
                updateSuggestions();
            });

            inputEl.addEventListener('focus', () => {
                updateSuggestions();
            });

            inputEl.addEventListener('blur', () => {
                // Delay hiding suggestion to allow mousedown event to complete first
                setTimeout(() => {
                    suggContainer.style.display = 'none';
                }, 150);
            });

            this.plugin.register(() => suggContainer.remove());
        });
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass('dp-settings');

        new Setting(containerEl).setName('General').setHeading();

        new Setting(containerEl)
            .setName('Default Task File Path')
            .setDesc('The default markdown file where tasks will be added when creating them in the planner.')
            .addText(text => text
                .setPlaceholder('Day Planner.md')
                .setValue(this.plugin.settings.defaultTaskFile)
                .onChange(async (value) => {
                    this.plugin.settings.defaultTaskFile = value || 'Day Planner.md';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Exclude Folder/File Paths')
            .setDesc('Paths of folders or files to exclude from task scanning. (e.g. archive/ or templates/Draft.md)')
            .setClass('dp-filter-setting');

        // Filter card
        const filterCard = containerEl.createDiv({ cls: 'dp-filter-card' });

        // Header inside the card: Match [any / all] of the below filter group
        const filterHeader = filterCard.createDiv({ cls: 'dp-filter-header' });
        filterHeader.createSpan({ text: 'Match' });
        
        const matchSelect = filterHeader.createEl('select', { cls: 'dp-filter-select dropdown' });
        matchSelect.createEl('option', { value: 'any', text: 'any' });
        matchSelect.createEl('option', { value: 'all', text: 'all' });
        matchSelect.value = this.plugin.settings.excludeMatchMode || 'any';
        matchSelect.addEventListener('change', async () => {
            this.plugin.settings.excludeMatchMode = matchSelect.value as 'any' | 'all';
            await this.plugin.saveSettings();
        });

        filterHeader.createSpan({ text: 'of the below filter group' });

        // Divider line below header
        filterCard.createEl('hr', { cls: 'dp-filter-divider' });

        // List container
        const filterList = filterCard.createDiv({ cls: 'dp-filter-list' });

        // Render function
        const renderExcludes = () => {
            filterList.empty();
            
            if (!this.plugin.settings.excludePaths || this.plugin.settings.excludePaths.length === 0) {
                filterList.createDiv({ 
                    text: 'No exclusion rules defined. All files will be scanned.' 
                });
                return;
            }

            this.plugin.settings.excludePaths.forEach((path, index) => {
                const item = filterList.createDiv({ cls: 'dp-filter-item' });
                
                // Icon (folder or file depending on content)
                const iconEl = item.createDiv({ cls: 'dp-filter-item-icon' });
                const isFolder = path.endsWith('/') || !path.includes('.');
                setIcon(iconEl, isFolder ? 'folder' : 'file-text');

                // Input
                const input = item.createEl('input', {
                    type: 'text',
                    cls: 'dp-filter-item-input',
                    placeholder: 'e.g. archive/ or templates/Draft.md'
                });
                input.value = path;
                input.addEventListener('change', async () => {
                    this.plugin.settings.excludePaths[index] = input.value.trim();
                    
                    // Update icon dynamically
                    const newPath = input.value.trim();
                    const newIsFolder = newPath.endsWith('/') || !newPath.includes('.');
                    setIcon(iconEl, newIsFolder ? 'folder' : 'file-text');
                    
                    await this.plugin.saveSettings();
                });

                // Delete Button
                const deleteBtn = item.createEl('button', { cls: 'dp-filter-item-delete' });
                setIcon(deleteBtn, 'trash-2');
                deleteBtn.addEventListener('click', async () => {
                    this.plugin.settings.excludePaths.splice(index, 1);
                    await this.plugin.saveSettings();
                    renderExcludes();
                });
            });
        };

        // Footer inside the card
        const filterFooter = filterCard.createDiv({ cls: 'dp-filter-footer' });

        const createFooterBtn = (icon: string, label: string, onClick: () => void, cta = false) => {
            const btn = filterFooter.createEl('button', { cls: cta ? 'mod-cta' : '' });
            setIcon(btn.createSpan({ cls: 'dp-filter-btn-icon' }), icon);
            btn.createSpan({ text: label });
            btn.addEventListener('click', onClick);
        };

        createFooterBtn('plus', 'Add filter group', async () => {
            if (!this.plugin.settings.excludePaths) {
                this.plugin.settings.excludePaths = [];
            }
            this.plugin.settings.excludePaths.push('');
            await this.plugin.saveSettings();
            renderExcludes();
        }, true);

        const openPathSelector = (tab: 'files' | 'folders') => {
            const modal = new PathSelectorModal(this.app, async (selectedPath) => {
                if (!this.plugin.settings.excludePaths) {
                    this.plugin.settings.excludePaths = [];
                }
                if (!this.plugin.settings.excludePaths.includes(selectedPath)) {
                    this.plugin.settings.excludePaths.push(selectedPath);
                    await this.plugin.saveSettings();
                    renderExcludes();
                    new Notice(`Excluded: ${selectedPath}`);
                } else {
                    new Notice('This path is already in the exclusion list.');
                }
            });
            modal.activeTab = tab;
            modal.open();
        };

        createFooterBtn('file-plus', 'Add file', () => openPathSelector('files'));
        createFooterBtn('folder-plus', 'Add folder', () => openPathSelector('folders'));

        renderExcludes();

        new Setting(containerEl).setName('Daily notes').setHeading();
        new Setting(containerEl)
            .setName('Daily Notes Folder Path')
            .setDesc('Obsidian folder path for your daily notes. Leave empty for root folder.')
            .addText(text => text
                .setPlaceholder('Daily/Journal')
                .setValue(this.plugin.settings.dailyNotesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.dailyNotesFolder = value.trim() || '';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
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

        this.addTemplateSuggestSetting(
            containerEl,
            'Daily Note Template',
            'Choose the markdown file in your vault to use as a template for new Daily Notes.',
            this.plugin.settings.dailyNoteTemplate || '',
            async (value) => {
                this.plugin.settings.dailyNoteTemplate = value;
                await this.plugin.saveSettings();
            }
        );

        new Setting(containerEl).setName('Weekly notes').setHeading();
        new Setting(containerEl)
            .setName('Weekly Notes Folder Path')
            .setDesc('Obsidian folder path for your weekly notes. Leave empty for root folder.')
            .addText(text => text
                .setPlaceholder('Weekly/Plans')
                .setValue(this.plugin.settings.weeklyNotesFolder || '')
                .onChange(async (value) => {
                    this.plugin.settings.weeklyNotesFolder = value.trim() || '';
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
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

        this.addTemplateSuggestSetting(
            containerEl,
            'Weekly Note Template',
            'Choose the markdown file in your vault to use as a template for new Weekly Notes.',
            this.plugin.settings.weeklyNoteTemplate || '',
            async (value) => {
                this.plugin.settings.weeklyNoteTemplate = value;
                await this.plugin.saveSettings();
            }
        );

        new Setting(containerEl)
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

        new Setting(containerEl).setName('Theme').setHeading();
        new Setting(containerEl)
            .setName('Local Task Color')
            .setDesc('Color for highlight borders on your local tasks.')
            .addColorPicker(color => color
                .setValue(this.plugin.settings.taskColor || '#ff9f1c')
                .onChange(async (value) => {
                    this.plugin.settings.taskColor = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl).setName('Mobile').setHeading();
        new Setting(containerEl)
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
        new Setting(containerEl).setName('Timeline spacing & hour range').setHeading();
        
        new Setting(containerEl)
            .setName('Separate Combined and Daily View Heights')
            .setDesc('Enable this to adjust the zoom (hour height) of Combined and Daily views independently.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.separateViewHeights || false)
                .onChange(async (value) => {
                    this.plugin.settings.separateViewHeights = value;
                    await this.plugin.saveSettings();
                    this.display(); // Force display refresh to show/hide separate sliders
                })
            );

        if (this.plugin.settings.separateViewHeights) {
            new Setting(containerEl)
                .setName('Timeline Hour Height (Combined View)')
                .setDesc('Adjust the vertical spacing height (in pixels) for 1 hour on Combined View timelines. (Default: 60px)')
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

            new Setting(containerEl)
                .setName('Timeline Hour Height (Daily View)')
                .setDesc('Adjust the vertical spacing height (in pixels) for 1 hour on Daily View timelines. (Default: 60px)')
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
            new Setting(containerEl)
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

        new Setting(containerEl)
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

        new Setting(containerEl)
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



        new Setting(containerEl).setName('Google Calendar integration').setHeading();
        new Setting(containerEl)
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
            new Setting(containerEl)
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

        new Setting(containerEl).setName('Google Calendar OAuth 2.0 (sync & editing)').setHeading();
        containerEl.createEl('p', { 
            text: 'To sync calendars (including private ones) and edit/drag events directly in the timeline, you need to configure your custom OAuth 2.0 web application credentials.'
        });

        new Setting(containerEl)
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

        new Setting(containerEl)
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

        new Setting(containerEl)
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

        const calHeader = containerEl.createDiv();
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

        const calsContainer = containerEl.createDiv();
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
    }
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

    /** Call right before the plugin itself writes `path` during a sync, so the resulting `modify` is not re-synced. */
    markSelfWrite(path: string) {
        this.selfWrites.set(path, (this.selfWrites.get(path) ?? 0) + 1);
        window.setTimeout(() => this.selfWrites.delete(path), 3000);
    }

    private consumeSelfWrite(path: string): boolean {
        const n = this.selfWrites.get(path) ?? 0;
        if (n <= 0) return false;
        if (n === 1) this.selfWrites.delete(path); else this.selfWrites.set(path, n - 1);
        return true;
    }

    async onload() {
        await this.loadSettings();

        const styleEl = document.createElement('style');
        styleEl.id = 'day-planner-pro-styles';
        styleEl.textContent = STYLES;
        document.head.appendChild(styleEl);

        // 오직 통합 뷰와 독립 일간 뷰 두 가지만 등록 및 생성 제어
        this.registerView(VIEW_TYPES.COMBINED, (leaf) => new DayPlannerCombinedView(leaf, this));
        this.registerView(VIEW_TYPES.DAILY, (leaf) => new DayPlannerDailyView(leaf, this));

        this.addRibbonIcon('calendar-glyph', 'Day Planner Pro (Combined View)', () => {
            this.activateView(VIEW_TYPES.COMBINED);
        });
        // Sidebar timeline: right sidebar on desktop, the slide-out right drawer on Obsidian Mobile
        this.addRibbonIcon('calendar-clock', 'Day Planner Pro (Daily Timeline)', () => {
            this.activateView(VIEW_TYPES.DAILY);
        });

        this.addCommand({
            id: 'open-day-planner-pro-combined',
            name: 'Day Planner Pro: Open Combined Tab View',
            callback: () => this.activateView(VIEW_TYPES.COMBINED)
        });
        this.addCommand({
            id: 'open-day-planner-pro-daily',
            name: 'Day Planner Pro: Open Daily Timeline View',
            callback: () => this.activateView(VIEW_TYPES.DAILY)
        });
        this.addCommand({
            id: 'go-to-today',
            name: 'Day Planner Pro: Go to Today',
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
                else new Notice('Open a Day Planner view first.');
            }
        });
        this.addCommand({
            id: 'insert-inline-view',
            name: 'Day Planner Pro: Insert Inline View (dayplanner block)',
            editorCallback: (editor) => {
                const codeblock = "```dayplanner\ntype: daily\nheight: 500px\n```\n";
                editor.replaceSelection(codeblock);
            }
        });

        this.addSettingTab(new DayPlannerSettingTab(this.app, this));

        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar();
        this.registerInterval(window.setInterval(() => this.updateStatusBar(), 30000));

        // Metadata cache index completion event -> full re-scan
        this.registerEvent(this.app.metadataCache.on('resolved', async () => {
            this.tasksCache = await scanVaultTasks(this.app);
            this.updateStatusBar();
            this.refreshActiveViews();
        }));

        // Centralized file modify observers
        let modifyTimeout: number | null = null;
        const userModifiedPaths = new Set<string>();
        this.registerEvent(this.app.vault.on('modify', (file) => {
            if (file instanceof TFile && file.extension === 'md' && !isSyncConflictPath(file.path)) {
                if (!this.consumeSelfWrite(file.path)) userModifiedPaths.add(file.path);
                if (modifyTimeout) window.clearTimeout(modifyTimeout);
                modifyTimeout = window.setTimeout(async () => {
                    const isUserEdit = userModifiedPaths.delete(file.path);
                    await this.updateCacheForFile(file, !isUserEdit);
                }, 350);
            }
        }));

        this.registerEvent(this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md' && !isSyncConflictPath(file.path)) {
                if (modifyTimeout) window.clearTimeout(modifyTimeout);
                modifyTimeout = window.setTimeout(async () => {
                    await this.updateCacheForFile(file);
                }, 350);
            }
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile && file.extension === 'md' && !isSyncConflictPath(file.path)) {
                const deletedTasks = (this.tasksCache || []).filter(t => t.filePath === file.path && t.gcalEventId);
                if (this.tasksCache) {
                    this.tasksCache = this.tasksCache.filter(t => t.filePath !== file.path);
                }
                if (this.settings.enableGoogleCalendar && this.settings.taskSyncCalendarId) {
                    deletedTasks.forEach(task => {
                        deleteGoogleCalendarEvent(this, this.settings.taskSyncCalendarId, task.gcalEventId!).catch(err => {
                            console.error('Failed to delete synced Google Calendar event for removed file task:', err);
                        });
                    });
                }
                this.updateStatusBar();
                this.refreshActiveViews();
            }
        }));

        // Register codeblock processors for tags `dayplanner` and `dayplanner-pro`
        ['dayplanner', 'dayplanner-pro'].forEach(lang => {
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

    async updateCacheForFile(file: TFile, skipGCalSync: boolean = false) {
        if (isSyncConflictPath(file.path)) return;
        const previousFileTasks = (this.tasksCache || []).filter(t => t.filePath === file.path);
        if (!this.tasksCache) {
            this.tasksCache = await scanVaultTasks(this.app);
        } else {
            const content = await this.app.vault.read(file);
            const lines = content.split('\n');
            const fileTasks: TaskItem[] = [];
            for (let i = 0; i < lines.length; i++) {
                const parsed = parseTaskLine(lines[i], file.path, i, this.settings.dailyNotesFormat);
                if (parsed) {
                    fileTasks.push(parsed);
                }
            }
            this.tasksCache = this.tasksCache.filter(t => t.filePath !== file.path).concat(fileTasks);

            if (!skipGCalSync && this.settings.enableGoogleCalendar && this.settings.taskSyncCalendarId) {
                const currentGCalIds = new Set(fileTasks.map(t => t.gcalEventId).filter(Boolean));
                const deletedSyncedTasks = previousFileTasks.filter(t => t.gcalEventId && !currentGCalIds.has(t.gcalEventId));
                for (const task of deletedSyncedTasks) {
                    await deleteGoogleCalendarEvent(this, this.settings.taskSyncCalendarId, task.gcalEventId!);
                }

                const timedTasks = fileTasks.filter(t => t.date && t.startTime && t.endTime);
                for (const task of timedTasks) {
                    let prevTask: TaskItem | undefined;
                    if (task.gcalEventId) {
                        prevTask = previousFileTasks.find(pt => pt.gcalEventId === task.gcalEventId);
                    }
                    if (!prevTask) {
                        prevTask = previousFileTasks.find(pt => pt.lineNumber === task.lineNumber);
                    }
                    if (!prevTask) {
                        prevTask = previousFileTasks.find(pt => pt.text === task.text && pt.date === task.date);
                    }

                    if (prevTask) {
                        const isChanged = 
                            task.text !== prevTask.text ||
                            task.statusChar !== prevTask.statusChar ||
                            task.date !== prevTask.date ||
                            task.startTime !== prevTask.startTime ||
                            task.endTime !== prevTask.endTime ||
                            task.gcalEventId !== prevTask.gcalEventId ||
                            task.priority !== prevTask.priority;
                        
                        if (!isChanged) {
                            continue;
                        }
                    }

                    await syncTaskToGCal(this, task, this.settings.taskSyncCalendarId);
                }
            }
        }
        this.updateStatusBar();
        this.refreshActiveViews();
    }

    async onunload() {
        const styleEl = document.getElementById('day-planner-pro-styles');
        if (styleEl) styleEl.remove();
        if (this.statusBarItem) this.statusBarItem.remove();
    }

    async updateStatusBar() {
        if (!this.statusBarItem) return;

        const now = (window as any).moment();
        const todayStr = now.format('YYYY-MM-DD');
        const currentMinutes = now.hour() * 60 + now.minute();

        if (!this.tasksCache) {
            this.tasksCache = await scanVaultTasks(this.app);
        }
        const todayTasks = this.tasksCache.filter(t => t.date === todayStr && t.startTime && t.endTime);

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
            this.statusBarItem.setText('📅 Day Planner: Complete');
            this.statusBarItem.title = 'All tasks for today are completed or no tasks scheduled.';
        }
    }

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);

        if (data && (data as any).googleCalendarId && (!this.settings.googleCalendars || this.settings.googleCalendars.length === 0)) {
            this.settings.googleCalendars = [{
                id: (data as any).googleCalendarId,
                name: 'Default Calendar',
                color: '#4285f4',
                enabled: true
            }];
        }
        setHapticsEnabled(this.settings.enableMobileHaptics);
    }

    async saveSettings() {
        setHapticsEnabled(this.settings.enableMobileHaptics);
        await this.saveData(this.settings);
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
                const byId = new Map<string, GCalEvent>();
                this.gcalRanges.forEach(r => r.events.forEach(e => byId.set(`${e.calendarId}::${e.id}`, e)));
                this.gcalCache = Array.from(byId.values());
            }
            return changed;
        })();
        this.gcalInflight.set(cacheKey, promise);
        promise.finally(() => this.gcalInflight.delete(cacheKey));
        return promise;
    }

    refreshActiveViews(forceFetchGCal: boolean = false) {
        const { workspace } = this.app;
        [VIEW_TYPES.COMBINED, VIEW_TYPES.DAILY].forEach(viewType => {
            workspace.getLeavesOfType(viewType).forEach(leaf => {
                const view = leaf.view as any;
                if (view && typeof view.refreshTasks === 'function') {
                    view.refreshTasks(null, forceFetchGCal);
                }
            });
        });
    }
}
