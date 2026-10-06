<script setup lang="ts">
import { saveAs } from 'file-saver'
import { i18n } from '../../i18n'
import BaseModal from '../../modals/BaseModal.vue'
import { toRecoveryFile } from './unreadable'

const props = defineProps<{
    text: string
    /** Storage refused the copy, so auto save stays off for this tab. */
    keptInPlace: boolean
}>()

defineEmits<{
    close: []
}>()

const download = () => {
    const { blob, name } = toRecoveryFile(props.text)
    saveAs(blob, name)
}
</script>

<template>
    <BaseModal :title="i18n.history.autoSave.title" @close="$emit('close')">
        <div class="flex flex-col gap-2">
            <p>{{ i18n.history.autoSave.unreadable.message }}</p>
            <p>
                {{
                    keptInPlace
                        ? i18n.history.autoSave.unreadable.keptInPlace
                        : i18n.history.autoSave.unreadable.setAside
                }}
            </p>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="download"
            >
                {{ i18n.history.autoSave.unreadable.download }}
            </button>
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-accent px-4 text-on-accent shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg [@media(pointer:coarse)]:h-11"
                data-autofocus
                @click="$emit('close')"
            >
                {{ i18n.modals.info.ok }}
            </button>
        </div>
    </BaseModal>
</template>
