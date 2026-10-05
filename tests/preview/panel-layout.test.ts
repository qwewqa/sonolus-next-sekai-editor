import assert from 'node:assert/strict'
import test from 'node:test'
import {
    layoutPreviewControls,
    placePreviewSettings,
    previewSettingsWidth,
    previewStripMetrics,
    type Rect,
    type SettingsPlacementInput,
} from '../../src/preview/layout'

const ratio = 16 / 9
const controls = (overrides: Partial<Parameters<typeof layoutPreviewControls>[0]>) =>
    layoutPreviewControls({
        width: 304,
        height: 1000,
        aspectRatio: ratio,
        coarse: false,
        showTime: true,
        anchor: 'start',
        ...overrides,
    })

test('the strip is one row of constant height: 44 px fine, 52 px coarse', () => {
    const fine = previewStripMetrics(false)
    const coarse = previewStripMetrics(true)
    assert.equal(fine.height, 44)
    assert.equal(coarse.height, 52)
    assert.equal(fine.steps, 254)
    assert.equal(coarse.steps, 310)
    assert.equal(fine.stepsWithTime, 254 + 4 + 64)
    assert.equal(coarse.compactWithTime, 192 + 4 + 64)
})

test('a tall side panel keeps the image at the top with the strip below it', () => {
    const layout = controls({})
    assert.equal(layout.placement, 'below')
    assert.deepEqual(layout.canvas, { left: 0, top: 0, width: 304, height: 171 })
    assert.deepEqual(layout.strip, { left: 4, top: 175, width: 296, height: 44 })
    // 296 px holds six steppers; the time then shows in the image's corner
    // rather than costing them their room.
    assert.equal(layout.mode, 'steps')
    assert.equal(layout.timeInStrip, false)
})

test('six steppers come first, and the time joins them only with room to spare', () => {
    assert.deepEqual(
        [controls({ width: 330 }), controls({ width: 329 })].map(({ mode, timeInStrip }) => [
            mode,
            timeInStrip,
        ]),
        [
            ['steps', true],
            ['steps', false],
        ],
    )
    // The compact stepper is only for panels too narrow for six steppers.
    const fine = previewStripMetrics(false)
    const compact = controls({ width: fine.steps + 8 - 1 })
    assert.deepEqual([compact.mode, compact.timeInStrip], ['compact', true])
    assert.equal(controls({ width: fine.steps + 8 }).mode, 'steps')
    // Without the time, six steppers need only their own width.
    const noTime = controls({ width: 262, showTime: false })
    assert.deepEqual([noTime.mode, noTime.timeInStrip], ['steps', false])
    // Too narrow for the time beside a stepper: it moves to the image's corner.
    const narrow = controls({ width: 260, coarse: true })
    assert.deepEqual([narrow.mode, narrow.timeInStrip], ['compact', false])
    assert.equal(narrow.strip.width, 252)
    const phone = controls({ width: 390, height: 300, coarse: true, anchor: 'center' })
    // A 390 px phone fits the time and six 40 px steppers.
    assert.deepEqual([phone.mode, phone.timeInStrip], ['steps', true])
})

test('wide strips stop growing once their steppers reach full size', () => {
    const layout = controls({ width: 820, height: 420, anchor: 'center' })
    const metrics = previewStripMetrics(false)
    assert.equal(layout.placement, 'below')
    assert.equal(layout.mode, 'steps')
    assert.equal(layout.strip.width, metrics.stepsMax + metrics.gap + metrics.time)
    assert.equal(layout.strip.left, (820 - layout.strip.width) / 2)
    // The image shrinks by at most 30% to make room.
    assert.equal(layout.canvas.height, 420 - 52)
    assert.equal(layout.canvas.top, 0)
})

test('a short, wide panel docks the full strip below the image, never beside it', () => {
    const metrics = previewStripMetrics(false)
    const layout = controls({ width: 1600, height: 200, anchor: 'center' })
    assert.equal(layout.placement, 'below')
    assert.deepEqual([layout.mode, layout.timeInStrip], ['steps', true])
    assert.equal(layout.strip.width, metrics.stepsMax + metrics.gap + metrics.time)
    assert.equal(layout.strip.top, layout.canvas.top + layout.canvas.height + 4)
    assert.equal(layout.canvas.left, (1600 - layout.canvas.width) / 2)

    // Shorter still, the strip shows on demand, still at full size.
    const short = controls({ width: 800, height: 146, coarse: true, anchor: 'center' })
    assert.equal(short.placement, 'overlay')
    assert.equal(short.mode, 'steps')
    assert.equal(short.strip.width, previewStripMetrics(true).stepsMax)
    assert.equal(short.canvas.left, (800 - short.canvas.width) / 2)
})

