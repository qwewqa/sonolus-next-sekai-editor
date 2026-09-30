import Type from 'typebox'
import type { NoteObject } from './note'

export const noteStyles = [
    'default',
    'neutral',
    'red',
    'green',
    'blue',
    'yellow',
    'purple',
    'cyan',
    'black',
] as const

export type NoteStyle = (typeof noteStyles)[number]

export const noteStyleSchema = Type.Union([
    Type.Literal('default'),
    Type.Literal('neutral'),
    Type.Literal('red'),
    Type.Literal('green'),
    Type.Literal('blue'),
    Type.Literal('yellow'),
    Type.Literal('purple'),
    Type.Literal('cyan'),
    Type.Literal('black'),
])
export const noteStyleValueSchema = Type.Integer({ minimum: 0, maximum: 8 })

export const noteStyleValue = (style: NoteStyle) => noteStyles.indexOf(style)

export const guideColor = (style: NoteStyle = 'default') => (style === 'default' ? 'green' : style)

// Colored segment kinds encode the family in the tens digit and color in the units digit.
export const connectorKindValue = (
    note: Pick<
        NoteObject,
        'connectorType' | 'connectorIsFake' | 'connectorActiveIsCritical' | 'connectorStyle'
    >,
) => {
    if (note.connectorType === 'guide') return 100 + noteStyleValue(guideColor(note.connectorStyle))
    const family = note.connectorType === 'damage' ? 3 : note.connectorActiveIsCritical ? 2 : 1
    const style = noteStyleValue(note.connectorStyle)
    return (note.connectorIsFake ? 50 : 0) + (style > 0 ? family * 10 + style : family)
}

export const coloredConnectorKinds = [10, 20, 30, 60, 70, 80].flatMap((base) =>
    noteStyles.slice(1).map((_, i) => base + i + 1),
)

export const connectorBaseKind = (kind: number) => {
    if (!coloredConnectorKinds.includes(kind)) return kind
    return kind < 50 ? Math.floor(kind / 10) : 50 + Math.floor((kind - 50) / 10)
}

export const connectorStyle = (kind: number): NoteStyle =>
    coloredConnectorKinds.includes(kind) || (kind >= 101 && kind <= 108)
        ? (noteStyles[kind % 10] ?? 'default')
        : 'default'
