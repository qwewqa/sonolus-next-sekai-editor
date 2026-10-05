<script setup lang="ts">
import { nextTick, onUnmounted, useTemplateRef, watch } from 'vue'
import ChevronIcon from '../ChevronIcon.vue'
import GripIcon from './icons/GripIcon.vue'
import HiddenIcon from './icons/HiddenIcon.vue'
import MoreIcon from './icons/MoreIcon.vue'
import PartialIcon from './icons/PartialIcon.vue'
import VisibleIcon from './icons/VisibleIcon.vue'
import type { ManagerRowAction } from './model'
import { settings } from '../../../settings'

const props = defineProps<{
    name: string
    /** Tooltip for the name, which may be truncated. */
    nameTitle: string
    /** Whether this row is the authoring target, or a collapsed folder holding it. */
    current: boolean
    shown: boolean
    /** Dims the name, as for hidden entries; band rows keep full-strength text. */
    muted: boolean
    eyeLabel: string
    /** Tooltip for the eye, e.g. with a modifier hint. */
    eyeTitle?: string
    /** The band row of a list, titled in bold like other panel bands. */
    heading?: boolean
    /** A short number in the trailing column, such as an object count. */
    meta?: string
    metaTitle?: string
    /** Actions that overlay the trailing column when the row is in use. */
    actions?: ManagerRowAction[]
    /**
     * When the actions show: `hover` on the current, hovered or focused row
     * (fine pointers), `current` on the current row only (touch).
     */
    inline?: 'hover' | 'current'
    /** The action menu button label; rows without one get a matching spacer. */
    menuLabel?: string
    menuOpen?: boolean
    /** Shows an inline name field instead of the name. */
    renaming?: boolean
    renameLabel?: string
    /** Rows that can be dragged get a handle on touch screens. */
    dragLabel?: string
    dragging?: boolean
    /** Hides the touch drag handle where names need the room. */
    noGrip?: boolean
    /** Reserves the touch handle's room so columns line up with draggable rows. */
    gripSpace?: boolean
    /** Some but not all entries are shown. */
    partial?: boolean
    /** Shows the row without letting it act, e.g. while a feature is off. */
    disabled?: boolean
    /** A folder row: the name toggles whether its members show. */
    folder?: boolean
    /** Whether a folder row's members show. */
    expanded?: boolean
    /** The id of the member list a folder row shows and hides. */
    controls?: string
    /** A folder member, indented under its folder. */
    indented?: boolean
    /** A folder row a dragged entry would drop into. */
    dropTarget?: boolean
}>()

const emit = defineEmits<{
    select: []
    toggle: [solo: boolean]
    action: [key: string, button: HTMLElement, keyboard: boolean]
    menu: [anchor: HTMLElement]
    renameStart: []
    renameEnd: [value: string | undefined, keyboard: boolean]
    dragStart: [event: PointerEvent]
    reorder: [offset: -1 | 1]
    /** Left/Right on a folder name: collapse or expand it. */
    expand: [expanded: boolean]
    /** Left on a member's name: go to its folder. */
    parent: []
}>()

const blurAfterPointer = (event: MouseEvent) => {
    // Pointer clicks return keyboard shortcuts to the editor.
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
}

// Whether the row was already the target when a click sequence began; the
// first click of a double click selects it.
let currentAtPress = false

const onSelect = (event: MouseEvent) => {
    if (suppressClick) {
        suppressClick = false
        return
    }
    if (event.detail <= 1) currentAtPress = props.current
    emit('select')
    // Keep focus through a double click so it can start renaming.
    if (event.detail > 1) return
    blurAfterPointer(event)
}

const onToggle = (event: MouseEvent) => {
    // Alt (or Ctrl/Cmd) shows only this entry, as in layer panels.
    emit('toggle', event.altKey || event.ctrlKey || event.metaKey)
    blurAfterPointer(event)
}

const onAction = (event: MouseEvent, key: string) => {
    const button = event.currentTarget as HTMLElement
    blurAfterPointer(event)
    emit('action', key, button, event.detail === 0)
}

const onMenu = (event: MouseEvent) => {
    emit('menu', event.currentTarget as HTMLElement)
    // An opened menu takes focus itself; a closed one leaves none behind.
    blurAfterPointer(event)
}

const more = useTemplateRef<HTMLButtonElement>('more')

// A right click or a long press opens the same menu as the more button, as on
// rail tabs. Opening never toggles: Android may follow a long press with its
// own contextmenu event.
const openMenu = () => {
    if (more.value && !props.menuOpen) emit('menu', more.value)
}

