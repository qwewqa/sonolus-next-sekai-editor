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
    closeModal(modal)
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
