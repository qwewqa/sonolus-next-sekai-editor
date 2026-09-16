import { saveAs } from 'file-saver'
import { gzip } from 'pako'
import type { Command } from '..'
import { levelDataHandle, setLevelDataHandle } from '../../../history'
import { bgm } from '../../../history/bgm'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { filename } from '../../../history/filename'
import { groups } from '../../../history/groups'
import { initialLife } from '../../../history/initialLife'
import { stages } from '../../../history/stages'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import { serializeToLevelData } from '../../../levelData/serialize'
import { showModal } from '../../../modals'
import LoadingModal from '../../../modals/LoadingModal.vue'
import { pickFileForSave } from '../../../utils/file'
import { timeout } from '../../../utils/promise'
import { notify } from '../../notification'
import SaveIcon from './SaveIcon.vue'

export const save: Command = {
    title: () => i18n.value.commands.save.title,
    icon: {
        is: SaveIcon,
    },

    execute() {
        void showModal(LoadingModal, {
            title: () => i18n.value.commands.save.title,
            async *task(signal: AbortSignal) {
                yield () => i18n.value.commands.save.exporting
                await timeout(50)
                signal.throwIfAborted()

                const name = filename.value ?? 'LevelData'

                const levelData = serializeToLevelData(
                    initialLife.value,
                    isDynamicStages.value,
                    bgm.value.offset,
                    store.value,
                    groups.value,
                    stages.value,
                )

                const file = gzip(JSON.stringify(levelData), {
                    level: 9,
                })
                const blob = new Blob([file], {
                    type: 'application/octet-stream',
                })

                const handle = levelDataHandle ?? (await pickFileForSave('levelData', name))
                signal.throwIfAborted()
                if (handle) {
                    let writable: FileSystemWritableFileStream | undefined
                    try {
                        writable = await handle.createWritable()
                        signal.throwIfAborted()
                        await writable.write(blob)
                        signal.throwIfAborted()
                        await writable.close()
                        signal.throwIfAborted()

                        setLevelDataHandle(handle)
                    } catch (error) {
                        // Before close(), writes remain pending. Release the
                        // stream on cancellation/failure without committing it.
                        await writable?.abort().catch(() => undefined)
                        signal.throwIfAborted()
                        if (error instanceof DOMException && error.name === 'AbortError') {
                            throw error
                        }
                        saveAs(blob, name)

                        setLevelDataHandle(undefined)
                    }
                } else {
                    saveAs(blob, name)
                }

                notify(() => i18n.value.commands.save.saved)
            },
        })
    },
}