// iOS fires no contextmenu event for a long press, so a touch held still on the
// name opens the menu itself. The timing and slop match the editor's.
const longPressDelay = 500
const longPressSlop = 10
let longPress: { pointerId: number; x: number; y: number; timer: number } | undefined
let lastPointerType = ''
// The click that ends a long press must not also choose the row.
let suppressClick = false

const cancelLongPress = () => {
    if (longPress) clearTimeout(longPress.timer)
    longPress = undefined
}

onUnmounted(cancelLongPress)

const onRowPointerdown = (event: PointerEvent) => {
    lastPointerType = event.pointerType
}

const onNameLongPressStart = (event: PointerEvent) => {
    suppressClick = false
    cancelLongPress()
    if (event.pointerType !== 'touch' || !event.isPrimary || !settings.touchLongPressContextMenu)
        return
    longPress = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
            longPress = undefined
            suppressClick = true
            openMenu()
        }, longPressDelay),
    }
}

const onNamePointermove = (event: PointerEvent) => {
    if (longPress?.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > longPressSlop)
        cancelLongPress()
}

const onContextMenu = (event: MouseEvent) => {
    if (props.renaming) return
    event.preventDefault()
    // Firefox for Android reports a plain MouseEvent, so use the last pointer.
    const touch =
        event instanceof PointerEvent ? event.pointerType === 'touch' : lastPointerType === 'touch'
    if (!touch) {
        openMenu()
        return
    }
    cancelLongPress()
    if (!settings.touchLongPressContextMenu) return
    suppressClick = true
    openMenu()
}

const onKeydown = (event: KeyboardEvent) => {
    if (props.renaming) return
    if (event.key === 'F2' && props.renameLabel) {
        event.preventDefault()
        emit('renameStart')
    } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
        event.preventDefault()
        openMenu()
    } else if (
        props.dragLabel &&
        event.altKey &&
        (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
        event.preventDefault()
        emit('reorder', event.key === 'ArrowUp' ? -1 : 1)
    } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        !event.altKey &&
        (event.target as HTMLElement).classList.contains('manager-name')
    ) {
        if (props.folder) {
            event.preventDefault()
            emit('expand', event.key === 'ArrowRight')
        } else if (props.indented && event.key === 'ArrowLeft') {
            event.preventDefault()
            emit('parent')
        }
    }
}

const onNamePointerdown = (event: PointerEvent) => {
    onNameLongPressStart(event)
    // A mouse drags rows by their name; touch keeps scrolling the list and
    // drags by the handle instead.
    if (event.pointerType === 'mouse' && props.dragLabel) emit('dragStart', event)
}

/**
 * A double click renames the target only, so it never doubles as choosing a
 * new target; F2 and the menu rename any row.
 */
const onNameDblclick = () => {
    // Folders are never the target; their double click toggles twice, then renames.
    if (props.renameLabel && (currentAtPress || props.folder)) emit('renameStart')
}

const input = useTemplateRef<HTMLInputElement>('input')
let renameDone = false

watch(
    () => props.renaming,
    async (renaming) => {
        if (!renaming) return
        renameDone = false
        await nextTick()
        input.value?.focus({ preventScroll: true })
        input.value?.select()
    },
    { immediate: true },
)

const endRename = (value: string | undefined, keyboard: boolean) => {
    if (renameDone) return
    renameDone = true
    emit('renameEnd', value, keyboard)
}

const onRenameKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
        event.preventDefault()
        endRename((event.currentTarget as HTMLInputElement).value, true)
    } else if (event.key === 'Escape') {
        // Also keeps a surrounding dialog open.
        event.preventDefault()
        event.stopPropagation()
        endRename(undefined, true)
    }
}

const onRenameBlur = (event: FocusEvent) => {
    endRename((event.currentTarget as HTMLInputElement).value, false)
}
</script>

