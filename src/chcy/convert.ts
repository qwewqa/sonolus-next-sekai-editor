import type { LevelData, LevelDataEntity } from '@sonolus/core'
import { ImportRefusal } from '../chart/refusal'
import type { UscObject } from '../usc/objects/schema'
import type { Usc } from '../usc/schema'

/**
 * Chart Cyanvas ("chcy-pjsekai-extended") level data, as served by Chart
 * Cyanvas servers such as https://cc.milkbun.org/.
 *
 * Chart Cyanvas generates this level data from USC, so it is converted back to
 * USC and imported like a USC file. The meaning of each archetype and value
 * follows the Next SEKAI engine's converter for this format
 * (`sekai/lib/converter.py`, `convert_pjsekai_extended_level_data`).
 */
type ChcyEntity = LevelDataEntity

/** The engine's test for this format: only it has `TimeScaleGroup` entities. */
export const isChcyLevelData = (data: unknown) =>
    typeof data === 'object' &&
    data !== null &&
    'entities' in data &&
    Array.isArray(data.entities) &&
    data.entities.some(
        (entity: unknown) =>
            typeof entity === 'object' &&
            entity !== null &&
            'archetype' in entity &&
            entity.archetype === 'TimeScaleGroup',
    )

type Single = Extract<UscObject, { type: 'single' }>
type Slide = Extract<UscObject, { type: 'slide' }>
type Connection = Slide['connections'][number]
type Guide = Extract<UscObject, { type: 'guide' }>
type UscEase = Guide['midpoints'][number]['ease']
type UscDirection = NonNullable<Single['direction']>

const eases: Record<number, UscEase> = {
    [-2]: 'outin',
    [-1]: 'out',
    0: 'linear',
    1: 'in',
    2: 'inout',
}

const directions: Record<number, 'left' | 'up' | 'right'> = {
    [-1]: 'left',
    0: 'up',
    1: 'right',
}

const guideColors: Guide['color'][] = [
    'neutral',
    'red',
    'green',
    'blue',
    'yellow',
    'purple',
    'cyan',
    'black',
]

const guideFades: Guide['fade'][] = ['out', 'none', 'in']

const singleNotes: Record<string, { critical: boolean; trace: boolean; flick: boolean }> = {
    NormalTapNote: { critical: false, trace: false, flick: false },
    CriticalTapNote: { critical: true, trace: false, flick: false },
    NormalFlickNote: { critical: false, trace: false, flick: true },
    CriticalFlickNote: { critical: true, trace: false, flick: true },
    NormalTraceNote: { critical: false, trace: true, flick: false },
    CriticalTraceNote: { critical: true, trace: true, flick: false },
    NormalTraceFlickNote: { critical: false, trace: true, flick: true },
    CriticalTraceFlickNote: { critical: true, trace: true, flick: true },
    // The engine reads it as a normal trace flick in the omnidirectional "up".
    NonDirectionalTraceFlickNote: { critical: false, trace: true, flick: true },
}

/**
 * A visible slide start or end without connectors, kept as the single note it
 * judges as. Hidden, attached and ignored ticks have nothing to show alone;
 * ignored ticks are the half-beat combo ticks the editor schedules itself.
 */
const orphanSlideNote = (archetype: string) =>
    /^(Normal|Critical)(Trace)?Slide(Start|End|EndFlick)Note$/.test(archetype)
        ? {
              critical: archetype.startsWith('Critical'),
              trace: archetype.includes('Trace'),
              flick: archetype.includes('Flick'),
          }
        : undefined

const connectorArchetypes: Record<string, boolean> = {
    NormalSlideConnector: false,
    CriticalSlideConnector: true,
}

