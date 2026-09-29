import type { BpmObject } from '../../chart/bpm'
import type { CameraEventObject } from '../../chart/events/camera'
import type { StageMaskEventObject } from '../../chart/events/stage/mask'
import type { StagePivotEventObject } from '../../chart/events/stage/pivot'
import type { StageStyleEventObject } from '../../chart/events/stage/style'
import type { StageTransformEventObject } from '../../chart/events/stage/transform'
import type { NoteObject } from '../../chart/note'
import type { TimeScaleObject } from '../../chart/timeScale'
import type { Entity } from '../entities'
import type { BpmEntity } from '../entities/bpm'
import type { CameraEventJointEntity } from '../entities/events/joints/camera'
import type { StageMaskEventJointEntity } from '../entities/events/joints/stage/mask'
import type { StagePivotEventJointEntity } from '../entities/events/joints/stage/pivot'
import type { StageStyleEventJointEntity } from '../entities/events/joints/stage/style'
import type { StageTransformEventJointEntity } from '../entities/events/joints/stage/transform'
import type { NoteEntity } from '../entities/slides/note'
import type { TimeScaleEntity } from '../entities/timeScale'

export type EditableObject = Partial<
    BpmObject &
        TimeScaleObject &
        CameraEventObject &
        StageMaskEventObject &
        StagePivotEventObject &
        StageStyleEventObject &
        StageTransformEventObject &
        NoteObject
>

export type EditableEntity =
    | BpmEntity
    | TimeScaleEntity
    | CameraEventJointEntity
    | StageMaskEventJointEntity
    | StagePivotEventJointEntity
    | StageStyleEventJointEntity
    | StageTransformEventJointEntity
    | NoteEntity

export const isEditableEntity = (entity: Entity) =>
    entity.type === 'bpm' ||
    entity.type === 'timeScale' ||
    entity.type === 'cameraEventJoint' ||
    entity.type === 'stageMaskEventJoint' ||
    entity.type === 'stagePivotEventJoint' ||
    entity.type === 'stageStyleEventJoint' ||
    entity.type === 'stageTransformEventJoint' ||
    entity.type === 'note'