<template>
    <div
        class="manager-row"
        :class="{
            'manager-row-current': current,
            'manager-row-dragging': dragging,
            'manager-row-heading': heading,
            'manager-row-folder': folder,
            'manager-row-indented': indented,
            'manager-row-drop': dropTarget,
        }"
        @keydown="onKeydown"
        @contextmenu="onContextMenu"
        @pointerdown.capture="onRowPointerdown"
    >
        <button
            type="button"
            class="manager-eye manager-icon-button"
            :disabled
            :aria-label="eyeLabel"
            :title="eyeTitle ?? eyeLabel"
            @click="onToggle"
        >
            <component
                :is="partial ? PartialIcon : shown ? VisibleIcon : HiddenIcon"
                class="manager-icon fill-current"
                aria-hidden="true"
            />
        </button>
        <input
            v-if="renaming"
            ref="input"
            class="manager-rename"
            type="text"
            :value="name"
            :aria-label="renameLabel"
            enterkeyhint="done"
            @keydown="onRenameKeydown"
            @blur="onRenameBlur"
        />
        <button
            v-else
            type="button"
            class="manager-name"
            :disabled
            :aria-current="current && !folder ? 'true' : undefined"
            :aria-expanded="folder ? (expanded ? 'true' : 'false') : undefined"
            :aria-controls="expanded ? controls : undefined"
            :title="nameTitle"
            @click="onSelect"
            @dblclick="onNameDblclick"
            @pointerdown="onNamePointerdown"
            @pointermove="onNamePointermove"
            @pointerup="cancelLongPress"
            @pointercancel="cancelLongPress"
        >
            <span v-if="folder" class="manager-chevron" aria-hidden="true">
                <ChevronIcon :direction="expanded ? 'down' : 'right'" />
            </span>
            <!-- Sized to the label, unclipped, so the band marker can sit under it. -->
            <span class="manager-label-box relative flex min-w-0">
                <span
                    class="manager-label truncate"
                    :class="{
                        'font-bold': heading,
                        'font-semibold': folder,
                        'text-fg/80': muted && !heading,
                    }"
                    >{{ name }}</span
                >
            </span>
        </button>
        <div
            v-if="meta !== undefined || actions?.length"
            class="manager-slot"
            :class="actions?.length && inline ? `manager-slot-${inline}` : undefined"
        >
            <span v-if="meta !== undefined" class="manager-meta" :title="metaTitle">{{
                meta
            }}</span>
            <div v-if="actions?.length && inline" class="manager-inline">
                <button
                    v-for="action in actions"
                    :key="action.key"
                    type="button"
                    class="manager-icon-button manager-inline-button"
                    :class="`manager-inline-${action.key}`"
                    :aria-label="action.label"
                    :title="action.label"
                    :disabled="action.disabled"
                    @click="onAction($event, action.key)"
                >
                    <component
                        :is="action.icon"
                        class="manager-icon fill-current"
                        aria-hidden="true"
                    />
                </button>
            </div>
        </div>
        <button
            v-if="menuLabel"
            ref="more"
            type="button"
            class="manager-more manager-icon-button"
            :class="{ 'manager-icon-button-open': menuOpen }"
            :aria-label="menuLabel"
            :title="menuLabel"
            aria-haspopup="menu"
            :aria-expanded="menuOpen ? 'true' : 'false'"
            @click="onMenu"
        >
            <MoreIcon class="manager-icon fill-current" aria-hidden="true" />
        </button>
        <!-- Keeps a count in the shared column; without one, the name takes the room. -->
        <span v-else-if="meta !== undefined" class="manager-icon-spacer" aria-hidden="true" />
        <!-- The touch handle sits at the trailing edge, keeping the eye column aligned. -->
        <span
            v-if="dragLabel && !noGrip"
            class="manager-grip"
            :title="dragLabel"
            aria-hidden="true"
            @pointerdown="emit('dragStart', $event)"
        >
            <GripIcon class="h-3.5 w-2.5 fill-current" />
        </span>
        <span
            v-else-if="gripSpace && meta !== undefined"
            class="manager-grip manager-grip-space"
            aria-hidden="true"
        />
    </div>
</template>

<style scoped>
/*
 * Rows are pills; every control inside is a pill or circle inset evenly by
 * 2px, so shapes stay concentric. Hover styles apply only where hovering
 * exists, so they never stick after a tap.
 */
.manager-row {
    @apply relative flex select-none items-center rounded-full p-0.5 transition-[background-color,box-shadow];
    touch-action: manipulation;
}

/* The authoring target reads like a white pill field; the band row has its own marker. */
.manager-row-current:not(.manager-row-heading) {
    @apply bg-button shadow-md;
}

/* Band rows sit on lavender, where translucent text falls below 4.5:1. */
.manager-row-heading .manager-meta {
    @apply text-fg;
}

/*
 * The collection row is a header-level control. When it is current the band
 * keeps its lavender and the label gets a tab marker flush with the band's
 * lower edge, like the rail's marker on the edge facing the panel. Entries use
 * the white pill, so "All" never reads as one of them (fg on header 4.97:1).
 * It reaches 8px past the label, as the Properties tabs' bar does. It is 4px
 * rather than the rail's 3px: under 16px bold text, and in fg on lavender
 * rather than mint on chrome, a 3px bar reads as a text underline.
 */
.manager-row-heading.manager-row-current .manager-label-box::after {
    content: '';
    /* Row 40px (48 coarse), label 24px centered, band padding 4px (2 coarse):
       the band's lower edge is 14px below the label either way. */
    @apply pointer-events-none absolute -bottom-3.5 -left-2 -right-2 h-1 rounded-t-full bg-fg;
}

