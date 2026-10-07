<script lang="ts">
import type { CommandName as Name } from '../commands'

// Each layout's shown members, kept while a tool dialog hides the toolbar.
const shownByLayout = new Map<string, Name[]>()
const layoutOf = (toolbar: Name[][]) => toolbar.map((group) => group.join(',')).join('|')
</script>

<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
    useTemplateRef,
    watch,
} from 'vue'
import { settings } from '../../settings'
import { commands, type CommandName } from '../commands'
import { isDragging } from '../controls/gestures/recognizers/drag'
import { isCoarsePointer } from '../workspace'
import { vScrollEdges } from '../../directives/scrollEdges'
import LevelEditorToolbarTool from './LevelEditorToolbarTool.vue'
import {
    maxCoarseToolSize,
    maxShortCoarseToolSize,
    minToolSize,
    shortPaneHeight,
    toolbarGroups,
    toolbarPadding,
} from './layout'
import { commandState, isCommandPressed } from './pressed'

const props = defineProps<{ available?: CommandName[] }>()

const toolbar = computed<CommandName[][]>(() => toolbarGroups(settings.toolbar, props.available))

const activeNames = ref<CommandName[]>([])

watch(
    toolbar,
    (toolbar, previous) => {
        const layout = layoutOf(toolbar)
        if (previous && layoutOf(previous) === layout) return
        // A remount keeps the members shown before; a new layout starts from the defaults.
        const kept = previous ? undefined : shownByLayout.get(layout)
        activeNames.value = toolbar.map(
            (commands, index) => kept?.[index] ?? commands[commands.length - 1] ?? 'select',
        )
    },
    { immediate: true },
)
watch(activeNames, (names) => shownByLayout.set(layoutOf(toolbar.value), [...names]), {
    deep: true,
    immediate: true,
})

const isPressed = (name: CommandName, index: number) =>
    isCommandPressed(name, toolbar.value[index] ?? [])
const stateOf = (name: CommandName, index: number) => commandState(name, toolbar.value[index] ?? [])
// A flyout with values gives every row the check column, so labels line up.
const hasValues = (index: number) =>
    toolbar.value[index]?.some((name) => stateOf(name, index)?.kind === 'value') ?? false

const hasToolInUse = (index: number) =>
    toolbar.value[index]?.some((name) => {
        const state = stateOf(name, index)
        return state?.kind === 'tool' && state.current
    }) ?? false

// Values move a face only in a group whose states are all of one value family.
const followsValues = (index: number) => {
    const states = (toolbar.value[index] ?? []).flatMap((name) => stateOf(name, index) ?? [])
    const families = new Set(states.map((state) => state.kind === 'value' && state.family))
    return families.size === 1 && !families.has(false)
}

// A group shows its tool in use, else its value in use where values move it, nearest its default.
watch(
    () => toolbar.value.map((group) => group.filter((name) => isCommandPressed(name, group))),
    (pressed) => {
        for (const [index, names] of pressed.entries()) {
            const tools = names.filter((name) => stateOf(name, index)?.kind === 'tool')
            const candidates = tools.length || !followsValues(index) ? tools : names
            const shown = activeNames.value[index]
            const name = candidates[candidates.length - 1]
            if (name && shown && !candidates.includes(shown)) activeNames.value[index] = name
        }
    },
    { immediate: true },
)

const activeIndex = ref(-1)
const flyoutId = useId()

/** A group's main tool discloses its flyout, if it has other members. */
const flyoutAttributes = (index: number) =>
    (toolbar.value[index]?.length ?? 0) > 1
        ? {
              'aria-expanded': activeIndex.value === index ? 'true' : 'false',
              'aria-controls': activeIndex.value === index ? flyoutId : undefined,
          }
        : {}

// Sizes and rows follow ./layout, which side docks' defaults leave room for.
const root = useTemplateRef<HTMLDivElement>('root')
const room = ref(0)
const short = ref(false)
const observer = new ResizeObserver(([entry]) => {
    if (!entry) return
    room.value = entry.contentRect.width
    short.value = entry.contentRect.height < shortPaneHeight
})
watch(root, (element, previous) => {
    if (previous) observer.unobserve(previous)
    if (element) observer.observe(element)
})
onBeforeUnmount(() => {
    observer.disconnect()
})
const toolRows = computed(() => {
    const count = activeNames.value.length
    // Until measured, wrap freely at the smallest size.
    if (!room.value) return { perRow: count, size: minToolSize }
    const rows = Math.ceil(count / Math.max(1, Math.floor(room.value / minToolSize)))
    const perRow = Math.ceil(count / Math.max(1, rows))
    const size = isCoarsePointer.value
        ? Math.max(
              minToolSize,
              Math.min(
                  short.value ? maxShortCoarseToolSize : maxCoarseToolSize,
                  Math.floor(room.value / perRow),
              ),
          )
        : minToolSize
    return { perRow, size }
})

// Opening on movement rather than pointerover keeps a group closed when docks
// open or resize and move the toolbar under a resting pointer.
const onOverMain = (event: PointerEvent, index: number) => {
    if (event.pointerType !== 'mouse' || activeIndex.value === index) return

    activeIndex.value = index
}

