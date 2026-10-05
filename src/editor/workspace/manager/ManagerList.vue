<script setup lang="ts" generic="T extends number">
import { computed, nextTick, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import { i18n } from '../../../i18n'
import { modals } from '../../../modals'
import { interpolateRaw } from '../../../utils/interpolate'
import SelectIcon from '../../commands/select/SelectIcon.vue'
import ResetIcon from '../../commands/reset/ResetIcon.vue'
import { useScrollMemory } from '../useScrollMemory'
import ManagerAddButton from './ManagerAddButton.vue'
import MoveDownIcon from './icons/MoveDownIcon.vue'
import MoveHereIcon from './icons/MoveHereIcon.vue'
import MoveUpIcon from './icons/MoveUpIcon.vue'
import PropertiesIcon from './icons/PropertiesIcon.vue'
import RenameIcon from './icons/RenameIcon.vue'
import VisibleIcon from './icons/VisibleIcon.vue'
import ManagerMenu, { type ManagerMenuItem } from './ManagerMenu.vue'
import type { ManagerModel, ManagerRowAction } from './model'
import { canMoveSelectionTo, moveSelectionTo, ownedCounts, selectOwned } from './objects'
import ManagerRow from './ManagerRow.vue'

const props = defineProps<{
    model: ManagerModel<T>
    /** Remembers the list's scroll position across remounts under this key. */
    scrollKey?: string
}>()

const root = useTemplateRef<HTMLDivElement>('root')
const list = useTemplateRef<HTMLUListElement>('list')
useScrollMemory(() => props.scrollKey, list)

const entries = computed(() => props.model.entries())
const strings = computed(() => props.model.strings())
const scope = computed(() => props.model.scope)
const focused = computed(() => props.model.focused())
const counts = computed(() => ownedCounts(props.model.owner))

const allShown = computed(() => scope.value.shownCount.value === scope.value.totalCount.value)

const label = (template: string, ...values: string[]) => interpolateRaw(template, ...values)

const rowOf = (id: T) =>
    list.value?.querySelector<HTMLElement>(`[data-entry-id="${String(id)}"]`) ?? undefined

const focusIn = (id: T, selector: string) => {
    rowOf(id)?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
}

/**
 * Scrolls only the list, never the page or the panel around it, so the row
 * clears the list padding and the sticky Add item.
 */
const reveal = (id: T) => {
    const container = list.value
    const row = rowOf(id)
    if (!container || !row) return
    const bounds = container.getBoundingClientRect()
    const style = getComputedStyle(container)
    // A floating Add is covered by the list's bottom padding.
    const top = bounds.top + parseFloat(style.paddingTop)
    const bottom = bounds.bottom - parseFloat(style.paddingBottom)
    const rect = row.getBoundingClientRect()
    if (rect.top < top) container.scrollTop -= top - rect.top
    else if (rect.bottom > bottom) container.scrollTop += rect.bottom - bottom
}

// Inline actions need room beside a useful share of the name. With a mouse
// they appear on the row in use; touch has no hover, so only on the target.
const width = shallowRef(0)
const coarse = matchMedia('(pointer: coarse)')
const isCoarse = shallowRef(coarse.matches)
const onPointerChange = () => {
    isCoarse.value = coarse.matches
}
coarse.addEventListener('change', onPointerChange)
const listHeight = shallowRef(0)
const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
        if (entry.target === root.value) width.value = entry.contentRect.width
        // The whole box: the floating Add's room below the rows is padding,
        // which must not decide whether Add floats.
        else listHeight.value = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
    }
    onListScroll()
})
// Classic scrollbars reserve a gutter at the right (see the styles below). The
// rows' own 6px inset gives way to it, so they stay as centered as they can.
const gutterPadding = shallowRef<string>()
watch(list, (element, previous) => {
    if (previous) observer.unobserve(previous)
    if (!element) return
    observer.observe(element)
    const gutter = element.offsetWidth - element.clientWidth
    gutterPadding.value = gutter > 0 ? `${Math.max(0, 6 - gutter)}px` : undefined
})
// The Add item follows the rows; it floats in reach at the bottom of long
// lists, unless the list is too short to show it beside at least two rows.
const stickyAdd = computed(() => listHeight.value >= (isCoarse.value ? 176 : 156))
watch(root, (element, previous) => {
    if (previous) observer.unobserve(previous)
    if (element) observer.observe(element)
})
onUnmounted(() => {
    observer.disconnect()
    coarse.removeEventListener('change', onPointerChange)
})
const inlineMode = computed(() =>
    width.value < (isCoarse.value ? 320 : 256)
        ? undefined
        : isCoarse.value
          ? ('current' as const)
          : ('hover' as const),
)
/** Whether a row offers its inline actions, which the menu then leaves out. */
const hasInline = (id: T) =>
    inlineMode.value === 'hover' || (inlineMode.value === 'current' && focused.value === id)

