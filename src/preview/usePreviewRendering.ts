import { computed, onBeforeUnmount, shallowRef, watch, watchEffect, type Ref } from 'vue'
import { isAppActive } from '../activity'
import { view } from '../editor/view'
import { state } from '../history'
import { settings } from '../settings'
import type { State } from '../state'
import { hasSameChartData } from '../state/data'
import { getPreviewState, previewEdit } from './edit'
import { createPreviewChartBuilder } from './engine/chart'
import type { PreviewChart } from './engine/model'
import { renderPreviewFrame } from './engine/render'
import { createPreviewRenderer, type PreviewRenderer } from './gl'
import type { LoadedParticle } from './particle'
import { createSelectionOutline } from './selectionOutline'
import type { LoadedSkin } from './skin'
import type { usePreviewResources } from './usePreviewResources'

type PreviewViewport = {
    canvasWidth: Ref<number>
    canvasHeight: Ref<number>
    pixelRatio: Ref<number>
}

export const usePreviewRendering = (
    canvas: Readonly<Ref<HTMLCanvasElement | null>>,
    background: Readonly<Ref<HTMLDivElement | null>>,
    { skin, particle, status, errorDetail }: ReturnType<typeof usePreviewResources>,
    { canvasWidth, canvasHeight, pixelRatio }: PreviewViewport,
    selectionCanvas?: Readonly<Ref<HTMLCanvasElement | null>>,
) => {
    // Selection, audio and filename changes share the same chart data. Keep them from
    // rebuilding the preview and its indexes during ordinary editor interactions.
    const chartState = computed<State>((previous) => {
        const next = state.value
        if (previous && hasSameChartData(previous, next)) {
            return previous
        }
        return next
    })
    const buildChart = createPreviewChartBuilder()
    // Capture changes cheaply, then resolve only the latest request when a visible
    // frame actually draws. Numeric input and pointer events may arrive repeatedly
    // before RAF; discarded requests never build a transaction or compile a chart.
    const chartRequest = computed(() => {
        const current = chartState.value
        const edit = previewEdit.value
        const speed = settings.previewNoteSpeed
        let chart: PreviewChart | undefined
        return () => (chart ??= buildChart(getPreviewState(current, edit), speed))
    })

    const renderer = shallowRef<PreviewRenderer>()

    let contextLost = false

    const initializeRenderer = () => {
        if (!isAppActive.value || !canvas.value || !skin.value || renderer.value || contextLost)
            return

        try {
            renderer.value = createPreviewRenderer(canvas.value, settings.previewAntialias)
            errorDetail.value = ''
            status.value = 'ready'
        } catch (error) {
            console.error('Failed to create preview renderer:', error)
            errorDetail.value = error instanceof Error ? error.message : String(error)
            status.value = 'error'
        }
    }

    watch([skin, isAppActive], initializeRenderer)
    watch(canvas, (currentCanvas, _previousCanvas, onCleanup) => {
        renderer.value?.dispose()
        renderer.value = undefined
        contextLost = false
        if (!currentCanvas) return

        const onContextLost = (event: Event) => {
            // Opt in to restoration; all resources from the old context are invalid.
            event.preventDefault()
            contextLost = true
            renderer.value = undefined
        }
        const onContextRestored = () => {
            contextLost = false
            initializeRenderer()
        }
        currentCanvas.addEventListener('webglcontextlost', onContextLost)
        currentCanvas.addEventListener('webglcontextrestored', onContextRestored)
        onCleanup(() => {
            currentCanvas.removeEventListener('webglcontextlost', onContextLost)
            currentCanvas.removeEventListener('webglcontextrestored', onContextRestored)
        })

        initializeRenderer()
    })

    let uploadedRenderer: PreviewRenderer | undefined
    let uploadedSkin: LoadedSkin | undefined
    let uploadedParticle: LoadedParticle | undefined
    watch(
        [renderer, skin, particle, isAppActive],
        ([nextRenderer, nextSkin, nextParticle, active]) => {
            if (!active || !nextRenderer) return

            try {
                if (nextSkin && (nextRenderer !== uploadedRenderer || nextSkin !== uploadedSkin)) {
                    nextRenderer.setTexture(0, nextSkin.texture, nextSkin.interpolation)
                    uploadedSkin = nextSkin
                }
                if (
                    nextParticle &&
                    (nextRenderer !== uploadedRenderer || nextParticle !== uploadedParticle)
                ) {
                    nextRenderer.setTexture(1, nextParticle.texture, nextParticle.interpolation)
                    uploadedParticle = nextParticle
                }
                uploadedRenderer = nextRenderer
            } catch (error) {
                console.error('Failed to upload preview textures:', error)
                errorDetail.value = error instanceof Error ? error.message : String(error)
                status.value = 'error'
                renderer.value = undefined
                nextRenderer.dispose()
            }
        },
    )

    let rafId = 0
    let renderFrame: (() => void) | undefined
    let renderedBackground: HTMLDivElement | undefined
    let renderedBackgroundTransform = ''

    const getRenderSize = (requestedScale: number) => {
        if (!renderer.value) return

        const requestedWidth = canvasWidth.value * requestedScale
        const requestedHeight = canvasHeight.value * requestedScale
        const { width: maxWidth, height: maxHeight } = renderer.value.maxViewportSize
        const fit = Math.min(1, maxWidth / requestedWidth, maxHeight / requestedHeight)

        return {
            width: Math.max(1, Math.round(requestedWidth * fit)),
            height: Math.max(1, Math.round(requestedHeight * fit)),
        }
    }

    // Every animation uses chart time, so a paused frame only changes when one of
    // these inputs changes. Coalesce edits and playback updates into one draw.
    watchEffect(
        () => {
            if (!isAppActive.value) {
                cancelAnimationFrame(rafId)
                rafId = 0
                renderFrame = undefined
                return
            }
            const currentRenderer = renderer.value
            const currentSkin = skin.value
            if (!currentRenderer || !currentSkin || !canvasWidth.value || !canvasHeight.value) {
                renderFrame = undefined
                return
            }

            const renderSize = getRenderSize(pixelRatio.value * settings.previewRenderScale)
            if (!renderSize) return

            const getChart = chartRequest.value
            const backgroundElement = background.value
            const selected = settings.previewHighlightSelection
                ? getPreviewState(state.value).selectedEntities
                : []
            const objects = new Set(selected)
            const stageIds = new Set(
                selected.flatMap((entity) => {
                    if (entity.type === 'note' || entity.type === 'connector') return []
                    if ('stageId' in entity) return [entity.stageId]
                    if ('min' in entity && 'stageId' in entity.min) return [entity.min.stageId]
                    return []
                }),
            )
            const stages = new Set(
                [...state.value.stages.keys()].flatMap((id, index) =>
                    stageIds.has(id) ? [index] : [],
                ),
            )
            const overlay = selectionCanvas?.value
            const args = [
                view.cursorTime,
                renderSize.width,
                renderSize.height,
                canvasWidth.value,
                canvasHeight.value,
                settings.previewNoteSpeed,
                settings.previewShowEffects,
                particle.value?.particle,
            ] as const
            renderFrame = () => {
                const ctx = overlay?.getContext('2d')
                if (overlay && ctx) {
                    const ratio = pixelRatio.value
                    if (overlay.width !== Math.round(canvasWidth.value * ratio))
                        overlay.width = Math.round(canvasWidth.value * ratio)
                    if (overlay.height !== Math.round(canvasHeight.value * ratio))
                        overlay.height = Math.round(canvasHeight.value * ratio)
                    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
                    ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value)
                }
                const outline = createSelectionOutline()
                const quad = renderPreviewFrame(
                    currentRenderer,
                    currentSkin.skin,
                    getChart(),
                    ...args,
                    objects.size || stages.size
                        ? { objects, stages, outline: outline.add }
                        : undefined,
                )
                if (ctx) {
                    const scale = args[4] / 2
                    ctx.beginPath()
                    for (const { a, b } of outline.edges()) {
                        ctx.moveTo(args[3] / 2 + a.x * scale, args[4] / 2 - a.y * scale)
                        ctx.lineTo(args[3] / 2 + b.x * scale, args[4] / 2 - b.y * scale)
                    }
                    ctx.lineJoin = 'round'
                    ctx.lineCap = 'round'
                    ctx.strokeStyle = '#06151d'
                    ctx.lineWidth = 5
                    ctx.stroke()
                    ctx.strokeStyle = '#67e8f9'
                    ctx.lineWidth = 2
                    ctx.stroke()
                }
                if (!backgroundElement) return
                // Map the complete image into the engine's screen-space quad in
                // this same frame. CSS pixels have a downward-pointing y axis.
                const displayWidth = args[3]
                const displayHeight = args[4]
                const scale = displayHeight / 2
                const transform = `matrix(${[
                    ((quad.tr.x - quad.tl.x) * scale) / displayWidth,
                    (-(quad.tr.y - quad.tl.y) * scale) / displayWidth,
                    (quad.bl.x - quad.tl.x) / 2,
                    -(quad.bl.y - quad.tl.y) / 2,
                    displayWidth / 2 + quad.tl.x * scale,
                    displayHeight / 2 - quad.tl.y * scale,
                ].join(',')})`
                if (
                    renderedBackground !== backgroundElement ||
                    renderedBackgroundTransform !== transform
                ) {
                    backgroundElement.style.backgroundSize = '100% 100%'
                    backgroundElement.style.transform = transform
                    renderedBackground = backgroundElement
                    renderedBackgroundTransform = transform
                }
            }
            if (rafId) return
            rafId = requestAnimationFrame(() => {
                rafId = 0
                if (isAppActive.value) renderFrame?.()
            })
        },
        { flush: 'post' },
    )

    onBeforeUnmount(() => {
        cancelAnimationFrame(rafId)
        renderer.value?.dispose()
    })
}