// Pointer clicks return shortcuts to the editor, so Space cannot click the tool again.
const blurPointerClick = (event: MouseEvent) => {
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
}

const onClickMain = (event: MouseEvent, index: number, name: CommandName) => {
    blurPointerClick(event)
    if (activeIndex.value === -1 && toolbar.value[index] && toolbar.value[index].length > 1) {
        activeIndex.value = index
        return
    }

    void commands[name].execute()

    activeIndex.value = -1
}

const onClickSub = (event: MouseEvent, index: number, name: CommandName) => {
    blurPointerClick(event)
    // The flyout closes under a keyboard choice, so focus returns to its tool first.
    if (event.detail === 0) groups.value[index]?.querySelector('button')?.focus()
    const done = commands[name].execute()

    activeIndex.value = -1
    // A toggle takes the face once in use; one a dialog cancels leaves it on the one in use.
    const show = () => {
        if (isPressed(name, index) === false || !toolbar.value[index]?.includes(name)) return
        // A value leaves the face to a tool in use.
        if (stateOf(name, index)?.kind === 'value' && hasToolInUse(index)) return
        activeNames.value[index] = name
    }
    if (isPressed(name, index) === false) void Promise.resolve(done).then(show)
    else show()
}

const onOverBackdrop = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return

    activeIndex.value = -1
}

// A flyout rises from its tool's top edge, centered on the tool and kept 8px
// inside the pane, so it stays attached to the tool that opened it and is never
// clipped at either edge.
const flyoutMargin = 8
const groups = ref<HTMLElement[]>([])
let flyout: HTMLElement | undefined
const setFlyout = (element: unknown) => {
    flyout = element instanceof HTMLElement ? element : undefined
}
const placement = ref<{ left: number; bottom: number; maxHeight: number }>()

const place = () => {
    const group = groups.value[activeIndex.value]
    const element = flyout
    if (!root.value || !group || !element) return
    const pane = root.value.getBoundingClientRect()
    const tool = group.getBoundingClientRect()
    const width = element.getBoundingClientRect().width
    const center = tool.left + tool.width / 2 - pane.left
    placement.value = {
        left: Math.max(
            flyoutMargin,
            Math.min(center - width / 2, pane.width - flyoutMargin - width),
        ),
        bottom: pane.bottom - tool.top,
        maxHeight: Math.max(0, tool.top - pane.top - flyoutMargin),
    }
}

watch(activeIndex, async () => {
    placement.value = undefined
    if (activeIndex.value === -1) return
    await nextTick()
    place()
})
watch([room, short], place)

// Escape closes an open flyout and returns focus to its tool.
const onKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || activeIndex.value === -1) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const group = groups.value[activeIndex.value]
    activeIndex.value = -1
    group?.querySelector('button')?.focus()
}

onMounted(() => {
    window.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
    <!-- The bottom inset clears the time labels in the canvas corners. -->
    <div
        v-show="!isDragging"
        ref="root"
        data-editor-toolbar
        class="pointer-events-none absolute flex size-full items-end justify-center pb-6"
        :style="{
            paddingInline: toolbarPadding(isCoarsePointer),
            '--tool-size': `${toolRows.size}px`,
        }"
    >
        <div
            class="flex flex-wrap justify-center"
            :style="{ maxWidth: `${toolRows.perRow * toolRows.size}px` }"
        >
            <div
                v-for="(activeName, i) in activeNames"
                :key="i"
                :ref="(element) => element && (groups[i] = element as HTMLElement)"
                class="pointer-events-auto"
                :class="{ 'z-20': activeIndex === i }"
                :inert="activeIndex !== -1 && activeIndex !== i"
            >
                <LevelEditorToolbarTool
                    class="size-[--tool-size] justify-center"
                    :name="activeName"
                    :state="stateOf(activeName, i)"
                    v-bind="flyoutAttributes(i)"
                    @pointermove="onOverMain($event, i)"
                    @click="onClickMain($event, i, activeName)"
                />

                <div
                    v-if="activeIndex === i"
                    :id="flyoutId"
                    :ref="setFlyout"
                    v-scroll-edges
                    class="absolute w-max overflow-y-auto"
                    :class="{ invisible: !placement }"
                    :style="
                        placement && {
                            left: `${placement.left}px`,
                            bottom: `${placement.bottom}px`,
                            maxHeight: `${placement.maxHeight}px`,
                        }
                    "
                >
                    <LevelEditorToolbarTool
                        v-for="(name, j) in toolbar[i]"
                        :key="j"
                        class="mb-1 w-full"
                        :name
                        :state="stateOf(name, i)"
                        :check-column="hasValues(i)"
                        show-label
                        @click="onClickSub($event, i, name)"
                    />
                </div>
            </div>
        </div>
    </div>

    <div
        v-if="activeIndex !== -1"
        class="absolute size-full bg-bg/75"
        @pointerover="onOverBackdrop"
        @click="activeIndex = -1"
    />
</template>
