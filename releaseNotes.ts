/**
 * "What's New" content, newest first: WhatsNewModal shows one entry after an update (main.ts) and from the command and
 * the settings button. Add an entry with each release. English, like the rest of the UI copy.
 */
export interface ReleaseNoteItem {
    emoji: string;
    title: string;
    text: string;
}

export interface ReleaseNotes {
    version: string;
    date: string; // YYYY-MM-DD
    features: ReleaseNoteItem[];
    improvements: ReleaseNoteItem[];
    fixes: ReleaseNoteItem[];
}

export const RELEASE_NOTES: ReleaseNotes[] = [
    {
        version: '4.4.10',
        date: '2026-11-03',
        features: [
            {
                emoji: '✌️',
                title: 'Two-finger moves while holding a card',
                text: 'On phones, iPad and touchscreen PCs, hold a task or event with one finger and slide a second '
                    + 'finger: sideways goes to the next or previous day, week or month (the card comes along and drops '
                    + 'there), up and down scrolls the timeline under it.'
            }
        ],
        improvements: [
            {
                emoji: '➡️',
                title: 'Page transitions',
                text: 'j/k, the arrows, Today and swipes switch dates with a full-width push: the old page slides out '
                    + 'as the new one slides in. On touch the page follows your finger and springs back if you let go '
                    + 'early.'
            },
            {
                emoji: '🔍',
                title: 'View switch animation',
                text: 'Between Daily, N-day, Weekly and Monthly the calendar zooms through the date: a day shrinks into '
                    + 'its column or cell, a week into its row, and back. Board and List push the whole view up or down.'
            },
            {
                emoji: '🪟',
                title: 'Popups open from the card',
                text: 'The task and event editor grows out of the card you tapped and closes back into it (into its new '
                    + 'place if you moved it). Dayloom\'s popups no longer dim the page behind them.'
            },
            {
                emoji: '👆',
                title: 'Sideways swipe setting',
                text: 'Settings > View/Display has a switch: Change dates, or Obsidian default to get Obsidian\'s sidebar '
                    + 'swipe back. The description follows the side you pick.'
            },
            {
                emoji: '📅',
                title: 'Calendar paging and notes',
                text: 'The mouse wheel and two-finger trackpad scroll page the sidebar calendar and the drawer\'s mini '
                    + 'calendar month by month, vertically, with the month following your fingers. Days and weeks that '
                    + 'have a daily or weekly note are underlined, and the week numbers have their own column.'
            },
            {
                emoji: '↪️',
                title: 'Moving overdue tasks keeps their history',
                text: 'Move, Pick a date, Roll to today, Unschedule and Fit it in on an overdue task mark the old line '
                    + 'cancelled and add the new one right below it (its Google event moves along), with one Undo.'
            },
            {
                emoji: '🌙',
                title: 'Review today and today\'s note',
                text: 'Review today says when today\'s daily note isn\'t written yet, with a Write it button.'
            },
            {
                emoji: '📱',
                title: 'Touch layout',
                text: 'The touch layout keeps the round pill shapes, just bigger. On phones, Monthly items, all-day chips '
                    + 'and Board cards can be held and moved too, and the settings tab bar shows each tab\'s icon over '
                    + 'its label instead of overlapping.'
            }
        ],
        fixes: [
            {
                emoji: '✋',
                title: 'Holding a card no longer opens the editor',
                text: 'On phones and tablets, a long press picks the card up (move it, or use its resize bars) and '
                    + 'letting go never opens the editor; a quick tap still does. Dragging a card sideways no longer '
                    + 'changes the page.'
            },
            {
                emoji: '🔤',
                title: 'No more vanishing labels on iPhone',
                text: 'The selected settings tab, the Sideways swipe switch, the Stats Day / Week switch and the review '
                    + 'choices keep their text: they now work like the view tabs.'
            },
            {
                emoji: '🔄',
                title: 'No sync conflicts from the Google Calendar cache',
                text: 'The event cache lives in each device\'s local storage instead of gcal-cache.json in the plugin '
                    + 'folder, so sync tools (Self-hosted LiveSync, Syncthing...) no longer create conflicts.'
            }
        ]
    },
    {
        version: '4.4.9',
        date: '2026-10-26',
        features: [
            {
                emoji: '🗓️',
                title: 'Dayloom Calendar',
                text: 'A small month calendar for Obsidian\'s sidebar (command "Open Dayloom Calendar (sidebar)"). A day '
                    + 'opens or creates its daily note, a week number its weekly note; dots show tasks and one dot per '
                    + 'calendar in its colour, and past days or weeks without a note are struck through. It follows the '
                    + 'note you open, and the drawer\'s mini calendar shows the same dots.'
            },
            {
                emoji: '✍️',
                title: 'Smart quick-add',
                text: 'Quick capture, a double-click task on the timeline and a new task\'s description read dates, '
                    + 'times, lengths, deadlines and priority from plain English or Korean ("Report fri 3pm 1h !high", '
                    + '"회의 내일 오후 3시"), with a preview of what was recognized. Text in quotes is left as is.'
            },
            {
                emoji: '🌐',
                title: 'Subscribed calendars',
                text: 'Add .ics / webcal links (Outlook, school, holidays) in Settings > Google Calendar. They show '
                    + 'read-only beside your tasks in every view, without Google; repeats, exceptions and time zones '
                    + 'are handled, and each device keeps its own copy outside the vault.'
            },
            {
                emoji: '🌙',
                title: 'Review today',
                text: 'A Review button on Today\'s Tasks lists what is left: Keep, Tomorrow, Unschedule, Done or '
                    + 'Cancelled for each (or all at once), with one Undo. It can open by itself each evening.'
            },
            {
                emoji: '📊',
                title: 'Week stats',
                text: 'The Stats panel has a Day / Week switch: the week\'s ring, planned and completed time, a bar per '
                    + 'day against your working hours and a warning on overloaded days.'
            },
            {
                emoji: '🧩',
                title: 'Fit It In everywhere',
                text: 'A Fit pill on Overdue and Unscheduled cards, and Fit all on Overdue places every overdue task into '
                    + 'free time (one Undo). Fitting now stays before a task\'s deadline.'
            },
            {
                emoji: '⚠️',
                title: 'Late for the deadline',
                text: 'A task scheduled to end after its deadline gets a ⚠ in every view, edits that make it late warn '
                    + 'you, and the Deadlines section always lists such tasks.'
            },
            {
                emoji: '🔄',
                title: 'Sync after startup',
                text: 'One minute after Obsidian starts, once file sync has settled, Google Calendar syncs once by '
                    + 'itself (on by default, waits while you type).'
            }
        ],
        improvements: [
            {
                emoji: '🫧',
                title: 'Glass and motion',
                text: 'Buttons, tabs, toggles and pop-ups share one calm glass look. Pop-ups grow out of what you '
                    + 'pressed and shrink back into it, the drawer springs in and pushes the view aside, Sync spins '
                    + 'while it works, and the timeline glides to the current time (no motion with reduced motion).'
            },
            {
                emoji: '🖼️',
                title: 'Your theme\'s background',
                text: 'The planner, drawer, List, Board and code blocks show your theme\'s own background, images and '
                    + 'gradients included, on desktop, iPad and iPhone, in the main area and the sidebar.'
            },
            {
                emoji: '⚡',
                title: 'Instant moves',
                text: 'Moving or resizing a card shows the change at once and saves in the background (a failed save '
                    + 'restores it). Dragging shows the whole time range it lands on, and short cards resize from their '
                    + 'top or bottom edge like a window.'
            },
            {
                emoji: '📏',
                title: 'Multi-day bars',
                text: 'Multi-day all-day events are one continuous bar across their days in Week, N-day and Month. '
                    + 'Deadlines at nearby times stack their flags instead of covering each other.'
            },
            {
                emoji: '🗂️',
                title: 'Tidier drawer',
                text: 'Overdue is at the top, empty sections hide, and overdue cards have Fit · Move · Unscheduled; '
                    + 'choose Move\'s options in Settings. Undated is now Unscheduled and includes deadline-only tasks.'
            },
            {
                emoji: '📱',
                title: 'Phones and Compact',
                text: 'The view switcher sits at the top, clear of Obsidian\'s mobile toolbar, and the zoom row is a '
                    + 'tile like Search and Sync.'
            },
            {
                emoji: '📝',
                title: 'Event details in List',
                text: 'List shows a calendar event\'s location, calendar and description under its title.'
            },
            {
                emoji: '🔔',
                title: 'Softer reminder',
                text: 'The reminder sound is a warm felt-mallet chime.'
            }
        ],
        fixes: [
            {
                emoji: '✏️',
                title: 'Apple Pencil',
                text: 'On iPad the Pencil works like a mouse: drag on empty space to select, drag a card to move it, '
                    + 'hold to resize; fingers keep scrolling.'
            },
            {
                emoji: '👉',
                title: 'Swipe on phones and iPad',
                text: 'A sideways swipe in the planner pages dates instead of opening Obsidian\'s sidebars (turn off '
                    + '"Swipe to change dates" to give the swipe back).'
            },
            {
                emoji: '📐',
                title: 'Week and N-day columns',
                text: 'Day headers and the all-day row line up with the hourly columns at any day count, with one '
                    + 'scrollbar in narrow panes.'
            },
            {
                emoji: '📅',
                title: 'Deadline-only tasks',
                text: 'A task with only 📅 no longer shows as an all-day item; scheduling it sets ⏳ and keeps the deadline.'
            },
            {
                emoji: '🚀',
                title: 'Faster start, quicker drops',
                text: 'Obsidian starts about 10 seconds faster with Dayloom Calendar open, and a task dropped from the '
                    + 'drawer shows on the timeline at once.'
            }
        ]
    },
    {
        version: '4.4.8',
        date: '2026-10-20',
        features: [
            {
                emoji: '⌛',
                title: 'Deadlines with a time',
                text: 'A 📅 due date can now have a time ([dueTime:: 17:00], set from the box beside Due Date in the '
                    + 'task editor). Day, N-day and Week draw it as a dashed line with a flag in your task colour; '
                    + 'Month and List show it on its due day. Missed ones turn red, done ones fade.'
            },
            {
                emoji: '✋',
                title: 'Drag deadlines',
                text: 'Drag a deadline to another time or day, onto an All day row (date only), a Month day or a mini '
                    + 'calendar day. A preview shows where it lands; only the 📅 and its time change.'
            },
            {
                emoji: '📋',
                title: 'Deadlines in the drawer and on the Board',
                text: 'A ⌛ Deadlines section lists open tasks by due date with a countdown (D-3 · 09:00, in 2h 15m, '
                    + 'missed). The Board gains a Deadline layout: No Deadline, Missed, Today, Next 7 Days, Later, Completed.'
            },
            {
                emoji: '🔔',
                title: 'More reminders',
                text: 'All-day tasks remind you on the day (and optionally the day before) at a chosen hour. Deadlines '
                    + 'remind you before their time or on their day, and a done task\'s deadline still checks in with ✅.'
            },
            {
                emoji: '☀️',
                title: 'Drop onto All day',
                text: 'Drag any task (timeline card, drawer card, Month item, a whole selection) onto an All day row to '
                    + 'make it untimed on that day. Day view now always shows its All day row.'
            },
            {
                emoji: '⏱',
                title: 'Time estimates',
                text: 'Add ⏱ 30m to a task: it sets the block length when you drop it on the timeline, and the drawer '
                    + 'adds up each section and shows how much free time today has left.'
            },
            {
                emoji: '👆',
                title: 'Touch layout',
                text: 'Bigger buttons, tabs, checkboxes and drawer for a finger. It turns on by itself when you touch a '
                    + 'touchscreen computer and off when you use the mouse (or pick Always in settings).'
            },
            {
                emoji: '🧩',
                title: 'Inline block hours',
                text: 'Inline blocks take hours: 08:00-18:00, picked from the new 🕗 button, and remember their own '
                    + 'N-day count and Board layout.'
            },
            {
                emoji: '↔️',
                title: 'Resizable drawer',
                text: 'Drag the side drawer\'s left edge to set its width; double-click resets it.'
            }
        ],
        improvements: [
            {
                emoji: '🗂️',
                title: 'Overlapping items',
                text: 'Like Google Calendar: items starting together sit side by side, and a later item over a running '
                    + 'one nests on top of it, indented.'
            },
            {
                emoji: '🎨',
                title: 'One card colour',
                text: 'Tasks use your task colour and events their calendar colour, tuned for light and dark themes. '
                    + 'Done tasks keep a dimmed version of the task colour instead of grey or white.'
            },
            {
                emoji: '🗓️',
                title: 'Tidier Month cells',
                text: 'Multi-day events come first as joined bars that keep one row across the week, then all-day '
                    + 'items, then everything else by start time.'
            },
            {
                emoji: '🔔',
                title: 'New reminder sound',
                text: 'A soft two-note glass bell replaces the marimba.'
            },
            {
                emoji: '⚙️',
                title: 'Settings tabs',
                text: 'The settings tabs use the glass segmented control, with icons.'
            },
            {
                emoji: '📌',
                title: 'Board layouts',
                text: 'Kanban is now called Scheduled; the layout switch shows icons (⏳ ⏫ 📅) and names them on hover.'
            },
            {
                emoji: '📱',
                title: 'Phones',
                text: 'Wider ‹ Today › buttons, and no more swipe to change dates (it fought Obsidian\'s sidebar swipe; '
                    + 'it remains a setting for touchscreen laptops). The drawer always docks beside the views.'
            }
        ],
        fixes: [
            {
                emoji: '📅',
                title: 'Due dates kept',
                text: 'New tasks keep the 📅 entered in the editor, and saving a task with only a due date no longer '
                    + 'clears or overwrites it.'
            },
            {
                emoji: '🎯',
                title: 'Drag right after an edit',
                text: 'A task grabbed just after an edit no longer drops near the top of the timeline.'
            },
            {
                emoji: '🧩',
                title: 'Inline blocks',
                text: 'Week and N-day blocks draw every day again, day headers and week numbers open inside the '
                    + 'block, and a block keeps its date when it switches view.'
            }
        ]
    },
    {
        version: '4.4.7',
        date: '2026-10-18',
        features: [
            {
                emoji: '🖐️',
                title: 'Touchscreen laptops',
                text: 'Dayloom tells a finger from the mouse. A finger long-presses a task to pick it up (and to show its '
                    + 'resize bars), so a swipe still scrolls; the mouse keeps its instant drag.'
            },
            {
                emoji: '🔀',
                title: 'Drag across views',
                text: 'Pick a task up in Day, then switch to Month or Board mid-drag (shortcut keys, or a tap on a view '
                    + 'tab with a second finger) and drop it on a day or a column. Every drop target lights up.'
            },
            {
                emoji: '🪟',
                title: 'Floating drawer on narrow screens',
                text: 'When the planner is 900px wide or less, the side drawer opens as a card over the views instead '
                    + 'of squeezing them. A click outside closes it; tasks can still be dropped into it.'
            }
        ],
        improvements: [
            {
                emoji: '🧭',
                title: 'Steady view tabs',
                text: 'The desktop view tabs keep their place and width when you switch views, and the zoom control '
                    + 'opens over the gap instead of pushing them aside.'
            },
            {
                emoji: '🎨',
                title: 'Follows your theme',
                text: 'The header, menus, dialogs, search and selection bars take their colour from your theme '
                    + '(Catppuccin, Nord, …) instead of plain white or graphite.'
            },
            {
                emoji: '🎯',
                title: 'Clearer dragging',
                text: 'Month days and Board columns light up like the drawer sections, the dragged chip sits right '
                    + 'under your pointer, and Board cards drag like every other card.'
            },
            {
                emoji: '📅',
                title: 'Calmer event cards',
                text: 'A Google event\'s location and description are greyed below its title, and narrow cards keep '
                    + 'their details instead of collapsing to the title.'
            },
            {
                emoji: '⌨️',
                title: 'j / k on the Board',
                text: 'On the desktop Board, j and k switch between Kanban and Priority.'
            },
            {
                emoji: '⚡',
                title: 'Faster',
                text: 'Typing in long notes no longer redraws the planner until you pause, scrolling stays smooth after '
                    + 'a drag, the zoom slider saves once per drag, and the plugin file is about 30% smaller.'
            }
        ],
        fixes: [
            {
                emoji: '🗓️',
                title: 'Resizing events in Week',
                text: 'Resizing a Google Calendar event in Week or N-day view keeps it on its own day.'
            },
            {
                emoji: '✋',
                title: 'Two-finger taps while dragging',
                text: 'Tapping a view tab or a date arrow with another finger during a drag now works, and keeps the '
                    + 'task you are holding.'
            }
        ]
    },
    {
        version: '4.4.6',
        date: '2026-10-10',
        features: [
            {
                emoji: '⋯',
                title: 'More sheet on phones',
                text: 'The bottom bar gains a More button. It opens a frosted sheet with Search, Google Calendar Sync '
                    + '(long-press for options), the timeline zoom slider, and the drawer\'s Tasks and Stats panels, so '
                    + 'Overdue and Undated tasks are now reachable on phones. Tap outside, drag it down or press Esc to '
                    + 'close it.'
            },
            {
                emoji: '📅',
                title: 'Today\'s Tasks',
                text: 'The Tasks panel lists everything dated today, timed or not. Today\'s 🔺 Focus tasks sit on top as '
                    + 'highlighted cards with a 🎯 FOCUS pill, never repeated below. Completed tasks stay, greyed out, '
                    + 'so a checkbox can be undone; ↗ opens a task in its note, and dropping a task here moves it to today.'
            },
            {
                emoji: '🧭',
                title: 'One-row desktop header',
                text: 'The view tabs now sit in the header row between the date and the buttons, with shorter names '
                    + '(Day, 4-day, Week, Month, Board, List). They grow with the window and move to their own '
                    + 'full-width row when the pane gets narrow.'
            }
        ],
        improvements: [
            {
                emoji: '📱',
                title: 'Phone header and bottom bar',
                text: 'The phone header is the date, ‹ Today › and +. The bottom bar is two islands: the four views, '
                    + 'and More.'
            },
            {
                emoji: '🎨',
                title: 'Calmer priority colours',
                text: '🔺 and ⏫ cards in the drawer use a softer tint and glow, and completed tasks turn grey '
                    + 'whatever their priority.'
            },
            {
                emoji: '☑️',
                title: 'Simpler checkboxes',
                text: 'A click on a checkbox toggles between done and to-do (any other status becomes done).'
            },
            {
                emoji: '🕘',
                title: 'Tighter phone agenda',
                text: 'In the phone List, times use 24-hour format and sit closer to the edge, leaving more room for '
                    + 'titles.'
            },
            {
                emoji: '📳',
                title: 'Haptics in the More sheet',
                text: 'Buttons, the panel switcher, section folds and zoom steps give a light tick on Android '
                    + '(follows the haptics setting).'
            }
        ],
        fixes: [
            {
                emoji: '🔄',
                title: 'Fewer Syncthing conflicts',
                text: 'Google access tokens are no longer written to data.json every hour, unchanged settings are '
                    + 'never rewritten, and a data.json changed by another device is reloaded. An unreadable data.json '
                    + 'no longer breaks loading or gets replaced by defaults.'
            },
            {
                emoji: '⌨️',
                title: 'Mobile search and the keyboard',
                text: 'Opening search on a phone no longer makes the planner jump or the search bar slip out of place '
                    + 'when the keyboard appears.'
            }
        ]
    },
    {
        version: '4.4.5',
        date: '2026-10-09',
        features: [
            {
                emoji: '📅',
                title: 'One-day agenda on phones',
                text: 'On phones and in the compact sidebar, List shows one day as a clean timeline: times on the left, '
                    + 'colour rails, the length and note of each item, and a summary of tasks done. Page days with the '
                    + 'date pills, a swipe, or the < > buttons.'
            },
            {
                emoji: '⏱️',
                title: 'Live in-progress tracker',
                text: 'The current-task bar in Daily has a new glass look with a progress line, and its time remaining '
                    + 'now updates live. It also appears and disappears on its own when a task starts or ends.'
            },
            {
                emoji: '↩️',
                title: 'Undo for deleted events',
                text: 'Deleting a Google Calendar event, from its editor or the timeline, now shows Undo, which brings '
                    + 'back the same event. The Delete key in the event editor asks first, like the Delete button.'
            }
        ],
        improvements: [
            {
                emoji: '🔺',
                title: 'Consistent priority',
                text: 'Daily, N-day, Weekly, Monthly and all-day tasks show the priority emoji right before the title. '
                    + 'List shows it as a coloured pill after the title.'
            },
            {
                emoji: '🧭',
                title: 'Simpler mobile tabs',
                text: 'The phone and compact tab bar is now Daily, List, Monthly, Board.'
            },
            {
                emoji: '👉',
                title: 'Swipes share with Obsidian',
                text: 'A swipe that starts at the screen edge opens the Obsidian sidebar; one further in changes the date. '
                    + 'Turn off "Swipe to change dates" in settings to leave every swipe to Obsidian; < > buttons '
                    + 'then appear in the header (they always show in the compact sidebar on desktop).'
            }
        ],
        fixes: [
            {
                emoji: '🛠️',
                title: 'Long List titles',
                text: 'A long title no longer pushes the priority and the note name out of view.'
            },
            {
                emoji: '🗓️',
                title: 'Event delete calendar',
                text: 'Deleting an event from its editor always uses the event\'s own calendar, even after the calendar '
                    + 'menu was changed.'
            }
        ]
    },
    {
        version: '4.4.4',
        date: '2026-10-08',
        features: [
            {
                emoji: '📱',
                title: 'Mobile long-press time resizing',
                text: 'Resize handles appear on demand on touch devices. Long-press a block: drag its body to move it, '
                    + 'the top bar to change the start time, the bottom bar to change the end time.'
            },
            {
                emoji: '📟',
                title: 'Tablet support',
                text: 'The full side drawer and its header button now work on iPad and Android tablets.'
            },
            {
                emoji: '✋',
                title: 'Drag and drop on tablets',
                text: 'Hold a task or event, then drag it to another time or day, a Monthly day, a Board column or the '
                    + 'side drawer. A trackpad, mouse or Apple Pencil drags as on desktop.'
            },
            {
                emoji: '👆',
                title: 'Double-tap to create',
                text: 'Double-tap an empty time slot on a phone or tablet to add a task, like a double-click on desktop.'
            }
        ],
        improvements: [
            {
                emoji: '⚡',
                title: 'Tap-outside dismissal',
                text: 'Tapping empty space or pressing Esc cleanly clears the selection and the resize mode, '
                    + 'including in the middle of a drag or resize.'
            },
            {
                emoji: '🚀',
                title: 'Performance optimization',
                text: 'Weekly and Monthly with Google Calendar render far faster, date filters run about 25× faster, '
                    + 'and large vaults scan with less lag.'
            },
            {
                emoji: '📋',
                title: 'Board columns',
                text: 'The fold button is now a chevron at the far left of the column header.'
            },
            {
                emoji: '📳',
                title: 'Long-press feel',
                text: 'A held card lifts slightly with a firmer haptic pulse.'
            }
        ],
        fixes: [
            {
                emoji: '🛠️',
                title: 'Resize handle taps',
                text: 'Tapping a resize handle without moving no longer rewrites the task or shows a "rescheduled" notice.'
            }
        ]
    }
];

/** The notes for a release: an exact match, else the release a test build belongs to (4.4.4.2 → 4.4.4), else the latest */
export function getReleaseNotes(version: string): ReleaseNotes {
    return RELEASE_NOTES.find(notes => notes.version === version)
        ?? RELEASE_NOTES.find(notes => version.startsWith(`${notes.version}.`))
        ?? RELEASE_NOTES[0];
}
