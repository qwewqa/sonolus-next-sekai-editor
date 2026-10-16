import { showModal } from './modals'
import MovedModal from './MovedModal.vue'

const oldHost = 'next-sekai-editor-test.qwewqa.xyz'

/** Points every visit to the old address at the new one. */
export const showMovedNotice = () => {
    if (location.hostname !== oldHost) return
    void showModal(MovedModal, { url: 'https://nse.qwewqa.dev/', host: 'nse.qwewqa.dev' })
}
