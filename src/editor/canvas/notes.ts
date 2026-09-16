import type { FlickDirection } from '../../chart/note'
import type { NoteEntity } from '../../state/entities/slides/note'
import { beatToTime } from '../../state/integrals/bpms'
import { drawText } from './text'
import type { EditorDrawContext } from './types'

type NoteInfo = {
    note: NoteEntity
    activeHead?: NoteEntity
    activeTail?: NoteEntity
}

type NoteVisualType = 'anchor' | 'damage' | 'trace' | 'tick' | 'single' | 'head' | 'tail'

// Creation and paste ghosts can refer to a note in the existing slide or be a
// new insertion. Keep their role calculation identical to committed notes.
export const getNoteVisualType = (
    entity: NoteEntity,
    infos?: readonly NoteInfo[],
    lookup?: ReadonlyMap<NoteEntity, NoteInfo>,
): NoteVisualType => {
    if (entity.noteType === 'anchor') return 'anchor'
    if (entity.noteType === 'damage') return 'damage'
    if (entity.noteType === 'trace') return 'trace'
    if (entity.noteType === 'forceTick') return 'tick'
    if (!infos) return 'single'

    const infoEntity = entity.useInfoOf ?? entity
    const info = lookup ? lookup.get(infoEntity) : infos.find(({ note }) => note === infoEntity)
    if (info) {
        if (info.activeHead === info.activeTail) return 'single'
        if (info.activeHead === infoEntity) return 'head'
        if (info.activeTail === infoEntity) return 'tail'
        return infoEntity.noteType === 'default' ? 'tick' : 'single'
    }
    if (!infos.length) return 'single'

    let isActive = false
    let i = 0
    for (; i < infos.length; i++) {
        const info = infos[i]
        if (!info) break
        if (entity.beat < info.note.beat) break
        if (i === 0 || info.note.isConnectorSeparator) {
            isActive = info.note.connectorType === 'active'
        }
    }

    if (isActive) {
        if (!infos[i]) return 'tail'
        if (entity.isConnectorSeparator && entity.connectorType !== 'active') return 'tail'
        return 'tick'
    }
    if (!infos[i - 1]) return entity.connectorType === 'active' ? 'head' : 'single'
    if (!infos[i]) return 'single'
    return entity.isConnectorSeparator && entity.connectorType === 'active' ? 'head' : 'single'
}

const colors = {
    cyan: ['#aabfff', '#e6edff', '#8394f6'],
    green: ['#81f8cf', '#dafdf1', '#5ce29d'],
    red: ['#fec3dc', '#ffedf5', '#f89cc2'],
    yellow: ['#fed983', '#fffccc', '#fed84b'],
} as const

const traceColors = { green: '#5fefc2', red: '#fe9ccb', yellow: '#fddd86' }
const diamondColors = { green: '#abfbe3', red: '#ffd8f6', yellow: '#fff2c3' }

type Point = readonly [number, number]

const arrowPoints: Record<Exclude<FlickDirection, 'none'>, readonly Point[]> = {
    up: [
        [-1, 0],
        [-1, -0.4],
        [0, -1],
        [1, -0.4],
        [1, 0],
        [0, -0.6],
    ],
    upLeft: [
        [-1, 0],
        [-1.2, -0.3],
        [-0.6, -1.1],
        [0.6, -0.8],
        [0.8, -0.4],
        [-0.4, -0.7],
    ],
    upRight: [
        [1, 0],
        [1.2, -0.3],
        [0.6, -1.1],
        [-0.6, -0.8],
        [-0.8, -0.4],
        [0.4, -0.7],
    ],
    down: [
        [-1, -1.2],
        [-1, -0.8],
        [0, -0.2],
        [1, -0.8],
        [1, -1.2],
        [0, -0.6],
    ],
    downLeft: [
        [-1, -1.2],
        [-1.2, -0.9],
        [-0.6, -0.1],
        [0.6, -0.4],
        [0.8, -0.8],
        [-0.4, -0.5],
    ],
    downRight: [
        [1, -1.2],
        [1.2, -0.9],
        [0.6, -0.1],
        [-0.6, -0.4],
        [-0.8, -0.8],
        [0.4, -0.5],
    ],
}

