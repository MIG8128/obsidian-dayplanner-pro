import { Notice, Platform } from 'obsidian';
import { isDeadlineOnly, isOverdueTask } from '../../drawer';
import { patchGoogleCalendarEvent, syncEditedTaskToGCal } from '../../gcalApi';
import { t } from '../../i18n';
import { GCalEvent, TaskItem } from '../../types';
import { cleanTaskTextForDisplay, fileNameTaskDate, isTouchLike, minutesToTime, PRIORITY_EMOJI, RescheduledTaskLine, RescheduleTarget, rescheduleTaskLines, timeToMinutes, triggerHaptic, undoRescheduleTaskLines } from '../../utils';
import { grabOffsetIn, hasTouchScreen, isLockedTask, isStylusTouch, isTimedTask, PointerDragSource, PointerDropTarget, reparseAndRefresh, showGCalEventUndoNotice, snapshotTask, TaskUpdates, updateTaskInFile, updateTasksInFile } from './shared';
import { PlannerViewCore } from './viewCore';

/** Drag & drop (native, pointer, touch hold), drag previews, resize, marquee selection, scheduling drops. */
export abstract class DragDropLayer extends PlannerViewCore {
    /**
     * Minutes at `y` px below the top of a timeline column, snapped to 15 minutes. A new block (drawer / all-day task,
     * inline create) is clamped to the visible hours; moving an existing item (`wholeDay`) only to the day itself, so
     * one that starts before the first visible hour is not pushed down the moment it is picked up.
     */
    snapTimelineMinutes(y: number, wholeDay = false): number {
        const ratio = this.getHourHeight() / 60;
        const { startHour, endHour } = this.getTimelineHours();
        const snapped = Math.round((y / ratio) / 15) * 15 + startHour * 60;
        return wholeDay
            ? Math.min(Math.max(snapped, 0), 24 * 60 - 15)
            : Math.min(Math.max(snapped, startHour * 60), endHour * 60 - 30);
    }

    /**
     * Pointer distance below a timeline item's true start line, from its data-start-min (set at render) rather than
     * the card's visible top: a card that starts before the first visible hour is drawn clipped at that hour, and
     * measuring from there shifted the item on pick-up. Falls back to the card's layout top.
     */
    timelineGrabOffset(card: HTMLElement, clientY: number): number {
        const col = card.offsetParent as HTMLElement | null;
        const startMin = Number(card.dataset.startMin);
        if (!col || card.dataset.startMin === undefined || !Number.isFinite(startMin)) return grabOffsetIn(card, clientY);
        const ratio = this.getHourHeight() / 60;
        const startLine = col.getBoundingClientRect().top + col.clientTop + (startMin - this.getTimelineHours().startHour * 60) * ratio;
        return clientY - startLine;
    }

    /** `e` is null for touch drags (no native drag image to hide). */
    initDragPreview(e: DragEvent | null, primaryTaskId: string, clickOffsetMin: number, parentElement: HTMLElement) {
        if (e && !e.dataTransfer) return;

        // Set transparent drag image to hide native ghost preview
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e?.dataTransfer?.setDragImage(img, 0, 0);

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60;

        let primaryStartMin = 0;
        let primaryDateStr = '';

        const primaryTask = this.tasks.find(t => t.id === primaryTaskId);
        if (primaryTask && primaryTask.startTime) {
            primaryStartMin = timeToMinutes(primaryTask.startTime);
            primaryDateStr = primaryTask.date || '';
        } else {
            const primaryGCal = this.plugin.gcalCache.find(ev => ev.id === primaryTaskId);
            if (primaryGCal && primaryGCal.startTimeStr) {
                primaryStartMin = timeToMinutes(primaryGCal.startTimeStr);
                primaryDateStr = primaryGCal.dateStr || '';
            }
        }

        this.clearDragPreview(parentElement);
        this.activePrimaryTaskId = primaryTaskId;
        this.activeDragItems = [];
        this.lastDragSnapKey = '';
        triggerHaptic('light'); // drag start

        const rootSearchContainer = this.containerEl || parentElement;

        this.selectedTaskIds.forEach(id => {
            let startMin = 0;
            // Untimed items (drawer tasks) preview the block they will get on drop
            let durationMin = this.plugin.settings.defaultTaskDuration || 60;
            let itemDateStr = primaryDateStr;
            let title = '';
            let priorityBadge = '';

            const task = this.tasks.find(t => t.id === id);
            if (isLockedTask(task)) return; // done / cancelled tasks never move (see moveSelectedTimelineItems)
            if (task) {
                if (task.startTime && task.endTime) {
                    startMin = timeToMinutes(task.startTime);
                    durationMin = Math.max(15, timeToMinutes(task.endTime) - startMin);
                } else if (task.estimateMinutes) {
                    durationMin = task.estimateMinutes;
                }
                if (task.date) itemDateStr = task.date;
                title = cleanTaskTextForDisplay(task.text);
                if (task.priority && task.priority !== 'normal') {
                    priorityBadge = PRIORITY_EMOJI[task.priority] || '';
                }
            } else {
                const gcal = this.plugin.gcalCache.find(ev => ev.id === id);
                if (gcal?.readOnly) return; // a subscribed event stays where it is
                if (gcal) {
                    if (gcal.startTimeStr && gcal.endTimeStr) {
                        startMin = timeToMinutes(gcal.startTimeStr);
                        durationMin = Math.max(15, timeToMinutes(gcal.endTimeStr) - startMin);
                    }
                    if (gcal.dateStr) itemDateStr = gcal.dateStr;
                    title = gcal.summary || 'Google Event';
                }
            }

            // The visible card only: a cached pane's twin would be dimmed instead, and measuring it forces that hidden pane's layout
            const originalEl = Array.from(rootSearchContainer.querySelectorAll<HTMLElement>(`[data-task-id="${id}"]`))
                .find(el => !el.closest('.is-hidden'));

            // The rendered card's own range (data-start-min / data-end-min) is the item's real duration on that day, also
            // for multi-day events; its offsetHeight is not: cards are clipped to the visible hours
            if (originalEl?.dataset.startMin !== undefined && originalEl.dataset.endMin !== undefined) {
                durationMin = Math.max(15, Number(originalEl.dataset.endMin) - Number(originalEl.dataset.startMin));
            }

            const deltaMin = startMin - primaryStartMin;
            const offsetY = deltaMin * ratio;

            const cardHeight = Math.max(15, Math.round(durationMin * ratio)); // full duration, never the clipped height
            let cardClasses = 'dp-timeline-event selected';
            let bgStyle = '';
            let borderStyle = '';

            if (originalEl) {
                cardClasses = originalEl.className;
                bgStyle = originalEl.style.getPropertyValue('--dp-item-color'); // a Google event's calendar colour (fill)
                borderStyle = originalEl.style.border || '';
                const titleEl = originalEl.querySelector('.dp-task-title') || originalEl.querySelector('span');
                if (titleEl && titleEl.textContent) title = titleEl.textContent;
                const priorityEl = originalEl.querySelector('.dp-priority-mark');
                if (priorityEl && priorityEl.textContent) priorityBadge = priorityEl.textContent;

                originalEl.style.opacity = '0.35';
            }

            this.activeDragItems.push({
                id: id,
                height: cardHeight,
                durationMin: durationMin,
                offsetY: offsetY,
                itemDateStr: itemDateStr,
                title: title,
                classes: cardClasses,
                bgStyle: bgStyle,
                borderStyle: borderStyle,
                priorityBadge: priorityBadge
            });
        });
    }

