import { getCurrentScope, onScopeDispose, watch } from 'vue'
import { isDirty, resetState, state } from '..'
import type { Chart } from '../../chart'
import { parseLevelDataChart } from '../../chart/parse/levelData'
import { validateChart } from '../../chart/validate'
import { notify } from '../../editor/notification'
import { i18n } from '../../i18n'
import { serializeEditorMetadata } from '../../levelData/editorMetadata'
import { serializeToLevelData } from '../../levelData/serialize'
import { showModal } from '../../modals'
import ConfirmModal from '../../modals/ConfirmModal.vue'
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
import {
    removeRecovery,
    restoreAside,
    setRecoveryAside,
    unreadableRecoveryKey,
    type UnreadableRecovery,
} from './unreadable'
import UnreadableRecoveryModal from './UnreadableRecoveryModal.vue'

let errorReported = false

export const useAutoSave = () => {
    let id: number | undefined
    let savedState: State | undefined
    let changed = false
    // Read as text so damaged JSON still counts as a recovery to keep.
    const data = storageGetText('autoSave.levelData')
    const initialAside = storageGetText(unreadableRecoveryKey)
    // Auto save waits until both are handled, so it never writes over either.
    let restoring = data !== undefined || initialAside !== undefined

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

    /** Offers an unreadable recovery; true once it is discarded. */
    const offerUnreadable = async (text: string, kept: UnreadableRecovery) => {
        if (!(await showModal(UnreadableRecoveryModal, { text, kept }))) return false
        removeRecovery(kept)
        return true
    }

    const restore = async (data: string | undefined, aside: string | undefined) => {
        const loaded: { primary?: ParsedRecovery; earlier?: ParsedRecovery; done: boolean } = {
            done: false,
        }
        await showModal(LoadingModal, {
            title: () => i18n.value.history.autoSave.title,
            async *task(signal: AbortSignal) {
                yield () => i18n.value.history.autoSave.importing
                await timeout(50)
                signal.throwIfAborted()
                if (data !== undefined) loaded.primary = parseRecovery(data)
                // A newer build may open what an older one set aside.
                if (aside !== undefined) loaded.earlier = parseRecovery(aside)
                loaded.done = true
            },
        })
        // Closed before it finished: auto save stays off, so the recovery waits for the next start.
        if (!loaded.done) {
            // A recovery set aside is safe from auto save already.
            if (data === undefined) restoring = false
            else
                void showModal(InfoModal, {
                    title: () => i18n.value.history.autoSave.title,
                    message: () => i18n.value.history.autoSave.paused,
                })
            return
        }
        const { primary, earlier } = loaded

        // One dialog at a time: an earlier recovery still unreadable first, as discarding it makes room.
        if (aside !== undefined && !earlier) await offerUnreadable(aside, 'earlier')

        if (primary) {
            resetState(true, primary.chart, primary.offset, primary.filename)
            savedState = state.value
        }

        let unreadable: UnreadableRecovery | undefined
        if (aside !== undefined && earlier) {
            // Restoring it must not silently replace a recovery just restored.
            if (
                !isDirty.value ||
                (await showModal(ConfirmModal, {
                    title: () => i18n.value.history.autoSave.title,
                    message: () => i18n.value.history.autoSave.unreadable.restorable,
                    confirm: () => i18n.value.history.autoSave.unreadable.restore,
                }))
            ) {
                resetState(true, earlier.chart, earlier.offset, earlier.filename)
                savedState = state.value
                notify(() => i18n.value.history.autoSave.unreadable.restored)
                unreadable = restoreAside(aside, primary || data === undefined ? undefined : data)
            }
        }

        if (data === undefined || primary) {
            restoring = false
            return
        }
        // Never let the next edit replace a recovery this version cannot open.
        unreadable ??= setRecoveryAside(data)
        // Without a copy aside, auto save stays off so it cannot overwrite it.
        restoring = unreadable !== 'aside'
        // Once a recovery kept in place is handled, auto save resumes.
        if ((await offerUnreadable(data, unreadable)) && unreadable !== 'aside') restoring = false
    }

    if (data !== undefined || initialAside !== undefined) void restore(data, initialAside)
}

type ParsedRecovery = { chart: Chart; offset: number; filename?: string }

/** A stored recovery as a chart, the same way whichever slot it is in; undefined when it cannot open. */
const parseRecovery = (text: string): ParsedRecovery | undefined => {
    try {
        const parsed = parseAutoSave(JSON.parse(text))
        const chart = parseLevelDataChart(parsed.levelData.entities, parsed.defaultGuideColors)
        validateChart(chart)
        return { chart, offset: parsed.levelData.bgmOffset, filename: parsed.filename }
    } catch (error) {
        console.error('Failed to restore chart recovery:', error)
        return
    }
}

export const resetAutoSave = () => {
    errorReported = false
}
