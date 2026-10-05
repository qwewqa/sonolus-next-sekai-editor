// Pure geometry for the preview panel. Positions are in CSS pixels; the image
// and playback strip are relative to the preview container, and settings
// placement uses viewport coordinates because the expanded settings may
// extend beyond the panel.

import type { PreviewTransportPosition } from './options'

export type PreviewSide = 'left' | 'right' | 'top'

export type Rect = { left: number; top: number; right: number; bottom: number }

/** Gap between the image, the playback strip, settings and panel edges. */
export const previewGap = 4

/** Image height Auto may give up to the strip below; absorbs dock rounding. */
const autoBelowTolerance = 0.5

export type PreviewCanvas = {
    left: number
    top: number
    width: number
    height: number
}

/** Sizes of the single-row playback strip, which never wraps. */
export const previewStripMetrics = (coarse: boolean) => {
    // Play is the frequent control; on touch the steppers are a little smaller.
    const button = coarse ? 44 : 36
    const step = coarse ? 40 : 32
    const chevron = coarse ? 40 : 36
    const sizeButton = 48
    const pad = 4
    const gap = 4
    // Steppers sit in an inset track: 2 px inset and 2 px between buttons.
    const track = (buttons: number, width: number) => 4 + buttons * width + (buttons - 1) * 2
    // "00:00.000" in 12 px tabular numerals with 4 px either side (min-w-16).
    const time = 64
    const steps = pad * 2 + button + gap + track(6, step)
    const compact = pad * 2 + button + gap + track(2, chevron) + 2 + sizeButton
    return {
        button,
        step,
        sizeButton,
        pad,
        gap,
        time,
        height: button + pad * 2,
        /** Play and six steppers at their smallest. */
        steps,
        /** Play and six steppers at their largest (4rem each). */
        stepsMax: pad * 2 + button + gap + track(6, 64),
        /** Play plus back, step size and forward. */
        compact,
        stepsWithTime: steps + gap + time,
        compactWithTime: compact + gap + time,
    }
}

export type PreviewStripMode = 'steps' | 'compact'
export type PreviewStripPlacement = 'below' | 'overlay'

export type PreviewControlsLayout = {
    canvas: PreviewCanvas
    /** The playback strip, relative to the preview container. */
    strip: { left: number; top: number; width: number; height: number }
    mode: PreviewStripMode
    /** Whether the strip shows the time; otherwise the image's corner chip does. */
    timeInStrip: boolean
    placement: PreviewStripPlacement
}

export type PreviewControlsInput = {
    width: number
    height: number
    aspectRatio: number
    coarse: boolean
    /** Whether the time is shown at all. */
    showTime: boolean
    /** Side docks are often much taller than the image; keep it at the top. */
    anchor: 'start' | 'center'
    position?: PreviewTransportPosition
}

/**
 * Places the image and its playback strip: below the image, across the panel's
 * width, or over its lower edge, shown on demand. Auto docks it below only
 * while that leaves the image at its full fitted size. The strip is never
 * narrowed to fit beside the image.
 *
 * The strip holds six steppers whenever the panel is wide enough for them; the
 * compact back / step size / forward stepper is only for panels too narrow for
 * six. Where there is room beside them it also shows the time, which then
 * needs no chip over the image; the time never costs the steppers.
 */
export const layoutPreviewControls = ({
    width,
    height,
    aspectRatio,
    coarse,
    showTime,
    anchor,
    position = 'auto',
}: PreviewControlsInput): PreviewControlsLayout => {
    const metrics = previewStripMetrics(coarse)
    const g = previewGap
    const stripHeight = metrics.height
    const content = (room: number) => {
        if (room >= metrics.steps)
            return {
                mode: 'steps' as const,
                timeInStrip: showTime && room >= metrics.stepsWithTime,
            }
        return {
            mode: 'compact' as const,
            timeInStrip: showTime && room >= metrics.compactWithTime,
        }
    }
    // Wide strips stop growing once their steppers reach full size.
    const widthFor = (room: number, c: ReturnType<typeof content>) =>
        c.mode === 'steps'
            ? Math.min(room, metrics.stepsMax + (c.timeInStrip ? metrics.gap + metrics.time : 0))
            : room
    if (width <= 0 || height <= 0) {
        return {
            canvas: { left: 0, top: 0, width: 0, height: 0 },
            strip: { left: 0, top: 0, width: 0, height: stripHeight },
            mode: 'compact',
            timeInStrip: false,
            placement: 'overlay',
        }
    }

    // Preserve the exact logical ratio; backing pixels are rounded separately.
    const full = Math.min(width, height * aspectRatio)
    const reserve = stripHeight + g * 2
    const docked = Math.min(width, Math.max(0, (height - reserve) * aspectRatio))
    const room = width - g * 2
    const below =
        position === 'below' ||
        (position === 'auto' && (docked - full) / aspectRatio >= -autoBelowTolerance)
    if (below) {
        const canvasHeight = docked / aspectRatio
        const top = anchor === 'start' ? 0 : Math.max(0, (height - canvasHeight - reserve) / 2)
        const c = content(room)
        const stripWidth = widthFor(room, c)
        return {
            canvas: { left: (width - docked) / 2, top, width: docked, height: canvasHeight },
            strip: {
                left: (width - stripWidth) / 2,
                top: top + canvasHeight + g,
                width: stripWidth,
                height: stripHeight,
            },
            mode: c.mode,
            timeInStrip: c.timeInStrip,
            placement: 'below',
        }
    }

    // Otherwise the strip shows on demand over the image's lower edge, in place:
    // showing or hiding it never moves or resizes the image. The time stays in
    // the corner chip here, since the strip is often hidden.
    const canvasHeight = full / aspectRatio
    // Auto keeps the image where Below had it, so crossing over moves only the strip.
    const top = anchor === 'start' || position === 'auto' ? 0 : (height - canvasHeight) / 2
    const bottom = top + canvasHeight
    const overlay = room >= metrics.steps ? ('steps' as const) : ('compact' as const)
    const stripWidth = overlay === 'steps' ? Math.min(room, metrics.stepsMax) : room
    return {
        canvas: { left: (width - full) / 2, top, width: full, height: canvasHeight },
        strip: {
            left: (width - stripWidth) / 2,
            // Auto slides it from below the image up into its lower edge.
            top: Math.max(
                0,
                position === 'auto'
                    ? Math.min(bottom + g, height - stripHeight - g)
                    : bottom - stripHeight - g,
            ),
            width: stripWidth,
            height: stripHeight,
        },
        mode: overlay,
        timeInStrip: false,
        placement: 'overlay',
    }
}

