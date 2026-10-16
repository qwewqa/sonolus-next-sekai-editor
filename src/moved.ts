import { i18n } from './i18n'
import { showModal } from './modals'
import ConfirmModal from './modals/ConfirmModal.vue'

const oldHost = 'next-sekai-editor-test.qwewqa.xyz'
const newUrl = 'https://nse.qwewqa.dev/'

/** Points every visit to the old address at the new one. */
export const showMovedNotice = async () => {
    if (location.hostname !== oldHost) return
    const go = await showModal(ConfirmModal, {
        title: () => i18n.value.moved.title,
        message: () => i18n.value.moved.message,
        confirm: () => i18n.value.moved.go,
    })
    if (go) location.assign(newUrl)
}
