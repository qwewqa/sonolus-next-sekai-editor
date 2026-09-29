import {
    ParticleEffectName,
    type ParticleData,
    type ParticleDataEffect,
    type ParticleItem,
    type ServerItemDetails,
    type ServerItemList,
} from '@sonolus/core'
import { noteStyles, type NoteStyle } from '../chart/noteStyle'
import type { Tint } from './gl'
import { parseGzippedJson, parseScp } from './scp'
import { toSpriteUv, type Sprite } from './skin'

export type ParticleExpression = Partial<Record<string, number>>

export type ParticleProperty = {
    from: ParticleExpression
    to: ParticleExpression
    ease: string
}

export type ResolvedParticle = {
    sprite: Sprite | undefined
    tint: Tint
    start: number
    duration: number
    x: ParticleProperty
    y: ParticleProperty
    w: ParticleProperty
    h: ParticleProperty
    r: ParticleProperty
    a: ParticleProperty
}

export type ResolvedGroup = {
    count: number
    particles: ResolvedParticle[]
}

export type ParticleEffect = {
    transform?: Record<string, ParticleExpression>
    groups: ResolvedGroup[]
}

export type NoteParticleSet = {
    circular?: ParticleEffect
    linear?: ParticleEffect
    directional?: ParticleEffect
    tick?: ParticleEffect
    lane?: ParticleEffect
    laneBasic?: ParticleEffect
    slotLinear?: ParticleEffect
}

export type ConnectorParticleSet = {
    circular?: ParticleEffect
    linear?: ParticleEffect
    trailLinear?: ParticleEffect
    slotLinear?: ParticleEffect
}

export type PreviewParticle = {
    styles?: Partial<Record<NoteStyle, PreviewParticle>>
    lane?: ParticleEffect

    normalNote: NoteParticleSet
    slideNote: NoteParticleSet
    flickNote: NoteParticleSet
    downFlickNote: NoteParticleSet
    criticalNote: NoteParticleSet
    criticalSlideNote: NoteParticleSet
    criticalFlickNote: NoteParticleSet
    criticalDownFlickNote: NoteParticleSet
    traceNote: NoteParticleSet
    traceFlickNote: NoteParticleSet
    traceDownFlickNote: NoteParticleSet
    criticalTraceNote: NoteParticleSet
    criticalTraceFlickNote: NoteParticleSet
    criticalTraceDownFlickNote: NoteParticleSet
    normalSlideTickNote: NoteParticleSet
    criticalSlideTickNote: NoteParticleSet
    damageNote: NoteParticleSet

    normalSlideConnector: ConnectorParticleSet
    criticalSlideConnector: ConnectorParticleSet
}

export type LoadedParticle = {
    title: string
    interpolation: boolean
    texture: ImageBitmap
    particle: PreviewParticle
}

export const loadParticleFromScp = async (buffer: ArrayBuffer): Promise<LoadedParticle> => {
    const scp = parseScp(buffer)

    const list = scp.getJson<ServerItemList<ParticleItem>>('sonolus/particles/list')
    const item = list?.items[0]
    if (!item) throw new Error('No particle found in scp file')

    const details = scp.getJson<ServerItemDetails<ParticleItem>>(`sonolus/particles/${item.name}`)
    const particleItem = details?.item ?? item

    const dataRaw = particleItem.data.url ? scp.get(particleItem.data.url) : undefined
    if (!dataRaw) throw new Error('Missing particle data in scp file')
    const data = parseGzippedJson<ParticleData>(dataRaw)

    const textureRaw = particleItem.texture.url ? scp.get(particleItem.texture.url) : undefined
    if (!textureRaw) throw new Error('Missing particle texture in scp file')
    const texture = await createImageBitmap(new Blob([new Uint8Array(textureRaw)]), {
        premultiplyAlpha: 'premultiply',
        colorSpaceConversion: 'none',
    })

    const sprites = data.sprites.map((sprite): Sprite => ({
        ...toSpriteUv(sprite.x, sprite.y, sprite.w, sprite.h, data.width, data.height),
        texture: 1,
    }))

    const effects = new Map<string, ParticleEffect>()
    for (const effect of data.effects) {
        if (effects.has(effect.name)) continue

        effects.set(effect.name, toEffect(effect, sprites))
    }

    return {
        title: particleItem.title,
        interpolation: data.interpolation,
        texture,
        particle: resolveParticle((name) => effects.get(name)),
    }
}