export type SettingsPlacement = 'below' | 'over' | 'beside' | 'under' | 'down'

export type SettingsPlacementInput = {
    side: PreviewSide
    /** The preview container. */
    tile: Rect
    /** The letterboxed image inside it. */
    image: Rect
    viewport: { width: number; height: number }
    /** The visible playback bar, if any: docked below the image or over it. */
    transport?: Rect
    /** The corner clock, if shown. */
    clock?: Rect
    /** Controls outside the panel the settings must never cover. */
    obstacles?: readonly Rect[]
    panelWidth: number
    /** Header plus full body height, before any scrolling. */
    naturalHeight: number | ((formWidth: number) => number)
    /** Smallest useful height: the header plus a couple of rows. */
    minHeight: number
    buttonSize: number
}

export type SettingsLayout = {
    placement: SettingsPlacement
    left: number
    top: number
    width: number
    maxHeight: number
    /** Whether the expanded settings fit within the panel without scrolling. */
    fitsInPanel: boolean
    /** Settings toggle position: the image's top-right corner, mirroring the clock. */
    button: { left: number; top: number }
    /** Whether the toggle would sit on the playback bar over a very short image. */
    isButtonBlocked: boolean
}

const overlaps = (a: Pick<Rect, 'left' | 'right'>, b: Pick<Rect, 'left' | 'right'>) =>
    a.left < b.right && a.right > b.left

/**
 * Chooses where expanded preview settings open. In-panel placements are
 * preferred while the whole form fits; otherwise the placement with the most
 * room wins, which may extend beyond a small panel toward the editor. The
 * settings never cover their toggle, the clock or the given obstacles, and
 * cover the playback bar only when a very short top panel leaves nothing else.
 */
const preferredSettingsWidth = 352
const minSettingsWidth = 256
/** On a phone the form spans the screen with even margins, like other sheets. */
const narrowViewportWidth = 480
const narrowSettingsMargin = 8