// Selection and visibility

const onSelectAll = () => {
    if (focused.value !== undefined) scope.value.focus(undefined)
}

const onToggleAll = () => {
    scope.value.setAllShown(!allShown.value)
}

const onSelect = (id: T) => {
    // Selecting the current target again changes nothing unless it is hidden.
    if (focused.value === id && scope.value.isShown(id)) return
    scope.value.focus(id)
}

const isSoloed = (id: T) => scope.value.isShown(id) && scope.value.shownCount.value === 1

/** Shows only this entry, or everything again when it already is alone. */
const solo = (id: T) => {
    if (isSoloed(id)) {
        scope.value.setAllShown(true)
    } else {
        scope.value.setAllShown(false)
        scope.value.setShown(id, true)
    }
}

const onToggle = (id: T, soloed: boolean) => {
    if (soloed) solo(id)
    else scope.value.setShown(id, !scope.value.isShown(id))
}

// Rows scrolled under the band get a separator and fade out at its edge; rows
// hidden below fade out behind the floating Add.
const scrolled = shallowRef(false)
const hiddenBelow = shallowRef(false)
const onListScroll = () => {
    const element = list.value
    scrolled.value = (element?.scrollTop ?? 0) > 0
    hiddenBelow.value =
        !!element && element.scrollTop + element.clientHeight < element.scrollHeight - 1
}

const onAdd = async (event: MouseEvent) => {
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
    const id = props.model.add()
    await nextTick()
    reveal(id)
    // Name the new entry right away: Enter or leaving keeps the typed name,
    // Escape keeps the generated one. The authoring target stays put.
    startRename(id)
}

// Renaming

const renaming = shallowRef<T>()

const startRename = (id: T) => {
    closeMenu(false)
    renaming.value = id
}

const endRename = async (id: T, value: string | undefined, keyboard: boolean) => {
    if (renaming.value !== id) return
    renaming.value = undefined
    if (value !== undefined) props.model.rename(id, value)
    if (!keyboard) return
    await nextTick()
    focusIn(id, '.manager-name')
}

// Rows added or removed change what lies below.
watch(entries, () => void nextTick(onListScroll), { flush: 'post' })

// Stop renaming an entry that disappears, e.g. after an undo.
watch(entries, (value) => {
    const id = renaming.value
    if (id !== undefined && !value.some((entry) => entry.id === id)) renaming.value = undefined
})

// Reordering by keyboard and drag

const reorder = async (id: T, offset: -1 | 1) => {
    props.model.move(id, offset)
    await nextTick()
    reveal(id)
    focusIn(id, '.manager-name')
}

type Drag = {
    id: T
    pointerId: number
    from: number
    to: number
    startY: number
    startScroll: number
    /** Row centers in list content coordinates when the drag began. */
    centers: number[]
    step: number
    offset: number
    started: boolean
}

const drag = shallowRef<Drag>()
const dragThreshold = 5

const rowStyle = (index: number) => {
    const current = drag.value
    if (!current?.started) return undefined
    if (index === current.from) return { transform: `translateY(${current.offset}px)` }
    if (current.from < current.to && index > current.from && index <= current.to)
        return { transform: `translateY(${-current.step}px)` }
    if (current.to < current.from && index >= current.to && index < current.from)
        return { transform: `translateY(${current.step}px)` }
    return undefined
}

const onDragStart = (id: T, event: PointerEvent) => {
    const container = list.value
    if (event.button !== 0 || renaming.value !== undefined || !container) return
    const rows = [...container.querySelectorAll<HTMLElement>('[data-entry-id]')]
    const from = entries.value.findIndex((entry) => entry.id === id)
    if (from === -1 || rows.length < 2) return
    const centers = rows.map((row) => row.offsetTop + row.offsetHeight / 2)
    drag.value = {
        id,
        pointerId: event.pointerId,
        from,
        to: from,
        startY: event.clientY,
        startScroll: container.scrollTop,
        centers,
        step: (rows[1]?.offsetTop ?? 0) - (rows[0]?.offsetTop ?? 0),
        offset: 0,
        started: false,
    }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('pointercancel', onDragCancel)
    window.addEventListener('keydown', onDragKeydown, true)
}

