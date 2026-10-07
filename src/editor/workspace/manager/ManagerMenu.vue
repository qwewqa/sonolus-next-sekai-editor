<script setup lang="ts">
import {
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    ref,
    useId,
    useTemplateRef,
    type Component,
} from 'vue'
import { vScrollEdges } from '../../../directives/scrollEdges'
import { menuKeyIndex } from '../../../utils/menuKeys'
import { swallowPress } from '../../../utils/swallowPress'
import { createTypeAhead, isTypeAheadKey } from '../../../utils/typeAhead'
import { isInWorkspaceDock, workspaceDockAttribute } from '..'

export type ManagerMenuItem = {
    key: string
    label: string
    /** Choice items omit it: their slot holds the check mark instead. */
    icon?: Component
    disabled?: boolean
    /** Makes the item one choice of a radio group, checked or not. */
    checked?: boolean
    /** Destructive items are set apart and tinted. */
    destructive?: boolean
    /** Starts a new section of related items. */
    separated?: boolean
    /** Items sharing a group sit under its heading. */
    group?: string
}

const props = defineProps<{
    anchor: HTMLElement
    label: string
    items: ManagerMenuItem[]
    /**
     * Opened by a touch: the first item takes focus without the keyboard
     * highlight, which script focus would otherwise show after a touch.
     */
    touch?: boolean
    /**
     * Opens beside the anchor toward this side, aligned to its top, rather
     * than below or above it: for anchors in a vertical rail at a screen edge.
     */
    beside?: 'left' | 'right'
    /** Opened by ArrowUp: the last item takes focus. */
    focusLast?: boolean
}>()

const emit = defineEmits<{
    select: [key: string, keyboard: boolean, touch: boolean]
    close: [restoreFocus: boolean]
}>()

const menu = useTemplateRef<HTMLDivElement>('menu')
const headingId = useId()

// Grouped menus without icons or checks need no glyph column.
const glyphless = computed(() =>
    props.items.every(
        (item) => item.group !== undefined && !item.icon && item.checked === undefined,
    ),
)

// Runs of items sharing a group; ungrouped runs render as plain items.
const sections = computed(() =>
    props.items.reduce<{ group?: string; items: ManagerMenuItem[] }[]>((sections, item) => {
        const last = sections.at(-1)
        if (last && last.group === item.group) last.items.push(item)
        else sections.push({ group: item.group, items: [item] })
        return sections
    }, []),
)
const scroller = useTemplateRef<HTMLDivElement>('scroller')

// A modal dialog renders in the top layer, so a menu opened from inside one
// must render inside it too to appear above it.
const container = computed(() => props.anchor.closest('dialog') ?? 'body')

const margin = 8
const gap = 4
const placement = ref<{ left: number; top: number; maxHeight?: number }>()
let anchorAt: { left: number; top: number } | undefined

const place = () => {
    const element = menu.value
    if (!element) return
    const anchor = props.anchor.getBoundingClientRect()
    anchorAt = { left: anchor.left, top: anchor.top }
    const width = element.offsetWidth
    // The items scroll inside; measure their full height, not the clipped box.
    const height = scroller.value?.scrollHeight ?? element.scrollHeight
    const viewportWidth = document.documentElement.clientWidth
    const viewportHeight = window.innerHeight

    const besideLeft =
        props.beside === 'right'
            ? anchor.right + gap
            : props.beside === 'left'
              ? anchor.left - gap - width
              : undefined
    if (
        besideLeft !== undefined &&
        besideLeft >= margin &&
        besideLeft + width <= viewportWidth - margin
    ) {
        const room = viewportHeight - margin * 2
        placement.value = {
            left: besideLeft,
            top: Math.max(margin, Math.min(anchor.top, viewportHeight - margin - height)),
            maxHeight: height > room ? room : undefined,
        }
        return
    }

    const below = viewportHeight - anchor.bottom - gap - margin
    const above = anchor.top - gap - margin

    let top: number
    let maxHeight: number | undefined
    if (height <= below) {
        top = anchor.bottom + gap
    } else if (height <= above) {
        top = anchor.top - gap - height
    } else if (Math.max(below, above) >= Math.min(height, 160)) {
        // Neither side fits the whole menu: use the roomier side and scroll.
        maxHeight = Math.max(below, above)
        top = below >= above ? anchor.bottom + gap : margin
    } else {
        // Very short screens: cover the anchor rather than squeeze the menu.
        maxHeight = Math.max(0, viewportHeight - margin * 2)
        top = Math.max(margin, Math.min(anchor.bottom + gap, viewportHeight - margin - height))
    }

    placement.value = {
        left: Math.max(margin, Math.min(anchor.right - width, viewportWidth - margin - width)),
        top,
        maxHeight,
    }
}

const buttons = () =>
    [
        ...(menu.value?.querySelectorAll<HTMLButtonElement>(
            '[role="menuitem"], [role="menuitemradio"]',
        ) ?? []),
    ].filter((button) => !button.disabled)

let active = true

onMounted(async () => {
    await nextTick()
    place()
    // Hidden elements cannot take focus, so wait for the placed menu to show.
    await nextTick()
    if (!active) return
    const list = buttons()
    ;(props.focusLast ? list.at(-1) : list[0])?.focus({
        preventScroll: true,
        ...(props.touch && { focusVisible: false }),
    })

    window.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
})

onUnmounted(() => {
    active = false
    window.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onDismiss)
    window.removeEventListener('blur', onDismiss)
})

const onDismiss = () => {
    emit('close', false)
}

