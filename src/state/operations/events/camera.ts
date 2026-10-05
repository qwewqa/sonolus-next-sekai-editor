import type { CameraEventObject } from '../../../chart/events/camera'
import { applyEaseEdit, type WithEaseEdits } from '../../../ease'
import type { CameraEventJointEntity } from '../../entities/events/joints/camera'
import { addCameraEventJoint, removeCameraEventJoint } from '../../mutations/events/camera'
import type { Transaction } from '../../transaction'

export const editSelectedCameraEvent = (
    transaction: Transaction,
    entity: CameraEventJointEntity,
    object: Partial<WithEaseEdits<CameraEventObject>>,
) => {
    removeCameraEventJoint(transaction, entity)
    return addCameraEventJoint(transaction, {
        beat: object.beat ?? entity.beat,
        cameraLeft: object.cameraLeft ?? entity.cameraLeft,
        cameraSize: object.cameraSize ?? entity.cameraSize,
        cameraZoom: object.cameraZoom ?? entity.cameraZoom,
        cameraZoomTargetLane: object.cameraZoomTargetLane ?? entity.cameraZoomTargetLane,
        cameraZoomTargetY: object.cameraZoomTargetY ?? entity.cameraZoomTargetY,
        cameraZoomVerticalAlign: object.cameraZoomVerticalAlign ?? entity.cameraZoomVerticalAlign,
        cameraRotation: object.cameraRotation ?? entity.cameraRotation,
        cameraStageTilt: object.cameraStageTilt ?? entity.cameraStageTilt,
        eventEase: applyEaseEdit(object.eventEase, entity.eventEase),
    })
}