/* A dragged row lifts above its neighbors. */
.manager-row-dragging {
    @apply bg-button shadow-lg ring-1 ring-fg/15;
}

.manager-row-dragging .manager-name,
.manager-row-dragging .manager-name:active {
    @apply bg-transparent text-fg;
}

.manager-icon {
    @apply size-4;
}

.manager-icon-button {
    @apply flex size-9 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:pointer-events-none disabled:opacity-40;
}

/* A button whose menu is open holds its hover look. */
.manager-icon-button-open:not(:active) {
    @apply bg-fg/10;
}

.manager-row-heading .manager-icon-button-open:not(:active) {
    @apply bg-white/40;
}

.manager-icon-spacer {
    @apply w-9 shrink-0;
}

.manager-grip {
    @apply hidden h-9 w-7 shrink-0 cursor-grab items-center justify-center text-fg/70;
    touch-action: none;
}

.manager-name {
    @apply flex h-9 min-w-0 flex-1 items-center rounded-full px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:pointer-events-none;
}

.manager-rename {
    @apply h-9 min-w-0 flex-1 rounded-full bg-button px-2 shadow-md outline-none ring-2 ring-fg;
}

/* The folder chevron leads the name, inside its target. */
.manager-chevron {
    @apply mr-1.5 flex w-3 shrink-0 justify-center text-fg/70;
}

.manager-name:active .manager-chevron {
    @apply text-on-accent;
}

/*
 * Members indent their names under the folder's name, past its chevron; the
 * eye, count and menu columns stay aligned with every other row. The folder's
 * guide line runs in this indent (see ManagerList).
 */
.manager-row-indented .manager-name,
.manager-row-indented .manager-rename {
    @apply ml-5;
}

/* The folder a dragged entry would join. */
.manager-row-drop {
    @apply bg-accent/35 ring-2 ring-inset ring-accent;
}

/* One trailing column for counts, which inline actions overlay in place. */
.manager-slot {
    @apply relative flex h-9 w-10 shrink-0 items-center justify-end;
}

.manager-meta {
    @apply text-right text-xs tabular-nums text-fg/80;
}

.manager-inline {
    @apply absolute inset-y-0 right-0 hidden items-center text-fg/70;
}

/* Mouse: actions overlay the count of the row in use (hovered or focused). */
.manager-row:focus-within .manager-slot-hover .manager-inline {
    display: flex;
}

.manager-row:focus-within .manager-slot-hover .manager-meta {
    visibility: hidden;
}

/*
 * Touch has no hover: the target shows its actions beside its count, which
 * keeps its column.
 */
.manager-row-current .manager-slot-current {
    @apply w-auto gap-0.5;
}

.manager-row-current .manager-slot-current .manager-inline {
    @apply static order-first flex;
}

.manager-row-current .manager-slot-current .manager-meta {
    @apply w-10;
}

@media (hover: hover) {
    /* Hover previews the current pill: most of the way to white on the panel,
       a lighter band on lavender. */
    .manager-row:not(.manager-row-current):not(.manager-row-dragging):hover {
        @apply bg-button/70;
    }

    .manager-row.manager-row-heading:not(.manager-row-current):not(.manager-row-dragging):hover {
        @apply bg-header-hover;
    }

    .manager-icon-button:hover:not(:active) {
        @apply bg-fg/10;
    }

    /* Icon buttons on the lavender band lighten, like other band buttons. */
    .manager-row-heading .manager-icon-button:hover:not(:active) {
        @apply bg-white/40;
    }

    .manager-row:hover .manager-slot-hover .manager-inline {
        display: flex;
    }

    .manager-row:hover .manager-slot-hover .manager-meta {
        visibility: hidden;
    }
}

@media (pointer: coarse) {
    .manager-icon-button {
        @apply size-11;
    }

    .manager-icon {
        @apply size-5;
    }

    .manager-icon-spacer {
        @apply w-11;
    }

    .manager-name,
    .manager-rename,
    .manager-slot {
        @apply h-11;
    }

    .manager-name,
    .manager-rename {
        @apply px-2.5;
    }

    .manager-row-indented .manager-name,
    .manager-row-indented .manager-rename {
        @apply ml-[1.125rem];
    }

    /* Touch drags by a visible handle so the list keeps scrolling. */
    .manager-grip {
        @apply flex h-11;
    }
}

/* A dragged row carries its name and count, not the actions of the row in use;
   after the hover rules above so it outranks them. */
.manager-row.manager-row-dragging .manager-slot .manager-inline {
    display: none;
}

.manager-row.manager-row-dragging .manager-slot .manager-meta {
    visibility: visible;
}
</style>