const parseColor = (color: string): Tint => {
    let hex = color.startsWith('#') ? color.slice(1) : color
    if (hex.length === 3) {
        hex = hex
            .split('')
            .map((c) => c + c)
            .join('')
    }
    const value = Number.parseInt(hex.slice(0, 6), 16)
    if (Number.isNaN(value)) return { r: 1, g: 1, b: 1 }

    return {
        r: ((value >> 16) & 0xff) / 255,
        g: ((value >> 8) & 0xff) / 255,
        b: (value & 0xff) / 255,
    }
}

const identityTransformKeys = ['x1', 'x2', 'x3', 'x4', 'y1', 'y2', 'y3', 'y4'] as const

const toEffect = (effect: ParticleDataEffect, sprites: Sprite[]): ParticleEffect => {
    let transform: Record<string, ParticleExpression> | undefined
    for (const key of identityTransformKeys) {
        const expression: ParticleExpression = effect.transform[key]
        for (const [name, value] of Object.entries(expression)) {
            if (value === (name === key ? 1 : 0)) continue

            transform = effect.transform
            break
        }
        if (transform) break
    }

    return {
        transform,
        groups: effect.groups.map((group) => ({
            count: group.count,
            particles: group.particles.map((particle): ResolvedParticle => ({
                sprite: sprites[particle.sprite],
                tint: parseColor(particle.color),
                start: particle.start,
                duration: particle.duration,
                x: toProperty(particle.x),
                y: toProperty(particle.y),
                w: toProperty(particle.w),
                h: toProperty(particle.h),
                r: toProperty(particle.r),
                a: toProperty(particle.a),
            })),
        })),
    }
}

const toProperty = (property: {
    from?: ParticleExpression
    to?: ParticleExpression
    ease?: string
}): ParticleProperty => ({
    from: property.from ?? {},
    to: property.to ?? {},
    ease: property.ease ?? 'linear',
})

