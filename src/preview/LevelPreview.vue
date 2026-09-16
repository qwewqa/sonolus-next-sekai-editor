<script setup lang="ts">
import {
    computed,
    onMounted,
    onUnmounted,
    ref,
    shallowRef,
    useTemplateRef,
    watch,
    watchEffect,
} from 'vue'
import { isAppActive } from '../activity'
import { view } from '../editor/view'
import { state } from '../history'
import { isPlaying } from '../player'
import type { State } from '../state'
import { getPreviewState, hasSamePreviewData, previewEdit } from './edit'
import { createPreviewChartBuilder } from './engine/chart'
import { TARGET_ASPECT_RATIO } from './engine/layout'
import type { PreviewChart } from './engine/model'
import { renderPreviewFrame } from './engine/render'
import { createPreviewRenderer, type PreviewRenderer } from './gl'
import { loadParticleFromScp, type LoadedParticle } from './particle'
import { loadPreviewResource } from './resource'
import { loadSkinFromScp, type LoadedSkin } from './skin'

const container = useTemplateRef('container')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')

const noteSpeed = ref(10)

const renderScale = ref(1)

const showEffects = ref(true)

const antialias = ref(true)
// The same viewport ratios outlined by the engine's test-aspect overlay.
const aspectRatios = [
    { label: '16:9', value: TARGET_ASPECT_RATIO },
    { label: '21:9', value: 21 / 9 },
    { label: '4:3', value: 4 / 3 },
] as const
const aspectRatio = ref<number>(TARGET_ASPECT_RATIO)

const skin = shallowRef<LoadedSkin>()
const particle = shallowRef<LoadedParticle>()
const status = ref<'loading' | 'missing' | 'error' | 'ready'>('loading')

// Selection, audio and filename changes share the same chart data. Keep them from
// rebuilding the preview and its indexes during ordinary editor interactions.
const chartState = computed<State>((previous) => {
    const next = state.value
    if (previous && hasSamePreviewData(previous, next)) {
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
    const speed = noteSpeed.value
    let chart: PreviewChart | undefined
    return () => (chart ??= buildChart(getPreviewState(current, edit), speed))
})

const renderer = shallowRef<PreviewRenderer>()

let loadController: AbortController | undefined

const releaseResources = () => {
    skin.value?.texture.close()
    particle.value?.texture.close()
    skin.value = undefined
    particle.value = undefined
}

const loadSkin = async () => {
    loadController?.abort()
    loadController = new AbortController()
    const { signal } = loadController
    const isAborted = () => signal.aborted
    status.value = 'loading'
    releaseResources()

    try {
        const loadedSkin = await loadPreviewResource(
            `${import.meta.env.BASE_URL}resource/skin.scp`,
            loadSkinFromScp,
            signal,
        )
        if (isAborted()) {
            loadedSkin?.texture.close()
            return
        }
        if (!loadedSkin) {
            status.value = 'missing'
            return
        }

        skin.value = loadedSkin
        status.value = 'ready'
    } catch (error) {
        if (isAborted()) return
        console.error('Failed to load preview skin:', error)
        status.value = 'missing'
        return
    }

    try {
        const loadedParticle = await loadPreviewResource(
            `${import.meta.env.BASE_URL}resource/particle.scp`,
            loadParticleFromScp,
            signal,
        )
        if (isAborted()) {
            loadedParticle?.texture.close()
            return
        }
        particle.value = loadedParticle
    } catch (error) {
        if (isAborted()) return
        console.error('Failed to load preview particle:', error)
    }
}

let contextLost = false

const initializeRenderer = () => {
    if (!isAppActive.value || !canvas.value || !skin.value || renderer.value || contextLost) return

    try {
        renderer.value = createPreviewRenderer(canvas.value, antialias.value)
        status.value = 'ready'
    } catch (error) {
        console.error('Failed to create preview renderer:', error)
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
watch([renderer, skin, particle, isAppActive], ([nextRenderer, nextSkin, nextParticle, active]) => {
    if (!active || !nextRenderer) return

    if (nextSkin && (nextRenderer !== uploadedRenderer || nextSkin !== uploadedSkin)) {
        nextRenderer.setTexture(0, nextSkin.texture, nextSkin.interpolation)
        uploadedSkin = nextSkin
    }
    if (nextParticle && (nextRenderer !== uploadedRenderer || nextParticle !== uploadedParticle)) {
        nextRenderer.setTexture(1, nextParticle.texture, nextParticle.interpolation)
        uploadedParticle = nextParticle
    }
    uploadedRenderer = nextRenderer
})

const canvasWidth = ref(0)
const canvasHeight = ref(0)
const canvasLeft = ref(0)
const canvasTop = ref(0)
const pixelRatio = ref(devicePixelRatio || 1)

let containerWidth = 0
let containerHeight = 0

const canvasStyle = computed(() => ({
    left: `${canvasLeft.value}px`,
    top: `${canvasTop.value}px`,
    width: `${canvasWidth.value}px`,
    height: `${canvasHeight.value}px`,
}))

const updateCanvasSize = () => {
    if (!containerWidth || !containerHeight) return

    // Preserve the exact logical ratio; backing pixels are rounded separately.
    // Independent CSS width/height rounding would subtly stretch the engine field.
    canvasWidth.value = Math.min(containerWidth, containerHeight * aspectRatio.value)
    canvasHeight.value = canvasWidth.value / aspectRatio.value
    canvasLeft.value = (containerWidth - canvasWidth.value) / 2
    canvasTop.value = (containerHeight - canvasHeight.value) / 2
}

watch(aspectRatio, updateCanvasSize)

const resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry) return

    containerWidth = entry.contentRect.width
    containerHeight = entry.contentRect.height
    updateCanvasSize()
})

