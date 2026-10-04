<script setup lang="ts">
import { computed } from 'vue'
import { closeModal, modals, type Modal } from '.'

const regularModals = computed(() => modals.filter((modal) => modal.presentation !== 'tool'))

const onClick = (event: MouseEvent, modal: Modal) => {
    if (event.target !== event.currentTarget) return

    closeModal(modal)
}

const vOpen = {
    mounted(el: HTMLDialogElement) {
        el.showModal()
        setTimeout(() => {
            ;(
                el.lastElementChild?.querySelector('label') ??
                el.lastElementChild?.querySelector('button')
            )?.focus()
        }, 0)
    },
}
</script>

<template>
    <dialog
        v-for="modal in regularModals"
        :key="modal.id"
        v-open
        class="flex max-h-full w-full max-w-2xl flex-col rounded-xl bg-modal text-fg shadow-xl backdrop:bg-bg/75"
        @click="onClick($event, modal)"
        @close="closeModal(modal)"
    >
        <component :is="modal.is" v-bind="modal.props" @close="closeModal(modal, $event)" />
    </dialog>
</template>
