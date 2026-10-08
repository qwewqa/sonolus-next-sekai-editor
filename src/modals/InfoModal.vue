<script setup lang="ts">
import { i18n } from '../i18n'
import BaseModal from './BaseModal.vue'

defineProps<{
    title: () => string
    message: () => string
}>()

defineEmits<{
    close: []
}>()
</script>

<template>
    <BaseModal :title="title()" @close="$emit('close')">
        <div>{{ message() }}</div>

        <div class="flex justify-end">
            <button
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-accent px-4 text-on-accent shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg forced-colors:focus-visible:outline-4 forced-colors:focus-visible:-outline-offset-4 [@media(pointer:coarse)]:h-11"
                @click="$emit('close')"
            >
                {{ i18n.modals.info.ok }}
            </button>
        </div>
    </BaseModal>
</template>
