<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { i18n } from '../../i18n'
import { modals } from '../../modals'
import { settings } from '../../settings'
import { interpolateRaw } from '../../utils/interpolate'
import {
    closePanel,
    getPanelPosition,
    isCoarsePointer,
    isTabHiding,
    movePanel,
    onPanelTab,
    toggleDockCollapsed,
    type DockSide,
    type PanelId,
} from '.'
import ChevronIcon from './ChevronIcon.vue'
import CloseIcon from './CloseIcon.vue'
import type { DockLayout } from './layout'
import ManagerMenu, { type ManagerMenuItem } from './manager/ManagerMenu.vue'
import { panelTileId, panelTitle } from './panels'

const props = defineProps<{
    side: DockSide
    dock: DockLayout
}>()

const scroller = useTemplateRef<HTMLDivElement>('scroller')
const vertical = computed(() => props.side !== 'top')

const state = (id: PanelId) => (props.dock.visible.includes(id) ? 'visible' : 'hidden')

const tabTitle = (id: PanelId) =>
    interpolateRaw(
        isTabHiding(id) ? i18n.value.workspace.hide : i18n.value.workspace.show,
        panelTitle(id),
    )

// Roving focus: the tab strip is one Tab stop, which follows arrow keys and
// returns to the first visible tab when the dock changes.
const focusId = computed(
    () => props.dock.panels.find((id) => props.dock.visible.includes(id)) ?? props.dock.panels[0],
)
const rovingId = ref(focusId.value)
watch(focusId, (id) => {
    rovingId.value = id
})

