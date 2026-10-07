import type { Command } from '..'
import { setClipboardData } from '../../../clipboard/index.ts'
import { state } from '../../../history'
import { chartSessionId } from '../../../history/chartSession'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { groups } from '../../../history/groups'
import { initialLife } from '../../../history/initialLife'
import { selectedEntities } from '../../../history/selectedEntities'
import { stages } from '../../../history/stages'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import { serializeEditorMetadata } from '../../../levelData/editorMetadata'
import { serializeToLevelDataEntities } from '../../../levelData/entities/serialize'
import type { Entity, EntityOfType, EntityType } from '../../../state/entities'
import { inStoredOrder } from '../../../state/operations/transformSelection'
import { createStore } from '../../../state/store/creates'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { hitAllEntitiesAtPoint } from '../../tools/utils'
import { view, yToValidBeat } from '../../view'
import CopyIcon from './CopyIcon.vue'

export const copy: Command = {
    title: () => i18n.value.commands.copy.title,
    icon: {
        is: CopyIcon,
    },

    execute() {
        const entities = selectedEntities.value

        if (!entities.length) {
            notify(() => i18n.value.commands.copy.noSelected)
            return
        }

        const copiedStore = createStore(
            {
                initialLife: initialLife.value,
                isDynamicStages: isDynamicStages.value,
                bpms: getEntities(entities, 'bpm'),
                timeScales: getEntities(entities, 'timeScale'),
                cameraEvents: getEntities(entities, 'cameraEventJoint'),
                stageMaskEvents: getEntities(entities, 'stageMaskEventJoint'),
                stagePivotEvents: getEntities(entities, 'stagePivotEventJoint'),
                stageStyleEvents: getEntities(entities, 'stageStyleEventJoint'),
                stageTransformEvents: getEntities(entities, 'stageTransformEventJoint'),
                groups: groups.value,
                stages: stages.value,
                slides: getSlides(entities),
            },
            // The selection may hold no BPM; attached notes keep their document places.
            state.value.bpms,
        )
        const copiedEntities = serializeToLevelDataEntities(
            initialLife.value,
            isDynamicStages.value,
            copiedStore,
            groups.value,
            stages.value,
        )

        setClipboardData({
            ...getAnchor(entities, view.pointer.x, view.pointer.y),
            entities: copiedEntities,
            ...serializeEditorMetadata(copiedEntities, copiedStore),
            source: clipboardSource(),
        })

        notify(interpolate(() => i18n.value.commands.copy.copied, `${entities.length}`))
    },
}

/** Lets a paste into the same chart keep each object's own group and stage. */
export const clipboardSource = () => ({
    chart: chartSessionId(),
    groups: [...groups.value.keys()],
    // Stages are listed only with dynamic stages.
    ...(isDynamicStages.value ? { stages: [...stages.value.keys()] } : {}),
})

const getAnchor = (entities: Entity[], x: number, y: number) => {
    const hitEntities = hitAllEntitiesAtPoint(x, y)
        .filter((entity) => entities.includes(entity))
        .sort((a, b) => a.beat - b.beat)
    const sortedEntities = [...entities].sort((a, b) => a.beat - b.beat)

    const note =
        hitEntities.find((entity) => entity.type === 'note') ??
        sortedEntities.find((entity) => entity.type === 'note')
    if (note)
        return {
            lane: note.left + note.size / 2,
            beat: note.beat,
        }

    const entity = hitEntities[0] ?? sortedEntities[0]
    return {
        lane: 0,
        beat: entity?.beat ?? yToValidBeat(y),
    }
}

// A same-beat pair keeps its stored order, whatever the selection order.
const getEntities = <T extends EntityType>(entities: Entity[], type: T) =>
    inStoredOrder(
        state.value,
        entities.filter((entity): entity is EntityOfType<T> => entity.type === type),
        (entity) => entity,
    )

/** Each touched slide's selected notes, in the slide's own order. */
export const getSlides = (entities: Entity[]) => {
    const selectedNotes = entities.filter((entity) => entity.type === 'note')
    const selectedNotesSet = new Set(selectedNotes)

    return [...new Set(selectedNotes.map((note) => note.slideId))].map((slideId) => {
        const notes = store.value.slides.note.get(slideId)
        if (!notes) throw new Error('Unexpected notes not found')

        return notes.filter((note) => selectedNotesSet.has(note))
    })
}