const stopDragListeners = () => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragCancel)
    window.removeEventListener('keydown', onDragKeydown, true)
}

const onDragMove = (event: PointerEvent) => {
    const current = drag.value
    const container = list.value
    if (!current || !container || event.pointerId !== current.pointerId) return
    if (!current.started) {
        if (Math.abs(event.clientY - current.startY) < dragThreshold) return
        closeMenu(false)
    }
    event.preventDefault()

    // Scroll the list while the pointer rests near its edges.
    const bounds = container.getBoundingClientRect()
    if (event.clientY < bounds.top + 24) container.scrollTop -= 8
    else if (event.clientY > bounds.bottom - 24) container.scrollTop += 8

    const offset = event.clientY - current.startY + container.scrollTop - current.startScroll
    const center = (current.centers[current.from] ?? 0) + offset
    const to = current.centers.filter(
        (value, index) => index !== current.from && value < center,
    ).length
    drag.value = { ...current, offset, to, started: true }
}

// A drag ends with a click on whatever is under the pointer; swallow it so
// dropping on a name does not also select that entry.
const swallowClick = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
}

const onDragEnd = (event: PointerEvent) => {
    const current = drag.value
    if (current?.pointerId !== event.pointerId) return
    stopDragListeners()
    drag.value = undefined
    if (!current.started) return
    window.addEventListener('click', swallowClick, { capture: true, once: true })
    setTimeout(() => {
        window.removeEventListener('click', swallowClick, true)
    }, 0)
    if (current.to !== current.from) props.model.moveTo(current.id, current.to)
}

const onDragCancel = () => {
    stopDragListeners()
    drag.value = undefined
}

const onDragKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !drag.value?.started) return
    event.preventDefault()
    event.stopPropagation()
    onDragCancel()
}

onUnmounted(stopDragListeners)

// Cancel a drag whose entries change underneath it, e.g. after an undo.
watch(entries, () => {
    if (drag.value) onDragCancel()
})

// Actions and the menu

const menu = shallowRef<{ id: T; anchor: HTMLElement; modals: number }>()

/** Common actions are one click away on panels with room for them. */
const inlineActions = (): ManagerRowAction[] => [
    { key: 'properties', label: strings.value.properties, icon: PropertiesIcon },
]

const menuItems = computed((): ManagerMenuItem[] => {
    const id = menu.value?.id
    if (id === undefined) return []
    const index = entries.value.findIndex((entry) => entry.id === id)
    const manager = i18n.value.workspace.manager
    // Actions offered inline are not repeated here.
    const items: ManagerMenuItem[] = [
        { key: 'rename', label: manager.rename, icon: RenameIcon },
        ...(hasInline(id)
            ? []
            : [{ key: 'properties', label: strings.value.properties, icon: PropertiesIcon }]),
        {
            key: 'solo',
            label: isSoloed(id) ? strings.value.showAll : manager.solo,
            icon: VisibleIcon,
            separated: true,
        },
        {
            key: 'select',
            label: manager.select,
            icon: SelectIcon,
            disabled: !counts.value.get(id),
        },
    ]
    if (canMoveSelectionTo(props.model.owner, id))
        items.push({ key: 'moveSelection', label: manager.moveSelection, icon: MoveHereIcon })
    items.push(
        {
            key: 'moveUp',
            label: strings.value.moveUp,
            icon: MoveUpIcon,
            disabled: index <= 0,
            separated: true,
        },
        {
            key: 'moveDown',
            label: strings.value.moveDown,
            icon: MoveDownIcon,
            disabled: index === -1 || index >= entries.value.length - 1,
        },
        { key: 'delete', label: strings.value.delete, icon: ResetIcon, destructive: true },
    )
    return items
})

const menuLabel = computed(() => {
    const id = menu.value?.id
    const name = entries.value.find((entry) => entry.id === id)?.name ?? ''
    return label(i18n.value.workspace.manager.actions, name)
})

const onMenu = (id: T, anchor: HTMLElement) => {
    if (menu.value?.id === id) closeMenu(false)
    else menu.value = { id, anchor, modals: modals.length }
}

function closeMenu(restoreFocus: boolean) {
    const current = menu.value
    if (!current) return
    menu.value = undefined
    // Never take focus from a dialog that opened meanwhile.
    if (restoreFocus && modals.length <= current.modals && current.anchor.isConnected)
        current.anchor.focus({ preventScroll: true })
}

