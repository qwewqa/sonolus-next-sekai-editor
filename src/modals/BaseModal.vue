<script setup lang="ts">
import { inject, useId, watch } from 'vue'
import { vScrollEdges } from '../directives/scrollEdges'
import CloseIcon from '../editor/workspace/CloseIcon.vue'
import { i18n } from '../i18n'
import { modalTitleKey } from './title'

const props = defineProps<{
    title: string
}>()

// Only the editor's tool-modal host provides a title; its panels use the
// Heading size, while top-level dialogs keep the larger Title size.
const modalTitle = inject(modalTitleKey, undefined)
if (modalTitle)
    watch(
        () => props.title,
        (title) => (modalTitle.value = title),
        { immediate: true },
    )

defineEmits<{
    close: []
}>()

// The dialog around it is named by this title.
const titleId = useId()
</script>

<template>
    <div
        class="flex h-12 shrink-0 items-center justify-between gap-2 bg-header pl-4 pr-1.5 font-bold [@media(pointer:coarse)]:h-[52px]"
        :class="modalTitle ? 'text-base' : 'text-lg'"
    >
        <span :id="titleId" class="min-w-0 truncate" data-modal-title :title>{{ title }}</span>
        <button
            type="button"
            class="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:size-11"
            :aria-label="i18n.modals.close"
            :title="i18n.modals.close"
            @click="$emit('close')"
        >
            <CloseIcon class="size-4 [@media(pointer:coarse)]:size-5" />
        </button>
    </div>

    <div v-scroll-edges class="relative flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <slot />
    </div>
</template>
