<script setup lang="ts">
import { i18n } from '../i18n'
import BaseModal from './BaseModal.vue'

defineProps<{
    title: () => string
    message: () => string
    /** The confirm button's label, e.g. naming the action; "Confirm" by default. */
    confirm?: () => string
    /** Confirming deletes something: the button is red. */
    destructive?: boolean
}>()

defineEmits<{
    close: [result: boolean]
}>()
</script>

<template>
    <BaseModal :title="title()" @close="$emit('close', false)">
        <div>{{ message() }}</div>

        <div class="flex justify-end gap-2">
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="$emit('close', false)"
            >
                {{ i18n.modals.confirm.cancel }}
            </button>
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full px-4 shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg [@media(pointer:coarse)]:h-11"
                :class="destructive ? 'bg-danger text-white' : 'bg-accent text-on-accent'"
                data-autofocus
                @click="$emit('close', true)"
            >
                {{ confirm?.() ?? i18n.modals.confirm.confirm }}
            </button>
        </div>
    </BaseModal>
</template>
