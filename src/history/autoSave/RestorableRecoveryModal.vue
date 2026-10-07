<script setup lang="ts">
import { i18n } from '../../i18n'
import BaseModal from '../../modals/BaseModal.vue'

defineEmits<{
    /** Cancel, Escape and the backdrop keep the earlier recovery for the next start. */
    close: [result?: 'restore' | 'discard']
}>()
</script>

<template>
    <BaseModal :title="i18n.history.autoSave.title" @close="$emit('close')">
        <div>{{ i18n.history.autoSave.unreadable.restorable }}</div>

        <div class="flex flex-wrap justify-end gap-2">
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="$emit('close', 'discard')"
            >
                {{ i18n.history.autoSave.unreadable.discard }}
            </button>
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="$emit('close')"
            >
                {{ i18n.modals.confirm.cancel }}
            </button>
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-accent px-4 text-on-accent shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg [@media(pointer:coarse)]:h-11"
                data-autofocus
                @click="$emit('close', 'restore')"
            >
                {{ i18n.history.autoSave.unreadable.restore }}
            </button>
        </div>
    </BaseModal>
</template>