const diamondPoints: readonly Point[] = [
    [-0.3, 0],
    [0, -0.3],
    [0.3, 0],
    [0, 0.15],
]
const diamondHighlightPoints: readonly Point[] = [
    [-0.25, 0],
    [0, -0.25],
    [0, 0.1],
]

const polygon = (ctx: CanvasRenderingContext2D, points: readonly Point[]) => {
    ctx.beginPath()
    points.forEach(([x, y], i) => {
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
    })
    ctx.closePath()
}

const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
    ctx.beginPath()
    // SVG does not paint rectangles with a negative width. Clamp each radius
    // independently, as SVG does for very narrow notes.
    if (w <= 0) return
    ctx.roundRect(x, y, w, h, { x: Math.min(0.1, w / 2), y: Math.min(0.1, h / 2) })
}

const drawArtwork = (
    ctx: CanvasRenderingContext2D,
    entity: NoteEntity,
    type: NoteVisualType,
    outline: boolean,
    scale: number,
) => {
    const { size, isCritical, flickDirection } = entity
    const color = isCritical ? 'yellow' : flickDirection !== 'none' ? 'red' : 'green'
    const x = size > 0 ? 0 : -0.1
    const w = size > 0 ? size : 0.2
    ctx.lineWidth = 2 / scale
    ctx.lineJoin = 'miter'
    ctx.miterLimit = 4
    ctx.lineCap = 'butt'
    ctx.setLineDash([])

    if (type === 'anchor' || type === 'tick') {
        if (outline) {
            roundedRect(ctx, x, 0.15, w, 0.3)
            ctx.strokeStyle = '#fff'
            ctx.stroke()
        }
    } else if (type === 'damage' || type === 'trace') {
        roundedRect(ctx, x, 0.15, w, 0.3)
        ctx.fillStyle = type === 'damage' ? '#a50acc' : traceColors[color]
        ctx.fill()
    } else {
        const [outer, inner, dot] = colors[type === 'single' && color === 'green' ? 'cyan' : color]
        roundedRect(ctx, x, 0, w, 0.6)
        ctx.fillStyle = outer
        ctx.fill()
        if (size > 0) {
            roundedRect(ctx, 0.1, 0.1, size - 0.2, 0.4)
            ctx.fillStyle = inner
            ctx.fill()
            ctx.fillStyle = dot
            ctx.fillRect(0.1, 0.225, 0.15, 0.15)
            ctx.fillRect(size - 0.25, 0.225, 0.15, 0.15)
        }
    }

    ctx.save()
    ctx.translate(size / 2, 0.3)
    if ((type === 'tick' || type === 'trace') && size > 0) {
        polygon(ctx, diamondPoints)
        ctx.fillStyle = diamondColors[type === 'tick' && !isCritical ? 'green' : color]
        ctx.fill()
        polygon(ctx, diamondHighlightPoints)
        ctx.fillStyle = '#fff'
        ctx.fill()
    }
    if (type !== 'anchor' && type !== 'tick' && type !== 'damage' && flickDirection !== 'none') {
        polygon(ctx, arrowPoints[flickDirection])
        ctx.fillStyle = isCritical ? '#ffc633' : '#ec7cb4'
        ctx.fill()
        ctx.strokeStyle = '#fff'
        ctx.stroke()
    }
    ctx.restore()

    if (type !== 'anchor' && entity.isFake) {
        ctx.strokeStyle = '#f44'
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.lineTo(size, 0.6)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, 0.6)
        ctx.lineTo(size, 0)
        ctx.stroke()
    }
}

type Sprite = {
    canvas: HTMLCanvasElement
    x: number
    y: number
    w: number
    h: number
    pixels: number
}

// Four million pixels cap the cached RGBA artwork at about 16 MiB, independently
// of chart size. Very large/unique notes use direct drawing instead.
const maxCachedPixels = 4 * 1024 * 1024
const maxCachedSprites = 512
const maxSpritePixels = 1024 * 1024
const maxSpriteDimension = 4096

