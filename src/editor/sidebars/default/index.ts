import { pushState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import { createEditedEntitiesState } from '../../../state/operations/edit'
import type { EditableObject } from '../../../state/operations/editable'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { editBpm } from '../../tools/bpm'
import { editCameraEvent } from '../../tools/events/camera'
import { editStageMaskEvent } from '../../tools/events/stage/mask'
import { editStagePivotEvent } from '../../tools/events/stage/pivot'
import { editStageStyleEvent } from '../../tools/events/stage/style'
import { editStageTransformEvent } from '../../tools/events/stage/transform'
import { editNote } from '../../tools/note'
import { editTimeScale } from '../../tools/timeScale'
import { view } from '../../view'
export { isEditableEntity } from '../../../state/operations/editable'

export const editSelectedEditableEntities = (object: EditableObject) => {
    if (selectedEntities.value.length === 1) {
        const editEntity = getEditEntity()

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const entity = selectedEntities.value[0]!
        editEntity[entity.type]?.(entity as never, object)
    } else {
        pushState(
            interpolate(
                () => i18n.value.sidebars.default.edited,
                `${selectedEntities.value.length}`,
            ),
            createEditedEntitiesState(state.value, selectedEntities.value, object),
        )
        view.entities = {
            hovered: [],
            creating: [],
        }

        notify(
            interpolate(
                () => i18n.value.sidebars.default.edited,
                `${selectedEntities.value.length}`,
            ),
        )
    }
}

let editEntity:
    | {
          [T in Entity as T['type']]: ((entity: T, object: EditableObject) => void) | undefined
      }
    | undefined

const getEditEntity = () =>
    (editEntity ??= {
        bpm: editBpm,
        timeScale: editTimeScale,

        cameraEventJoint: editCameraEvent,
        cameraEventConnection: undefined,

        stageMaskEventJoint: editStageMaskEvent,
        stageMaskEventConnection: undefined,

        stagePivotEventJoint: editStagePivotEvent,
        stagePivotEventConnection: undefined,

        stageStyleEventJoint: editStageStyleEvent,
        stageStyleEventConnection: undefined,

        stageTransformEventJoint: editStageTransformEvent,
        stageTransformEventConnection: undefined,

        note: editNote,
        connector: undefined,
    })
