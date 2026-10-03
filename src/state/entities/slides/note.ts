import type { SlideId } from '.'
import type { BaseEntity } from '..'
import type { GroupId } from '../../../chart/groups'
import type {
    ConnectorEase,
    ConnectorLayer,
    ConnectorPresentation,
    ConnectorType,
    FlickDirection,
    NoteObject,
    NoteSfx,
    NoteType,
} from '../../../chart/note'
import type { NoteStyle } from '../../../chart/noteStyle'
import type { StageId } from '../../../chart/stages'

export type NoteEntity = BaseEntity & {
    type: 'note'
    slideId: SlideId
    groupId: GroupId
    stageId: StageId
    elevation: number
    noteStyle: NoteStyle
    connectorStyle: NoteStyle
    noteType: NoteType
    isAttached: boolean
    left: number
    size: number
    isCritical: boolean
    flickDirection: FlickDirection
    isFake: boolean
    sfx: NoteSfx
    isConnectorSeparator: boolean
    connectorType: ConnectorType
    connectorEase: ConnectorEase
    connectorLayer: ConnectorLayer
    connectorIsFake: boolean
    connectorActiveIsCritical: boolean
    connectorGuideAlpha: number
    connectorIsPassThrough: boolean
    connectorPresentation: ConnectorPresentation

    useInfoOf?: NoteEntity
}

export const toNoteEntity = (
    slideId: SlideId,
    object: NoteObject,
    useInfoOf?: NoteEntity,
): NoteEntity => ({
    type: 'note',
    hitbox: {
        lane: object.left + object.size / 2,
        beat: object.beat,
        w: object.size / 2,
        h: 0.3,
    },

    slideId,
    groupId: object.groupId,
    stageId: object.stageId,
    beat: object.beat,
    elevation: object.elevation ?? 0,
    noteStyle: object.noteStyle,
    connectorStyle: object.connectorStyle,
    noteType: object.noteType,
    isAttached: object.isAttached,
    left: object.left,
    size: object.size,
    isCritical: object.isCritical,
    flickDirection: object.flickDirection,
    sfx: object.sfx,
    isFake: object.isFake,
    isConnectorSeparator: object.isConnectorSeparator,
    connectorType: object.connectorType,
    connectorEase: object.connectorEase,
    connectorIsFake: object.connectorIsFake,
    connectorActiveIsCritical: object.connectorActiveIsCritical,
    connectorGuideAlpha: object.connectorGuideAlpha,
    connectorLayer: object.connectorLayer,
    connectorIsPassThrough: object.connectorIsPassThrough,
    connectorPresentation: object.connectorPresentation,

    useInfoOf,
})
