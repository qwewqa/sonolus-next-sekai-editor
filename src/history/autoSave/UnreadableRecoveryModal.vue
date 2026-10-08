<script setup lang="ts">
import { saveAs } from 'file-saver'
import { computed, ref } from 'vue'
import { i18n } from '../../i18n'
import BaseModal from '../../modals/BaseModal.vue'
import { toRecoveryFile, type UnreadableRecovery } from './unreadable'

const props = defineProps<{
    text: string
    kept: UnreadableRecovery
}>()

defineEmits<{
    /** Only Discard removes the stored copy: browsers never confirm a download saved. */
    close: [result?: 'discard']
}>()

const downloaded = ref(false)

const paragraphs = computed(() => {
    const strings = i18n.value.history.autoSave.unreadable
    switch (props.kept) {
        case 'aside':
            return [strings.message, strings.setAside]
        case 'inPlace':
            return [strings.message, strings.keptInPlace]
        case 'waiting':
            return [strings.message, strings.waiting]
        case 'earlier':
            return [strings.earlier, strings.earlierHint]
    }
})

const download = () => {
    const { blob, name } = toRecoveryFile(props.text)
    saveAs(blob, name)
    downloaded.value = true
}
</script>

<template>
    <BaseModal :title="i18n.history.autoSave.title" @close="$emit('close')">
        <div class="flex flex-col gap-2">
            <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
            <p v-if="downloaded" role="status">
                {{ i18n.history.autoSave.unreadable.downloaded }}
            </p>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="download"
            >
                {{ i18n.history.autoSave.unreadable.download }}
            </button>
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="$emit('close', 'discard')"
            >
                {{ i18n.history.autoSave.unreadable.discard }}
            </button>
            <button
                type="button"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-accent px-4 text-on-accent shadow-md outline-none -outline-offset-2 transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-button active:text-fg [@media(pointer:coarse)]:h-11"
                data-autofocus
                @click="$emit('close')"
            >
                {{ i18n.modals.info.ok }}
            </button>
        </div>
    </BaseModal>
</template>
