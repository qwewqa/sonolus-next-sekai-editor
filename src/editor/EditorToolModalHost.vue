<script setup lang="ts">
import {
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    provide,
    ref,
    useTemplateRef,
    watch,
} from 'vue'
import { closeModal, modals } from '../modals'
import { modalTitleKey } from '../modals/title'
import { toolName } from './tools/state'
import type { ToolModalPane } from './toolModals'

const props = defineProps<{ pane: ToolModalPane }>()
const panel = useTemplateRef<HTMLDivElement>('panel')
const matching = computed(() =>
    modals.filter((modal) => modal.presentation === 'tool' && modal.pane === props.pane),
)
const current = computed(() => matching.value.at(-1))
const label = ref('')
provide(modalTitleKey, label)

// Main tools of the pane's toolbar, which a dialog unmounts and Escape brings back.
const toolButtons = (pane: Element | null | undefined) => [
    ...(pane?.querySelectorAll<HTMLElement>('[data-editor-toolbar] > div > div > button') ?? []),
]

// A tool the keyboard used to open the dialog; pointer clicks leave tools unfocused.
let opener: { pane: Element; index: number } | undefined

// Read before any render unmounts the toolbar.
watch(
    current,
    (modal) => {
        if (!modal) return
        const active = document.activeElement
        const pane = active?.closest('[data-editor-toolbar]')?.parentElement
        // A dialog replacing another keeps its opener.
        if (pane && active instanceof HTMLElement)
            opener = { pane, index: toolButtons(pane).indexOf(active) }
        else if (!panel.value?.contains(active)) opener = undefined
    },
    { flush: 'sync' },
)

watch(current, async (modal) => {
    if (!modal) return
    await nextTick()
    if (current.value !== modal) return
    if (!panel.value?.contains(document.activeElement)) panel.value?.focus({ preventScroll: true })
})
watch(toolName, () => {
    if (current.value) closeModal(current.value)
})

const onKeydown = (event: KeyboardEvent) => {
    const modal = current.value
    if (event.key !== 'Escape' || !modal || modals.at(-1) !== modal) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const pane = panel.value?.parentElement
    const hadFocus = !!panel.value?.contains(document.activeElement)
    const index = opener && opener.pane === pane ? opener.index : -1
    closeModal(modal)
    if (!hadFocus || !(pane instanceof HTMLElement)) return
    // Focus goes back to the tool that opened it, or else to the chart.
    void nextTick(() => {
        if (current.value || !pane.isConnected) return
        const target = toolButtons(pane)[index] ?? pane
        target.focus({ preventScroll: true })
    })
}

onMounted(() => {
    window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown)
    for (const modal of matching.value) closeModal(modal)
})
</script>

<template>
    <div
        v-if="current"
        ref="panel"
        role="dialog"
        :aria-label="label"
        tabindex="-1"
        data-tool-dialog
        class="editor-tool-modal absolute inset-x-0 bottom-2 z-30 mx-auto flex max-h-[70%] w-[calc(100%-1rem)] max-w-md flex-col overflow-hidden rounded-xl bg-modal text-fg shadow-xl outline-none ring-1 ring-fg/10"
        @keydown="onKeydown"
        @pointerdown.stop
        @mousedown.stop
        @touchstart.stop
        @wheel.stop
    >
        <component
            :is="current.is"
            :key="current.id"
            v-bind="current.props"
            @close="closeModal(current, $event)"
        />
    </div>
</template>