const tabs = () => [...(scroller.value?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]

// Labels that overflow the rail by only a few pixels (e.g. longer translations
// on a phone) fit by trimming each tab's padding from 12px to 8px per side,
// rather than scrolling behind a fade that makes the last label look clipped.
const compactSaving = 8
const compact = ref(false)

// Fade whichever end of the rail has labels scrolled out of view.
const overflow = ref({ start: false, end: false })
const updateOverflow = () => {
    const element = scroller.value
    if (!element) return
    const size = vertical.value ? element.clientHeight : element.clientWidth
    const list = tabs()
    const first = list[0]?.getBoundingClientRect()
    const last = list.at(-1)?.getBoundingClientRect()
    if (first && last) {
        // The strip's length at full padding, whichever padding is applied now.
        const saving = list.length * compactSaving
        const natural =
            (vertical.value ? last.bottom - first.top : last.right - first.left) +
            (compact.value ? saving : 0)
        const next = natural > size + 1 && natural - saving <= size + 1
        if (next !== compact.value) {
            compact.value = next
            // Measure the overflow once the new padding is laid out.
            void nextTick(updateOverflow)
            return
        }
    }
    const position = vertical.value ? element.scrollTop : element.scrollLeft
    const content = vertical.value ? element.scrollHeight : element.scrollWidth
    overflow.value = { start: position > 1, end: position + size < content - 1 }
}
watch(
    () => props.dock.panels.join(),
    async () => {
        await nextTick()
        updateOverflow()
    },
)
watch(scroller, (element, _, onCleanup) => {
    if (!element) return
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    updateOverflow()
    onCleanup(() => {
        observer.disconnect()
    })
})

// Keep a visible tab reachable when labels overflow the rail.
watch(
    () => props.dock.visible.join(),
    async () => {
        await nextTick()
        scroller.value
            ?.querySelector('[aria-selected="true"]')
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    },
    { immediate: true },
)

const blurAfterPointer = (event: MouseEvent) => {
    // Pointer clicks return keyboard shortcuts to the editor.
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
}

// The tab menu: where the panel docks, and closing it.

const menu = shallowRef<{ id: PanelId; anchor: HTMLElement; modals: number; touch: boolean }>()

const dockPositions = ['auto', 'left', 'right', 'top'] as const

const menuItems = computed((): ManagerMenuItem[] => {
    const id = menu.value?.id
    if (!id) return []
    const strings = i18n.value.workspace
    const position = getPanelPosition(id)
    const items: ManagerMenuItem[] = dockPositions.map((value) => ({
        key: value,
        label: strings.dock[value],
        checked: position === value,
    }))
    if (props.dock.open.includes(id))
        items.push({
            key: 'close',
            label: interpolateRaw(strings.closePanel, panelTitle(id)),
            icon: CloseIcon,
            separated: true,
        })
    return items
})

const menuLabel = computed(() =>
    menu.value
        ? interpolateRaw(i18n.value.workspace.manager.actions, panelTitle(menu.value.id))
        : '',
)

// Opening never toggles: a long press, Shift+F10 or the menu key may each be
// followed by a native contextmenu event for the same tab.
const openMenu = (id: PanelId, anchor: HTMLElement, touch = false) => {
    if (menu.value?.id === id) return
    menu.value = { id, anchor, modals: modals.length, touch }
}

const closeMenu = (restoreFocus: boolean) => {
    const current = menu.value
    if (!current) return
    menu.value = undefined
    // Never take focus from a dialog that opened meanwhile.
    if (restoreFocus && modals.length <= current.modals && current.anchor.isConnected)
        current.anchor.focus({ preventScroll: true })
}

// Close when the tab leaves this rail, e.g. when Auto moves its panel.
watch(
    () => props.dock.panels.join(),
    () => {
        if (menu.value && !props.dock.panels.includes(menu.value.id)) closeMenu(false)
    },
)

const onMenuSelect = async (key: string, keyboard: boolean) => {
    const current = menu.value
    if (!current) return
    closeMenu(keyboard)
    const { id } = current
    if (key === 'close') {
        closePanel(id)
        return
    }
    const position = dockPositions.find((value) => value === key)
    if (!position) return
    // Show the panel where it now docks.
    movePanel(id, position)
    if (!keyboard) return
    // The tab may now be in another rail; keyboard focus follows it there.
    await nextTick()
    document.querySelector<HTMLElement>(`[data-panel-tab="${id}"]`)?.focus({ preventScroll: true })
}

// A touch held still opens the menu, as a right click does: iOS fires no
// contextmenu event for a long press on a button. The timing and slop match
// the editor's long press.
const longPressDelay = 500
const longPressSlop = 10
let longPress: { pointerId: number; x: number; y: number; timer: number } | undefined
// The click that ends a long press must not also toggle the panel.
let suppressClick = false

const cancelLongPress = () => {
    if (longPress) clearTimeout(longPress.timer)
    longPress = undefined
}

onUnmounted(cancelLongPress)

const openFromTouch = (id: PanelId, anchor: HTMLElement) => {
    suppressClick = true
    openMenu(id, anchor, true)
}

const onPointerDown = (event: PointerEvent, id: PanelId) => {
    suppressClick = false
    cancelLongPress()
    if (event.pointerType !== 'touch' || !event.isPrimary || !settings.touchLongPressContextMenu)
        return
    const anchor = event.currentTarget as HTMLElement
    longPress = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        timer: window.setTimeout(() => {
            longPress = undefined
            openFromTouch(id, anchor)
        }, longPressDelay),
    }
}

const onPointerMove = (event: PointerEvent) => {
    if (longPress?.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > longPressSlop)
        cancelLongPress()
}

const onContextMenu = (event: MouseEvent, id: PanelId) => {
    event.preventDefault()
    const anchor = event.currentTarget as HTMLElement
    if (!(event instanceof PointerEvent && event.pointerType === 'touch')) {
        openMenu(id, anchor)
        return
    }
    // Android's own long press: the timer would open the same menu.
    cancelLongPress()
    if (settings.touchLongPressContextMenu) openFromTouch(id, anchor)
}

const onMouseDown = (event: MouseEvent) => {
    // The mouse events emulated as a long press ends would focus the tab,
    // taking focus from the menu it opened.
    if (suppressClick) event.preventDefault()
}

const onTab = (event: MouseEvent, id: PanelId) => {
    if (suppressClick) {
        suppressClick = false
        return
    }
    closeMenu(false)
    onPanelTab(id)
    blurAfterPointer(event)
}

const onAuxClick = (event: MouseEvent, id: PanelId) => {
    // A middle click closes a panel, as in browser and editor tabs.
    if (event.button !== 1 || !props.dock.open.includes(id)) return
    event.preventDefault()
    closePanel(id)
    blurAfterPointer(event)
}

