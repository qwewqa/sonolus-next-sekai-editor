export const previewNoteSpeed = { default: 10, min: 1, max: 12, step: 0.01, sliderStep: 0.05 }
export const previewRenderScale = { default: 1, min: 0.25, max: 2, step: 0.25 }

// Viewport ratios supported by the engine's test-aspect overlay.
export const previewAspectRatios: [[string, number], [string, number], [string, number]] = [
    ['16:9', 16 / 9],
    ['21:9', 21 / 9],
    ['4:3', 4 / 3],
]
export const previewControls = ['auto', 'expanded', 'collapsed'] as const
export const previewTransportPositions = ['auto', 'below', 'overlay'] as const
export type PreviewTransportPosition = (typeof previewTransportPositions)[number]