const onOutside = (event: PointerEvent) => {
    const target = event.target
    if (!(target instanceof Node)) return
    // The anchor toggles the menu itself on click.
    if (menu.value?.contains(target) || props.anchor.contains(target)) return
    // The press only closes the menu, so closing never edits what lies under it. A
    // right press in a dock only opens menus, so it moves the menu there instead.
    if (event.button !== 2 || !(target instanceof Element) || !isInWorkspaceDock(target))
        swallowPress(event)
    emit('close', false)
}

const onScroll = (event: Event) => {
    if (event.target instanceof Node && menu.value?.contains(event.target)) return
    // Close once the anchor moves away; a late scroll event from bringing the
    // anchor into view before opening leaves it in place.
    const anchor = props.anchor.getBoundingClientRect()
    if (
        anchorAt &&
        Math.abs(anchor.left - anchorAt.left) < 1 &&
        Math.abs(anchor.top - anchorAt.top) < 1
    )
        return
    emit('close', false)
}

const typeAhead = createTypeAhead()

const onKeydown = (event: KeyboardEvent) => {
    // Letters and digits move to the next item starting with what was typed.
    if (isTypeAheadKey(event)) {
        // Also keeps Firefox's quick find closed.
        event.preventDefault()
        const list = buttons()
        const labels = list.map(
            (button) =>
                props.items.find((item) => item.key === button.dataset.menuKey)?.label ?? '',
        )
        const current = list.findIndex((button) => button === document.activeElement)
        const next = typeAhead(event.key, labels, current)
        if (next !== undefined) list[next]?.focus()
    } else if (event.key === 'Escape') {
        // Also keeps a surrounding dialog open.
        event.preventDefault()
        emit('close', true)
    } else if (event.key === 'Tab') {
        // Focus returns to the anchor first, so Tab continues from there.
        emit('close', true)
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const list = buttons()
        const index = list.findIndex((button) => button === document.activeElement)
        const next = menuKeyIndex(event.key, index, list.length)
        if (next !== undefined) list[next]?.focus()
    }
}

// Firefox for Android reports a plain MouseEvent click, so the last press tells touch apart.
let lastPointerType = ''
const onPointerDown = (event: PointerEvent) => (lastPointerType = event.pointerType)

const onSelect = (event: MouseEvent, item: ManagerMenuItem) => {
    if (item.disabled) return
    const keyboard = event.detail === 0
    const touch =
        !keyboard &&
        (event instanceof PointerEvent ? event.pointerType : lastPointerType) === 'touch'
    emit('select', item.key, keyboard, touch)
}
</script>

<template>
    <Teleport :to="container">
        <div
            ref="menu"
            :[workspaceDockAttribute]="'menu'"
            role="menu"
            :aria-label="label"
            class="manager-menu popup-surface fixed z-50"
            :class="{ invisible: !placement }"
            :style="{
                left: `${placement?.left ?? 0}px`,
                top: `${placement?.top ?? 0}px`,
                maxHeight: placement?.maxHeight === undefined ? '' : `${placement.maxHeight}px`,
            }"
            @keydown.stop="onKeydown"
            @pointerdown.capture="onPointerDown"
            @contextmenu.prevent
        >
            <!-- The fade marks more items; the menu's own chrome stays crisp. -->
            <div ref="scroller" v-scroll-edges role="none" class="popup-scroller">
                <template v-for="(section, index) in sections" :key="index">
                    <div
                        v-if="section.group !== undefined && index > 0"
                        role="separator"
                        class="popup-separator"
                    />
                    <div
                        :role="section.group === undefined ? 'none' : 'group'"
                        :aria-labelledby="
                            section.group === undefined ? undefined : `${headingId}-${index}`
                        "
                        :class="section.group === undefined ? 'contents' : 'flex shrink-0 flex-col'"
                    >
                        <div
                            v-if="section.group !== undefined"
                            :id="`${headingId}-${index}`"
                            aria-hidden="true"
                            class="manager-menu-heading popup-heading"
                        >
                            {{ section.group }}
                        </div>
                        <template v-for="item in section.items" :key="item.key">
                            <div
                                v-if="item.separated || item.destructive"
                                role="separator"
                                class="popup-separator"
                            />
                            <button
                                type="button"
                                :role="item.checked === undefined ? 'menuitem' : 'menuitemradio'"
                                :aria-checked="item.checked"
                                tabindex="-1"
                                class="manager-menu-item popup-item"
                                :class="{ 'text-danger': item.destructive }"
                                :disabled="item.disabled"
                                :data-menu-key="item.key"
                                @click="onSelect($event, item)"
                            >
                                <component
                                    :is="item.icon"
                                    v-if="item.icon"
                                    class="size-4 shrink-0 fill-current"
                                    aria-hidden="true"
                                />
                                <svg
                                    v-else-if="item.checked"
                                    class="size-4 shrink-0 fill-current"
                                    viewBox="0 0 448 512"
                                    aria-hidden="true"
                                >
                                    <!--! Font Awesome Free 6.6.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2024 Fonticons, Inc. -->
                                    <path
                                        d="M438.6 105.4c12.5 12.5 12.5 32.8 0 45.3l-256 256c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L160 338.7 393.4 105.4c12.5-12.5 32.8-12.5 45.3 0z"
                                    />
                                </svg>
                                <span
                                    v-else-if="!glyphless"
                                    class="size-4 shrink-0"
                                    aria-hidden="true"
                                />
                                <span class="flex-1">{{ item.label }}</span>
                            </button>
                        </template>
                    </div>
                </template>
            </div>
        </div>
    </Teleport>
</template>