test('without room below, the strip shows over the image on demand, in place', () => {
    const layout = controls({ width: 300, height: 140, aspectRatio: 4 / 3, anchor: 'center' })
    assert.equal(layout.placement, 'overlay')
    // The strip may be hidden, so the time stays in the image's corner.
    assert.equal(layout.timeInStrip, false)
    // The image stays centered whether or not the strip shows; the strip covers
    // its lower edge.
    assert.equal(layout.canvas.top, (140 - layout.canvas.height) / 2)
    assert.equal(layout.strip.top, 140 - 44 - 4)
})

const rect = (left: number, top: number, width: number, height: number): Rect => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
})

// A desktop left dock: a 352 px tile with the image at its top.
const base = (overrides: Partial<SettingsPlacementInput>): SettingsPlacementInput => ({
    side: 'left',
    tile: rect(36, 0, 352, 1000),
    image: rect(36, 0, 352, 198),
    viewport: { width: 1600, height: 1000 },
    panelWidth: 344,
    naturalHeight: 340,
    minHeight: 136,
    buttonSize: 36,
    ...overrides,
})

test('the toggle sits in the image corner, mirroring the clock', () => {
    const layout = placePreviewSettings(base({ transport: rect(40, 202, 344, 44) }))
    assert.deepEqual(layout.button, { left: 388 - 4 - 36, top: 4 })
    assert.equal(layout.isButtonBlocked, false)
})

test('settings open below the docked bar of a tall side panel', () => {
    const layout = placePreviewSettings(
        base({ transport: rect(40, 202, 344, 44), clock: rect(40, 4, 70, 20) }),
    )
    assert.equal(layout.placement, 'below')
    assert.equal(layout.fitsInPanel, true)
    assert.deepEqual(
        { left: layout.left, top: layout.top, width: layout.width },
        { left: 40, top: 250, width: 344 },
    )
    assert.equal(layout.maxHeight, 1000 - 4 - 250)
})

test('a short stacked side panel opens settings beside the dock without covering it', () => {
    const left = placePreviewSettings(
        base({ tile: rect(36, 0, 352, 262), transport: rect(40, 202, 344, 44) }),
    )
    assert.equal(left.placement, 'beside')
    assert.equal(left.fitsInPanel, false)
    assert.equal(left.left, 388 + 4)
    assert.equal(left.maxHeight, 1000 - 8)

    const right = placePreviewSettings(
        base({
            side: 'right',
            tile: rect(1212, 0, 352, 262),
            image: rect(1212, 0, 352, 198),
            transport: rect(1216, 202, 344, 44),
        }),
    )
    assert.equal(right.placement, 'beside')
    assert.equal(right.left + right.width, 1212 - 4)
})

test('right dock settings stay inside the panel edge next to the rail', () => {
    const layout = placePreviewSettings(
        base({
            side: 'right',
            tile: rect(1212, 0, 352, 1000),
            image: rect(1212, 0, 352, 198),
            transport: rect(1216, 202, 344, 44),
        }),
    )
    assert.equal(layout.placement, 'below')
    assert.equal(layout.left + layout.width, 1564 - 4)
    assert.ok(layout.left >= 1212)
})

test('top panels hang settings from the toggle, or open under the dock', () => {
    const roomy = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(0, 36, 820, 420),
            image: rect(83, 36, 654, 368),
            viewport: { width: 820, height: 1180 },
            transport: rect(90, 408, 640, 44),
            naturalHeight: 300,
        }),
    )
    assert.equal(roomy.placement, 'over')
    assert.equal(roomy.fitsInPanel, true)
    // Right-aligned with the toggle at the image's corner, just below it.
    assert.equal(roomy.left + roomy.width, 737 - 4)
    assert.equal(roomy.top, 36 + 4 + 36 + 4)

    const short = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(0, 36, 390, 290),
            image: rect(0, 46, 390, 219),
            viewport: { width: 390, height: 844 },
            panelWidth: 352,
            transport: rect(4, 270, 382, 44),
            clock: rect(4, 50, 70, 20),
        }),
    )
    // Settings open under the dock, leaving the image, clock and bar in view.
    assert.equal(short.placement, 'under')
    assert.equal(short.top, 330)
    assert.equal(short.maxHeight, 844 - 4 - 330)
    assert.ok(short.left >= 4 && short.left + short.width <= 386)

    // A very short window extends over the panel, below the toggle.
    const tiny = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(0, 36, 1069, 41),
            image: rect(498, 36, 73, 41),
            viewport: { width: 1069, height: 128 },
            panelWidth: 352,
        }),
    )
    assert.equal(tiny.placement, 'down')
    assert.equal(tiny.top, 36 + 4 + 36 + 4)
})

