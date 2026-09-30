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
import type { LoadedSkin } from './skin'
import type { usePreviewResources } from './usePreviewResources'

type PreviewViewport = {
    canvasWidth: Ref<number>
    canvasHeight: Ref<number>
    pixelRatio: Ref<number>
}

export const usePreviewRendering = (
    canvas: Readonly<Ref<HTMLCanvasElement | null>>,
    { skin, particle, status, errorDetail }: ReturnType<typeof usePreviewResources>,
    { canvasWidth, canvasHeight, pixelRatio }: PreviewViewport,
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
                renderPreviewFrame(currentRenderer, currentSkin.skin, getChart(), ...args)
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