export const createNoteRenderer = () => {
    const sprites = new Map<string, Sprite>()
    let cachedPixels = 0
    let lookups = new WeakMap<readonly NoteInfo[], ReadonlyMap<NoteEntity, NoteInfo>>()

    const release = (sprite: Sprite) => {
        cachedPixels -= sprite.pixels
        sprite.canvas.width = 0
        sprite.canvas.height = 0
    }

    const getSprite = (
        context: EditorDrawContext,
        entity: NoteEntity,
        type: NoteVisualType,
        outline: boolean,
    ) => {
        const { scale, pixelRatio } = context
        const density = scale * pixelRatio
        const key = `${type === 'tail' ? 'head' : type}:${entity.size}:${+entity.isCritical}:${entity.flickDirection}:${+entity.isFake}:${+outline}:${scale}:${pixelRatio}`
        const cached = sprites.get(key)
        if (cached) {
            sprites.delete(key)
            sprites.set(key, cached)
            return cached
        }

        const hasArrow =
            type !== 'anchor' &&
            type !== 'tick' &&
            type !== 'damage' &&
            entity.flickDirection !== 'none'
        // Extra stroke space covers the mitered arrow tips and antialiasing.
        const padding = 4 / scale
        const l =
            Math.min(
                -0.1,
                entity.size,
                entity.size > 0 ? entity.size - 0.25 : 0,
                hasArrow ? entity.size / 2 - 1.2 : 0,
            ) - padding
        const r = Math.max(0.25, entity.size, hasArrow ? entity.size / 2 + 1.2 : 0) + padding
        const t = (hasArrow ? -0.9 : 0) - padding
        const b = 0.6 + padding
        const x = Math.floor(l * density) / density
        const y = Math.floor(t * density) / density
        const width = Math.ceil((r - x) * density)
        const height = Math.ceil((b - y) * density)
        const pixels = width * height
        if (pixels > maxSpritePixels || width > maxSpriteDimension || height > maxSpriteDimension) {
            return
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(density, 0, 0, density, -x * density, -y * density)
        drawArtwork(ctx, entity, type, outline, scale)
        const sprite = { canvas, x, y, w: width / density, h: height / density, pixels }
        while (sprites.size >= maxCachedSprites || cachedPixels + pixels > maxCachedPixels) {
            const oldest = sprites.entries().next().value
            if (!oldest) break
            sprites.delete(oldest[0])
            release(oldest[1])
        }
        sprites.set(key, sprite)
        cachedPixels += pixels
        return sprite
    }

    return {
        draw(context: EditorDrawContext, entity: NoteEntity, highlighted: boolean, opacity = 1) {
            const { ctx, state, scale, recentlyActive } = context
            if (opacity <= 0 || scale <= 0 || context.pixelRatio <= 0) return
            const infos = state.store.slides.info.get(entity.slideId)
            let lookup = infos && lookups.get(infos)
            if (infos && !lookup) {
                lookup = new Map(infos.map((info) => [info.note, info]))
                lookups.set(infos, lookup)
            }
            const type = getNoteVisualType(entity, infos, lookup)
            const outline =
                (type === 'anchor' || type === 'tick') && (highlighted || recentlyActive)
            if (type === 'anchor' && !outline) return
            const x = entity.left
            const y = beatToTime(state.bpms, entity.beat) * context.ups - 0.3
            ctx.save()
            ctx.globalAlpha *= opacity
            const sprite = getSprite(context, entity, type, outline)
            if (sprite) {
                ctx.drawImage(sprite.canvas, x + sprite.x, y + sprite.y, sprite.w, sprite.h)
            } else {
                ctx.save()
                ctx.translate(x, y)
                drawArtwork(ctx, entity, type, outline, scale)
                ctx.restore()
            }

            if (highlighted || recentlyActive) {
                const stage =
                    context.showStageName &&
                    state.isDynamicStages &&
                    state.stages.get(entity.stageId)?.name
                const group =
                    context.showGroupName &&
                    entity.groupId !== context.defaultGroupId &&
                    state.groups.get(entity.groupId)?.name
                if (stage) {
                    drawText(
                        context,
                        stage,
                        x + entity.size / 2,
                        y + 0.3,
                        '#a0a',
                        0.4,
                        group ? 'end' : 'center',
                    )
                }
                if (group) {
                    drawText(
                        context,
                        group,
                        x + entity.size / 2,
                        y + 0.3,
                        '#0aa',
                        0.4,
                        stage ? 'start' : 'center',
                    )
                }
            }
            ctx.restore()
        },
        clear() {
            for (const sprite of sprites.values()) release(sprite)
            sprites.clear()
            lookups = new WeakMap()
        },
    }
}