export const resolveParticle = (
    get: (name: string) => ParticleEffect | undefined,
): PreviewParticle => {
    const first = (...names: string[]) => {
        for (const name of names) {
            const effect = get(name)
            if (effect) return effect
        }
        return undefined
    }

    const lane = get(ParticleEffectName.LaneLinear)

    const normalNoteLane = get('Sekai Note Lane Linear')
    const slideNoteLane = first('Sekai Slide Lane Linear', 'Sekai Note Lane Linear')
    const flickNoteLane = get('Sekai Flick Lane Linear')
    const downFlickNoteLane = first('Sekai Down Flick Lane Linear', 'Sekai Flick Lane Linear')
    const criticalNoteLane = get('Sekai Critical Lane Linear')
    const criticalSlideNoteLane = first(
        'Sekai Critical Slide Lane Linear',
        'Sekai Critical Lane Linear',
    )
    const criticalFlickNoteLane = get('Sekai Critical Flick Lane Linear')
    const criticalDownFlickNoteLane = first(
        'Sekai Critical Down Flick Lane Linear',
        'Sekai Critical Flick Lane Linear',
    )

    const flickDirectional = first(
        'Sekai Flick Note Directional',
        ParticleEffectName.NoteLinearAlternativeRed,
    )
    const downFlickDirectional = first(
        'Sekai Down Flick Note Directional',
        'Sekai Flick Note Directional',
        ParticleEffectName.NoteLinearAlternativeRed,
    )
    const criticalDirectional = first(
        'Sekai Critical Note Directional',
        ParticleEffectName.NoteLinearAlternativeYellow,
    )
    const criticalDownFlickDirectional = first(
        'Sekai Critical Down Flick Note Directional',
        'Sekai Critical Note Directional',
        ParticleEffectName.NoteLinearAlternativeYellow,
    )

    const particle: PreviewParticle = {
        lane,

        normalNote: {
            circular: first('Sekai Normal Note Circular', ParticleEffectName.NoteCircularTapCyan),
            linear: first('Sekai Normal Note Linear', ParticleEffectName.NoteLinearTapCyan),
            lane: normalNoteLane,
            laneBasic: lane,
            slotLinear: first('Sekai Normal Note Slot Linear', 'Sekai Slot Linear Tap Cyan'),
        },
        slideNote: {
            circular: first('Sekai Slide Note Circular', ParticleEffectName.NoteCircularTapGreen),
            linear: first('Sekai Slide Note Linear', ParticleEffectName.NoteLinearTapGreen),
            lane: slideNoteLane,
            laneBasic: lane,
            slotLinear: first('Sekai Slide Note Slot Linear', 'Sekai Slot Linear Tap Green'),
        },
        flickNote: {
            circular: first('Sekai Flick Note Circular', ParticleEffectName.NoteCircularTapRed),
            linear: first('Sekai Flick Note Linear', ParticleEffectName.NoteLinearTapRed),
            directional: flickDirectional,
            lane: flickNoteLane,
            slotLinear: first('Sekai Flick Note Slot Linear', 'Sekai Slot Linear Alternative Red'),
        },
        downFlickNote: {
            circular: first(
                'Sekai Down Flick Note Circular',
                'Sekai Flick Note Circular',
                ParticleEffectName.NoteCircularTapRed,
            ),
            linear: first(
                'Sekai Down Flick Note Linear',
                'Sekai Flick Note Linear',
                ParticleEffectName.NoteLinearTapRed,
            ),
            directional: downFlickDirectional,
            lane: downFlickNoteLane,
            slotLinear: first(
                'Sekai Down Flick Note Slot Linear',
                'Sekai Flick Note Slot Linear',
                'Sekai Slot Linear Alternative Red',
            ),
        },
        criticalNote: {
            circular: first(
                'Sekai Critical Note Circular',
                ParticleEffectName.NoteCircularTapYellow,
            ),
            linear: first('Sekai Critical Note Linear', ParticleEffectName.NoteLinearTapYellow),
            lane: criticalNoteLane,
            laneBasic: lane,
            slotLinear: first('Sekai Critical Note Slot Linear', 'Sekai Slot Linear Tap Yellow'),
        },
        criticalSlideNote: {
            circular: first(
                'Sekai Critical Slide Note Circular',
                'Sekai Critical Slide Circular Yellow',
                'Sekai Critical Note Circular',
                ParticleEffectName.NoteCircularTapYellow,
            ),
            linear: first(
                'Sekai Critical Slide Note Linear',
                'Sekai Critical Slide Linear Yellow',
                'Sekai Critical Note Linear',
                ParticleEffectName.NoteLinearTapYellow,
            ),
            lane: criticalSlideNoteLane,
            laneBasic: lane,
            slotLinear: first(
                'Sekai Critical Slide Note Slot Linear',
                'Sekai Slot Linear Slide Tap Yellow',
                'Sekai Critical Note Slot Linear',
                'Sekai Slot Linear Tap Yellow',
            ),
        },
        criticalFlickNote: {
            circular: first(
                'Sekai Critical Flick Note Circular',
                'Sekai Critical Flick Circular Yellow',
                'Sekai Critical Note Circular',
                ParticleEffectName.NoteCircularTapYellow,
            ),
            linear: first(
                'Sekai Critical Flick Note Linear',
                'Sekai Critical Flick Linear Yellow',
                'Sekai Critical Note Linear',
                ParticleEffectName.NoteLinearTapYellow,
            ),
            directional: criticalDirectional,
            lane: criticalFlickNoteLane,
            laneBasic: lane,
            slotLinear: first(
                'Sekai Critical Flick Note Slot Linear',
                'Sekai Slot Linear Alternative Yellow',
                'Sekai Critical Note Slot Linear',
                'Sekai Slot Linear Tap Yellow',
            ),
        },
        criticalDownFlickNote: {
            circular: first(
                'Sekai Critical Down Flick Note Circular',
                'Sekai Critical Flick Note Circular',
                'Sekai Critical Flick Circular Yellow',
                'Sekai Critical Note Circular',
                ParticleEffectName.NoteCircularTapYellow,
            ),
            linear: first(
                'Sekai Critical Down Flick Note Linear',
                'Sekai Critical Flick Note Linear',
                'Sekai Critical Flick Linear Yellow',
                'Sekai Critical Note Linear',
                ParticleEffectName.NoteLinearTapYellow,
            ),
            directional: criticalDownFlickDirectional,
            lane: criticalDownFlickNoteLane,
            laneBasic: lane,
            slotLinear: first(
                'Sekai Critical Down Flick Note Slot Linear',
                'Sekai Critical Flick Note Slot Linear',
                'Sekai Slot Linear Alternative Yellow',
                'Sekai Critical Note Slot Linear',
                'Sekai Slot Linear Tap Yellow',
            ),
        },
        traceNote: {
            linear: first('Sekai Trace Note Linear', 'Sekai Trace Note Linear Green'),
            tick: first('Sekai Trace Note Circular', 'Sekai Trace Note Circular Green'),
        },
        traceFlickNote: {
            directional: flickDirectional,
            lane: flickNoteLane,
        },
        traceDownFlickNote: {
            directional: downFlickDirectional,
            lane: downFlickNoteLane,
        },
        criticalTraceNote: {
            linear: first('Sekai Critical Trace Note Linear', 'Sekai Trace Note Linear Yellow'),
            tick: first('Sekai Critical Trace Note Circular', 'Sekai Trace Note Circular Yellow'),
        },
        criticalTraceFlickNote: {
            directional: criticalDirectional,
            lane: criticalFlickNoteLane,
        },
        criticalTraceDownFlickNote: {
            directional: criticalDownFlickDirectional,
            lane: criticalDownFlickNoteLane,
        },
        normalSlideTickNote: {
            tick: first(
                'Sekai Normal Slide Tick Note',
                ParticleEffectName.NoteCircularAlternativeGreen,
            ),
        },
        criticalSlideTickNote: {
            tick: first(
                'Sekai Critical Slide Tick Note',
                ParticleEffectName.NoteCircularAlternativeYellow,
            ),
        },
        damageNote: {
            circular: get('Sekai Damage Note Circular'),
            linear: get('Sekai Damage Note Linear'),
            laneBasic: lane,
        },

        normalSlideConnector: {
            circular: first(
                'Sekai Normal Slide Connector Circular',
                ParticleEffectName.NoteCircularHoldGreen,
            ),
            linear: first(
                'Sekai Normal Slide Connector Linear',
                ParticleEffectName.NoteLinearHoldGreen,
            ),
            trailLinear: first(
                'Sekai Normal Slide Connector Trail Linear',
                'Sekai Normal Slide Trail Linear',
            ),
            slotLinear: first(
                'Sekai Normal Slide Connector Slot Linear',
                'Sekai Slot Linear Slide Green',
            ),
        },
        criticalSlideConnector: {
            circular: first(
                'Sekai Critical Slide Connector Circular',
                ParticleEffectName.NoteCircularHoldYellow,
            ),
            linear: first(
                'Sekai Critical Slide Connector Linear',
                ParticleEffectName.NoteLinearHoldYellow,
            ),
            trailLinear: first(
                'Sekai Critical Slide Connector Trail Linear',
                'Sekai Critical Slide Trail Linear',
            ),
            slotLinear: first(
                'Sekai Critical Slide Connector Slot Linear',
                'Sekai Slot Linear Slide Yellow',
            ),
        },
    }
    particle.styles = Object.fromEntries(
        noteStyles.slice(1).map((style) => {
            const color = style.charAt(0).toUpperCase() + style.slice(1)
            const colored = { ...particle }
            for (const [family, names] of Object.entries(noteParticleNames)) {
                const key = family as keyof typeof noteParticleNames
                const resolved = { ...particle[key] }
                for (const [property, name] of Object.entries(names)) {
                    const field = property as keyof NoteParticleSet
                    resolved[field] = get(`Sekai ${name} ${color}`) ?? resolved[field]
                }
                colored[key] = resolved
            }
            for (const [key, name] of [
                ['normalSlideConnector', 'Normal'],
                ['criticalSlideConnector', 'Critical'],
            ] as const) {
                const resolved = { ...particle[key] }
                for (const [field, suffix] of [
                    ['circular', 'Circular'],
                    ['linear', 'Linear'],
                    ['trailLinear', 'Trail Linear'],
                    ['slotLinear', 'Slot Linear'],
                ] as const) {
                    resolved[field] =
                        get(`Sekai ${name} Slide Connector ${suffix} ${color}`) ?? resolved[field]
                }
                colored[key] = resolved
            }
            return [style, colored]
        }),
    )
    return particle
}

