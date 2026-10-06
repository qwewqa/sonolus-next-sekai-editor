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
import { isCommandPressed } from './pressed'

const props = defineProps<{ available?: CommandName[] }>()

const toolbar = computed<CommandName[][]>(() => [
    ...settings.toolbar
        .map((group) =>
            props.available ? group.filter((name) => props.available?.includes(name)) : group,
        )
        .filter((group) => group.length),
    ['fullscreen', 'settings', 'openContextMenu', 'help'],
])

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

// A group switches to its member whose tool comes into use, nearest its default.
watch(
    () => toolbar.value.map((group) => group.filter(isCommandPressed)),
    (pressed) => {
        for (const [index, names] of pressed.entries()) {
            const shown = activeNames.value[index]
            const name = names[names.length - 1]
            if (name && shown && !isCommandPressed(shown)) activeNames.value[index] = name
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

// Tools wrap into as few rows as the smallest size allows, balanced so no
// row is left with a few orphans. On touch they then grow, up to 40px, into
// the room those rows leave (36px in short panes, such as a phone held
// sideways, where height is scarce), and a row may be wider to fit them;
// mouse pointers keep 32px in rows up to 36rem.
const minToolSize = 32
const maxCoarseToolSize = 40
const maxShortCoarseToolSize = 36
const shortPaneHeight = 480
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
    void commands[name].execute()

    activeIndex.value = -1
    activeNames.value[index] = name
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
            paddingInline: `clamp(0.75rem, calc((100% - ${isCoarsePointer ? 45 : 36}rem) / 2), 8rem)`,
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
                    :pressed="isCommandPressed(activeName)"
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
                        :pressed="isCommandPressed(name)"
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
