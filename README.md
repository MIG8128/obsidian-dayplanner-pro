# Dayloom User Guide

> The user guide for **Dayloom** (version 4.4.3), a time-blocking planner for Obsidian.
> It walks through everything step by step, so you can follow along even if you are new to Obsidian.
>
> 한국어 안내서: [README.ko.md](README.ko.md) (written for 4.0.0)

---

## Contents

1. [What is Dayloom? Key concepts](#1-what-is-dayloom-key-concepts)
2. [Google Calendar OAuth 2.0 setup](#2-google-calendar-oauth-20-setup)
3. [Settings, tab by tab](#3-settings-tab-by-tab)
4. [The side drawer & timeboxing workflow](#4-the-side-drawer--timeboxing-workflow)
5. [Views, search, selection & shortcuts](#5-views-search-selection--shortcuts)
6. [Task syntax & inline code blocks](#6-task-syntax--inline-code-blocks)
7. [FAQ & troubleshooting](#7-faq--troubleshooting)

---

## 1. What is Dayloom? Key concepts

### What it does

Dayloom gathers the **checkbox tasks (`- [ ]`)** in your Obsidian notes and lays them out like a schedule.
Give a task a date and a time and it appears as a block on the timeline; drag the block and **the text in your note changes with it.**
There is no separate database: everything lives in your own Markdown files.

### Features at a glance

| Feature | Description |
| --- | --- |
| 6 views | Daily timeline, N-day (2–14 days), Weekly, Monthly, Board (Kanban / Priority), List |
| Timeboxing | Drag tasks onto time slots; resize blocks with their top / bottom handles |
| Side drawer | Mini calendar, 🎯 Today's Focus, Overdue and Undated tasks, daily Stats; drag tasks straight onto the planner (desktop, every view) |
| Search | `/` turns the header into a search bar; Enter lists every match |
| Multi-select & delete | Ctrl/Cmd+click or box selection in every view; Delete removes tasks and events (with Undo for tasks) |
| Google Calendar | Read, edit and create events; sync timed tasks to a calendar |
| Reminders | In-app or system notifications at the start time (or 5–30 min before), with a chime |
| Inline views | Embed the planner in any note with a ```` ```dayloom ```` code block, with filters |
| Tasks compatible | Uses the Obsidian Tasks emoji syntax (📅 ⏳ 🛫 ✅ ❌ 🔁 🔺⏫🔼🔽⏬) |
| Languages | English, 한국어, 日本語, 简体中文 (follows Obsidian, or pick one in Settings) |

### Two windows: Dayloom and Dayloom Compact

| Name | How to open | What it is |
| --- | --- | --- |
| **Dayloom** | Ribbon calendar icon *Open Dayloom*, or the command `Open Dayloom` | The main tab. On desktop it has the side drawer |
| **Dayloom Compact** | Ribbon clock-calendar icon *Open Dayloom Compact*, or the command `Open Dayloom Compact` | A small view docked in the right sidebar, with 5 bottom tabs (Daily · 2-Day · Monthly · Board · List) |

> 💡 Open the **command palette** with `Ctrl+P` (`Cmd+P` on Mac) and type "Dayloom" to see every Dayloom command.

### Basic concepts

- **A task is one checkbox line.** Write `- [ ] Write the report` and Dayloom picks it up.
- **The date** comes from `⏳ 2026-10-07` (scheduled), then `📅 2026-10-07` (due), then the **daily note's file name**.
  A task written in a daily note such as `2026-10-07.md` belongs to that day without any date of its own.
- **The time** is written as `⏰09:00-10:30`. Timed tasks become blocks on the timeline; untimed ones sit in the "All Day" row.
- **The status** is the character in the checkbox: `[ ]` to do, `[/]` in progress, `[x]` done, `[-]` cancelled.

---

## 2. Google Calendar OAuth 2.0 setup

Google Calendar is **optional**. Every task feature in Dayloom works without it.

### How Dayloom signs in

Dayloom has **no "Sign in with Google" button.** Instead, you enter three values in the settings:

| Setting | What it is | Looks like |
| --- | --- | --- |
| `Google Client ID` | The ID of the OAuth app you create | `xxxx.apps.googleusercontent.com` |
| `Google Client Secret` | That app's secret key | `GOCSPX-xxxx` |
| `Google Refresh Token` | A long-lived token used to get new access tokens | `1//0xxxx` |

With these, Dayloom fetches short-lived access tokens from Google (`https://oauth2.googleapis.com/token`) by itself.
So your job is to **① create an OAuth app in Google Cloud and ② obtain a refresh token once.**
Taken slowly, it takes 20–30 minutes.

> ⚠️ The Google Cloud console changes its layout often. If a menu is named a little differently, look for the item with the same meaning.

### Step 1: Create a Google Cloud project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and sign in with your Google account.
2. Click the **project picker** at the top → **New project**.
3. Name it something recognisable, such as `Dayloom`, and click **Create**.
4. Make sure the new project is selected in the picker at the top.

### Step 2: Enable the Google Calendar API

1. In the left menu, open **APIs & Services → Library**.
2. Search for `Google Calendar API` and open it.
3. Click **Enable**.

### Step 3: Configure the OAuth consent screen

(Newer consoles call this the **Google Auth Platform**.)

1. Open **APIs & Services → OAuth consent screen** (or *Google Auth Platform → Branding*) and click **Get started**.
2. App information:
   - **App name**: `Dayloom` (any name works)
   - **User support email**: your email
3. **Audience / user type**: for a personal Google account, choose **External**.
4. Enter a contact email, agree, and **Create / Save**.
5. Under **Test users**, add **your own Google account's email**.

> ⚠️ **Important: the 7-day expiry**
> While the app is in **Testing**, Google expires calendar refresh tokens **after 7 days**.
> To avoid re-issuing a token every week, switch the app to **Publish app → In production** (on the consent screen / Audience page) *before* you get the token.
> For an app only you use, publishing works without Google's review. Signing in will show a "Google hasn't verified this app" warning: click **Advanced → Go to (app name)** to continue.

### Step 4: Create the OAuth client ID / secret

Dayloom's settings describe these as an *OAuth Web Client*, so create a **Web application** client.

1. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**
   (or *Google Auth Platform → Clients → Create client*).
2. **Application type**: `Web application`
3. **Name**: anything, e.g. `Dayloom Web Client`
4. Under **Authorized redirect URIs**, add exactly this address (Google's own token tool, used in the next step):
   ```
   https://developers.google.com/oauthplayground
   ```
5. Click **Create**. The **Client ID** and **Client secret** appear: copy both somewhere safe.

### Step 5: Get a refresh token (OAuth 2.0 Playground)

1. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground).
2. Click the **gear (⚙️, OAuth 2.0 configuration)** at the top right.
   - Tick **Use your own OAuth credentials**.
   - Paste the **OAuth Client ID** and **OAuth Client secret** from Step 4.
   - Check that **Access type** is `Offline` (required to receive a refresh token).
3. In the box under **Step 1** on the left (*Input your own scopes*), enter this scope:
   ```
   https://www.googleapis.com/auth/calendar.events
   ```
   > Dayloom only **reads, creates, edits and deletes events**, so this scope is enough.
4. Click **Authorize APIs**, sign in with the account you added as a test user, and allow access.
   (If you see the unverified-app warning, click *Advanced → Go to …*.)
5. On the **Step 2** screen, click **Exchange authorization code for tokens**.
6. Copy the **Refresh token** (it starts with `1//0`). That is the last key. 🎉

> 🔒 Treat the client secret and refresh token **like passwords.** Never share them.

### Step 6: Enter the values in Dayloom

1. Open Obsidian **Settings (⚙️) → Community plugins → Dayloom**.
2. Click the **☁️ Google Calendar** tab at the top.
3. Turn on **Enable Google Calendar Integration**.
4. Under **Google Calendar OAuth 2.0 (sync & editing)**, paste:
   - `Google Client ID`
   - `Google Client Secret`
   - `Google Refresh Token`

### Step 7: Add the calendars you want to see

1. On the same tab, click **+ Add Calendar** next to **Google Calendars 📅**.
2. Fill in the new row:
   - **Checkbox**: on = shown, off = hidden
   - **Name**: the name shown in Dayloom (e.g. Work, Personal)
   - **ID**: `primary` (your main calendar) or the calendar's ID
   - **Color**: the color of this calendar's events
3. To find the ID of another calendar:
   Google Calendar on the web → the calendar's **⋮ → Settings and sharing → Integrate calendar → Calendar ID**
   (usually `xxxx@group.calendar.google.com`; the main calendar's ID is your Gmail address).
4. Remove calendars you don't need with **Delete**.

### Step 8: Choose a calendar for task sync (optional)

Pick a calendar under **Task Sync Google Calendar** and every task with a date and a time gets an event in that calendar.

> 💡 **Recommended**: create a **dedicated calendar** in Google Calendar (e.g. `Obsidian Tasks`), add it in Step 7, and pick it here.
> To avoid duplicates, Dayloom **does not show the sync calendar's events as events** on the timeline (the tasks are already there).
> If you pick your main calendar, its meetings will disappear from the timeline too.

### Step 9: Test the connection

1. Open Dayloom.
2. Click the **sync** button (↻) in the header toolbar, or press `F5`.
3. A "✅ …" notice and your events on the timeline mean it works.
4. If it fails, an OAuth error notice appears → see the [FAQ](#7-faq--troubleshooting).

### How sync works

| Action | Result |
| --- | --- |
| **Sync button / `F5` / `Ctrl+R` (`Cmd+R`)** | Re-reads your vault's tasks, refetches the events in view, and pushes timed tasks to the sync calendar (from 60 days ago to 365 days ahead) |
| **Right-click the sync button** | Opens *Synchronize Tasks with Google Calendar 📤*: pick a target calendar and click **Sync Tasks Now** |
| **Editing a task inside Dayloom** (drag, edit dialog, checkbox…) | That one task is updated in Google Calendar right away |
| **Editing the text in a note** | **Not** sent automatically; the next Sync sends it |
| Removing a task's date / time | If Dayloom created its event, the event is deleted from the calendar |
| Deleting a synced task in Dayloom | Its calendar copy is deleted too |

- Synced task lines end with `[gcalId:: …]`. That links the task to its event, so don't delete it.
- Sync only deletes **events Dayloom created.** Your meetings, invitations and other events are never removed by sync.
- Dragging or editing a Google event block on the timeline saves the change to Google Calendar immediately.

---

## 3. Settings, tab by tab

Settings are split into five tabs:

`⚙️ General` · `⏱️ Timeline` · `☁️ Google Calendar` · `🔔 Notifications` · `📱 View/Display`

> Setting names are shown in your chosen language; this guide uses the English names.

### ⚙️ General

| Setting | What it does | Suggested value |
| --- | --- | --- |
| **Language / 언어** | Dayloom's display language: `Auto (Obsidian Default)`, `English`, `한국어`, `日本語`, `简体中文`. Applies immediately | `Auto` |
| **Default Task File Path** | The note new tasks are saved to (quick capture, double-click on the timeline, the `+` button). Created if missing | `Day Planner.md` (default) or `Inbox/Tasks.md` |
| **Excluded Files & Folders** | Folders / notes not scanned for tasks (see below) | Templates, Archive |
| **Daily Notes Folder Path** | Where your daily notes live | e.g. `Daily` |
| **Daily Notes File Format** | Daily note file-name format | `YYYY-MM-DD` |
| **Daily Note Template** | Template for new daily notes | e.g. `Templates/Daily.md` |
| **Weekly Notes Folder Path** | Where your weekly notes live | e.g. `Weekly` |
| **Weekly Notes File Format** | Weekly note file-name format | `gggg-[W]ww` (e.g. `2026-W41`) |
| **Weekly Note Template** | Template for new weekly notes | e.g. `Templates/Weekly.md` |

#### 🔎 Path suggestions

Path fields suggest files and folders from your vault as you type (fuzzy search): typing `dly` already finds the `Daily` folder.
File fields list Markdown notes only; folder fields list folders only.

#### 🚫 Excluded Files & Folders

Rules are managed as **chips**, like Obsidian's search filters.

1. Choose **Exclude** or **Keep** to the left of the input.
2. Type a folder or note name and pick a suggestion, or press `Enter`.
3. The rule is added as a chip:
   - **Click** a chip to switch it between Exclude and Keep.
   - Remove it with its **×**.
   - Paths that don't exist in the vault are shown greyed out and struck through.
4. "Leaving out N of M notes." below shows how many notes the rules exclude.

| Example | Meaning |
| --- | --- |
| `Archive` | The Archive folder and every note in it |
| `Templates/Daily.md` (or `Templates/Daily`) | That one note |
| `**/Templates` | Every folder named `Templates`, at any depth |
| `Daily/*.md` | Notes directly in `Daily` (not its subfolders) |
| `Archive` + **Keep** `Archive/2026` | Exclude the archive except its 2026 folder |

> `*` matches within one folder level, `**` across levels. Matching ignores case.

### ⏱️ Timeline

| Setting | What it does | Suggested value |
| --- | --- | --- |
| **N-day view length** | Days shown in the N-day view (2–14) | `4` |
| **Separate Dayloom and Dayloom Compact Heights** | Zoom the main and Compact views independently | Off |
| **Timeline Hour Height (…)** | Height of one hour in pixels (30–180) | `60` (default); `90`+ for busy days |
| **Timeline Start Hour / End Hour** | The hours shown on the timeline. Also the **working hours used by Fit It In** | e.g. `7` – `23` |
| **Default Task Duration (minutes)** | Length an untimed task gets when dropped on the timeline (1–1440). Also used when several tasks are dropped back to back | `60` (default); `25` for Pomodoro |

> 💡 You can also change the hour height with the **zoom** control (🔍+) in the header toolbar.

### ☁️ Google Calendar

| Setting | What it does |
| --- | --- |
| **Enable Google Calendar Integration** | Turns the integration on or off |
| **Task Sync Google Calendar** | The calendar timed tasks are synced to ([Step 8](#step-8-choose-a-calendar-for-task-sync-optional)) |
| **Google Client ID / Client Secret / Refresh Token** | OAuth credentials ([section 2](#2-google-calendar-oauth-20-setup)) |
| **Google Calendars 📅** | The calendars to show: enabled, name, ID, color, Delete |
| **Local Task Color** | Accent color of your vault tasks, set right next to the calendar colors |

### 🔔 Notifications

| Setting | Options | Notes |
| --- | --- | --- |
| **Reminder Type** | `Off` / `Auto` / `In-app notice` / `System notification` | **Auto (recommended)**: an in-app notice with a chime while Obsidian is in front, a system notification otherwise |
| **Reminder Timing** | `At event start time` (default) / `5`, `10`, `15`, `30 minutes before` | When to remind you |
| **Reminder Sound** | On / off; 🔊 plays a test chime | A short chime with in-app notices (system notifications use your OS sound) |
| **Remind for Tasks** | On / off | Tasks dated today that have a start time (`⏰HH:mm`) |
| **Remind for Google Calendar Events** | On / off | Today's timed Google events (all-day events are skipped) |

> The first time you choose system notifications, your OS asks for permission. **Allow** it, or no notifications arrive.
> Done (`[x]`) and cancelled (`[-]`) tasks are never reminded.

### 📱 View/Display

| Setting | What it does | Suggested value |
| --- | --- | --- |
| **Hide Inline Metadata Fields** | Hides bracketed fields such as `[gcalId:: …]` in the planner, Reading view and Live Preview (your files keep them) | On |
| **Show shortcut button in header** | Shows the shortcuts (?) button in the header toolbar. `?` and `h` work either way | Your choice |
| **Haptic Feedback** | Short vibrations on mobile when completing, switching tabs or dragging | On |

---

## 4. The side drawer & timeboxing workflow

**Timeboxing** means giving each task a block of time: deciding *when* you will do it.
Dayloom's side drawer collects the tasks you haven't scheduled yet, shows today's focus and progress, and lets you drag tasks onto your schedule.

### Opening and closing the drawer

- Available in the **Dayloom** view on **desktop**, in every tab (Daily, N-day, Weekly, Monthly, Board, List).
  It is not shown in Dayloom Compact or on phones and tablets.
- Open / close: press `s`, click the **panel icon** at the end of the header toolbar, or run `Toggle Side Drawer`.
- The drawer's own close button sits at the top right.

### Layout

```
┌ October 2026 ▾        ‹ Today ›    ⨯ ┐  ← mini calendar (hidden in Board view)
│ Su  Mo  Tu  We  Th  Fr  Sa            │
│ ...  6 weeks, dots under busy days ...│
│ [ ☑ Tasks 8 │ ◔ Stats 62% ]           │  ← mode switcher
├───────────────────────────────────────┤
│ [+ Add an undated task (🔺 ⏫ …)]      │  ← quick capture
│ ▾ 🎯 Today's Focus      (1)            │
│ ▾ 🚨 Overdue Tasks      (3) [Roll to today] │
│ ▾ 📂 Undated Tasks      (5)            │
└───────────────────────────────────────┘
```

### Mini calendar

- **Click a day** to show it in the planner. The days currently on screen are highlighted as a band; today is a filled circle.
- **Ctrl/Cmd+click** a day to open its daily note.
- **Dots** under a day: orange = open tasks, glowing red = a 🔺 Highest task, green = everything done, blue = calendar events.
- **‹ ›** or the **mouse wheel** page through months; **Today** jumps back.
- **Click the month name** to fold the calendar to a single week (‹ › then step by week). Dayloom remembers this.
- **Drop a task on a day** to move it to that date (its time is kept).
- In **Board** view the mini calendar is hidden, so the task lists get the full height.

### Tasks mode

- **🎯 Today's Focus**: today's open **🔺 Highest** tasks, in the order of the day. **Drop any task here** to make it a focus task: it moves to today and becomes 🔺 Highest (an undated task gets `📅` today as its due date).
- **🚨 Overdue Tasks**: unfinished tasks dated before today, sorted by priority → oldest date → title, with the missed date in red.
- **📂 Undated Tasks**: tasks without a date (the same list as the Board's *Undated* column), sorted by priority → title.
- Empty sections **fold automatically** and unfold when tasks arrive; click a header to fold it yourself.
- **🔺 Highest** cards have a red edge and glow; **⏫ High** cards an amber one.

### Stats mode

A summary of **the day the planner is showing** (pick another day in the mini calendar):

- A **progress ring**: time completed vs. time planned (timed tasks, cancelled ones excluded). With no timed tasks, it shows tasks done vs. total.
- **Planned / Completed / Remaining** time.
- **Tasks done**, **focus tasks done**, **calendar event time**, and a **per-priority** breakdown.
- A short encouraging note.

Search doesn't change Stats: they always cover the whole day.

### ① Quick capture

1. Type a task in the box at the top of the drawer and press `Enter`.
2. It is added to the **Default Task File Path** note as an undated task, with a "Task created in …" notice.
3. Add a priority emoji to set its priority, e.g. `⏫ Draft the proposal`.
4. Works with IME input (Korean, Japanese, Chinese): one `Enter` saves it.

### ② Set a priority

Click a card's priority badge (a faint flag appears on hover when it has none), or focus a card and press `p`.
Pick from 🔺 Highest, ⏫ High, 🔼 Medium, ○ Normal, 🔽 Low and ⏬ Lowest (arrow keys and `Esc` work too). The emoji is written to your note.

### ③ Drag tasks onto your schedule

| Drop on | Result |
| --- | --- |
| **A time slot** (Daily / N-day / Weekly) | That date and time (15-minute steps). Length: **Default Task Duration** |
| **A day in the Monthly view or the mini calendar** | Date only (time kept; untimed tasks stay all-day) |
| **A day header in Weekly / N-day** | **Fit It In**: the first free slot of that day |
| **A Board column** | Kanban: that column's date (or done); Priority: that priority |
| **🎯 Today's Focus** | Today + 🔺 Highest |
| **The rest of the drawer** | Unscheduled (see ⑤) |

- While dragging, a dashed preview with the time (e.g. `14:30`) shows where it will land.
- Press `j` / `k` while dragging to move to the next / previous day (or week) without dropping.
- Press `Esc` while dragging to cancel.
- Every change shows a notice with an **Undo** button.

### ④ Schedule several tasks back to back

1. **Ctrl/Cmd+click** drawer cards, or **drag a box** over empty space in the task list, to select several.
2. Drag any selected card onto a timeline.
3. They are placed **back to back** from the drop time, in drawer order. Each keeps its own length, or gets the Default Task Duration.
4. Tasks that would start after midnight stay where they were. One Undo reverts the whole drop.

`Esc` clears the drawer selection.

### ⑤ Unschedule

Drag a timeline block, an all-day task, a Monthly task or a Board card **into the drawer** and its date and time are removed: it goes back to Undated.

- The time, `⏳` scheduled date and `📅` due date are all removed.
- **Tasks inside a daily note** keep their date, because it comes from the file name (a notice explains this).
- Google events dragged into the drawer stay in the calendar.
- To prevent accidents, Overdue and Focus cards are only unscheduled when dropped **on the Undated section.**

### ⑥ Triage overdue tasks

- Hover an Overdue card for its buttons:
  `Today` · `Tmrw` (tomorrow) · `+1 wk` · `Undate` (remove the date). Only the date changes; the time is kept.
- **Roll to today** in the section header moves every overdue task to today, with a single Undo.

### ⑦ Keyboard on drawer cards

Press `Tab` to focus a card, then:

| Key | Action |
| --- | --- |
| `Enter` | Edit the task |
| `f` | **Fit It In**: the first free slot within the next 14 days |
| `p` | Set the priority |

Fit It In treats **Timeline Start / End Hour** as working hours, only looks after the current time for today, and avoids existing tasks and Google events. If nothing fits, you get a "No free … slot" notice.

### A suggested daily routine ☀️

1. Open Dayloom in the morning and press `s` for the drawer.
2. Clear **Overdue** with `Roll to today`, `Tmrw` or `Undate`.
3. Pick today's most important task or two and drop them on **🎯 Today's Focus**.
4. Throw anything that comes to mind into **quick capture**.
5. Select today's tasks in **Undated** and drop them on the timeline: they line up back to back.
6. Drag a block's bottom handle to fit the time you expect it to take, and check **Stats** at the end of the day.

---

## 5. Views, search, selection & shortcuts

### Views

| View (tab) | Key | Highlights |
| --- | --- | --- |
| **Daily Timeline** | `d` | One day. Current-time line, progress bar for the task in progress, pinned "All Day" row |
| **N-day View** | `x` | Several days side by side (2–14, change it right in the tab). 2 days on phones |
| **Weekly View** | `w` | One week. **Click a day header** to open that day in Daily |
| **Monthly Calendar** | `m` | A month grid. **Click a date** (or a cell's empty space) to open that day in Daily; **click a week number** to open that week in Weekly |
| **Board** | `b` | Kanban. *Kanban* mode (Undated · Overdue · Today · Tomorrow · Future · Completed) and *Priority* mode (Highest 🔺 … Lowest ⏬) |
| **List View** | `l` | The month as an agenda. While searching, every match from every date |

- The **date pill** at the left of the header (📅 2026-10-07 (Wk 41)) opens the matching daily or weekly note.
- On the **Board**, dragging cards to another column changes their date (Today → today, Tomorrow → tomorrow, Future → 3 days ahead, Overdue → yesterday, Undated → no date, Completed → done). In *Priority* mode it changes their priority. Select several cards to move them together.

### Header (desktop)

```
[📅 date]                [‹ Today ›]  [🔍 ↻ 🔍+ ? ▣]  [+]
```

| Control | What it does |
| --- | --- |
| 📅 Date pill | Open the daily / weekly note |
| ‹ Today › | Previous / today / next |
| 🔍 Search | Search tasks and events (`/`) |
| ↻ Sync | Sync with Google Calendar (right-click: task sync dialog). Shown when Google Calendar is enabled |
| 🔍+ Zoom | Timeline zoom (hour height). Daily / N-day / Weekly |
| ? | Keyboard shortcuts (can be hidden in Settings) |
| ▣ Panel | Open / close the side drawer |
| **+** | New task, or a new Google event (*Add Local Task* / *Add Appointment*) |

In Board view, a **Kanban / Priority** switch joins the header.

### 🔍 Search

1. Press `/` or click the search icon. The header row steps aside and a search field spans its full width.
2. Type: the current view filters as you type. Search looks at task text (including `#tags`), note paths, and event titles, locations and calendar names. Every word must match. A counter shows the matches.
3. Press **Enter** to switch to **List View**, which then shows **every match on every date.**
4. Press **Esc** or click **×** to close search and show everything again.

Undated tasks have no place in List View; while searching, matching undated tasks appear in the drawer's Undated section.

### ✅ Selection and deleting

| To | Do this |
| --- | --- |
| Select one item more (or less) | **Ctrl/Cmd+click** it, in any view (the editor doesn't open) |
| Select several at once | **Drag a box** over empty space: on the timeline, the all-day row, the Board, or the drawer's task list |
| Add a box to the selection | Hold `Ctrl`/`Cmd`/`Shift` while dragging the box |
| Clear the selection | Click empty space, press `Esc`, or click × on the selection bar |
| Move several together | Drag any selected item: the others follow (timeline blocks keep their spacing; drawer cards line up back to back) |
| Delete | Press `Delete` or `Backspace`, or click **Delete** on the "N selected" bar |

- A selection belongs to **one area**: the timeline / Board / Monthly grid, the all-day row, or the drawer. Selecting in another area starts a new selection.
- **Deleting** asks for confirmation first (`Enter` deletes, `Esc` cancels). Task lines are removed from their notes, with **one Undo** for the whole batch. Selected Google Calendar events are deleted from the calendar, as are the calendar copies of deleted synced tasks.
- ⚠️ **Deleted Google Calendar events cannot be restored** with Undo.
- The task edit dialog also has a **Delete** button.

### ⌨️ Keyboard shortcuts

> Shortcuts work once the Dayloom view is active (click it once). They never fire while you type in a text field, quick capture, search or the editor. `Ctrl`/`Cmd`/`Alt` combinations are left to Obsidian, except `Ctrl/Cmd+R`.

| Key | Action |
| --- | --- |
| `j` | Next day / period (phones and compact Board: next column) |
| `k` | Previous day / period (phones and compact Board: previous column) |
| `t` | Go to today |
| `d` / `x` / `w` / `m` / `b` / `l` | Daily / N-day / Weekly / Monthly / Board / List |
| `s` | Open / close the side drawer (desktop) |
| `/` | Search tasks and events |
| `?` or `h` | Show / hide the shortcut list |
| `F5` or `Ctrl+R` (`Cmd+R`) | Sync (re-read tasks + refresh Google Calendar) |
| `Delete` / `Backspace` | Delete the selected items |
| `Esc` | Cancel a drag or box selection → clear the selection → close the search |
| `Ctrl/Cmd + Click` | Add / remove an item from the selection |
| `Ctrl/Cmd + Drag` | Box-select, adding to the selection |
| `Enter` / `f` / `p` (drawer card focused) | Edit / Fit It In / set priority |
| `j` / `k` (while dragging) | Page dates without dropping |

### 🖱️ Mouse

| To | Do this |
| --- | --- |
| Edit a task | Click its block → edit dialog |
| Change its status | Click the checkbox (`[ ]` → `[/]` → `[x]` → `[-]`) |
| See it in its note | Click the block's `↗` |
| Move it | Drag the block to another time or day (15-minute steps) |
| Resize it | Drag the **top / bottom edge handle** |
| Create a task | **Double-click** an empty time slot → type a title → `Enter` (`Esc` cancels). Saved to the Default Task File |
| Create from a menu | **Right-click** an empty slot → `Add Task at HH:MM` / `Add Appointment at HH:MM` (Google) |

> 🔒 **Done (`[x]`) and cancelled (`[-]`) tasks are locked**: they can't be dragged or resized (you can still click to edit them).
> When a block is narrow, location and description are hidden and the title gets up to 3 lines.

### 📱 On phones

- Bottom tabs: **Daily · 2-Day View · Monthly · Board · List**
- A week strip of date pills under the header in Daily and 2-Day View: tap a day to show it.
- **Swipe** left / right to change the date (on the Board, the column).
- **Long-press** a block (about 0.35 s) to pick it up and move it.
- The calendar icon in the header jumps to today.

### Status bar

Obsidian's status bar shows the task in progress (`📅 [Progress: …] … remaining` with a progress bar) or the next one (`📅 [Upcoming: …] … until start`).

---

## 6. Task syntax & inline code blocks

### Basic format

```markdown
- [ ] Task title ⏰09:00-10:30 ⏫ 🔁 every week ⏳ 2026-10-07 📅 2026-10-10
```

| Part | Syntax | Meaning |
| --- | --- | --- |
| Status | `[ ]` `[/]` `[x]` `[-]` | To do / in progress / done / cancelled |
| Time | `⏰09:00-10:30` | Start–end. Without an end (`⏰09:00`) it shows as 30 minutes |
| Priority | 🔺 ⏫ 🔼 🔽 ⏬ | Highest / high / medium / low / lowest (none = normal) |
| Scheduled | `⏳ YYYY-MM-DD` | The date Dayloom writes when it schedules a task |
| Due | `📅 YYYY-MM-DD` | Used when there is no scheduled date |
| Start | `🛫 YYYY-MM-DD` | Obsidian Tasks compatibility |
| Done / cancelled | `✅ YYYY-MM-DD` / `❌ YYYY-MM-DD` | Added automatically when you check a task |
| Recurrence | `🔁 every day`, … | Checking it off creates the next occurrence on a new line |
| Google link | `[gcalId:: …]` | Added by sync (don't write it yourself) |

#### Other ways to write a time

These are recognised as times too:

```markdown
- [ ] 09:00 - 10:00 Meeting          ← time first
- [ ] Meeting [09:00-10:00]          ← in brackets
- [ ] Meeting [startTime:: 09:00 - 10:00]
```

#### Which date counts

`⏳ scheduled` → `📅 due` → **the date in the note's file name** (daily notes).
For example, `- [ ] Workout ⏰07:00-08:00` written in `Daily/2026-10-07.md` becomes a 07:00 block on October 7.

#### Recurrence rules

`every day` (`daily`), `every week` (`weekly`), `every month` (`monthly`), `every year` (`yearly`), `every weekday`, and `every N day/week/month/year` (e.g. `every 3 days`).

### Inline code blocks: ```` ```dayloom ````

Put a Dayloom view anywhere in a note. The command **Insert Inline View (dayloom block)** inserts one for you.

````markdown
```dayloom
type: daily
height: 500px
```
````

> The older names ```` ```dayplanner ```` and ```` ```dayplanner-pro ```` still work.

| Option | Values | Meaning |
| --- | --- | --- |
| `type` | `daily` · `multiDay` · `weekly` · `monthly` · `board` · `list` | The view. Clicking a tab inside the block updates it for you |
| `date` | `YYYY-MM-DD` or `today` | The date to show |
| `height` | `500px`, `80vh`, … (a bare number means px) | Block height. Dragging the block's bottom edge saves the new height |
| `hourHeight` | number | Hour height for this block only |
| `showFilters` | `true` | Start with the filter panel open |
| `collapsedColumns` | `[undated, completed]` | Board columns to keep folded |
| `filters` | (written by the filter panel) | See filters below |

- Inside a **daily note**, a block with no `type` / `date` shows that day.
- Inside a **weekly note**, it shows that week.
- In a block, day headers, dates and week numbers open the daily / weekly **notes** (a block has no tabs to switch to), and List View keeps its own agenda search box.

### 🔍 Inline block filters

Click **🔍 Filter** in the block's header to open a one-line filter bar. The button shows how many filters apply, e.g. `🔍 Filter · 2`.

```
[Match all ▾] [📁 Folder in Work ×] [# Tag contains #urgent ×] [+ Filter]
```

1. **+ Filter** → choose a filter: `Folder` · `File` · `Tag` · `Status` · `Priority` · `Date` · `Text` · `Item type`
2. In the editor row that opens, pick a condition and value, then **Done** (or `Enter`).
3. Click a chip to edit it again, `×` to remove it.
4. **Match all / any / none** at the front sets how the filters combine.
5. For more complex conditions, **+ Filter → Group (match any of…)** adds a bracketed group.

| Filter | Conditions |
| --- | --- |
| Folder | `in` / `not in` + folder (with suggestions) |
| File | `matches` / `does not match` + note name |
| Tag | `contains` / `is` … + `urgent` (the `#` is optional; subtags included) |
| Status | `is` / `is not` + To do · In progress · Completed · Cancelled |
| Priority | `is` / `above` / `below` + priority |
| Date | `is` / `before` / `after` + Today · Tomorrow · This week · This month · a specific date, or `is empty` / `is set` |
| Text | `contains` / `starts with` … + text |
| Item type | Task / Google Calendar appointment |

When the panel closes, the filters are saved in the code block as YAML (you can edit it by hand):

```yaml
filters:
  kind: group
  mode: all
  children:
    - kind: rule
      type: folder
      operator: contains
      value: "Work"
    - kind: rule
      type: status
      operator: notEquals
      value: "completed"
```

> 💡 Tip: put a Board block filtered on `Folder in Projects/Alpha` in a project note and you have a Kanban board for that project.

---

## 7. FAQ & troubleshooting

### Q1. My tasks don't show up in the planner.

- Check that the line starts with `- [ ] ` (`*` bullets and numbered lists are not recognised).
- The timeline only shows tasks **with a date.** Undated tasks are in the drawer's **Undated** section and the Board's **Undated** column.
- Check that the note isn't excluded under Settings → General → **Excluded Files & Folders**.
- Conflict copies made by sync tools (file names containing `.sync-conflict-`) are deliberately ignored.
- Is a search active? Press `Esc` to clear it.
- Press `F5` to re-read the vault.

### Q2. I get "invalid_grant" when Dayloom refreshes the Google token.

The refresh token has expired or been revoked.

- While the consent screen is in **Testing**, tokens **expire after 7 days.** Publish the app **to production**, then get a new token as in [Step 5](#step-5-get-a-refresh-token-oauth-20-playground).
- Changing your Google password, or removing the app's access in your Google account's security settings, also revokes it.

### Q3. I get "unauthorized_client" or "invalid_client".

- Make sure the client ID and secret have no spaces or line breaks around them.
- The refresh token must come from **the same client ID and secret.** A token issued in the Playground without *Use your own OAuth credentials* won't work.

### Q4. Google events are missing, or only some appear.

- Check that the calendar is listed and **ticked** under Settings → ☁️ Google Calendar → **Google Calendars 📅**.
- Events in the **Task Sync Google Calendar** are not shown as events (to avoid duplicates). Don't pick a calendar with meetings as the sync calendar.
- Click the sync button or press `F5` to refresh.

### Q5. I changed a time in my note, but Google Calendar didn't update.

Edits typed directly into notes aren't sent automatically. Press **sync** (or `F5`) once.
Tasks dragged or edited inside Dayloom are sent right away.

### Q6. `[gcalId:: …]` at the end of my tasks looks messy.

It links the task to its event, so don't delete it. Turn on Settings → 📱 View/Display → **Hide Inline Metadata Fields** to hide it on screen only.

### Q7. I don't get reminders.

- Check that Settings → 🔔 Notifications → **Reminder Type** isn't `Off`.
- The task needs **today's date** and a **start time (`⏰HH:mm`)**.
- System notifications need your OS's permission. If you denied it, allow Obsidian's notifications in your OS settings (without permission, Dayloom shows in-app notices instead).
- If you hear no chime, try the 🔊 test button. On phones, you may need to tap the screen once before sound is allowed.

### Q8. Shortcuts don't work.

- Click the Dayloom view once to make it the **active view.**
- While the cursor is in a text field (quick capture, search, the editor…), keys type text instead. That's intentional.
- Pressing `?` again closes the open shortcut list.

### Q9. A block won't move.

- Done and cancelled tasks are locked. Uncheck one to move it again.
- On phones, **long-press** a block to pick it up.

### Q10. I can't see the side drawer.

The drawer is available in the **Dayloom view on desktop**, in every tab. Press `s`, or click the panel icon in the header toolbar.
It is not shown in Dayloom Compact or on phones and tablets.

### Q11. A task from quick capture doesn't appear under Undated.

If the **Default Task File Path** note has a date in its name (e.g. `2026-10-07.md`), its tasks get that date. Use a name without a date (e.g. `Inbox.md`).

### Q12. I moved or deleted something by mistake. Can I undo it?

Yes. Every change shows an **Undo** button in a notice at the top right for a few seconds. Moving or deleting several tasks at once is undone in one step.
The exception: **deleted Google Calendar events** can't be restored from Dayloom.

### Q13. Where are my Google credentials stored? Is it safe?

The client secret and refresh token are stored in your vault at `.obsidian/plugins/obsidian-day-planner-pro/data.json`.
If you publish your vault (e.g. a public GitHub repository), make sure to exclude that file.
To cut off access, remove the app under your Google account → Security → **Third-party apps & services**.

### Q14. Dayloom shows the wrong language.

Settings → General → **Language / 언어**. `Auto` follows Obsidian's own language setting; pick a language to override it.

---

Happy timeboxing! ⏳🧵
