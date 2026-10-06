import { getCurrentScope, onScopeDispose, watch } from 'vue'
import { isDirty, resetState, state } from '..'
import { parseLevelDataChart } from '../../chart/parse/levelData'
import { validateChart } from '../../chart/validate'
import { i18n } from '../../i18n'
import { serializeEditorMetadata } from '../../levelData/editorMetadata'
import { serializeToLevelData } from '../../levelData/serialize'
import { showModal } from '../../modals'
import InfoModal from '../../modals/InfoModal.vue'
import LoadingModal from '../../modals/LoadingModal.vue'
import { settings } from '../../settings'
import type { State } from '../../state'
import { hasSameChartData } from '../../state/data'
import { storageGetText, storageRemove, storageSet } from '../../storage'
import { timeout } from '../../utils/promise'
import { filename } from '../filename'
import { parseAutoSave } from './parse'
import { serializeAutoSave } from './serialize'
import { setRecoveryAside } from './unreadable'
import UnreadableRecoveryModal from './UnreadableRecoveryModal.vue'

let errorReported = false

export const useAutoSave = () => {
    let id: number | undefined
    let savedState: State | undefined
    let changed = false
    // Read as text so damaged JSON still counts as a recovery to keep.
    const data = storageGetText('autoSave.levelData')
    let restoring = !!data

    const flush = () => {
        clearTimeout(id)
        id = undefined
        if (restoring) return
        const current = state.value
        try {
            if (!settings.autoSave || !isDirty.value) {
                // A fresh, untouched tab must not erase another tab's recovery.
                if (changed) storageRemove('autoSave.levelData')
                savedState = undefined
                changed = false
                return
            }
            if (
                savedState &&
                hasSameChartData(savedState, current) &&
                savedState.initialLife === current.initialLife &&
                savedState.bgm.offset === current.bgm.offset &&
                (savedState.filename ?? savedState.bgm.filename) === filename.value
            )
                return

            const levelData = serializeToLevelData(
                current.initialLife,
                current.isDynamicStages,
                current.bgm.offset,
                current.store,
                current.groups,
                current.stages,
                { groups: current.groupFolders, stages: current.stageFolders },
            )
            // setItem is atomic: a failed write leaves the previous recovery intact.
            storageSet(
                'autoSave.levelData',
                serializeAutoSave(
                    levelData,
                    filename.value,
                    serializeEditorMetadata(levelData.entities, current.store),
                ),
            )
            savedState = current
            errorReported = false
        } catch (error) {
            console.error('Failed to save chart recovery:', error)
            if (errorReported) return
            errorReported = true
            void showModal(InfoModal, {
                title: () => i18n.value.history.autoSave.title,
                message: () => i18n.value.history.autoSave.failed,
            })
        }
    }

    const stop = watch(
        () => [settings.autoSave, isDirty.value, state.value] as const,
        () => {
            changed = true
            clearTimeout(id)
            if (!settings.autoSave || !isDirty.value) flush()
            else id = window.setTimeout(flush, settings.autoSaveDelay * 1000)
        },
    )

    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibilityChange)
    if (getCurrentScope())
        onScopeDispose(() => {
            flush()
            stop()
            window.removeEventListener('beforeunload', flush)
            window.removeEventListener('pagehide', flush)
            document.removeEventListener('visibilitychange', onVisibilityChange)
        })

    if (data) {
        void showModal(LoadingModal, {
            title: () => i18n.value.history.autoSave.title,
            async *task(signal: AbortSignal) {
                let keptInPlace = false
                try {
                    yield () => i18n.value.history.autoSave.importing
                    await timeout(50)
                    signal.throwIfAborted()

                    let chart, parsed
                    try {
                        parsed = parseAutoSave(JSON.parse(data))
                        chart = parseLevelDataChart(
                            parsed.levelData.entities,
                            parsed.defaultGuideColors,
                        )
                        validateChart(chart)
                    } catch (error) {
                        console.error('Failed to restore chart recovery:', error)
                        // Never let the next edit replace a recovery this version cannot open.
                        keptInPlace = !setRecoveryAside(data)
                        void showModal(UnreadableRecoveryModal, { text: data, keptInPlace })
                        return
                    }

                    resetState(true, chart, parsed.levelData.bgmOffset, parsed.filename)
                    savedState = state.value
                } finally {
                    // Without a copy aside, auto save stays off so it cannot overwrite it.
                    restoring = keptInPlace
                }
            },
        })
    }
}

export const resetAutoSave = () => {
    errorReported = false
}
