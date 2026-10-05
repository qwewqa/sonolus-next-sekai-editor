<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { closeModal, modals, type Modal } from '.'

const regularModals = computed(() => modals.filter((modal) => modal.presentation !== 'tool'))

const onClick = (event: MouseEvent, modal: Modal) => {
    if (event.target !== event.currentTarget) return

    closeModal(modal)
}

// Whether the input that opened a dialog was a pointer: a click or tap focuses
// the dialog itself, so no field shows a focus ring or summons the on-screen
// keyboard, while a keyboard open still lands on the first field.
let byPointer = false
const onPointerDown = () => (byPointer = true)
const onKeyDown = () => (byPointer = false)

onMounted(() => {
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
})
onUnmounted(() => {
    window.removeEventListener('pointerdown', onPointerDown, true)
    window.removeEventListener('keydown', onKeyDown, true)
})

const vOpen = {
    mounted(el: HTMLDialogElement) {
        // The body's primary action always takes focus, as a confirm button must.
        const body = el.lastElementChild
        const primary = body?.querySelector<HTMLElement>('[data-autofocus]')
        const focusDialog = byPointer && !primary
        // Firefox hides a scripted focus ring after an earlier pointer open.
        const focusVisible = !byPointer
        el.toggleAttribute('autofocus', focusDialog)
        el.showModal()
        setTimeout(() => {
            if (focusDialog) {
                el.focus({ preventScroll: true })
                return
            }
            // Otherwise its first field or button.
            const label = body?.querySelector('label')
            ;(primary ?? label?.control ?? label ?? body?.querySelector('button'))?.focus({
                focusVisible,
            })
        }, 0)
    },
}
</script>

<template>
    <!-- An 8px inset from the viewport on every side, like docked dialogs, menus
    and the phone sheet, so rounded corners never meet the screen edge. -->
    <dialog
        v-for="modal in regularModals"
        :key="modal.id"
        v-open
        tabindex="-1"
        class="flex max-h-[calc(100%-1rem)] w-[calc(100%-1rem)] max-w-2xl flex-col rounded-xl bg-modal text-fg shadow-xl outline-none backdrop:bg-bg/75"
        @click="onClick($event, modal)"
        @close="closeModal(modal)"
    >
        <component :is="modal.is" v-bind="modal.props" @close="closeModal(modal, $event)" />
    </dialog>
</template>
