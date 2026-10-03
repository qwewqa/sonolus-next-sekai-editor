import type { GroupId } from './groups'
import type { NoteStyle } from './noteStyle'
import type { StageId } from './stages'

export type NoteType = 'default' | 'trace' | 'anchor' | 'damage' | 'forceTick' | 'forceNonTick'

export type FlickDirection =
    'none' | 'up' | 'upLeft' | 'upRight' | 'down' | 'downLeft' | 'downRight'

export type NoteSfx =
    | 'default'
    | 'none'
    | 'normalTap'
    | 'criticalTap'
    | 'normalFlick'
    | 'criticalFlick'
    | 'normalTrace'
    | 'criticalTrace'
    | 'normalTick'
    | 'criticalTick'
    | 'damage'

export type ConnectorType = 'active' | 'guide' | 'damage'

export type ConnectorEase = 'linear' | 'in' | 'out' | 'inOut' | 'outIn' | 'none'

export type ConnectorLayer = 'top' | 'bottom' | 'under' | 'over'

export type ConnectorPresentation = 'default' | 'fullscreen'

export type NoteObject = {
    groupId: GroupId
    stageId: StageId
    beat: number
    elevation?: number
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
    connectorIsFake: boolean
    connectorActiveIsCritical: boolean
    connectorGuideAlpha: number
    connectorLayer: ConnectorLayer
    connectorIsPassThrough: boolean
    connectorPresentation: ConnectorPresentation
}
