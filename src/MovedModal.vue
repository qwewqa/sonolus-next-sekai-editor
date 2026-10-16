<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from './i18n'
import BaseModal from './modals/BaseModal.vue'

defineProps<{
    url: string
    host: string
}>()

defineEmits<{
    close: []
}>()

// The address links where the message places {0}.
const parts = computed(() => i18n.value.moved.message.split('{0}'))
</script>

<template>
    <BaseModal :title="i18n.moved.title" @close="$emit('close')">
        <p>
            {{ parts[0]
            }}<a
                :href="url"
                class="rounded-sm font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-fg"
                >{{ host }}</a
            >{{ parts[1] }}
        </p>

        <div class="flex justify-end gap-2">
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="$emit('close')"
            >
                {{ i18n.modals.confirm.cancel }}
            </button>
            <a
                :href="url"
                class="flex h-9 min-w-24 max-w-full items-center justify-center truncate rounded-full bg-accent px-4 text-on-accent shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg [@media(pointer:coarse)]:h-11"
                data-autofocus
            >
                {{ i18n.moved.go }}
            </a>
        </div>
    </BaseModal>
</template>
