import { getCurrentScope, onScopeDispose, watch } from 'vue'
import { isDirty, resetState, state } from '..'
import { parseLevelDataChart } from '../../chart/parse/levelData'
import { validateChart } from '../../chart/validate'
import { i18n } from '../../i18n'
import { serializeToLevelData } from '../../levelData/serialize'
import { showModal } from '../../modals'
import InfoModal from '../../modals/InfoModal.vue'
import LoadingModal from '../../modals/LoadingModal.vue'
import { settings } from '../../settings'
import type { State } from '../../state'
import { hasSameChartData } from '../../state/data'
import { storageGet, storageRemove, storageSet } from '../../storage'
import { timeout } from '../../utils/promise'
import { filename } from '../filename'
import { parseAutoSave } from './parse'
import { serializeAutoSave } from './serialize'

let errorReported = false

export const useAutoSave = () => {
    let id: number | undefined
    let savedState: State | undefined
    let changed = false
    const data = storageGet('autoSave.levelData', undefined)
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
            )
            // setItem is atomic: a failed write leaves the previous recovery intact.
            storageSet('autoSave.levelData', serializeAutoSave(levelData, filename.value))
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
                try {
                    yield () => i18n.value.history.autoSave.importing
                    await timeout(50)
                    signal.throwIfAborted()

                    const { filename, levelData } = parseAutoSave(data)

                    const chart = parseLevelDataChart(levelData.entities)
                    validateChart(chart)

                    resetState(true, chart, levelData.bgmOffset, filename)
                    savedState = state.value
                } finally {
                    restoring = false
                }
            },
        })
    }
}

export const resetAutoSave = () => {
    errorReported = false
}