test('settings never cover editor controls such as the elevation header', () => {
    // Beside a short stacked panel, with the elevation header at the top.
    const header = rect(388, 0, 600, 70)
    const beside = placePreviewSettings(
        base({
            tile: rect(36, 0, 352, 262),
            transport: rect(40, 202, 344, 44),
            obstacles: [header],
        }),
    )
    assert.equal(beside.placement, 'beside')
    assert.equal(beside.top, 74)

    // Under a top dock, the header directly below the dock is skipped.
    const under = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(0, 36, 390, 290),
            image: rect(0, 46, 390, 219),
            viewport: { width: 390, height: 844 },
            panelWidth: 352,
            transport: rect(4, 270, 382, 44),
            obstacles: [rect(0, 326, 390, 80)],
        }),
    )
    assert.equal(under.placement, 'under')
    assert.equal(under.top, 410)
})

test('the toggle is hidden only where it would sit on the playback bar', () => {
    const blocked = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(0, 36, 300, 60),
            image: rect(96, 36, 107, 60),
            transport: rect(4, 40, 292, 44),
        }),
    )
    assert.equal(blocked.isButtonBlocked, true)
})

test('settings width fills moderately narrow panels and uses the room beside narrow ones', () => {
    const tile = (left: number, width: number) => ({ left, right: left + width })
    assert.equal(previewSettingsWidth('left', tile(36, 1000), 1600), 352)
    assert.equal(previewSettingsWidth('left', tile(36, 320), 1600), 312)
    assert.equal(previewSettingsWidth('left', tile(36, 260), 844), 352)
    assert.equal(previewSettingsWidth('left', tile(36, 220), 568), 304)
    assert.equal(previewSettingsWidth('right', tile(400, 200), 636), 352)
    // Phones span the screen with even 8px margins.
    assert.equal(previewSettingsWidth('top', tile(0, 200), 320), 304)
    assert.equal(previewSettingsWidth('top', tile(0, 390), 390), 374)
})

test('on a phone the form is centered with even margins', () => {
    const layout = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(0, 44, 390, 300),
            image: rect(0, 44, 390, 219),
            viewport: { width: 390, height: 844 },
            panelWidth: previewSettingsWidth('top', rect(0, 44, 390, 300), 390),
        }),
    )
    assert.equal(layout.width, 374)
    assert.equal(layout.left, 8)
})

test('a form wider than a narrow side panel opens beside it even when it would fit below', () => {
    const layout = placePreviewSettings(
        base({
            tile: rect(36, 0, 260, 733),
            image: rect(36, 0, 260, 146),
            viewport: { width: 1069, height: 733 },
            panelWidth: 352,
            transport: rect(40, 150, 252, 44),
        }),
    )
    assert.equal(layout.placement, 'beside')
    assert.equal(layout.left, 300)
    assert.equal(layout.fitsInPanel, false)
})

test('beside the dock the form takes the room there, not the panel width', () => {
    const layout = placePreviewSettings(
        base({
            tile: rect(36, 0, 293, 400),
            image: rect(36, 0, 293, 165),
            viewport: { width: 1366, height: 768 },
            panelWidth: 285,
            transport: rect(40, 169, 285, 44),
            // Narrower forms wrap more lines.
            naturalHeight: (width) => (width < 300 ? 420 : 360),
        }),
    )
    assert.equal(layout.placement, 'beside')
    assert.equal(layout.width, 352)
    assert.equal(layout.left, 329 + 4)
})

test('a short top dock scrolls the form under the dock instead of covering the bar', () => {
    const layout = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(36, 36, 1208, 160),
            image: rect(498, 36, 213, 120),
            viewport: { width: 1280, height: 500 },
            panelWidth: 352,
            transport: rect(320, 160, 640, 32),
            naturalHeight: 480,
        }),
    )
    assert.equal(layout.placement, 'under')
    assert.equal(layout.top, 200)
    assert.equal(layout.maxHeight, 500 - 4 - 200)
})

test('settings never extend past an obstacle that cut their room short', () => {
    // A short top dock above the editor toolbar on a landscape phone.
    const toolbar = rect(150, 300, 560, 80)
    const layout = placePreviewSettings(
        base({
            side: 'top',
            tile: rect(44, 44, 800, 146),
            image: rect(314, 44, 260, 146),
            viewport: { width: 844, height: 390 },
            panelWidth: 352,
            obstacles: [toolbar],
            naturalHeight: 420,
        }),
    )
    const overlapsToolbar =
        layout.left < toolbar.right &&
        layout.left + layout.width > toolbar.left &&
        layout.top < toolbar.bottom &&
        layout.top + layout.maxHeight > toolbar.top
    assert.equal(overlapsToolbar, false)
    assert.ok(layout.maxHeight >= 136 - 44)
})
