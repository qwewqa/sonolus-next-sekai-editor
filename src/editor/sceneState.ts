import { computed } from 'vue'
import { state } from '../history'
import { cullAllEntities, cullEntities, hitAllEntities, hitEntities } from '../history/store'
import { isToolModalOpen } from '../modals'
import { getPreviewState } from '../preview/edit'
import type { EntityType } from '../state/entities'

export const sceneState = computed(() =>
    isToolModalOpen.value ? getPreviewState(state.value) : state.value,
)
export const sceneBpms = computed(() => sceneState.value.bpms)
export const isScenePreview = computed(() => sceneState.value !== state.value)

export const cullSceneEntities = <T extends EntityType>(type: T, minKey: number, maxKey: number) =>
    cullEntities(type, minKey, maxKey, sceneState.value.store)

export const cullAllSceneEntities = (minKey: number, maxKey: number) =>
    cullAllEntities(minKey, maxKey, sceneState.value.store)

export const hitSceneEntities = <T extends EntityType>(
    type: T,
    laneMin: number,
    laneMax: number,
    timeMin: number,
    timeMax: number,
    minimumNoteWidth = 0,
) => hitEntities(type, laneMin, laneMax, timeMin, timeMax, minimumNoteWidth, sceneState.value)

export const hitAllSceneEntities = (
    laneMin: number,
    laneMax: number,
    timeMin: number,
    timeMax: number,
    minimumNoteWidth = 0,
) => hitAllEntities(laneMin, laneMax, timeMin, timeMax, minimumNoteWidth, sceneState.value)