export const placePreviewSettings = ({
    side,
    tile,
    image,
    viewport,
    transport,
    clock,
    obstacles = [],
    panelWidth,
    naturalHeight,
    minHeight,
    buttonSize,
}: SettingsPlacementInput): SettingsLayout => {
    const m = previewGap
    const width = Math.max(0, Math.min(panelWidth, viewport.width - m * 2))
    const tileWidth = tile.right - tile.left
    const button = { left: image.right - m - buttonSize, top: image.top + m }
    const buttonBottom = button.top + buttonSize
    // The least a scrolling form may show: its header and about one row.
    const scrollMin = minHeight - 44
    const natural = (formWidth: number) =>
        typeof naturalHeight === 'number' ? naturalHeight : naturalHeight(formWidth)

    // In the panel, the form hangs from its toggle at the image's right edge.
    let left =
        width <= tileWidth - m * 2
            ? Math.max(tile.left + m, Math.min(button.left + buttonSize, tile.right - m) - width)
            : side === 'left'
              ? tile.left + m
              : tile.right - m - width
    left = Math.min(Math.max(left, m), Math.max(m, viewport.width - m - width))
    if (viewport.width < narrowViewportWidth) left = Math.max(0, (viewport.width - width) / 2)

    type Region = {
        placement: SettingsPlacement
        left: number
        top: number
        bottom: number
        width: number
        /** Whether an obstacle cut the region short. */
        clipped?: boolean
    }
    // Keep a region clear of an obstacle: stop above it when that leaves a
    // usable form, otherwise start below it.
    const avoid = (region: Region, obstacle: Rect): Region => {
        const span = { left: region.left, right: region.left + region.width }
        if (
            !overlaps(span, obstacle) ||
            obstacle.bottom <= region.top ||
            obstacle.top >= region.bottom
        )
            return region
        return obstacle.top - m - region.top >= scrollMin
            ? { ...region, bottom: obstacle.top - m, clipped: true }
            : { ...region, top: Math.max(region.top, obstacle.bottom + m), clipped: true }
    }
    const clear = (region: Region) =>
        [...(clock ? [clock] : []), ...obstacles].reduce(avoid, region)

    const overBottom =
        transport && overlaps({ left, right: left + width }, transport)
            ? Math.min(tile.bottom, transport.top) - m
            : tile.bottom - m
    const over = clear({
        placement: 'over',
        left,
        top: buttonBottom + m,
        bottom: overBottom,
        width,
    })
    const regions: Region[] = []
    let under: Region | undefined
    if (side === 'top') {
        // Below the dock the whole preview stays in view while settings change.
        // Only a very short window falls back to extending over the panel.
        under = clear({
            placement: 'under',
            left,
            top: tile.bottom + m,
            bottom: viewport.height - m,
            width,
        })
        regions.push(
            over,
            under,
            clear({
                placement: 'down',
                left,
                top: buttonBottom + m,
                bottom: viewport.height - m,
                width,
            }),
        )
    } else {
        // Beside the dock the form takes the room there rather than the panel's
        // width, so labels wrap no more than they need to.
        const besideRoom = side === 'left' ? viewport.width - tile.right - m * 2 : tile.left - m * 2
        const besideWidth = Math.min(preferredSettingsWidth, besideRoom)
        const beside =
            besideWidth >= minSettingsWidth
                ? clear({
                      placement: 'beside',
                      left: side === 'left' ? tile.right + m : tile.left - m - besideWidth,
                      top: tile.top + m,
                      bottom: viewport.height - m,
                      width: besideWidth,
                  })
                : undefined
        // A form wider than a narrow side panel opens beside it rather than
        // overhanging the panel edge.
        if (width <= tileWidth - m * 2 || !beside) {
            if (transport) {
                regions.push(
                    clear({
                        placement: 'below',
                        left,
                        top: transport.bottom + m,
                        bottom: tile.bottom - m,
                        width,
                    }),
                )
            }
            regions.push(over)
        }
        if (beside) regions.push(beside)
    }

    const room = (region: Region) => region.bottom - region.top
    const fits = (region: Region, share = 1) => room(region) >= natural(region.width) * share
    // Prefer the first place that fits the whole form, then one that shows most
    // of it with a short scroll. Under a top dock, a form that scrolls is better
    // than one covering the image and bar, so long as a few rows show. Covering
    // the bar is a last resort; failing everything, the most room wins.
    const preferred = regions.filter((region) => region.placement !== 'down')
    // A region an obstacle cut below a usable size is skipped: its height can
    // never grow past the obstacle, so it would show almost nothing.
    const usable = regions.filter((region) => !region.clipped || room(region) >= scrollMin)
    const candidates = usable.length ? usable : regions
    const chosen =
        preferred.find((region) => fits(region)) ??
        preferred.find((region) => fits(region, 2 / 3)) ??
        (under && room(under) >= scrollMin ? under : undefined) ??
        candidates.reduce((best, region) => (room(region) > room(best) ? region : best))

    return {
        placement: chosen.placement,
        left: chosen.left,
        top: chosen.top,
        width: chosen.width,
        // Never clip the header in a tiny free region, but never grow past an
        // obstacle either.
        maxHeight: chosen.clipped
            ? Math.max(0, room(chosen))
            : Math.max(room(chosen), Math.min(minHeight, viewport.height - m - chosen.top)),
        fitsInPanel: (chosen.placement === 'below' || chosen.placement === 'over') && fits(chosen),
        button,
        // Hiding the bar (by tapping the image) brings the toggle back.
        isButtonBlocked:
            !!transport &&
            overlaps({ left: button.left, right: button.left + buttonSize }, transport) &&
            button.top < transport.bottom &&
            buttonBottom > transport.top,
    }
}

/**
 * Settings fill a moderately narrow panel rather than poking out of it. A very
 * narrow side panel opens them beside the dock, using the room available there.
 */
export const previewSettingsWidth = (
    side: PreviewSide,
    tile: Pick<Rect, 'left' | 'right'>,
    viewportWidth: number,
) => {
    if (viewportWidth < narrowViewportWidth)
        return Math.max(0, viewportWidth - narrowSettingsMargin * 2)
    const inPanel = tile.right - tile.left - previewGap * 2
    const beside =
        side === 'left'
            ? viewportWidth - tile.right - previewGap * 2
            : side === 'right'
              ? tile.left - previewGap * 2
              : 0
    const room =
        inPanel >= minSettingsWidth
            ? inPanel
            : beside >= minSettingsWidth
              ? beside
              : viewportWidth - previewGap * 2
    return Math.max(0, Math.min(preferredSettingsWidth, room))
}
