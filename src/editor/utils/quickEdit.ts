import type {
    ConnectorEase,
    ConnectorLayer,
    ConnectorPresentation,
    ConnectorType,
    FlickDirection,
    NoteSfx,
    NoteType,
} from '../../chart/note'
import { noteStyles, type NoteStyle } from '../../chart/noteStyle'
import { cycleEase } from '../../ease'
import { selectedEntities } from '../../history/selectedEntities'
import type { DefaultNoteSlideProperties } from '../../settings'
import type { Entity } from '../../state/entities'
import type { EditableObject } from '../../state/operations/editable'
import { entries } from '../../utils/object'
import { editSelectedEditableEntities } from '../sidebars/default'

// Note and slide presets edit only the selected notes.
const isNote = (entity: Entity) => entity.type === 'note'

const edit = (object: EditableObject) => {
    editSelectedEditableEntities(object, isNote)
}

export const quickEdit = (properties: DefaultNoteSlideProperties) => {
    let count = 0
    let key: Exclude<keyof DefaultNoteSlideProperties, 'copyProperties'> | undefined

    for (const [k, v] of entries(properties)) {
        if (k === 'copyProperties') continue
        if (v === undefined) continue

        count++
        key = k
    }

    if (count > 1) {
        edit(properties)
        return
    }

    if (!key) return

    let value: unknown
    for (const entity of selectedEntities.value) {
        if (entity.type !== 'note') continue

        if (value === undefined) {
            value = entity[key]
        } else if (value !== entity[key]) {
            value = undefined
            break
        }
    }

    if (value === undefined) {
        edit(properties)
        return
    }

    switch (key) {
        case 'elevation':
            edit({ elevation: properties.elevation })
            break
        case 'noteStyle':
        case 'connectorStyle':
            edit({ [key]: rotate(value as NoteStyle, [...noteStyles]) })
            break
        case 'noteType':
            edit({
                noteType: rotate(value as NoteType, [
                    'default',
                    'trace',
                    'anchor',
                    'damage',
                    'forceTick',
                    'forceNonTick',
                ]),
            })
            break
        case 'isAttached':
            edit({ isAttached: !value })
            break
        case 'isCritical':
            edit({ isCritical: !value })
            break
        case 'flickDirection':
            edit({
                flickDirection: rotate(value as FlickDirection, [
                    'none',
                    'up',
                    'upLeft',
                    'upRight',
                    'down',
                    'downLeft',
                    'downRight',
                ]),
            })
            break
        case 'isFake':
            edit({ isFake: !value })
            break
        case 'sfx':
            edit({
                sfx: rotate(value as NoteSfx, [
                    'default',
                    'none',
                    'normalTap',
                    'criticalTap',
                    'normalFlick',
                    'criticalFlick',
                    'normalTrace',
                    'criticalTrace',
                    'normalTick',
                    'criticalTick',
                    'damage',
                ]),
            })
            break
        case 'isConnectorSeparator':
            edit({ isConnectorSeparator: !value })
            break
        case 'connectorType':
            edit({
                connectorType: rotate(value as ConnectorType, ['active', 'guide', 'damage']),
            })
            break
        case 'connectorEase':
            edit({
                connectorEase: cycleEase(value as ConnectorEase),
            })
            break
        case 'connectorIsFake':
            edit({ connectorIsFake: !value })
            break
        case 'connectorActiveIsCritical':
            edit({ connectorActiveIsCritical: !value })
            break
        case 'connectorGuideAlpha':
            edit({ connectorGuideAlpha: properties.connectorGuideAlpha })
            break
        case 'connectorLayer':
            edit({
                connectorLayer: rotate(value as ConnectorLayer, ['top', 'bottom']),
            })
            break
        case 'connectorIsPassThrough':
            edit({ connectorIsPassThrough: !value })
            break
        case 'connectorPresentation':
            edit({
                connectorPresentation: rotate(value as ConnectorPresentation, [
                    'default',
                    'fullscreen',
                ]),
            })
            break
    }
}

const rotate = <T>(value: T, values: T[]) => values[(values.indexOf(value) + 1) % values.length]