// Close when the anchor row disappears, e.g. after an undo.
watch(entries, (value) => {
    const id = menu.value?.id
    if (id !== undefined && !value.some((entry) => entry.id === id)) closeMenu(false)
})

const focusAfterDelete = (index: number) => {
    const rows = [...(list.value?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? [])]
    const row = rows[Math.min(index, rows.length - 1)]
    const target =
        row?.querySelector<HTMLElement>('.manager-more') ??
        root.value?.querySelector<HTMLElement>('.manager-name')
    target?.focus({ preventScroll: true })
}

const onMenuSelect = (key: string, keyboard: boolean) => {
    const current = menu.value
    if (!current) return
    closeMenu(keyboard)
    void run(current.id, key, keyboard, current.anchor)
}

const onInlineAction = (id: T, key: string, button: HTMLElement, keyboard: boolean) => {
    closeMenu(false)
    void run(id, key, keyboard, button)
}

/** Runs an action; keyboard users keep focus on `anchor` where it remains. */
const run = async (id: T, key: string, keyboard: boolean, anchor: HTMLElement) => {
    const index = entries.value.findIndex((entry) => entry.id === id)
    switch (key) {
        case 'rename':
            startRename(id)
            return
        case 'properties':
            props.model.openProperties(id)
            return
        case 'solo':
            solo(id)
            return
        case 'select':
            selectOwned(props.model.owner, id)
            return
        case 'moveSelection':
            await moveSelectionTo(props.model.owner, id)
            return
        case 'moveUp':
        case 'moveDown':
            props.model.move(id, key === 'moveUp' ? -1 : 1)
            await nextTick()
            reveal(id)
            // Reordering may move the focused button within the document, and a
            // move to either end disables that direction's button.
            if (keyboard) {
                const target =
                    anchor.isConnected && !(anchor as HTMLButtonElement).disabled
                        ? anchor
                        : rowOf(id)?.querySelector<HTMLElement>('.manager-more')
                if (target && document.activeElement !== target)
                    target.focus({ preventScroll: true })
            }
            return
        case 'delete':
            props.model.remove(id)
            if (!keyboard) return
            await nextTick()
            focusAfterDelete(index)
            return
    }
}
</script>