const onToggle = (event: MouseEvent) => {
    toggleDockCollapsed(props.side)
    blurAfterPointer(event)
}

const onKeydown = (event: KeyboardEvent, id: PanelId) => {
    const list = tabs()
    const index = list.indexOf(event.currentTarget as HTMLButtonElement)
    const previous = vertical.value ? 'ArrowUp' : 'ArrowLeft'
    const next = vertical.value ? 'ArrowDown' : 'ArrowRight'
    let target: number | undefined
    if (event.key === previous) target = (index - 1 + list.length) % list.length
    else if (event.key === next) target = (index + 1) % list.length
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = list.length - 1
    else if (event.key === 'Delete' && props.dock.open.includes(id)) closePanel(id)
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))
        openMenu(id, event.currentTarget as HTMLElement)
    else return
    event.preventDefault()
    if (target !== undefined) list[target]?.focus()
}

// The chevron points toward the screen edge to tuck the dock away, and back
// out to bring it back.
const chevronDirection = computed(() => {
    const out = ({ left: 'right', right: 'left', top: 'down' } as const)[props.side]
    const edge = ({ left: 'left', right: 'right', top: 'up' } as const)[props.side]
    return props.dock.collapsed ? out : edge
})
</script>

<template>
    <div
        class="panel-rail relative z-20 flex shrink-0 select-none bg-preview text-sm font-medium"
        :class="[
            vertical ? 'flex-col' : 'flex-row',
            vertical ? (isCoarsePointer ? 'w-11' : 'w-9') : isCoarsePointer ? 'h-11' : 'h-9',
            `panel-rail-${side}`,
        ]"
    >
        <div
            ref="scroller"
            class="panel-rail-tabs flex min-h-0 min-w-0 flex-1 gap-0.5 overscroll-contain"
            :class="[
                vertical
                    ? 'flex-col overflow-y-auto overflow-x-hidden'
                    : 'overflow-x-auto overflow-y-hidden',
                { 'fade-start': overflow.start, 'fade-end': overflow.end },
            ]"
            role="tablist"
            :aria-orientation="vertical ? 'vertical' : 'horizontal'"
            :aria-label="i18n.workspace.docks[side]"
            aria-multiselectable="true"
            @scroll.passive="updateOverflow"
        >
            <button
                v-for="id in dock.panels"
                :key="id"
                type="button"
                role="tab"
                class="panel-tab relative flex shrink-0 items-center justify-center whitespace-nowrap rounded transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                :class="[
                    vertical
                        ? `w-full px-0 ${compact ? 'py-2' : 'py-3'}`
                        : `h-full ${compact ? 'px-2' : 'px-3'}`,
                    state(id) === 'visible'
                        ? 'bg-white/10 text-white hover:bg-white/20'
                        : menu?.id === id
                          ? 'bg-white/10 text-white hover:bg-white/10'
                          : 'text-white/80',
                ]"
                :data-panel-tab="id"
                :aria-selected="state(id) === 'visible'"
                :aria-expanded="dock.open.includes(id)"
                :aria-controls="state(id) === 'visible' ? panelTileId(id) : undefined"
                :title="tabTitle(id)"
                :tabindex="id === rovingId ? 0 : -1"
                @click="onTab($event, id)"
                @auxclick="onAuxClick($event, id)"
                @contextmenu="onContextMenu($event, id)"
                @pointerdown="onPointerDown($event, id)"
                @mousedown="onMouseDown"
                @pointermove="onPointerMove"
                @pointerup="cancelLongPress"
                @pointercancel="cancelLongPress"
                @keydown="onKeydown($event, id)"
                @focus="rovingId = id"
            >
                <!-- Only the label turns vertical: Firefox does not keep a flex
                     button with a vertical writing mode centered across updates. -->
                <span :class="{ '[writing-mode:vertical-rl]': vertical }">{{
                    panelTitle(id)
                }}</span>
                <span
                    v-if="state(id) === 'visible'"
                    class="panel-tab-marker pointer-events-none absolute bg-accent forced-colors:bg-[CanvasText]"
                    :class="{
                        'inset-y-1 right-0 w-[3px] rounded-l-full': side === 'left',
                        'inset-y-1 left-0 w-[3px] rounded-r-full': side === 'right',
                        'inset-x-1 bottom-0 h-[3px] rounded-t-full': side === 'top',
                    }"
                    aria-hidden="true"
                />
            </button>
        </div>

        <button
            v-if="dock.open.length"
            type="button"
            class="panel-rail-toggle flex shrink-0 items-center justify-center text-white/80 transition-colors hover:text-white focus-visible:outline-none"
            :class="[vertical ? 'w-full' : 'h-full', isCoarsePointer ? 'size-11' : 'size-9']"
            :aria-label="
                dock.collapsed ? i18n.workspace.expand[side] : i18n.workspace.collapse[side]
            "
            :title="dock.collapsed ? i18n.workspace.expand[side] : i18n.workspace.collapse[side]"
            :aria-expanded="!dock.collapsed"
            @click="onToggle"
        >
            <span
                class="flex size-7 items-center justify-center rounded-full transition-colors"
                :class="dock.collapsed ? 'bg-white/10' : ''"
            >
                <ChevronIcon :direction="chevronDirection" />
            </span>
        </button>

        <ManagerMenu
            v-if="menu"
            :key="menu.id"
            :anchor="menu.anchor"
            :touch="menu.touch"
            :beside="side === 'left' ? 'right' : side === 'right' ? 'left' : undefined"
            :label="menuLabel"
            :items="menuItems"
            @select="onMenuSelect"
            @close="closeMenu"
        />
    </div>
