import { pushState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import { isEditableEntity, type EditableObject } from '../../../state/operations/editable'
import { planEdit } from '../../../state/operations/properties/plan'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { revealAuthoringTarget } from '../../scope'
import { editBpm } from '../../tools/bpm'
import { editTimeScale } from '../../tools/timeScale'
import { view } from '../../view'
import { fieldLabel, propertyField } from '../../workspace/properties/fields'
export { isEditableEntity } from '../../../state/operations/editable'

/** Names an edit by its one property, and counts the objects it changed. */
export const editLabel = (object: EditableObject, changed: readonly Entity[]) => {
    const keys = Object.entries(object as Record<string, unknown>).flatMap(([key, value]) =>
        value === undefined || !propertyField.has(key as never) ? [] : [key],
    )
    const notes = changed.every((entity) => entity.type === 'note')
    const count = `${changed.length}`
    const field = keys.length === 1 ? propertyField.get(keys[0] as never) : undefined
    if (field)
        return interpolate(
            () => (notes ? i18n.value.sidebars.default.setNotes : i18n.value.sidebars.default.set),
            count,
            () => fieldLabel(field, i18n.value, true),
        )
    return interpolate(
        () =>
            notes ? i18n.value.sidebars.default.editedNotes : i18n.value.sidebars.default.edited,
        count,
    )
}

/** Edits the selected objects, or only those `only` accepts. */
export const editSelectedEditableEntities = (
    object: EditableObject,
    only?: (entity: Entity) => boolean,
) => {
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