    /** `wholeDay`: an existing item is being moved (see snapTimelineMinutes); the drop must use the same value */
    updateDragPreview(e: { clientY: number }, currentColumn: HTMLElement, clickOffsetMin: number, wholeDay = false) {
        if (!this.activeDragItems || this.activeDragItems.length === 0) return;

        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60;
        const startHour = this.getTimelineHours().startHour;

        const rect = currentColumn.getBoundingClientRect();
        // Top = the snapped grab point minus how far below the item's start it was grabbed: no jump on pick-up
        const snappedMinutes = this.snapTimelineMinutes(e.clientY - rect.top - clickOffsetMin, wholeDay);

        const primarySnappedY = (snappedMinutes - (startHour * 60)) * ratio;

        const currentDateStr = currentColumn.getAttribute('data-date') || '';
        // One tick per 15-minute slot (or day column) crossed, not per dragover event
        const snapKey = `${currentDateStr}@${snappedMinutes}`;
        if (snapKey !== this.lastDragSnapKey) {
            if (this.lastDragSnapKey) triggerHaptic('light');
            this.lastDragSnapKey = snapKey;
        }
        const primaryItem = this.activeDragItems.find(it => it.id === this.activePrimaryTaskId) || this.activeDragItems[0];
        const primaryDateStr = primaryItem ? (primaryItem.itemDateStr || currentDateStr) : currentDateStr;

        const moment = (window as any).moment;
        const primaryMom = moment(primaryDateStr, 'YYYY-MM-DD');
        const targetMom = moment(currentDateStr, 'YYYY-MM-DD');
        const dayDelta = (targetMom.isValid() && primaryMom.isValid()) ? targetMom.diff(primaryMom, 'days') : 0;

        const daysWrapper = currentColumn.closest('.dp-weekly-days-wrapper') ||
                           (this.containerEl ? this.containerEl.querySelector('.dp-weekly-days-wrapper') : null);

        this.activeDragItems.forEach(item => {
            let targetCol: HTMLElement = currentColumn;
            if (daysWrapper && item.itemDateStr && primaryMom.isValid() && targetMom.isValid()) {
                const itemTargetDateStr = moment(item.itemDateStr, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD');
                const foundCol = daysWrapper.querySelector(`[data-date="${itemTargetDateStr}"]`) as HTMLElement;
                if (foundCol) {
                    targetCol = foundCol;
                }
            }

            let cardContainer = item.previewContainerEl;
            if (!cardContainer || !cardContainer.parentElement) {
                cardContainer = document.createElement('div');
                cardContainer.addClass('dp-drag-preview'); // sized to the hovered column (styles.ts)

                // Same classes as the card (look 1:1); .dp-drag-preview strips the .selected scale (styles.ts)
                const previewCard = cardContainer.createDiv({ cls: item.classes });
                previewCard.style.cssText = `
                    position: absolute !important;
                    top: 0px !important;
                    height: ${item.height}px !important;
                    width: 100% !important;
                    left: 0 !important;
                    box-sizing: border-box !important;
                    opacity: 0.9 !important;
                    border: 2px dashed var(--interactive-accent) !important;
                    padding-top: 0 !important;
                    padding-bottom: 0 !important;
                `;
                if (item.bgStyle) previewCard.style.setProperty('--dp-item-color', item.bgStyle);

                const mainRow = previewCard.createDiv();
                mainRow.style.cssText = 'display: flex; align-items: center; width: 100%; height: 100%; gap: 6px; overflow: hidden; min-width: 0; padding: 0 4px; line-height: 1.2;';
                // The primary card reads out the range it would land on
                if (item.id === primaryItem?.id) mainRow.createSpan({ cls: 'dp-drag-time' });
                const titleSpan = mainRow.createEl('span');
                titleSpan.style.cssText = 'flex-grow: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.85em; font-weight: bold;';
                if (item.priorityBadge) titleSpan.createSpan({ cls: 'dp-priority-mark', text: item.priorityBadge });
                titleSpan.appendText(item.title);

                item.previewContainerEl = cardContainer;
            }

            if (cardContainer.parentElement !== targetCol) {
                targetCol.appendChild(cardContainer);
            }

            const itemTop = primarySnappedY + item.offsetY;
            cardContainer.style.top = `${itemTop}px`;
            cardContainer.style.display = 'block';
            const timeEl = cardContainer.querySelector('.dp-drag-time');
            if (timeEl) timeEl.textContent = `${minutesToTime(snappedMinutes)}–${minutesToTime((snappedMinutes + item.durationMin) % 1440)}`;
        });
    }

    clearDragPreview(parentWrapper: HTMLElement) {
        this.activeDragItems.forEach(item => {
            if (item.previewContainerEl) {
                item.previewContainerEl.remove();
                item.previewContainerEl = undefined;
            }
        });
        this.activeDragItems = [];
        this.activePrimaryTaskId = '';

        // The cards initDragPreview dimmed get the stylesheet's opacity back. Removed, not set to a near-1 value: any
        // opacity below 1 turns every card into its own compositing layer (see .dp-timeline-event in styles.ts)
        const rootSearchContainer = this.containerEl || parentWrapper;
        rootSearchContainer.querySelectorAll<HTMLElement>('.dp-timeline-event').forEach(el => el.style.removeProperty('opacity'));
    }

    /**
     * Leaf views on desktop drag with pointer events instead of native HTML5 drag-and-drop: Chromium delivers no key
     * events during a native drag, so j/k could not page dates mid-drag. Code blocks (inside the editor, whose own
     * mouse handling must keep working) and mobile (long-press drag) keep their existing paths.
     */
    usesPointerMouseDrag(): boolean {
        return this instanceof PlannerViewCore && !Platform.isMobile;
    }

    /**
     * Mouse / pen drag on a timeline card or drawer card: starts after 4px of travel, so clicks still open the editor.
     * Tablets and touchscreen laptops add a touch long-press on the same engine (registerTouchHoldDrag).
     */
    registerMouseDrag(card: HTMLElement, source: PointerDragSource) {
        this.dragSources.set(card, source);
        if (Platform.isMobile) {
            this.registerTouchHoldDrag(card, source); // tablets, and phone cards other than timeline cards
            return;
        }
        if (!this.usesPointerMouseDrag()) return;
        card.setAttribute('draggable', 'false'); // the pointer engine replaces native drag-and-drop here
        this.attachMousePenDrag(card, source);
        this.registerTouchHoldDrag(card, source); // touchscreen laptops: a finger drags as on a tablet
    }

    /**
     * The pressed card, or the card that replaced it in a re-render (same item, same drag kind / origin), preferring
     * the one under the press point. Null when the item is gone from the view: no drag starts.
     */
    protected liveDragCard(card: HTMLElement, source: PointerDragSource, x: number, y: number): { card: HTMLElement; source: PointerDragSource } | null {
        if (card.isConnected) return { card, source };
        const idOf = (el: HTMLElement) => el.dataset.selectId ?? el.dataset.taskId ?? el.dataset.drawerTaskId;
        const id = idOf(card);
        if (!id) return null;
        const sameKind = (s?: PointerDragSource) => !!s && s.kind === source.kind
            && (s.kind === 'timeline' || s.origin === (source as Extract<PointerDragSource, { kind: 'task' }>).origin);
        const matches = (el: HTMLElement | null | undefined): el is HTMLElement =>
            !!el && idOf(el) === id && sameKind(this.dragSources.get(el));
        const underPress = (card.ownerDocument.elementFromPoint(x, y) as HTMLElement | null)
            ?.closest<HTMLElement>('[data-task-id], [data-select-id], [data-drawer-task-id]');
        const next = matches(underPress) ? underPress
            : Array.from(this.containerEl.querySelectorAll<HTMLElement>('[data-task-id], [data-select-id], [data-drawer-task-id]')).find(matches);
        return next ? { card: next, source: this.dragSources.get(next)! } : null;
    }

    /** The mouse / pen half of registerMouseDrag: a press that travels 4px starts beginPointerDrag (touch is ignored; an iPad Pencil uses both this and the hold) */
    protected attachMousePenDrag(card: HTMLElement, source: PointerDragSource) {
        card.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.pointerType === 'touch' || e.button !== 0 || this.activePointerDrag) return;
            if ((e.target as HTMLElement).closest('.dp-custom-cb, .dp-task-link-btn, .dp-resize-handle, .dp-drawer-card-actions, .dp-priority-trigger')) return;
            const doc = card.ownerDocument;
            const { pointerId, clientX: startX, clientY: startY } = e;
            const stop = () => {
                doc.removeEventListener('pointermove', onMove);
                doc.removeEventListener('pointerup', stop);
                doc.removeEventListener('pointercancel', stop);
            };
            const onMove = (ev: PointerEvent) => {
                if (ev.pointerId !== pointerId) return;
                if ((ev.buttons & 1) === 0) { stop(); return; } // released outside the window: no pointerup came
                if (this.activePointerDrag) { stop(); return; } // an iPad Pencil's hold lifted the card first
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
                stop();
                // A render (e.g. the save of an edit) can land between press and drag start: drag the redrawn card.
                // The detached one measured as if at the window's top, so every drop landed near the visible top.
                const live = this.liveDragCard(card, source, startX, startY);
                if (live) this.beginPointerDrag(live.card, live.source, startY, ev);
            };
            doc.addEventListener('pointermove', onMove);
            doc.addEventListener('pointerup', stop);
            doc.addEventListener('pointercancel', stop);
        });
    }

    /**
     * Tablet drag (leaf views; on phones every card but timeline cards, which have their own long-press drag): holding a card still for 320ms
     * lifts it (haptic, slight scale-up), then the finger drives the desktop drag engine, so every desktop drop target
     * works: timelines, day cells and headers, Board columns, the side drawer. Moving before the hold completes leaves
     * the touch to scrolling; lifting the finger without moving puts the card back down without a drop. Box selection
     * is mouse / Pencil only (registerMarqueeSelection ignores touch), so a finger on empty space always scrolls.
     * An iPad Pencil gets both: it drags like a mouse, and a still hold opens position & resize mode like a finger.
     */
    registerTouchHoldDrag(card: HTMLElement, source: PointerDragSource) {
        // Phone timeline cards have their own long-press drag (registerLongPressDrag); every other phone card (Monthly
        // items, all-day chips, Board cards) holds to move here, so a hold never falls through to a click (the editor)
        if (!hasTouchScreen() || !(this instanceof PlannerViewCore) || (this.useCompactLayout() && source.kind === 'timeline')) return;
        const HOLD_MS = 320;
        const SLOP = 8; // px of finger jitter tolerated during the hold
        if (Platform.isMobile) {
            card.setAttribute('draggable', 'false'); // iPadOS would otherwise start a native drag on the same long-press
            this.attachMousePenDrag(card, source); // a trackpad, mouse or Pencil drags as on desktop
        }
        // Timeline cards have a position & resize mode: the hold activates the card (resize bars), and a later touch on
        // the active card's body drags at once
        const refId = source.kind === 'timeline' ? source.refId : null;
        let holdTimer = 0, pointerId = -1, lifted = false, armed = false;
        let startX = 0, startY = 0, lastX = 0, lastY = 0;

        const detach = () => {
            window.clearTimeout(holdTimer);
            holdTimer = 0;
            card.removeEventListener('pointermove', onMove);
            card.removeEventListener('pointerup', detach);
            card.removeEventListener('pointercancel', detach);
        };
        const lift = (fromHold: boolean) => {
            detach();
            this.guardClickAfterTouchHold(pointerId); // the release must not open the editor, even if no drag starts
            if (!card.isConnected || this.activePointerDrag) return;
            lifted = true;
            card.addClass('dp-touch-lifted');
            if (fromHold && refId) this.setTouchActive(card, refId); // reveals the resize bars
            const at = new PointerEvent('pointermove', { pointerId, pointerType: 'touch', clientX: lastX, clientY: lastY, buttons: 1, isPrimary: true });
            this.beginPointerDrag(card, source, startY, at, {
                dropRequiresMove: fromHold,
                onEnd: (moved) => {
                    lifted = false;
                    card.removeClass('dp-touch-lifted');
                    // A finished move ends the mode; a hold released in place keeps it (the bars stay up)
                    if (moved || !fromHold) this.clearTouchActive();
                }
            });
            if (fromHold) triggerHaptic('lift'); // after the engine's own light pulse, which this one replaces
        };
        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            lastX = e.clientX;
            lastY = e.clientY;
            if (Math.hypot(lastX - startX, lastY - startY) <= SLOP) return;
            if (armed) lift(false); // the active card's body: drag without another hold
            else detach(); // a scroll or swipe, not a drag
        };

        card.addEventListener('pointerdown', (e: PointerEvent) => {
            if (!isTouchLike(e) || !e.isPrimary || this.activePointerDrag) return;
            armed = false;
            if ((e.target as HTMLElement).closest('.dp-custom-cb, .dp-task-link-btn, .dp-resize-handle, .dp-drawer-card-actions, .dp-priority-trigger')) return;
            detach();
            pointerId = e.pointerId;
            startX = lastX = e.clientX;
            startY = lastY = e.clientY;
            armed = !!refId && this.isTouchActive(refId);
            card.addEventListener('pointermove', onMove);
            card.addEventListener('pointerup', detach);
            card.addEventListener('pointercancel', detach);
            if (!armed) holdTimer = window.setTimeout(() => lift(true), HOLD_MS);
        });
        // Once lifted (or on the active card, whose touch-action is none), finger moves drive the drag, not a scroll;
        // a Pencil never scrolls a card: it drags at once, like a mouse
        card.addEventListener('touchmove', (e) => { if ((lifted || armed || isStylusTouch(e)) && e.cancelable) e.preventDefault(); }, { passive: false });
        card.addEventListener('contextmenu', (e) => { if (holdTimer || lifted) e.preventDefault(); });
    }

    /**
     * One desktop drag session. Listens on the document (the source card may be re-rendered away mid-drag), hit-tests
     * the pointer each frame, shows the 15-minute snap preview over timeline columns, a dashed outline on monthly day
     * cells (single tasks) and on the side drawer (unschedule), auto-scrolls near the timeline's top / bottom edge,
     * and drops on release. j/k re-render the view under the drag; render() calls refresh() so it re-targets.
     */
    protected beginPointerDrag(card: HTMLElement, source: PointerDragSource, startY: number, ev: PointerEvent,
        opts: { dropRequiresMove?: boolean; onEnd?: (moved: boolean) => void } = {}) {
        const doc = card.ownerDocument;
        const win = doc.defaultView ?? window;
        const pointerId = ev.pointerId;
        let x = ev.clientX;
        let y = ev.clientY;
        // Touch lifts start without travel: a release on the spot puts the card back instead of dropping it in place
        const originX = x, originY = y;
        let movedSinceStart = false;
        let grabOffset: number;
        let previewRoot: HTMLElement;
        let group: TaskItem[] = []; // task drags: the tasks that move (several for a drawer multi-selection)

        if (source.kind === 'timeline') {
            if (!this.selectedTaskIds.has(source.refId)) {
                this.selectedTaskIds.clear();
                this.selectedTaskIds.add(source.refId);
                this.selectionZone = 'main';
                source.previewRoot.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                card.addClass('selected');
            }
            // Done / cancelled tasks swept into a marquee selection ride along nowhere: drop them from this drag
            this.tasks.forEach(t => { if (isLockedTask(t) && this.selectedTaskIds.has(t.id)) this.selectedTaskIds.delete(t.id); });
            grabOffset = this.timelineGrabOffset(card, startY); // from the item's true start line, scale-free
            previewRoot = source.previewRoot;
            this.initDragPreview(null, source.refId, grabOffset, previewRoot);
        } else {
            // A drawer card inside a drawer multi-selection (Ctrl / Cmd + click) takes the whole selection along: on a
            // timeline they land back to back (scheduleTasksSequentially). Any other card drags alone.
            const fromDrawer = source.origin === 'focus' || source.origin === 'today' || source.origin === 'overdue' || source.origin === 'undated';
            const selected = this.selectedTaskIds.has(source.task.id);
            // Board (touch): a selected card carries every selected card, as the native Board drag does
            const selection = fromDrawer && selected ? this.drawerSelection()
                : source.origin === 'board' && selected ? this.tasks.filter(t => this.selectedTaskIds.has(t.id)) : [];
            group = selection.length > 1 ? selection : [source.task];
            this.selectedTaskIds.clear();
            group.forEach(task => this.selectedTaskIds.add(task.id));
            this.selectionZone = group.length > 1 ? (fromDrawer ? 'drawer' : 'main') : null;
            grabOffset = 10; // the new block's top sits just above the pointer
            previewRoot = this.containerEl;
            this.initDragPreview(null, group[0].id, grabOffset, previewRoot);
            if (group.length > 1) this.stackDragPreview(group);
            card.addClass('is-dragging');
        }
        // Floating title chip wherever no snap preview is drawn (over the drawer, a day cell, or nothing)
        // A done / cancelled Board card has no preview item: its own title then
        const ghostText = this.selectedTaskIds.size > 1 ? `${this.selectedTaskIds.size} items`
            : (this.activeDragItems[0]?.title ?? (source.kind === 'task' ? cleanTaskTextForDisplay(source.task.text) : ''));
        const ghost = doc.body.createDiv({ cls: 'dp-drag-ghost', text: ghostText });
        this.activeDragClickOffsetMin = grabOffset;
        // On this view, not body: a body class that `* { cursor }` keys off restyled the whole app (the open note's
        // editor included) at every drag start and end. Drops only land inside this view anyway (locate()).
        const dragHost = this.containerEl;
        dragHost.addClass('dp-pointer-dragging');

        // Undated drawer cards have no date to clear; everything else can be dropped back into the drawer
        const canUnschedule = source.kind === 'timeline' || source.origin !== 'undated';
        // Overdue / Focus cards start inside the drawer: only the Undated section clears their date, so a short slip
        // inside the drawer never unschedules anything. Drags from the timeline / calendar may land anywhere on it.
        const undatedOnly = source.kind === 'task' && (source.origin === 'overdue' || source.origin === 'focus' || source.origin === 'today' || source.origin === 'deadline');
        let target: PointerDropTarget | null = null;
        let scroller: HTMLElement | null = null;
        let frame = 0;
        let scrollFrame = 0;

        const locate = (): PointerDropTarget | null => {
            const hit = doc.elementFromPoint(x, y) as HTMLElement | null;
            if (!hit || !this.containerEl.contains(hit)) return null;
            // A day of the drawer's mini calendar: the task moves to that date (its time is kept)
            const miniDay = hit.closest<HTMLElement>('.dp-side-drawer.is-open .dp-mc-day[data-date]');
            if (miniDay) return { kind: 'day', el: miniDay, dateStr: miniDay.dataset.date! };
            const drawer = hit.closest<HTMLElement>('.dp-side-drawer.is-open');
            if (drawer) {
                // Today's Focus: the tasks become 🔺 Highest (undated ones also get today as due date)
                const focusSection = hit.closest<HTMLElement>('.dp-drawer-focus-slot[data-section="focus"]');
                if (focusSection) return { kind: 'focus', el: focusSection, dateStr: '' };
                // Today's Tasks: moved to today (time kept), like a mini calendar day
                const todaySection = source.kind === 'timeline' || source.origin !== 'today'
                    ? hit.closest<HTMLElement>('.dp-drawer-section[data-section="today"]') : null;
                if (todaySection) return { kind: 'day', el: todaySection, dateStr: (window as any).moment().format('YYYY-MM-DD') };
                if (!canUnschedule) return null;
                const undatedSection = drawer.querySelector<HTMLElement>('.dp-drawer-section[data-section="undated"]');
                if (undatedOnly && !(undatedSection && undatedSection.contains(hit))) return null;
                // The Undated section lights up as the destination, wherever over the drawer the task is held
                return { kind: 'drawer', el: undatedSection ?? drawer, dateStr: '' };
            }
            // A timeline drag carried into Month / Board (j/k or a tab shortcut mid-drag) lands there too; a Google event
            // has no Board column
            const boardCol = source.kind === 'task' || !source.isGCal ? hit.closest<HTMLElement>('.dp-kanban-column[data-col-id]') : null;
            if (boardCol) return { kind: 'board', el: boardCol, dateStr: boardCol.dataset.colId! };
            const dayHeader = source.kind === 'task' ? hit.closest<HTMLElement>('.dp-grid-header[data-date]') : null;
            if (dayHeader) return { kind: 'fit', el: dayHeader, dateStr: dayHeader.dataset.date! };
            // An all-day row (Daily / N-day / Weekly): the tasks become untimed on that day
            const allDay = hit.closest<HTMLElement>('[data-allday-date]');
            if (allDay) return { kind: 'allday', el: allDay, dateStr: allDay.dataset.alldayDate! };
            const col = hit.closest<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events');
            // The Daily column carries no data-date (see renderDailyTimeline): it always shows the current date
            if (col) return { kind: 'timeline', el: col, dateStr: col.dataset.date || this.currentDate.format('YYYY-MM-DD') };
            const cell = hit.closest<HTMLElement>('.dp-grid-cell[data-date]');
            return cell ? { kind: 'day', el: cell, dateStr: cell.dataset.date! } : null;
        };
        const update = () => {
            frame = 0;
            const next = locate();
            if (target && target.kind !== 'timeline' && target.el !== next?.el) target.el.removeClass('dp-drop-target');
            target = next;
            if (next?.kind === 'timeline') {
                scroller = next.el.closest<HTMLElement>('.dp-content');
                this.updateDragPreview({ clientY: y }, next.el, grabOffset, source.kind === 'timeline');
            } else {
                this.activeDragItems.forEach(item => { if (item.previewContainerEl) item.previewContainerEl.style.display = 'none'; });
                next?.el.addClass('dp-drop-target');
            }
            ghost.toggleClass('is-over-timeline', next?.kind === 'timeline'); // the snap preview takes over there
            if (next?.kind !== 'timeline') placeGhost();
        };
        // The chip sits centered on the cursor / finger, as if held there; over the open drawer it narrows to the
        // drawer's width. It is only kept inside the window, never pinned inside a drop zone away from the pointer.
        const placeGhost = () => {
            const drawerRect = this.containerEl.querySelector<HTMLElement>('.dp-side-drawer.is-open')?.getBoundingClientRect();
            const overDrawer = !!drawerRect && x >= drawerRect.left && x <= drawerRect.right && y >= drawerRect.top && y <= drawerRect.bottom;
            ghost.style.maxWidth = `${overDrawer ? Math.max(48, Math.min(220, drawerRect!.width - 8)) : 220}px`;
            const gx = Math.max(4, Math.min(x - ghost.offsetWidth / 2, win.innerWidth - ghost.offsetWidth - 4));
            const gy = Math.max(4, Math.min(y - ghost.offsetHeight / 2, win.innerHeight - ghost.offsetHeight - 4));
            ghost.style.transform = `translate(${gx}px, ${gy}px)`;
        };
        const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };

        const EDGE = 48; // px band at the timeline scroller's top / bottom that auto-scrolls
        const autoScroll = () => {
            scrollFrame = win.requestAnimationFrame(autoScroll);
            if (!scroller?.isConnected) return;
            const r = scroller.getBoundingClientRect();
            if (x < r.left || x > r.right || y < r.top - EDGE || y > r.bottom + EDGE) return;
            const step = y < r.top + EDGE ? -10 : y > r.bottom - EDGE ? 10 : 0;
            if (step) {
                scroller.scrollTop += step;
                schedule();
            }
        };

        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            if ((e.buttons & 1) === 0) { void finish(false); return; } // released outside the window: cancel, don't drop
            x = e.clientX;
            y = e.clientY;
            if (!movedSinceStart && Math.hypot(x - originX, y - originY) > 6) movedSinceStart = true;
            schedule();
        };
        const onUp = (e: PointerEvent) => { if (e.pointerId === pointerId) void finish(movedSinceStart || !opts.dropRequiresMove); };
        const onCancel = (e: PointerEvent) => { if (e.pointerId === pointerId) void finish(false); };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation(); // the view's own Esc handler never sees this press
            void finish(false); // synchronous without a landing
            this.dismissSelection(); // the drag selected the card: Esc leaves nothing highlighted
        };
        // Touch drags: a second finger taps the planner's controls (view tabs, date arrows, day pills) while the first
        // one holds the task. Browsers make no click of a tap while another finger is down, so a tap (lifted within
        // 10px) clicks the control here; should the browser click it after all, that click is dropped.
        let otherTap: { id: number; x: number; y: number; el: HTMLElement } | null = null;
        const onOtherDown = (e: PointerEvent) => {
            if (e.pointerId === pointerId || e.pointerType !== 'touch') return;
            const target = e.target as HTMLElement | null;
            const el = target?.closest('select') ? null : target?.closest<HTMLElement>('.dp-tab, .dp-day-pill, button, [role="button"], .clickable-icon');
            otherTap = el && this.containerEl.contains(el) ? { id: e.pointerId, x: e.clientX, y: e.clientY, el } : null;
        };
        const onOtherUp = (e: PointerEvent) => {
            const tap = otherTap;
            if (!tap || e.pointerId !== tap.id) return;
            otherTap = null;
            if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10 || !tap.el.isConnected) return;
            const dropNative = (ce: MouseEvent) => {
                if (ce.isTrusted && tap.el.contains(ce.target as Node)) { ce.stopPropagation(); ce.preventDefault(); }
            };
            doc.addEventListener('click', dropNative, true);
            win.setTimeout(() => doc.removeEventListener('click', dropNative, true), 500);
            tap.el.click();
        };
        // No scroll or pinch-zoom while a finger drags: a second finger starting one would cancel the dragging finger
        const holdStill = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
        const teardown = () => {
            this.activePointerDrag = null;
            doc.removeEventListener('pointermove', onMove);
            doc.removeEventListener('pointerup', onUp);
            doc.removeEventListener('pointercancel', onCancel);
            doc.removeEventListener('keydown', onKey, true);
            doc.removeEventListener('scroll', schedule, true);
            doc.removeEventListener('pointerdown', onOtherDown, true);
            doc.removeEventListener('pointerup', onOtherUp, true);
            doc.removeEventListener('touchmove', holdStill, true);
            if (frame) win.cancelAnimationFrame(frame);
            win.cancelAnimationFrame(scrollFrame);
            dragHost.removeClass('dp-pointer-dragging');
            ghost.remove();
            card.removeClass('is-dragging');
            opts.onEnd?.(movedSinceStart);
        };
        const finish = async (drop: boolean) => {
            if (frame) {
                win.cancelAnimationFrame(frame);
                update(); // land where the pointer is now, not where the last frame left it
            }
            const landing = drop ? target : null;
            teardown();
            (target as PointerDropTarget | null)?.el.removeClass('dp-drop-target');
            this.clearDragPreview(previewRoot);
            // The release would click whatever it ends on (a card opens its editor, a column clears the selection)
            const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
            doc.addEventListener('click', swallow, { capture: true, once: true });
            win.setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);

            // A card keeps the task it was drawn with; a re-read of its note since then (the background calendar sync
            // writing a gcalId back) cached fresh copies, and an edit of the old copy would only show after the next re-read
            const current = (task: TaskItem) => this.plugin.tasksCache?.find(t => t.id === task.id) ?? task;
            group = group.map(current);
            // Tasks being dragged, resolved before the selection is cleared (a timeline drag may carry GCal events too)
            const draggedTasks = source.kind === 'task'
                ? group
                : this.tasks.filter(t => this.selectedTaskIds.has(t.id));
            if (source.kind === 'task') group.forEach(task => this.selectedTaskIds.delete(task.id));
            if (!landing) return;

            if (landing.kind === 'focus') {
                if (source.kind === 'timeline') this.selectedTaskIds.clear();
                await this.promoteToFocus(draggedTasks);
                return;
            }
            if (landing.kind === 'drawer') {
                if (source.kind === 'timeline') {
                    if (this.selectedTaskIds.size > draggedTasks.length) {
                        new Notice('Google Calendar events stay on the calendar; only tasks return to Unscheduled.');
                    }
                    this.selectedTaskIds.clear();
                }
                await this.unscheduleTasks(draggedTasks);
                return;
            }
            if (landing.kind === 'fit') {
                for (const task of group) await this.fitTaskIn(task, [landing.dateStr]);
                return;
            }
            if (landing.kind === 'allday') {
                if (source.kind === 'timeline') {
                    if (this.selectedTaskIds.size > draggedTasks.length) new Notice(t('drag.eventsStayTimed'));
                    this.selectedTaskIds.clear();
                }
                const fromDeadline = source.kind === 'task' && source.origin === 'deadline';
                await this.moveTasksToAllDay(source.kind === 'task' ? group : draggedTasks, landing.dateStr, fromDeadline);
                return;
            }
            if (landing.kind === 'board') {
                const boardTasks = source.kind === 'task' ? group : draggedTasks;
                if (source.kind === 'timeline') {
                    if (this.selectedTaskIds.size > draggedTasks.length) {
                        new Notice('Google Calendar events stay on the calendar; only tasks move to the Board column.');
                    }
                    this.selectedTaskIds.clear();
                }
                if (boardTasks.length > 0) await this.dropTasksOnBoardColumn(boardTasks, landing.dateStr, landing.el.dataset.colTitle);
                return;
            }
            if (source.kind === 'timeline' && landing.kind === 'day') {
                // A day (Month cell, mini calendar, Today's Tasks): the selection moves to that date, times kept
                await this.moveSelectedTimelineItems(source.refId, source.isGCal, null, landing.dateStr);
                return;
            }
            const minutes = landing.kind === 'timeline'
                ? this.snapTimelineMinutes(y - landing.el.getBoundingClientRect().top - grabOffset, source.kind === 'timeline')
                : null;
            if (source.kind === 'timeline') {
                if (minutes !== null) await this.moveSelectedTimelineItems(source.refId, source.isGCal, minutes, landing.dateStr);
            } else if (group.length > 1) {
                if (minutes !== null) await this.scheduleTasksSequentially(group, landing.dateStr, minutes);
                else await this.moveTasksToDate(group, landing.dateStr); // a day cell: same date, times kept
            } else {
                // A Deadlines card, or a task with only a deadline, plans the work day (⏳) and leaves its 📅 alone
                const task = current(source.task);
                await this.scheduleTask(task, landing.dateStr, minutes, source.origin === 'deadline' || isDeadlineOnly(task));
            }
        };

        doc.addEventListener('pointermove', onMove);
        doc.addEventListener('pointerup', onUp);
        doc.addEventListener('pointercancel', onCancel);
        doc.addEventListener('keydown', onKey, true);
        doc.addEventListener('scroll', schedule, true); // wheel-scrolling under a still pointer moves the target slot
        if (isTouchLike(ev)) {
            doc.addEventListener('pointerdown', onOtherDown, true);
            doc.addEventListener('pointerup', onOtherUp, true);
            doc.addEventListener('touchmove', holdStill, { capture: true, passive: false });
        }
        this.activePointerDrag = {
            refresh: () => { scroller = null; schedule(); },
            cancel: () => void finish(false)
        };
        update();
        scrollFrame = win.requestAnimationFrame(autoScroll);
    }

    /**
     * Drop of a single task: a timeline slot gives it that date and a block of settings.defaultTaskDuration minutes
     * (untimed tasks from the drawer or an all-day row); a calendar day changes only the date (any time is kept).
     * The block stays on its day: it ends at 23:59 at the latest (no wrap past midnight).
     */
    /**
     * Dropped on Today's Focus: the tasks move to today and become 🔺 Highest. An undated task gets today as its due
     * date (📅); a dated one gets today in the date field it already has. One Undo for the batch.
     */
    async promoteToFocus(tasks: TaskItem[]) {
        const todayStr = (window as any).moment().format('YYYY-MM-DD');
        const changing = tasks.filter(task => task.priority !== 'highest' || task.date !== todayStr);
        if (changing.length === 0) return;
        const changed = await updateTasksInFile(this.app, changing,
            (task): TaskUpdates => task.date === null
                ? { date: todayStr, dueDate: todayStr, priority: 'highest' }
                : { date: todayStr, priority: 'highest' },
            n => t('drawer.focusPromoted', { n }));
        if (changed > 0) await this.refreshTasks();
    }

    /** Minutes a task occupies when (re)scheduled: its own length when timed, else its ⏱ estimate, else the default */
    taskBlockLength(task: TaskItem): number {
        const fallback = task.estimateMinutes || this.plugin.settings.defaultTaskDuration || 60;
        if (!task.startTime || !task.endTime) return fallback;
        const length = timeToMinutes(task.endTime) - timeToMinutes(task.startTime);
        return length > 0 ? length : fallback;
    }

    /** Selected drawer cards in the order the drawer lists them: a multi-drag schedules them in this order */
    drawerSelection(): TaskItem[] {
        const seen = new Set<string>();
        return Array.from(this.containerEl.querySelectorAll<HTMLElement>('.dp-side-drawer [data-drawer-task-id]'))
            .map(el => el.dataset.drawerTaskId!)
            .filter(id => this.selectedTaskIds.has(id) && !seen.has(id) && !!seen.add(id))
            .map(id => this.tasks.find(t => t.id === id))
            .filter((task): task is TaskItem => !!task);
    }

    /** Multi-drag preview: the blocks stacked back to back in drop order, as scheduleTasksSequentially will place them */
    protected stackDragPreview(group: TaskItem[]) {
        const ratio = this.getHourHeight() / 60;
        const order = new Map(group.map((task, i) => [task.id, i]));
        this.activeDragItems.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
        let offsetMin = 0;
        this.activeDragItems.forEach(item => {
            const task = group.find(t => t.id === item.id);
            const length = task ? this.taskBlockLength(task) : (this.plugin.settings.defaultTaskDuration || 60);
            item.offsetY = offsetMin * ratio;
            item.height = Math.max(15, Math.round(length * ratio));
            item.itemDateStr = ''; // all in the hovered column, whatever date each had
            offsetMin += length;
        });
        this.activePrimaryTaskId = group[0].id;
    }

    /**
     * Drawer multi-selection dropped on a timeline: task 1 starts at the drop time, each next one where the previous
     * ends (own length, else the default duration), in drawer order. Tasks that would start past midnight stay where
     * they are. One Undo for the batch.
     */
    async scheduleTasksSequentially(tasks: TaskItem[], dateStr: string, startMin: number) {
        const slots = new Map<TaskItem, { startTime: string; endTime: string }>();
        let cursor = startMin;
        for (const task of tasks) {
            if (cursor >= 24 * 60 - 5) break;
            const end = Math.min(cursor + this.taskBlockLength(task), 24 * 60 - 1);
            slots.set(task, { startTime: minutesToTime(cursor), endTime: minutesToTime(end) });
            cursor = end;
        }
        const placed = Array.from(slots.keys());
        // A task with only a deadline gets ⏳ for the day; its 📅 stays
        const changed = await updateTasksInFile(this.app, placed,
            task => ({ date: dateStr, ...(isDeadlineOnly(task) ? { scheduledDate: dateStr } : {}), ...slots.get(task)! }),
            n => `Scheduled ${n} tasks back to back from ${minutesToTime(startMin)}.`);
        if (tasks.length > placed.length) new Notice(`${tasks.length - placed.length} task(s) did not fit before midnight and were left as they were.`);
        if (changed > 0) await this.refreshTasks();
    }

    /** `keepDue`: write the date as ⏳ even when the task has only a 📅 (otherwise its 📅 would move with it) */
    async scheduleTask(task: TaskItem, dateStr: string, startMin: number | null, keepDue = false) {
        if (startMin === null && task.date === dateStr && (!keepDue || task.scheduledDate === dateStr)) return; // dropped back on its own day
        const updates: Partial<Omit<TaskItem, 'id' | 'filePath' | 'lineNumber' | 'originalLine'>> = { date: dateStr };
        if (keepDue) updates.scheduledDate = dateStr;
        if (startMin !== null) {
            updates.startTime = minutesToTime(startMin);
            updates.endTime = minutesToTime(Math.min(startMin + this.taskBlockLength(task), 24 * 60 - 1));
        }
        // Undo notice + background calendar sync come with the view-level updateTaskInFile
        if (await updateTaskInFile(this.app, task, updates)) await this.refreshTasks();
    }

    /**
     * Drop into the side drawer: strips the time and the scheduled date (⏳), so the task is Unscheduled again; a 📅
     * deadline stays (its date falls back scheduled -> due -> note name). A task without one in a dated note (a daily
     * note) inherits the note's date from the file name, which no edit to the line can remove: those are left as they
     * are, with a notice.
     */
    async unscheduleTasks(tasks: TaskItem[]) {
        const movable = tasks.filter(t => t.dueDate || !fileNameTaskDate(t.filePath));
        const pinned = tasks.length - movable.length;
        const changed = await updateTasksInFile(this.app, movable,
            task => ({ date: task.dueDate, scheduledDate: null, startTime: null, endTime: null }),
            n => `Moved ${n} tasks to Unscheduled.`);
        if (pinned > 0) {
            new Notice(`${pinned} task(s) kept their date: they live in a dated note (e.g. a daily note), whose file name sets it.`);
        }
        if (changed > 0) await this.refreshTasks();
        else this.render(); // nothing moved: still drop the selection highlight
    }

    /**
     * Dropped on an all-day row: the tasks go to that day without a time (⏰ removed). A Deadlines card plans the work
     * day (⏳) and leaves its 📅 alone, as scheduleTask does. One Undo for the batch.
     */
    async moveTasksToAllDay(tasks: TaskItem[], dateStr: string, keepDue = false) {
        // A task with only a deadline is planned the same way: ⏳ for the day, its 📅 stays
        const keepsDue = (task: TaskItem) => keepDue || isDeadlineOnly(task);
        const changing = tasks.filter(task => task.date !== dateStr || task.startTime || task.endTime
            || (keepsDue(task) && task.scheduledDate !== dateStr));
        if (changing.length === 0) {
            this.render(); // dropped where it already was: still drop the selection highlight
            return;
        }
        const updates = (task: TaskItem): TaskUpdates => keepsDue(task)
            ? { date: dateStr, scheduledDate: dateStr, startTime: null, endTime: null }
            : { date: dateStr, startTime: null, endTime: null };
        if (await updateTasksInFile(this.app, changing, updates, n => t('drag.movedAllDay', { n }))) await this.refreshTasks();
    }

    /** Overdue triage: give tasks a new date (their times are kept). One Undo for the whole batch. */
    async moveTasksToDate(tasks: TaskItem[], dateStr: string) {
        const label = (window as any).moment(dateStr, 'YYYY-MM-DD').format('ddd, MMM D');
        // A task with only a deadline gets ⏳ for the day; its 📅 stays
        if (await updateTasksInFile(this.app, tasks, task => isDeadlineOnly(task) ? { date: dateStr, scheduledDate: dateStr } : { date: dateStr },
            n => `Moved ${n} tasks to ${label}.`)) await this.refreshTasks();
    }

    /**
     * Overdue Move / Roll to today / Fit / Unschedule: each task is marked cancelled and an open copy with its target
     * (a date, time kept unless the target gives one; null date: unscheduled, a deadline stays) is written right below
     * it, so the note keeps a record of the missed day. A task in a dated note without a 📅 cannot be unscheduled (its
     * file name sets the date). Its calendar event follows the copy (an untimed copy drops it). One Undo.
     */
    async rescheduleOverdueTasks(tasks: TaskItem[], target: RescheduleTarget | ((task: TaskItem) => RescheduleTarget),
        summary?: (n: number) => string) {
        const plugin = this.plugin;
        const markSelfWrite = (path: string) => plugin.markSelfWrite(path);
        const targetFor = typeof target === 'function' ? target : () => target;
        const pinned = tasks.filter(t => targetFor(t).date === null && !t.dueDate && fileNameTaskDate(t.filePath));
        if (pinned.length > 0) {
            new Notice(`${pinned.length} task(s) kept their date: they live in a dated note (e.g. a daily note), whose file name sets it.`);
            tasks = tasks.filter(t => !pinned.includes(t));
            if (tasks.length === 0) return;
        }
        // Calendar-linked lines: their event follows wherever the line now stands (`wasTimed`: the line it replaced)
        const isTimedLine = (line: string) => /⏰\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/.test(line);
        const syncLines = async (lines: Array<{ filePath: string; line: string; wasTimed: boolean }>) => {
            if (!plugin.hasCalendars()) return;
            const all = await plugin.ensureTasksCache();
            lines.forEach(({ filePath, line, wasTimed }) => {
                const task = all.find(x => x.filePath === filePath && x.originalLine === line);
                if (task?.gcalEventId && (wasTimed || isTimedTask(task))) syncEditedTaskToGCal(plugin, task, wasTimed);
            });
        };
        let done: RescheduledTaskLine[];
        try {
            done = await rescheduleTaskLines(this.app, tasks, targetFor, markSelfWrite);
        } catch (err) {
            console.error('Dayloom: rescheduling overdue tasks failed', err);
            new Notice(t('drawer.rescheduleFailed'));
            return;
        }
        if (done.length === 0) {
            new Notice(t('drawer.rescheduleFailed'));
            return;
        }
        await reparseAndRefresh(plugin, done.map(r => r.filePath));
        await syncLines(done.map(r => ({ filePath: r.filePath, line: r.copy, wasTimed: isTimedLine(r.original) })));

        const dateStr = typeof target === 'function' ? null : target.date;
        const text = summary ? summary(done.length)
            : dateStr ? t('drawer.rescheduled', { n: done.length, date: (window as any).moment(dateStr, 'YYYY-MM-DD').format('ddd, MMM D') })
            : t('drawer.unscheduledCopy', { n: done.length });
        const notice = new Notice('', 8000);
        const messageEl = (notice as any).noticeEl || (notice as any).messageEl;
        if (!messageEl) return;
        messageEl.empty();
        messageEl.createSpan({ text: `${text} ` });
        const undoBtn = messageEl.createEl('button', { text: t('common.undo') });
        undoBtn.addEventListener('click', async (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            notice.hide();
            const restored = await undoRescheduleTaskLines(this.app, done, markSelfWrite);
            await reparseAndRefresh(plugin, done.map(r => r.filePath));
            await syncLines(done.map(r => ({ filePath: r.filePath, line: r.original, wasTimed: isTimedLine(r.copy) })));
            new Notice(`Undid ${restored} task change(s).`);
        });
    }

    /**
     * First free start (minutes) for a block of `duration` minutes (default task duration) on `dateStr`, inside the timeline's
     * working hours (start / end hour settings, or a code block's `hours:`) and, for today, not before now. Timed tasks (except cancelled ones
     * and `exclude`) and timed Google Calendar events count as busy; all-day items do not. Null when nothing fits.
     */
    findFreeSlot(dateStr: string, exclude?: TaskItem, duration = this.plugin.settings.defaultTaskDuration || 60,
        extraBusy: Array<[number, number]> = []): number | null {
        // `extraBusy`: slots a batch (fitTasksIn) has already given away on this day
        const busy = extraBusy.length ? this.busyIntervals(dateStr, exclude).concat(extraBusy).sort((a, b) => a[0] - b[0])
            : this.busyIntervals(dateStr, exclude);

        const now = (window as any).moment();
        const todayStr = now.format('YYYY-MM-DD');
        if (dateStr < todayStr) return null; // no free time left in the past
        const align = (m: number) => Math.ceil(m / 15) * 15;
        const { startHour, endHour } = this.getTimelineHours();
        let cursor = startHour * 60;
        if (dateStr === todayStr) cursor = Math.max(cursor, now.hour() * 60 + now.minute());
        cursor = align(cursor);
        for (const [start, end] of busy) {
            if (end <= cursor) continue;
            if (start - cursor >= duration) break; // the gap before this item fits
            cursor = align(Math.max(cursor, end));
        }
        const dayEnd = Math.min(endHour * 60, 24 * 60 - 1);
        return cursor + duration <= dayEnd ? cursor : null;
    }

    /**
     * Busy time of `dateStr` in minutes, sorted by start: timed tasks (except cancelled ones and `exclude`) and timed
     * Google Calendar events; all-day items do not count. Shared by Fit It In and the drawer's free-time line.
     */
    busyIntervals(dateStr: string, exclude?: TaskItem, tasks: TaskItem[] = this.tasks): Array<[number, number]> {
        const busy: Array<[number, number]> = [];
        tasks.forEach(t => {
            if (t === exclude || t.date !== dateStr || !t.startTime || !t.endTime || t.statusChar === '-') return;
            busy.push([timeToMinutes(t.startTime), timeToMinutes(t.endTime)]);
        });
        if (this.plugin.hasCalendars()) {
            this.getCalendarEventsForDate(dateStr).forEach(e => {
                if (!e.isAllDay && e.startTimeStr && e.endTimeStr) busy.push([timeToMinutes(e.startTimeStr), timeToMinutes(e.endTimeStr)]);
            });
        }
        return busy.sort((a, b) => a[0] - b[0]);
    }

    /** "Fit it in": schedule `task` into the first free slot of the first day in `dates` that has one (its own length) */
    async fitTaskIn(task: TaskItem, dates: string[]) {
        const title = cleanTaskTextForDisplay(task.text);
        const duration = this.taskBlockLength(task);
        for (const dateStr of dates) {
            const start = this.findFreeSlot(dateStr, task, duration);
            if (start === null) continue;
            const when = (window as any).moment(dateStr, 'YYYY-MM-DD').add(start, 'minutes').format('ddd, MMM D HH:mm');
            if (isOverdueTask(task, (window as any).moment().format('YYYY-MM-DD'))) {
                // Overdue: cancelled, with a copy in the slot right below it (like Move)
                const target = { date: dateStr, startTime: minutesToTime(start), endTime: minutesToTime(Math.min(start + duration, 24 * 60 - 1)) };
                await this.rescheduleOverdueTasks([task], target, () => t('fit.done', { title, when }));
                return;
            }
            await this.scheduleTask(task, dateStr, start, isDeadlineOnly(task)); // a deadline-only task keeps its 📅
            new Notice(t('fit.done', { title, when }));
            return;
        }
        new Notice(dates.length > 1 ? t('fit.none', { n: duration, days: dates.length }) : t('fit.noneDay', { n: duration }));
    }

    /** Fit It In's search window for a task: the next 14 days, only up to its 📅 deadline while that is still ahead */
    fitDatesFor(task: TaskItem): string[] {
        const today = (window as any).moment();
        const dates: string[] = Array.from({ length: 14 }, (_, i) => today.clone().add(i, 'days').format('YYYY-MM-DD'));
        const beforeDeadline = task.dueDate ? dates.filter(d => d <= task.dueDate!) : dates;
        return beforeDeadline.length > 0 ? beforeDeadline : dates;
    }

    /**
     * Fit It In for several tasks (Overdue's Fit all): each in list order into the first free slot of its window, the
     * slots given to the earlier ones counting as busy for the later. One Undo for the batch.
     */
    async fitTasksIn(tasks: TaskItem[]) {
        const slots = new Map<TaskItem, { dateStr: string; start: number; end: number }>();
        const taken = new Map<string, Array<[number, number]>>();
        for (const task of tasks) {
            const duration = this.taskBlockLength(task);
            for (const dateStr of this.fitDatesFor(task)) {
                const day = taken.get(dateStr) ?? [];
                const start = this.findFreeSlot(dateStr, task, duration, day);
                if (start === null) continue;
                slots.set(task, { dateStr, start, end: Math.min(start + duration, 24 * 60 - 1) });
                taken.set(dateStr, [...day, [start, start + duration]]);
                break;
            }
        }
        const placed = Array.from(slots.keys());
        // Overdue tasks are cancelled, each with a copy in its slot right below it (like Move); the rest are moved
        const todayStr = (window as any).moment().format('YYYY-MM-DD');
        const overdue = placed.filter(task => isOverdueTask(task, todayStr));
        if (overdue.length > 0) {
            await this.rescheduleOverdueTasks(overdue, task => {
                const slot = slots.get(task)!;
                return { date: slot.dateStr, startTime: minutesToTime(slot.start), endTime: minutesToTime(slot.end) };
            }, n => t('fit.batchDone', { n }));
        }
        const moving = placed.filter(task => !overdue.includes(task));
        const changed = moving.length === 0 ? 0 : await updateTasksInFile(this.app, moving, task => {
            const slot = slots.get(task)!;
            return {
                date: slot.dateStr,
                ...(isDeadlineOnly(task) ? { scheduledDate: slot.dateStr } : {}),
                startTime: minutesToTime(slot.start),
                endTime: minutesToTime(slot.end)
            };
        }, n => t('fit.batchDone', { n }));
        if (tasks.length > placed.length) new Notice(t('fit.batchLeft', { n: tasks.length - placed.length }));
        if (changed > 0) await this.refreshTasks();
    }

    /**
     * Timeline interaction map (mouse / pen, iPad Pencil included; touch keeps native scrolling and the phone long-press drag):
     *   - press on a card            → card drag (registerMouseDrag; the multi-selection moves along)
     *   - press on empty space       → this marquee: a drag selects every card the box touches (Ctrl / Cmd / Shift add
     *                                  to the selection), a plain click clears the selection
     *   - double-click empty space   → inline task creation (openInlineCreate, a dblclick on the pane)
     *   - Escape                     → cancels a card drag (beginPointerDrag) or the marquee, else clears the selection
     * The marquee owns every press on empty space, so the columns have no click handlers of their own: one used to
     * receive the click that ends a marquee drag (the box has pointer-events: none) and wipe the fresh selection.
     * Tasks and Google Calendar events are selected alike.
     */
    registerMarqueeSelection(eventsCol: HTMLElement, getTimedEvents: () => HTMLElement[]) {
        let marquee: HTMLElement | null = null;
        let startX = 0;
        let startY = 0;
        let moved = false;
        let hadSelection = false;
        let additive = false; // Ctrl / Cmd / Shift at the press: the box adds to the selection (union)
        const doc = eventsCol.ownerDocument;

        const onDown = (e: PointerEvent) => {
            if (e.button !== 0 || e.pointerType === 'touch') return;
            const target = e.target as HTMLElement;
            if (target.closest('.dp-timeline-event, .dp-drawer-card, .dp-grid-task-item, .dp-kanban-card, .dp-kanban-col-header, button, input, .dp-custom-cb, .dp-task-link-btn, .dp-resize-handle')) return;
            e.preventDefault();

            moved = false;
            hadSelection = this.selectedTaskIds.size > 0;
            additive = e.ctrlKey || e.metaKey || e.shiftKey;
            const rect = eventsCol.getBoundingClientRect();
            // Content coordinates: a scrolling host (the drawer list) positions the box below its scroll offset
            startX = e.clientX - rect.left + eventsCol.scrollLeft;
            startY = e.clientY - rect.top + eventsCol.scrollTop;
            marquee = eventsCol.createDiv({ cls: 'dp-selection-marquee' });
            marquee.style.left = `${startX}px`;
            marquee.style.top = `${startY}px`;
            marquee.style.width = '0px';
            marquee.style.height = '0px';

            if (!additive) this.selectedTaskIds.clear();
            this.enterSelectionZone(this.selectionZoneOf(eventsCol)); // even additive: never mix areas

            doc.addEventListener('pointermove', onMove);
            doc.addEventListener('pointerup', onUp);
            doc.addEventListener('pointercancel', onUp);
            doc.addEventListener('keydown', onKey, true);
        };

        const onMove = (e: PointerEvent) => {
            if (!marquee) return;
            const rect = eventsCol.getBoundingClientRect();
            const currentX = e.clientX - rect.left + eventsCol.scrollLeft;
            const currentY = e.clientY - rect.top + eventsCol.scrollTop;
            const width = Math.abs(startX - currentX);
            const height = Math.abs(startY - currentY);
            if (width > 2 || height > 2) moved = true;
            marquee.style.left = `${Math.min(startX, currentX)}px`;
            marquee.style.top = `${Math.min(startY, currentY)}px`;
            marquee.style.width = `${width}px`;
            marquee.style.height = `${height}px`;

            const box = marquee.getBoundingClientRect();
            // All rects first, then the class writes: interleaving them forced a style recalc per card on every move
            const hits: Array<{ el: HTMLElement; taskId: string; overlaps: boolean }> = [];
            getTimedEvents().forEach(el => {
                const taskId = el.dataset.taskId ?? el.dataset.selectId ?? el.dataset.drawerTaskId;
                if (!taskId) return;
                const r = el.getBoundingClientRect();
                hits.push({ el, taskId, overlaps: !(r.right < box.left || r.left > box.right || r.bottom < box.top || r.top > box.bottom) });
            });
            hits.forEach(({ el, taskId, overlaps }) => {
                if (overlaps) {
                    this.selectedTaskIds.add(taskId);
                    el.addClass('selected');
                } else if (!additive) {
                    this.selectedTaskIds.delete(taskId);
                    el.removeClass('selected');
                }
            });
        };

        const end = () => {
            marquee?.remove();
            marquee = null;
            doc.removeEventListener('pointermove', onMove);
            doc.removeEventListener('pointerup', onUp);
            doc.removeEventListener('pointercancel', onUp);
            doc.removeEventListener('keydown', onKey, true);
        };

        const onUp = () => {
            end();
            if (moved) {
                // The release still produces a click (the box ignores the pointer): it must not reach anything else
                const swallow = (ce: MouseEvent) => { ce.stopPropagation(); ce.preventDefault(); };
                doc.addEventListener('click', swallow, { capture: true, once: true });
                window.setTimeout(() => doc.removeEventListener('click', swallow, { capture: true }), 0);
            }
            // The cards already carry their classes from the drag: only the selection bar (and, after a plain click
            // that cleared an old selection, every highlight) needs updating, on the next tick so the click / dblclick
            // ending this press still reaches its column. A full re-render here rebuilt the whole view for it.
            if (moved || hadSelection) window.setTimeout(() => this.applySelectionState(), 0);
        };

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            end();
            this.dismissSelection();
        };

        eventsCol.addEventListener('pointerdown', onDown);
        // iPadOS pans the page under a Pencil (then cancels the pointer) unless its touchmove is cancelled
        eventsCol.addEventListener('touchmove', (e) => { if (marquee && e.cancelable) e.preventDefault(); }, { passive: false });
    }

    /**
     * 태스크 및 구글 캘린더 일정 길이 조절 드래그 마우스 제어 인터페이스 (높이 조절 비율 대응 완료)
     */
    addResizeListeners(
        eventCard: HTMLElement,
        item: { type: 'task' | 'gcal'; refId: string; taskRef?: TaskItem; calendarId?: string; text: string; startTime: string; endTime: string },
        direction: 'top' | 'bottom'
    ) {
        const hourHeight = this.getHourHeight();
        const ratio = hourHeight / 60; // pixel / minute

        // The drawn height, 15px minimum included (renderTimelineItems)
        const cardHeight = Math.max(15, (timeToMinutes(item.endTime) - timeToMinutes(item.startTime)) * ratio);

        // Short cards: no bar, just an invisible ↕ edge zone (styles.ts), like a window edge
        let handleCls = `dp-resize-handle ${direction}`;
        if (cardHeight < 35) {
            handleCls += ' dp-small-handle';
        }

        const handle = eventCard.createDiv({ cls: handleCls });

        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            // A finger resizes only the touch-active card (long-press first); a bar left showing by tap-hover stays inert
            if (isTouchLike(e) && hasTouchScreen() && !eventCard.hasClass('is-touch-active')) return;
            e.stopPropagation();
            e.preventDefault();
            handle.setPointerCapture(e.pointerId);

            const hourHeight = this.getHourHeight();
            const { startHour, endHour } = this.getTimelineHours();
            const ratio = hourHeight / 60; // pixel / minute
            const startMinOffset = startHour * 60;

            const startY = e.clientY;
            const originalStartMin = timeToMinutes(item.startTime);
            const originalEndMin = timeToMinutes(item.endTime);
            let lastDeltaMin = 0;
            triggerHaptic('light'); // resize start

            /** The edge moved by whole 15-minute steps, kept inside the visible hours and at least 15 minutes long */
            const resized = (clientY: number): [number, number] => {
                const deltaMin = Math.round(((clientY - startY) / ratio) / 15) * 15;
                return direction === 'top'
                    ? [Math.max(startMinOffset, Math.min(originalEndMin - 15, originalStartMin + deltaMin)), originalEndMin]
                    : [originalStartMin, Math.min(endHour * 60, Math.max(originalStartMin + 15, originalEndMin + deltaMin))];
            };
            const displayTitle = cleanTaskTextForDisplay(item.text);

            const onPointerMove = (moveEvent: PointerEvent) => {
                moveEvent.preventDefault();
                const deltaMin = Math.round(((moveEvent.clientY - startY) / ratio) / 15) * 15;
                if (deltaMin === lastDeltaMin) return; // same 15-minute step: nothing to redraw
                lastDeltaMin = deltaMin;
                triggerHaptic('light'); // snapped to a new 15-minute slot
                const [newStartMin, newEndMin] = resized(moveEvent.clientY);
                eventCard.style.top = `${(newStartMin - startMinOffset) * ratio}px`;
                eventCard.style.height = `${Math.max(15, (newEndMin - newStartMin) * ratio)}px`; // same minimum as the render
                eventCard.querySelector('span')?.setText(`${displayTitle} (${minutesToTime(newStartMin)}-${minutesToTime(newEndMin)})`);
            };

            const doc = handle.ownerDocument;
            const detachResize = (pointerId: number) => {
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                handle.removeEventListener('pointermove', onPointerMove);
                handle.removeEventListener('pointerup', onPointerUp);
                handle.removeEventListener('pointercancel', onPointerUp);
                doc.removeEventListener('keydown', onResizeKey, true);
            };
            // Esc mid-resize: the card snaps back, nothing is written, nothing stays highlighted
            const onResizeKey = (ke: KeyboardEvent) => {
                if (ke.key !== 'Escape') return;
                ke.preventDefault();
                ke.stopPropagation();
                detachResize(e.pointerId);
                this.dismissSelection();
                this.render();
            };

            const onPointerUp = async (upEvent: PointerEvent) => {
                detachResize(upEvent.pointerId);
                this.clearTouchActive(); // a finished resize ends touch position & resize mode

                const [newStartMin, newEndMin] = resized(upEvent.clientY);
                const finalStart = minutesToTime(newStartMin);
                const finalEnd = minutesToTime(newEndMin);

                // A tap on a handle (the touch dots have a 24px target) changes nothing: put the card back, write nothing
                if (newStartMin === originalStartMin && newEndMin === originalEndMin) {
                    this.render();
                    return;
                }

                // The view redraws from the new times at once (layout, overlaps, time); the note / Google write follows,
                // and a failed write puts the old times back
                if (item.type === 'gcal') {
                    const cached = this.plugin.gcalCache.find(ev => ev.id === item.refId);
                    if (cached && !cached.readOnly) {
                        const previousState = {
                            summary: cached.summary,
                            description: cached.description || '',
                            location: cached.location || '',
                            dateStr: cached.dateStr,
                            startTimeStr: cached.startTimeStr,
                            endTimeStr: cached.endTimeStr,
                            isAllDay: cached.isAllDay
                        };
                        // The day of the column the card sits in (a Weekly / N-day day); the Daily column is the view's date.
                        // The view's date was sent for every column, so resizing in Weekly moved the event to that day.
                        const dateStr = eventCard.closest<HTMLElement>('[data-date]')?.dataset.date ?? this.currentDate.format('YYYY-MM-DD');
                        const rollback = this.applyEventEditNow(cached, dateStr, finalStart, finalEnd);
                        this.render();
                        const success = await patchGoogleCalendarEvent(this.plugin, item.calendarId!, item.refId, dateStr, finalStart, finalEnd);
                        if (success) {
                            new Notice(`📅 Google Calendar event changed: ${finalStart} ~ ${finalEnd}`);
                            showGCalEventUndoNotice(this.plugin, item.calendarId!, item.refId, previousState);
                        } else {
                            rollback();
                        }
                    }
                } else {
                    const edit = this.applyTaskEditNow(item.taskRef!, { startTime: finalStart, endTime: finalEnd });
                    this.render();
                    const success = await updateTaskInFile(this.plugin.app, edit.live, {
                        startTime: finalStart,
                        endTime: finalEnd
                    }, edit.previous);
                    if (success) new Notice(`Task rescheduled to: ${finalStart} ~ ${finalEnd}`);
                    else edit.rollback();
                }

                await this.refreshTasks();
            };

            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', onPointerUp);
            handle.addEventListener('pointercancel', onPointerUp);
            doc.addEventListener('keydown', onResizeKey, true);
        });
    }

    /**
     * Moves every selected timeline item (tasks and Google events) so the primary item starts at `snappedMinutes`
     * on `targetDateStr`; the others keep their time and day offsets. Shared by mouse drops and phone long-press drags.
     */
    async moveSelectedTimelineItems(primaryTaskId: string, isGCal: boolean, snappedMinutes: number | null, targetDateStr: string) {
        // [통합 동시 드래그 시스템]: 구글 캘린더와 마크다운 Task 구분 없이 모두 동시 이동 처리 (상대적 날짜 유지)
        let primaryItemStartMin = 0;
        let primaryDateStr = targetDateStr;
        if (isGCal) {
            const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === primaryTaskId);
            if (gcalEvent && gcalEvent.startTimeStr) {
                primaryItemStartMin = timeToMinutes(gcalEvent.startTimeStr);
                if (gcalEvent.dateStr) primaryDateStr = gcalEvent.dateStr;
            }
        } else {
            const primaryItem = this.tasks.find(t => t.id === primaryTaskId);
            if (primaryItem && primaryItem.startTime) {
                primaryItemStartMin = timeToMinutes(primaryItem.startTime);
                if (primaryItem.date) primaryDateStr = primaryItem.date;
            }
        }

        const deltaMin = snappedMinutes === null ? 0 : snappedMinutes - primaryItemStartMin; // null: a day drop, times kept
        const moment = (window as any).moment;
        const primaryMom = moment(primaryDateStr, 'YYYY-MM-DD');
        const targetMom = moment(targetDateStr, 'YYYY-MM-DD');
        const dayDelta = (targetMom.isValid() && primaryMom.isValid()) ? targetMom.diff(primaryMom, 'days') : 0;

        let taskUpdateCount = 0;
        let gcalUpdateCount = 0;

        // A start / end time moved by deltaMin, its hour and minute clamped separately (as always: no wrap to the next day)
        const shift = (time: string, maxHour: number) => {
            const total = timeToMinutes(time) + deltaMin;
            const h = Math.max(0, Math.min(maxHour, Math.floor(total / 60)));
            const m = Math.max(0, Math.min(59, total % 60));
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };
        const shiftDate = (dateStr: string | null) => dateStr
            ? moment(dateStr, 'YYYY-MM-DD').add(dayDelta, 'days').format('YYYY-MM-DD')
            : targetDateStr;

        // Every item takes its new place on screen at once (the drop never shows the old spot again); the note writes
        // and Google PATCHes follow one by one, and a failed one goes back to where it was
        const writes: Array<() => Promise<void>> = [];
        for (const taskId of this.selectedTaskIds) {
            const task = this.tasks.find(t => t.id === taskId);
            if (isLockedTask(task)) continue; // a marquee may have swept done / cancelled tasks in: they stay put
            if (task && task.startTime && task.endTime) {
                const updates = { startTime: shift(task.startTime, 23), endTime: shift(task.endTime, 24), date: shiftDate(task.date) };
                const edit = this.applyTaskEditNow(task, updates);
                writes.push(async () => {
                    if (await updateTaskInFile(this.app, edit.live, updates, edit.previous)) taskUpdateCount++;
                    else edit.rollback();
                });
            } else {
                // 선택된 ID가 구글 일정 캐시에 존재하는 경우 동시 이동 API 전송
                const gcalEvent = this.plugin.gcalCache.find(ev => ev.id === taskId);
                if (gcalEvent && !gcalEvent.readOnly && gcalEvent.startTimeStr && gcalEvent.endTimeStr && !gcalEvent.isAllDay) {
                    const previousState = {
                        summary: gcalEvent.summary,
                        description: gcalEvent.description || '',
                        location: gcalEvent.location || '',
                        dateStr: gcalEvent.dateStr,
                        startTimeStr: gcalEvent.startTimeStr,
                        endTimeStr: gcalEvent.endTimeStr,
                        isAllDay: gcalEvent.isAllDay
                    };
                    const newStartTime = shift(gcalEvent.startTimeStr, 23);
                    const newEndTime = shift(gcalEvent.endTimeStr, 24);
                    const gcalTargetDate = shiftDate(gcalEvent.dateStr);
                    const rollback = this.applyEventEditNow(gcalEvent, gcalTargetDate, newStartTime, newEndTime);
                    writes.push(async () => {
                        const success = await patchGoogleCalendarEvent(
                            this.plugin,
                            gcalEvent.calendarId,
                            gcalEvent.id,
                            gcalTargetDate,
                            newStartTime,
                            newEndTime
                        );
                        if (success) {
                            gcalUpdateCount++;
                            showGCalEventUndoNotice(this.plugin, gcalEvent.calendarId, gcalEvent.id, previousState);
                        } else {
                            rollback();
                        }
                    });
                }
            }
        }
        if (writes.length === 0) return;
        this.render();
        for (const write of writes) await write();

        if (taskUpdateCount > 0 || gcalUpdateCount > 0) {
            new Notice(`🔄 Rescheduled ${taskUpdateCount} task(s) and ${gcalUpdateCount} Google event(s)`);
            this.selectedTaskIds.clear();
        }
        await this.refreshTasks(null, gcalUpdateCount > 0);
    }

    /**
     * Shows a timeline edit at once, before the note is written: the view's current copy of the task takes the new
     * times / date (a card may still hold an older object that a background re-parse has replaced since it was drawn,
     * and changing that one showed nothing). Returns that copy, the Undo snapshot from before, and a rollback.
     */
    protected applyTaskEditNow(task: TaskItem, updates: { startTime: string; endTime: string; date?: string }) {
        const live = this.tasks.find(t => t.id === task.id) ?? task;
        const previous = snapshotTask(live);
        const fields: Partial<TaskItem> = { startTime: updates.startTime, endTime: updates.endTime };
        if (updates.date !== undefined && updates.date !== live.date) {
            fields.date = updates.date;
            // The date field the task already uses moves with it, as updateTaskInFile writes it
            if (live.scheduledDate) fields.scheduledDate = updates.date;
            else if (live.dueDate) fields.dueDate = updates.date;
            else fields.scheduledDate = updates.date;
        }
        const before = Object.fromEntries(Object.keys(fields).map(key => [key, live[key as keyof TaskItem]])) as Partial<TaskItem>;
        Object.assign(live, fields);
        return { live, previous, rollback: () => Object.assign(live, before) };
    }

    /** The same for a cached Google event: its day comes from start / end, so those move too. Returns the rollback. */
    protected applyEventEditNow(e: GCalEvent, dateStr: string, startTimeStr: string, endTimeStr: string): () => void {
        const moment = (window as any).moment;
        const before = { dateStr: e.dateStr, start: e.start, end: e.end, startTimeStr: e.startTimeStr, endTimeStr: e.endTimeStr };
        Object.assign(e, {
            dateStr,
            startTimeStr,
            endTimeStr,
            start: moment(`${dateStr} ${startTimeStr}`, 'YYYY-MM-DD HH:mm').format(),
            end: moment(`${dateStr} ${endTimeStr}`, 'YYYY-MM-DD HH:mm').format()
        });
        return () => Object.assign(e, before);
    }

    /**
     * Phone timeline drag (Daily / 2-Day): holding a card for 320ms lifts it with a haptic and makes it the touch-active
     * card (its resize bars appear). The finger then moves it through the same 15-minute snap preview as mouse dragging,
     * and lifting the finger drops it. Released without moving, the card stays active: a later touch on its body drags
     * it straight away (no second hold), its bars resize it. Until a hold completes on an idle card the touch is left
     * alone, so a normal swipe still scrolls or pages the timeline.
     */
    registerLongPressDrag(card: HTMLElement, refId: string, isGCal: boolean, previewRoot: HTMLElement) {
        const HOLD_MS = 320;
        const SLOP = 8;  // px of finger jitter tolerated during the hold
        const EDGE = 48; // px band at the scroller's top/bottom that auto-scrolls while dragging
        // Native touch drag-and-drop would compete with the long-press; desktop (sidebar) keeps mouse dragging
        if (Platform.isMobile) card.setAttribute('draggable', 'false');
        const scroller = card.closest<HTMLElement>('.dp-content');
        let holdTimer = 0, frame = 0, pointerId = -1;
        let startX = 0, startY = 0, lastX = 0, lastY = 0, grabOffset = 0;
        let dragging = false, moved = false;
        let armed = false; // this touch began on the active card: movement drags at once
        let column: HTMLElement | null = null;

        const updatePreview = () => {
            const hit = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
            column = hit?.closest<HTMLElement>('.dp-weekly-day-col, .dp-timeline-events') ?? column;
            if (column) this.updateDragPreview({ clientY: lastY }, column, grabOffset, true);
        };
        const autoScroll = () => {
            if (!dragging) return;
            if (scroller) {
                const r = scroller.getBoundingClientRect();
                const step = lastY < r.top + EDGE ? -8 : lastY > r.bottom - EDGE ? 8 : 0;
                if (step) {
                    scroller.scrollTop += step;
                    updatePreview();
                }
            }
            frame = requestAnimationFrame(autoScroll);
        };
        const detach = () => {
            window.clearTimeout(holdTimer);
            holdTimer = 0;
            card.removeEventListener('pointermove', onMove);
            card.removeEventListener('pointerup', onUp);
            card.removeEventListener('pointercancel', onCancel);
        };
        const endDrag = () => {
            dragging = false;
            this.touchDragActive = false;
            card.removeClass('dp-touch-lifted');
            cancelAnimationFrame(frame);
            this.clearDragPreview(previewRoot);
        };
        const onMove = (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            lastX = e.clientX;
            lastY = e.clientY;
            const dist = Math.hypot(lastX - startX, lastY - startY);
            if (!dragging) {
                if (dist <= SLOP) return;
                if (!armed) {
                    detach(); // moved before the hold completed: a scroll or swipe, not a drag
                    return;
                }
                lift(false); // the active card's body: drag without another hold
            }
            moved = moved || dist > SLOP;
            updatePreview();
        };
        const onCancel = () => {
            detach();
            if (dragging) endDrag();
        };
        const onUp = async (e: PointerEvent) => {
            if (e.pointerId !== pointerId) return;
            detach();
            if (!dragging) return; // the click the lift leaves behind is dropped by guardClickAfterTouchHold
            const target = column;
            endDrag();
            if (!moved || !target) return; // released on the spot: the card stays active, its bars showing
            this.clearTouchActive(); // a finished move ends position & resize mode
            const rect = target.getBoundingClientRect();
            const dateStr = target.getAttribute('data-date') || this.currentDate.format('YYYY-MM-DD');
            await this.moveSelectedTimelineItems(refId, isGCal, this.snapTimelineMinutes(lastY - rect.top - grabOffset, true), dateStr);
        };

        card.addEventListener('pointerdown', (e: PointerEvent) => {
            if (!isTouchLike(e) || !e.isPrimary || dragging) return;
            armed = false;
            if ((e.target as HTMLElement).closest('.dp-custom-cb, .dp-task-link-btn, .dp-resize-handle, .dp-drawer-card-actions, .dp-priority-trigger')) return;
            pointerId = e.pointerId;
            startX = lastX = e.clientX;
            startY = lastY = e.clientY;
            moved = false;
            column = null;
            armed = this.isTouchActive(refId);
            card.addEventListener('pointermove', onMove);
            card.addEventListener('pointerup', onUp);
            card.addEventListener('pointercancel', onCancel);
            if (!armed) {
                holdTimer = window.setTimeout(() => {
                    holdTimer = 0;
                    lift(true);
                }, HOLD_MS);
            }
        });
        const lift = (fromHold: boolean) => {
            dragging = true;
            this.touchDragActive = true;
            this.guardClickAfterTouchHold(pointerId); // the release must not open the editor
            if (!this.selectedTaskIds.has(refId)) {
                this.selectedTaskIds.clear();
                this.selectedTaskIds.add(refId);
                previewRoot.querySelectorAll('.dp-timeline-event.selected').forEach(el => el.removeClass('selected'));
                card.addClass('selected');
            }
            grabOffset = this.timelineGrabOffset(card, startY);
            this.initDragPreview(null, refId, grabOffset, previewRoot);
            card.addClass('dp-touch-lifted'); // slight scale-up while held
            if (fromHold) {
                this.setTouchActive(card, refId); // reveals the resize bars
                triggerHaptic('lift'); // replaces the preview's light pulse with the stronger pick-up one
            }
            updatePreview();
            frame = requestAnimationFrame(autoScroll);
        };
        // Once lifted (or on the active card, whose touch-action is none), finger moves drive the drag, not a scroll
        card.addEventListener('touchmove', (e) => { if ((dragging || armed) && e.cancelable) e.preventDefault(); }, { passive: false });
        card.addEventListener('contextmenu', (e) => { if (holdTimer || dragging) e.preventDefault(); });
    }

    // Implemented in a later layer (see src/views/baseView.ts)
    abstract dropTasksOnBoardColumn(tasks: TaskItem[], colId: string, colTitle?: string): Promise<void>;
}