</template>

<style scoped>
/* Borders would shrink the rail's content box below its tabs, so separate the
   rail from its dock body with an inset line instead. */
.panel-rail-left {
    box-shadow: inset -1px 0 0 rgb(255 255 255 / 0.1);
}

.panel-rail-right {
    box-shadow: inset 1px 0 0 rgb(255 255 255 / 0.1);
}

.panel-rail-top {
    box-shadow: inset 0 -1px 0 rgb(255 255 255 / 0.1);
}

.panel-rail-tabs {
    scrollbar-width: none;
}

/* A long press opens the tab menu rather than the iOS callout. */
.panel-tab {
    -webkit-touch-callout: none;
}

/* Pressed is the accent fill every control shares, as on the chevron below;
   the marker steps aside so the fill reads as one shape. */
.panel-tab:active {
    @apply bg-accent text-on-accent;
}

.panel-tab:active .panel-tab-marker {
    opacity: 0;
}

.panel-rail-tabs::-webkit-scrollbar {
    display: none;
}

/* Scrolling a tab into view keeps it clear of the fade at either end. */
.panel-rail-tabs[aria-orientation='horizontal'] {
    --fade-direction: to right;
    scroll-padding-inline: 1rem;
}

.panel-rail-tabs[aria-orientation='vertical'] {
    --fade-direction: to bottom;
    scroll-padding-block: 1rem;
}

.panel-rail-tabs.fade-start {
    -webkit-mask-image: linear-gradient(var(--fade-direction), transparent, black 1rem);
    mask-image: linear-gradient(var(--fade-direction), transparent, black 1rem);
}

.panel-rail-tabs.fade-end {
    -webkit-mask-image: linear-gradient(
        var(--fade-direction),
        black calc(100% - 1rem),
        transparent
    );
    mask-image: linear-gradient(var(--fade-direction), black calc(100% - 1rem), transparent);
}

.panel-rail-tabs.fade-start.fade-end {
    -webkit-mask-image: linear-gradient(
        var(--fade-direction),
        transparent,
        black 1rem,
        black calc(100% - 1rem),
        transparent
    );
    mask-image: linear-gradient(
        var(--fade-direction),
        transparent,
        black 1rem,
        black calc(100% - 1rem),
        transparent
    );
}

.panel-rail-toggle:focus-visible > span {
    box-shadow: 0 0 0 2px theme('colors.accent');
}

/* Hover is the white/10 a collapsed dock holds on the chevron, as an open
   menu's button holds its hover. */
@media (hover: hover) {
    .panel-rail-toggle:hover > span {
        @apply bg-white/10;
    }
}

.panel-rail-toggle:active > span {
    @apply bg-accent text-on-accent;
}
</style>