const onSpeedChange = (event: Event) => {
    const input = event.target as HTMLInputElement

    const value = Number.parseFloat(input.value)
    if (Number.isFinite(value)) {
        noteSpeed.value = Math.min(12, Math.max(1, Math.round(value * 100) / 100))
    }

    input.value = noteSpeed.value.toString()
}

const onScaleChange = (event: Event) => {
    const input = event.target as HTMLInputElement

    const value = Number.parseFloat(input.value)
    if (Number.isFinite(value)) {
        renderScale.value = Math.min(2, Math.max(0.25, Math.round(value * 4) / 4))
    }

    input.value = renderScale.value.toString()
}

const blurInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    input.blur()
}

const onAspectChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    // Pointer changes return shortcuts to the editor; keyboard radio navigation
    // keeps focus so arrow keys can continue through all three choices.
    if (!input.matches(':focus-visible')) input.blur()
}

const onSpeedKeydown = (event: KeyboardEvent) => {
    event.stopPropagation()

    if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur()
}

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

        const renderSize = getRenderSize(pixelRatio.value * renderScale.value)
        if (!renderSize) return

        const getChart = chartRequest.value
        const args = [
            view.cursorTime,
            renderSize.width,
            renderSize.height,
            canvasWidth.value,
            canvasHeight.value,
            noteSpeed.value,
            showEffects.value,
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

let pixelRatioQuery: MediaQueryList | undefined
const onPixelRatioChange = () => {
    pixelRatio.value = devicePixelRatio || 1
    updateCanvasSize()
    pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
    pixelRatioQuery = matchMedia(`(resolution: ${pixelRatio.value}dppx)`)
    pixelRatioQuery.addEventListener('change', onPixelRatioChange)
}

onMounted(() => {
    if (container.value) resizeObserver.observe(container.value)

    void loadSkin()

    onPixelRatioChange()
    window.addEventListener('resize', onPixelRatioChange)
})

onUnmounted(() => {
    loadController?.abort()
    resizeObserver.disconnect()
    cancelAnimationFrame(rafId)
    window.removeEventListener('resize', onPixelRatioChange)
    pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
    renderer.value?.dispose()
    releaseResources()
})
</script>

<template>
    <div ref="container" class="preview relative h-full w-full overflow-hidden">
        <div class="preview-viewport absolute overflow-hidden" :style="canvasStyle">
            <canvas
                ref="canvas"
                :key="antialias ? 'aa' : 'no-aa'"
                class="absolute inset-0 h-full w-full"
            />

            <div
                v-if="status !== 'ready'"
                class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/75"
            >
                <template v-if="status === 'loading'">Loading skin...</template>
                <template v-else>
                    <p>
                        Put a skin package at
                        <span class="font-bold">public/resource/skin.scp</span> to enable the
                        preview.
                    </p>
                    <p class="text-xs text-white/50">
                        Optionally add
                        <span class="font-bold">public/resource/particle.scp</span> for hit effects.
                    </p>
                    <button
                        class="rounded bg-button px-3 py-1 text-fg transition-colors hover:shadow-accent active:bg-accent active:text-button"
                        @click="loadSkin"
                    >
                        Reload
                    </button>
                </template>
            </div>
        </div>

        <div
            v-if="status === 'ready' && !isPlaying"
            class="preview-controls absolute right-1 top-1 flex max-h-[calc(100%-0.5rem)] max-w-[calc(100%-0.5rem)] flex-col items-end gap-1 overflow-y-auto rounded bg-black/40 px-2 py-1 text-xs text-white/75"
            @keydown.stop
        >
            <div class="flex w-full min-w-0 shrink-0 items-center gap-2">
                <span class="w-10 shrink-0">Speed</span>
                <input
                    v-model.number="noteSpeed"
                    class="min-w-0 flex-1"
                    type="range"
                    min="1"
                    max="12"
                    step="0.05"
                />
                <input
                    class="number-input w-10 shrink-0 rounded bg-black/30 px-1 text-right"
                    type="number"
                    min="1"
                    max="12"
                    step="0.01"
                    :value="noteSpeed"
                    @change="onSpeedChange"
                    @keydown="onSpeedKeydown"
                />
            </div>
            <div class="flex w-full min-w-0 shrink-0 items-center gap-2">
                <span class="w-10 shrink-0">Quality</span>
                <input
                    v-model.number="renderScale"
                    class="min-w-0 flex-1"
                    type="range"
                    min="0.25"
                    max="2"
                    step="0.25"
                />
                <input
                    class="number-input w-10 shrink-0 rounded bg-black/30 px-1 text-right"
                    type="number"
                    min="0.25"
                    max="2"
                    step="0.25"
                    :value="renderScale"
                    @change="onScaleChange"
                    @keydown="onSpeedKeydown"
                />
            </div>
            <div
                class="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1"
                role="radiogroup"
                aria-label="Aspect ratio"
            >
                <span>Aspect</span>
                <label
                    v-for="ratio in aspectRatios"
                    :key="ratio.label"
                    class="flex shrink-0 cursor-pointer items-center gap-1"
                >
                    <input
                        v-model="aspectRatio"
                        type="radio"
                        name="preview-aspect-ratio"
                        :value="ratio.value"
                        @change="onAspectChange"
                        @keydown.stop
                    />
                    <span>{{ ratio.label }}</span>
                </label>
            </div>
            <label class="flex shrink-0 cursor-pointer items-center gap-2">
                <span>Effects</span>
                <input v-model="showEffects" type="checkbox" @change="blurInput" />
            </label>
            <label class="flex shrink-0 cursor-pointer items-center gap-2">
                <span>Antialias</span>
                <input v-model="antialias" type="checkbox" @change="blurInput" />
            </label>
        </div>
    </div>
</template>

<style scoped>
.preview-viewport {
    background: url('./bg.png') center / cover no-repeat;
}

.number-input {
    appearance: textfield;
}

.number-input::-webkit-outer-spin-button,
.number-input::-webkit-inner-spin-button {
    margin: 0;
    appearance: none;
}
</style>
