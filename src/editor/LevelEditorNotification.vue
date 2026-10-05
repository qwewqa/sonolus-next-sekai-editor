<script setup lang="ts">
import { computed } from 'vue'
import { notification } from './notification'
import { hasToolModal, type ToolModalPane } from './toolModals'

// Shown within one editor pane, below its header (`inset`, in pixels), so it
// never covers the elevation header or straddles the split between panes.
const props = defineProps<{ pane: ToolModalPane; inset?: number }>()

// A tool dialog rises from the bottom of its pane, so notifications move to
// the top rather than fading over its fields.
const top = computed(() => hasToolModal(props.pane))
</script>

<template>
    <div
        class="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-2"
        :class="top ? 'items-start pt-4' : 'items-center'"
        :style="{ top: `${inset ?? 0}px` }"
    >
        <div
            v-if="notification"
            :key="notification.id"
            class="notification whitespace-break-spaces rounded-full px-6 py-2 text-center"
        >
            {{ notification.message() }}
        </div>
    </div>
</template>

<style scoped>
.notification {
    animation-name: fade;
    animation-duration: 1s;
    animation-fill-mode: forwards;
}

@keyframes fade {
    0% {
        z-index: 100;
        /* Dark text on mint, as on every accent fill (8.9:1). */
        color: theme('colors.on-accent');
        background-color: theme('colors.accent');
    }

    99% {
        z-index: 100;
    }

    100% {
        color: rgb(255 255 255 / 0.25);
        background-color: rgb(119 239 220 / 0);
    }
}
</style>
