<script setup lang="ts">
import { i18n } from '../../i18n'
import BaseModal from '../BaseModal.vue'

defineProps<{
    title: string
    submitLabel?: string
}>()

defineEmits<{
    submit: []
    close: []
}>()
</script>

<template>
    <BaseModal :title @close="$emit('close')">
        <form @submit.prevent="$emit('submit')">
            <div class="flex flex-col gap-3">
                <slot />
            </div>

            <div class="mt-4 flex justify-end">
                <input
                    class="h-9 min-w-24 max-w-full truncate rounded-full bg-accent px-4 text-on-accent shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg [@media(pointer:coarse)]:h-11"
                    type="submit"
                    :value="submitLabel ?? i18n.modals.form.confirm"
                />
            </div>
        </form>
    </BaseModal>
</template>