export const chcyToUsc = (levelData: LevelData): Usc['usc'] => {
    const { entities } = levelData
    const named = new Map<string, ChcyEntity>()
    for (const entity of entities) {
        if (entity.name !== undefined) named.set(entity.name, entity)
    }

    const value = (entity: ChcyEntity, name: string) => {
        const data = entity.data.find((data) => data.name === name)
        return data && 'value' in data ? data.value : undefined
    }
    const number = (entity: ChcyEntity, name: string, fallback?: number) => {
        const result = value(entity, name) ?? fallback
        if (result === undefined || !Number.isFinite(result))
            throw new ImportRefusal('missingValue', entity.archetype, name)
        return result
    }
    const ref = (entity: ChcyEntity, name: string) => {
        const data = entity.data.find((data) => data.name === name)
        return data && 'ref' in data ? named.get(data.ref) : undefined
    }

    const objects: UscObject[] = []

    // Time scale groups, in entity order; each lists its changes from `first`
    // along `next`. Groups without changes leave `first` unresolved.
    const groups = entities.filter(({ archetype }) => archetype === 'TimeScaleGroup')
    for (const group of groups) {
        const changes: { beat: number; timeScale: number }[] = []
        const seen = new Set<ChcyEntity>()
        for (
            let change = ref(group, 'first');
            change?.archetype === 'TimeScaleChange' && !seen.has(change);
            change = ref(change, 'next')
        ) {
            seen.add(change)
            changes.push({
                beat: number(change, '#BEAT'),
                timeScale: number(change, 'timeScale'),
            })
        }
        objects.push({ type: 'timeScaleGroup', changes })
    }
    const groupOf = (entity: ChcyEntity, name = 'timeScaleGroup') => {
        const group = ref(entity, name)
        const index = group ? groups.indexOf(group) : -1
        return Math.max(0, index)
    }

    for (const entity of entities) {
        if (entity.archetype !== '#BPM_CHANGE') continue
        objects.push({ type: 'bpm', beat: number(entity, '#BEAT'), bpm: number(entity, '#BPM') })
    }

    // Slides: the notes joined by one start's connectors, and the ticks
    // attached to them.
    type Connector = {
        entity: ChcyEntity
        head: ChcyEntity
        tail: ChcyEntity
        critical: boolean
        ease: UscEase
    }
    const slides = new Map<ChcyEntity, Connector[]>()
    const connectorsByEntity = new Map<ChcyEntity, Connector>()
    for (const entity of entities) {
        const critical = connectorArchetypes[entity.archetype]
        if (critical === undefined) continue
        const head = ref(entity, 'head')
        const tail = ref(entity, 'tail')
        const start = ref(entity, 'start')
        if (!head || !tail || !start) throw new ImportRefusal('missingNote', entity.archetype)
        const connector: Connector = {
            entity,
            head,
            tail,
            critical,
            ease: eases[value(entity, 'ease') ?? 0] ?? 'linear',
        }
        connectorsByEntity.set(entity, connector)
        const slide = slides.get(start)
        if (slide) slide.push(connector)
        else slides.set(start, [connector])
    }

    const attached = new Map<Connector, ChcyEntity[]>()
    for (const entity of entities) {
        if (entity.archetype === 'IgnoredSlideTickNote') continue
        const target = ref(entity, 'attach')
        const connector = target && connectorsByEntity.get(target)
        if (!connector) continue
        const notes = attached.get(connector)
        if (notes) notes.push(entity)
        else attached.set(connector, [entity])
    }

    const used = new Set<ChcyEntity>()
    for (const [start, connectors] of slides) {
        const critical = connectors[0]?.critical ?? false

        // The order of the joined notes, from the start along the connectors.
        const outgoing = new Map(connectors.map((connector) => [connector.head, connector]))
        const order = new Map<ChcyEntity, number>()
        for (let note: ChcyEntity | undefined = start; note && !order.has(note);) {
            order.set(note, order.size)
            note = outgoing.get(note)?.tail
        }
        const members = new Set<ChcyEntity>()
        for (const connector of connectors) {
            members.add(connector.head).add(connector.tail)
            for (const note of attached.get(connector) ?? []) members.add(note)
        }

        const notes = [...members]
            .map((entity, index) => ({ entity, beat: number(entity, '#BEAT'), index }))
            .sort(
                (a, b) =>
                    a.beat - b.beat ||
                    (order.get(a.entity) ?? Infinity) - (order.get(b.entity) ?? Infinity) ||
                    a.index - b.index,
            )
        if (notes.length < 2) continue

        const connections = notes.map(({ entity, beat }, i): Connection => {
            used.add(entity)
            const { archetype } = entity
            const isCritical = archetype.startsWith('Critical')
            const position = {
                beat,
                timeScaleGroup: groupOf(entity),
                lane: number(entity, 'lane', 0),
                size: number(entity, 'size', 0),
            }
            const ease = outgoing.get(entity)?.ease ?? 'linear'

            if (i === 0) {
                return {
                    type: 'start',
                    ...position,
                    critical: archetype === 'HiddenSlideStartNote' ? critical : isCritical,
                    ease,
                    judgeType: archetype.includes('Trace')
                        ? 'trace'
                        : archetype.startsWith('Hidden')
                          ? 'none'
                          : 'normal',
                }
            }
            if (i === notes.length - 1) {
                const direction = archetype.includes('Flick')
                    ? directions[value(entity, 'direction') ?? 0]
                    : undefined
                return {
                    type: 'end',
                    ...position,
                    critical: archetype.startsWith('Hidden') ? critical : isCritical,
                    ...(direction ? { direction } : {}),
                    judgeType: archetype.includes('Trace')
                        ? 'trace'
                        : archetype.startsWith('Hidden')
                          ? 'none'
                          : 'normal',
                }
            }
            if (archetype.includes('Attached')) {
                return {
                    type: 'attach',
                    beat,
                    critical: isCritical,
                    timeScaleGroup: position.timeScaleGroup,
                }
            }
            // A hidden tick is an anchor, which USC writes as a tick without
            // `critical`.
            return archetype.startsWith('Hidden')
                ? { type: 'tick', ...position, ease }
                : { type: 'tick', ...position, critical: isCritical, ease }
        })
        objects.push({ type: 'slide', critical, connections })
    }

    // Notes outside slides.
    for (const entity of entities) {
        if (used.has(entity)) continue
        const { archetype } = entity
        if (archetype === 'DamageNote') {
            objects.push({
                type: 'damage',
                beat: number(entity, '#BEAT'),
                timeScaleGroup: groupOf(entity),
                lane: number(entity, 'lane', 0),
                size: number(entity, 'size', 0),
            })
            continue
        }

        const single = singleNotes[archetype] ?? orphanSlideNote(archetype)
        if (!single) continue
        const direction: UscDirection | undefined = single.flick
            ? (directions[value(entity, 'direction') ?? 0] ?? 'up')
            : undefined
        objects.push({
            type: 'single',
            beat: number(entity, '#BEAT'),
            timeScaleGroup: groupOf(entity),
            lane: number(entity, 'lane', 0),
            size: number(entity, 'size', 0),
            critical: single.critical,
            trace: single.trace,
            ...(direction ? { direction } : {}),
        })
    }

    // Guides: each `Guide` entity is one piece (head to tail) of a guide
    // running from start to end. Pieces sharing a guide chain head to tail.
    type Point = Guide['midpoints'][number]
    const point = (entity: ChcyEntity, prefix: string, ease: UscEase = 'linear'): Point => ({
        beat: number(entity, `${prefix}Beat`),
        timeScaleGroup: groupOf(entity, `${prefix}TimeScaleGroup`),
        lane: number(entity, `${prefix}Lane`),
        size: number(entity, `${prefix}Size`),
        ease,
    })
    const key = ({ beat, timeScaleGroup, lane, size }: Point) =>
        `${beat}/${timeScaleGroup}/${lane}/${size}`

    type Piece = { head: Point; tail: Point }
    const guides = new Map<
        string,
        { color: Guide['color']; fade: Guide['fade']; pieces: Piece[] }
    >()
    for (const entity of entities) {
        if (entity.archetype !== 'Guide') continue
        const color = guideColors[value(entity, 'color') ?? 0] ?? 'neutral'
        const fade = guideFades[value(entity, 'fade') ?? 1] ?? 'none'
        const guideKey = [key(point(entity, 'start')), key(point(entity, 'end')), color, fade].join(
            '|',
        )
        const piece = {
            head: point(entity, 'head', eases[value(entity, 'ease') ?? 0] ?? 'linear'),
            tail: point(entity, 'tail'),
        }
        const guide = guides.get(guideKey)
        if (guide) guide.pieces.push(piece)
        else guides.set(guideKey, { color, fade, pieces: [piece] })
    }
    for (const { color, fade, pieces } of guides.values()) {
        pieces.sort((a, b) => a.head.beat - b.head.beat)
        // Each chain's last point takes the ease of the piece that continues it.
        const chains: { points: Point[]; last: Point }[] = []
        for (const { head, tail } of pieces) {
            const chain = chains.find(({ last }) => key(last) === key(head))
            if (chain) {
                chain.points.push({ ...chain.last, ease: head.ease })
                chain.last = tail
            } else {
                chains.push({ points: [head], last: tail })
            }
        }
        for (const { points, last } of chains)
            objects.push({ type: 'guide', color, fade, midpoints: [...points, last] })
    }

    return { offset: levelData.bgmOffset, objects }
}
