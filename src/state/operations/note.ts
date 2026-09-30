import type { NoteObject } from '../../chart/note'
import type { NoteEntity } from '../entities/slides/note'
import { replaceNote } from '../mutations/slides/note'
import type { Transaction } from '../transaction'

export const editSelectedNote = (
    transaction: Transaction,
    entity: NoteEntity,
    object: Partial<NoteObject>,
) => {
    return replaceNote(transaction, entity, {
        groupId: object.groupId ?? entity.groupId,
        stageId: object.stageId ?? entity.stageId,
        beat: object.beat ?? entity.beat,
        noteStyle: object.noteStyle ?? entity.noteStyle,
        connectorStyle: object.connectorStyle ?? entity.connectorStyle,
        noteType: object.noteType ?? entity.noteType,
        isAttached: object.isAttached ?? entity.isAttached,
        left: object.left ?? entity.left,
        size: object.size ?? entity.size,
        isCritical: object.isCritical ?? entity.isCritical,
        flickDirection: object.flickDirection ?? entity.flickDirection,
        isFake: object.isFake ?? entity.isFake,
        sfx: object.sfx ?? entity.sfx,
        isConnectorSeparator: object.isConnectorSeparator ?? entity.isConnectorSeparator,
        connectorType: object.connectorType ?? entity.connectorType,
        connectorEase: object.connectorEase ?? entity.connectorEase,
        connectorIsFake: object.connectorIsFake ?? object.isFake ?? entity.connectorIsFake,
        connectorActiveIsCritical:
            object.connectorActiveIsCritical ??
            object.isCritical ??
            entity.connectorActiveIsCritical,
        connectorGuideAlpha: object.connectorGuideAlpha ?? entity.connectorGuideAlpha,
        connectorLayer: object.connectorLayer ?? entity.connectorLayer,
        connectorIsPassThrough: object.connectorIsPassThrough ?? entity.connectorIsPassThrough,
        connectorPresentation: object.connectorPresentation ?? entity.connectorPresentation,
    })
}
