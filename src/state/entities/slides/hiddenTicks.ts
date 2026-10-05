import type { StoreSlides } from '../../store/slides'
import type { NoteEntity } from './note'
import { getActiveNoteRole } from './semantics'

export type SlideInfos = StoreSlides['info'] extends Map<unknown, infer T> ? T : never

export const beatToTicks = 480
export const ticksPerHiddenTick = beatToTicks / 2

/**
 * A transient hidden tick the engine judges along an active or damage connector
 * (TransientHiddenTickNote / TransientHiddenDamageTickNote). The level data
 * serializer emits exactly these, and the preview's hitbox overlay schedules the
 * same ones, so both share this schedule.
 */
export type HiddenTick = {
    /** Index in the slide's infos of the connector tail the tick precedes. */
    endpoint: number
    tick: number
    connectorType: 'active' | 'damage'
    attachHead: NoteEntity
    attachTail: NoteEntity
    /** The damage connector's head, for damage ticks. */
    damageHead?: NoteEntity
}

// Ticks are listed in serialization order: connector by connector, each
// connector's ticks in time order, then its damage tail tick.
export const scheduleHiddenTicks = (infos: SlideInfos): HiddenTick[] => {
    const ticks: HiddenTick[] = []

    let head: NoteEntity | undefined
    // Active heads at or before the current connector: later heads must not
    // suppress earlier connectors' ticks.
    const disallowHiddenTicks = new Set<number>()
    for (const [i, info] of infos.entries()) {
        const isFirst = i === 0
        const isLast = i === infos.length - 1
        const tick = Math.round(info.note.beat * beatToTicks)

        if (getActiveNoteRole(info) === 'head') {
            disallowHiddenTicks.add(tick)
        }

        if (!isFirst && !isLast && info.note.isAttached && !info.note.isConnectorSeparator) {
            continue
        }

        if (
            head &&
            info.segmentHead.connectorType !== 'guide' &&
            !info.segmentHead.connectorIsFake
        ) {
            const connectorType = info.segmentHead.connectorType
            const addTick = (tick: number) => {
                if (connectorType === 'damage' && !info.damageHead) {
                    throw new Error('Unexpected missing head')
                }
                ticks.push({
                    endpoint: i,
                    tick,
                    connectorType,
                    attachHead: info.attachHead,
                    attachTail: info.attachTail,
                    damageHead: connectorType === 'damage' ? info.damageHead : undefined,
                })
            }

            const headTick = Math.round(head.beat * beatToTicks)
            for (
                let i = Math.ceil(headTick / ticksPerHiddenTick) * ticksPerHiddenTick;
                i < tick;
                i += ticksPerHiddenTick
            ) {
                switch (connectorType) {
                    case 'active':
                        if (disallowHiddenTicks.has(i)) continue
                        break
                    case 'damage':
                        if (info.damageHead === head && headTick === i) continue
                        break
                }

                addTick(i)
            }

            if (info.damageTail === info.note) {
                addTick(tick)
            }
        }

        head = info.note
    }

    return ticks
}