const hitParticleNames = (name: string, lane: string) => ({
    circular: `${name} Note Circular`,
    linear: `${name} Note Linear`,
    slotLinear: `${name} Note Slot Linear`,
    lane: `${lane} Lane Linear`,
})
const noteParticleNames = {
    normalNote: hitParticleNames('Normal', 'Note'),
    slideNote: hitParticleNames('Slide', 'Slide'),
    flickNote: { ...hitParticleNames('Flick', 'Flick'), directional: 'Flick Note Directional' },
    downFlickNote: {
        ...hitParticleNames('Down Flick', 'Down Flick'),
        directional: 'Down Flick Note Directional',
    },
    criticalNote: hitParticleNames('Critical', 'Critical'),
    criticalSlideNote: hitParticleNames('Critical Slide', 'Critical Slide'),
    criticalFlickNote: {
        ...hitParticleNames('Critical Flick', 'Critical Flick'),
        directional: 'Critical Note Directional',
    },
    criticalDownFlickNote: {
        ...hitParticleNames('Critical Down Flick', 'Critical Down Flick'),
        directional: 'Critical Down Flick Note Directional',
    },
    traceNote: { tick: 'Normal Trace Note Circular', linear: 'Normal Trace Note Linear' },
    criticalTraceNote: {
        tick: 'Critical Trace Note Circular',
        linear: 'Critical Trace Note Linear',
    },
    traceFlickNote: { directional: 'Flick Note Directional', lane: 'Flick Lane Linear' },
    traceDownFlickNote: {
        directional: 'Down Flick Note Directional',
        lane: 'Down Flick Lane Linear',
    },
    criticalTraceFlickNote: {
        directional: 'Critical Note Directional',
        lane: 'Critical Flick Lane Linear',
    },
    criticalTraceDownFlickNote: {
        directional: 'Critical Down Flick Note Directional',
        lane: 'Critical Down Flick Lane Linear',
    },
    normalSlideTickNote: { tick: 'Normal Slide Tick Note' },
    criticalSlideTickNote: { tick: 'Critical Slide Tick Note' },
    damageNote: { circular: 'Damage Note Circular', linear: 'Damage Note Linear' },
} as const

export const getStyledParticle = (
    resource: PreviewParticle,
    style: NoteStyle = 'default',
): PreviewParticle => resource.styles?.[style] ?? resource
