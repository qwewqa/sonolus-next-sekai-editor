import type { NoteObject } from '../../chart/note'
import { guideColor } from '../../chart/noteStyle'
import { activeColors, connectorStyleColor, damageColor, guideColors } from '../../utils/colors'

type ConnectorProperties = Partial<
    Pick<
        NoteObject,
        'connectorType' | 'connectorStyle' | 'connectorActiveIsCritical' | 'isCritical'
    >
>

const shade = (color: string, target: number, amount: number) =>
    `#${[1, 3, 5]
        .map((offset) => {
            const channel = parseInt(color.slice(offset, offset + 2), 16)
            return Math.round(channel + (target - channel) * amount)
                .toString(16)
                .padStart(2, '0')
        })
        .join('')}`

// Match the skin's family cues without depending on loaded preview assets:
// active connectors have light edges, damage connectors dark bodies and edges,
// and guides are flat. Keep black distinguishable from both the grid and damage.
export const connectorColors = (properties: ConnectorProperties) => {
    if (properties.connectorType === 'guide')
        return { body: guideColors[guideColor(properties.connectorStyle)], edge: undefined }

    const critical = properties.connectorActiveIsCritical ?? properties.isCritical
    const style = properties.connectorStyle ?? 'default'
    const styled = style !== 'default'
    const base = styled
        ? connectorStyleColor(style)
        : properties.connectorType === 'damage'
          ? damageColor
          : activeColors[critical ? 'critical' : 'normal']

    if (properties.connectorType === 'damage')
        return { body: shade(base, 0, 0.22), edge: shade(base, 0, 0.65) }

    const body = styled && critical ? shade(base, 255, 0.5) : base
    return { body, edge: shade(body, 255, 0.25) }
}
