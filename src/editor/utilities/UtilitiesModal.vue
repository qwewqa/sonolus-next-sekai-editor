<script setup lang="ts">
import { i18n } from '../../i18n'
import { showModal } from '../../modals'
import BaseModal from '../../modals/BaseModal.vue'
import CoverEditorModal from './coverEditor/CoverEditorModal.vue'
import PreviewEditorModal from './previewEditor/PreviewEditorModal.vue'

const utilities = {
    coverEditor: CoverEditorModal,
    previewEditor: PreviewEditorModal,
}
</script>

<template>
    <BaseModal :title="i18n.utilities.title">
        <div class="flex flex-col gap-2">
            <button
                v-for="(modal, name) in utilities"
                :key="name"
                class="h-9 min-w-24 max-w-full truncate rounded-full bg-button px-4 shadow-md outline-none transition-colors hover:shadow-accent focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                @click="showModal(modal, {})"
            >
                {{ i18n.utilities[name].title }}
            </button>
        </div>
    </BaseModal>
</template>