<template>
    <div ref="root" class="manager-list flex min-h-0 flex-col text-fg">
        <div
            class="manager-band relative z-10 shrink-0 bg-header px-1.5 py-1 [@media(pointer:coarse)]:py-0.5"
            :class="{ 'manager-band-raised': scrolled }"
            :style="{ paddingRight: gutterPadding }"
        >
            <ManagerRow
                class="manager-all"
                heading
                :name="strings.all"
                :name-title="strings.all"
                :current="focused === undefined"
                :shown="scope.shownCount.value > 0"
                :partial="scope.shownCount.value > 0 && !allShown"
                :grip-space="width >= 300"
                :muted="false"
                :eye-label="allShown ? strings.hideAll : strings.showAll"
                :meta="allShown ? undefined : `${scope.shownCount.value}/${scope.totalCount.value}`"
                @select="onSelectAll"
                @toggle="onToggleAll"
            />
        </div>
        <div class="relative flex min-h-0 flex-1 flex-col">
            <ul
                ref="list"
                class="manager-entries relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-1.5 pt-1.5"
                :class="{
                    'manager-entries-dragging': drag?.started,
                    'manager-entries-scrolled': scrolled,
                    'manager-entries-more': stickyAdd && hiddenBelow,
                    'manager-entries-floating': stickyAdd,
                }"
                :style="{ paddingRight: gutterPadding }"
                @scroll.passive="onListScroll"
            >
                <li
                    v-for="({ id, name }, index) in entries"
                    :key="id"
                    :data-entry-id="id"
                    :class="{ 'manager-dragged relative z-20': drag?.started && drag.id === id }"
                    :style="rowStyle(index)"
                >
                    <ManagerRow
                        class="manager-entry"
                        :name
                        :name-title="
                            focused === id ? label(i18n.workspace.manager.target, name) : name
                        "
                        :current="focused === id"
                        :shown="scope.isShown(id)"
                        :muted="!scope.isShown(id)"
                        :eye-label="
                            label(
                                scope.isShown(id)
                                    ? i18n.workspace.manager.hide
                                    : i18n.workspace.manager.show,
                                name,
                            )
                        "
                        :eye-title="`${label(
                            scope.isShown(id)
                                ? i18n.workspace.manager.hide
                                : i18n.workspace.manager.show,
                            name,
                        )}\n${i18n.workspace.manager.soloHint}`"
                        :meta="`${counts.get(id) ?? 0}`"
                        :meta-title="
                            label(i18n.workspace.manager.objects, `${counts.get(id) ?? 0}`)
                        "
                        :actions="inlineActions()"
                        :inline="inlineMode"
                        :menu-label="label(i18n.workspace.manager.actions, name)"
                        :menu-open="menu?.id === id"
                        :renaming="renaming === id"
                        :rename-label="i18n.modals.form.name.label"
                        :drag-label="label(i18n.workspace.manager.drag, name)"
                        :dragging="drag?.started && drag.id === id"
                        :no-grip="width < 300"
                        @select="onSelect(id)"
                        @toggle="onToggle(id, $event)"
                        @action="
                            (key, button, keyboard) => onInlineAction(id, key, button, keyboard)
                        "
                        @menu="onMenu(id, $event)"
                        @rename-start="startRename(id)"
                        @rename-end="(value, keyboard) => endRename(id, value, keyboard)"
                        @drag-start="onDragStart(id, $event)"
                        @reorder="reorder(id, $event)"
                    />
                </li>
                <!-- In a short panel Add follows the rows. -->
                <li
                    v-if="!stickyAdd"
                    class="manager-footer pointer-events-none -mx-1.5 px-1.5 pb-2 pt-3"
                    :style="{ marginRight: gutterPadding && `-${gutterPadding}` }"
                >
                    <ManagerAddButton :label="strings.add" @click="onAdd" />
                </li>
            </ul>
            <!-- Otherwise it floats in reach over the list, which leaves room below
        its last row and fades rows out behind it only while more lie below.
        The button is the only thing drawn here. -->
            <div
                v-if="stickyAdd"
                class="manager-footer manager-footer-floating pointer-events-none absolute bottom-0 left-0 z-10 px-1.5 pb-2"
                :class="{ 'manager-footer-dragging': drag?.started }"
            >
                <ManagerAddButton :label="strings.add" @click="onAdd" />
            </div>
        </div>
        <ManagerMenu
            v-if="menu"
            :key="menu.id"
            :anchor="menu.anchor"
            :label="menuLabel"
            :items="menuItems"
            @select="onMenuSelect"
            @close="closeMenu"
        />
    </div>
</template>

<style scoped>
/* Room below the last row for the floating Add: the pill, its 8px inset and
   an 8px gap, so every row can scroll fully clear of it. */
.manager-entries-floating {
    padding-bottom: 3.5rem;
}

@media (pointer: coarse) {
    .manager-entries-floating {
        padding-bottom: 4rem;
    }
}

/* Out of the way of a row being dragged over it. */
.manager-footer-floating {
    transition: opacity 150ms;
}

.manager-footer-dragging {
    opacity: 0;
}

/*
 * Classic scrollbars take their room whether or not the list overflows, and
 * the band reserves the same gutter, so adding a row never shifts the columns
 * and the band's count lines up with the rows' counts.
 */
.manager-entries {
    scrollbar-gutter: stable;
    scrollbar-width: thin;
}

/* Rows scrolled under the band: a hairline, a soft shadow and a short fade. */
.manager-band {
    overflow: hidden;
    scrollbar-gutter: stable;
    scrollbar-width: thin;
    transition: box-shadow 150ms;
}

.manager-band-raised {
    @apply shadow-band;
}

.manager-entries-scrolled {
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 0.375rem);
    mask-image: linear-gradient(to bottom, transparent, #000 0.375rem);
}

/* Rows hidden below dissolve toward the floating Add, gone by its middle. */
.manager-entries-more {
    -webkit-mask-image: linear-gradient(
        to bottom,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
    mask-image: linear-gradient(
        to bottom,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
}

.manager-entries-scrolled.manager-entries-more {
    -webkit-mask-image: linear-gradient(
        to bottom,
        transparent,
        #000 0.375rem,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
    mask-image: linear-gradient(
        to bottom,
        transparent,
        #000 0.375rem,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
}

/* Neighbors glide aside while a row is dragged. */
.manager-entries-dragging > li {
    transition: transform 150ms ease;
}

.manager-entries-dragging > li.manager-dragged {
    transition: none;
}
</style>
