import { pushState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import { isEditableEntity, type EditableObject } from '../../../state/operations/editable'
import { isEditInRange, planEdit } from '../../../state/operations/properties/plan'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { revealAuthoringTarget } from '../../scope'
import { editBpm } from '../../tools/bpm'
import { editTimeScale } from '../../tools/timeScale'
import { view } from '../../view'
import { fieldLabel, propertyField } from '../../workspace/properties/fields'
export { isEditableEntity } from '../../../state/operations/editable'

// Event joints and the word messages qualify their events with.
const eventKinds = {
    cameraEventJoint: 'cameraEvent',
    stageMaskEventJoint: 'stageMaskEvent',
    stagePivotEventJoint: 'stagePivotEvent',
    stageStyleEventJoint: 'stageStyleEvent',
    stageTransformEventJoint: 'stageTransformEvent',
} as const

type Messages = { set: () => string; edited: () => string; kind?: () => string }

// Messages naming the one kind that changed, else objects.
const kindMessages = (changed: readonly Entity[]): Messages => {
    const kinds = new Set(changed.map(({ type }) => type))
    const [kind] = kinds
    const t = () => i18n.value
    if (kinds.size !== 1 || !kind)
        return { set: () => t().sidebars.default.set, edited: () => t().sidebars.default.edited }
    if (kind === 'note')
        return {
            set: () => t().sidebars.default.setNotes,
            edited: () => t().sidebars.default.editedNotes,
        }
    if (kind === 'bpm')
        return { set: () => t().sidebars.default.setBpm, edited: () => t().tools.bpm.edited }
    if (kind === 'timeScale')
        return {
            set: () => t().sidebars.default.setTimeScales,
            edited: () => t().tools.timeScale.edited,
        }
    if (kind in eventKinds) {
        const event = eventKinds[kind as keyof typeof eventKinds]
        return {
            set: () => t().sidebars.default.setEvents,
            edited: () => t().tools.events.edited,
            kind: () => t().eventKinds[event],
        }
    }
    return { set: () => t().sidebars.default.set, edited: () => t().sidebars.default.edited }
}

/** Names an edit by its one property, and counts the objects it changed. */
export const editLabel = (object: EditableObject, changed: readonly Entity[]) => {
    const keys = Object.entries(object as Record<string, unknown>).flatMap(([key, value]) =>
        value === undefined || !propertyField.has(key as never) ? [] : [key],
    )
    const messages = kindMessages(changed)
    const count = String(changed.length)
    const kind = messages.kind ?? (() => '')
    const field = keys.length === 1 ? propertyField.get(keys[0] as never) : undefined
    if (field)
        return interpolate(messages.set, count, () => fieldLabel(field, i18n.value, true), kind)
    return interpolate(messages.edited, count, kind)
}

/** Edits the selected objects, or only those `only` accepts. */
export const editSelectedEditableEntities = (
    object: EditableObject,
    only?: (entity: Entity) => boolean,
) => {
    // Refused without a notice, as fields refuse out-of-range values.
    if (!isEditInRange(state.value, selectedEntities.value, object, only)) return
    const { state: edited, changed } = planEdit(state.value, selectedEntities.value, object, {
        only,
    })
    if (!changed.length) {
        notify(() => i18n.value.sidebars.default.noChange)
        return
    }

    // Moving objects into a hidden group or stage reveals it, like authoring.
    revealAuthoringTarget(object)

    // A lone BPM or time scale moving by beat says so, as its tool does.
    const [entity] = changed
    if (
        selectedEntities.value.filter(isEditableEntity).length === 1 &&
        object.beat !== undefined &&
        object.beat !== entity?.beat
    ) {
        if (entity?.type === 'bpm') {
            editBpm(entity, object)
            return
        }
        if (entity?.type === 'timeScale') {
            editTimeScale(entity, object)
            return
        }
    }

    const label = editLabel(object, changed)
    pushState(label, edited)
    view.entities = {
        hovered: [],
        creating: [],
    }

    notify(label)
}
