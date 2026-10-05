<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watchEffect } from 'vue'
import { beats, times } from '..'
import { isAppActive } from '../../activity'
import { defaultGroupId } from '../../history/groups'
import { settings } from '../../settings'
import type { Entity } from '../../state/entities'
import { beatToTime, timeToBeat } from '../../state/integrals/bpms'
import { activateEditorNavigation, controlsForNavigation } from '../controls'
import { computedVisibleEntities, isEntityInBeatRange } from '../entities/visibility'
import { culledEntities, selectedEntitySet, visibleSelectedEntities } from '../entities/visible'
import { isScenePreview, sceneState } from '../sceneState'
import { scopeLookup } from '../scope'
import { bgmOffsetDelta } from '../tools/offset'
import { hoveredEntities, isViewRecentlyActive, view, viewBox } from '../view'
import OffscreenNoteIndicators from '../OffscreenNoteIndicators.vue'
import { createConnectorRenderer } from './connectors'
import { drawEvent, drawEventInfinities } from './events'
import { drawGrid } from './grid'
import { createNoteRenderer } from './notes'
import { orderEntities } from './ordering'
import { createFrameScheduler, prepareSurface } from './surface'
import { measureTextMiddle } from './text'
import type { EditorDrawContext } from './types'
import { createWaveformRenderer } from './waveform'

const container = useTemplateRef('container')
const controlListeners = controlsForNavigation(() => undefined)
const chartCanvas = useTemplateRef<HTMLCanvasElement>('chart')
const overlayCanvas = useTemplateRef<HTMLCanvasElement>('overlay')
const pixelRatio = ref(devicePixelRatio || 1)
const fontFamily = ref('sans-serif')
const fontMiddle = ref(0.25)
const redrawVersion = ref(0)
const waveformVersion = ref(0)
const chartFrame = createFrameScheduler()
const overlayFrame = createFrameScheduler()
const notes = createNoteRenderer()
const connectors = createConnectorRenderer()
const waveform = createWaveformRenderer(() => waveformVersion.value++)
let creatingCanvas: HTMLCanvasElement | undefined

const artRange = computed(() => {
    const scale = view.w / viewBox.value.w
    const padding = (1.25 * scale + 4) / settings.pps
    return {
        min: timeToBeat(sceneState.value.bpms, Math.max(0, times.value.min - padding)),
        max: timeToBeat(sceneState.value.bpms, times.value.max + padding),
    }
})
const artEntities = computedVisibleEntities(
    () => culledEntities.value,
    () => artRange.value,
)
const orderedEntities = computed(() =>
    orderEntities(artEntities.value, selectedEntitySet.value, {
        scope: scopeLookup.value,
        visibilities: view.visibilities,
        showOtherObjects: settings.showOtherObjects,
    }),
)
const hoveredSet = computed(() => new Set(hoveredEntities.value))
const offscreenNotes = computed(() => {
    const bounds = viewBox.value
    const scale = view.w / bounds.w
    return orderedEntities.value.flatMap(({ entity, highlighted, opacity }) =>
        entity.type === 'note'
            ? [
                  {
                      left: (entity.left - bounds.l) * scale,
                      right: (entity.left + entity.size - bounds.l) * scale,
                      y:
                          (beatToTime(sceneState.value.bpms, entity.beat) * bounds.ups - bounds.t) *
                          scale,
                      highlighted,
                      opacity,
                  },
              ]
            : [],
    )
})
const contextInputs = computed(() => ({
    width: view.w,
    height: view.h,
    scale: view.w / viewBox.value.w,
    pixelRatio: pixelRatio.value,
    bounds: viewBox.value,
    ups: viewBox.value.ups,
    state: sceneState.value,
    defaultGroupId: defaultGroupId.value,
    showStageName: settings.showStageName,
    showGroupName: settings.showGroupName,
    recentlyActive: isViewRecentlyActive.value,
    fontFamily: fontFamily.value,
    fontMiddle: fontMiddle.value,
    redrawVersion: redrawVersion.value,
}))

const drawEntity = (
    context: EditorDrawContext,
    entity: Entity,
    highlighted: boolean,
    opacity = 1,
) => {
    if (entity.type === 'note') notes.draw(context, entity, highlighted, opacity)
    else if (entity.type === 'connector') connectors.draw(context, entity, highlighted, opacity)
    else drawEvent(context, entity, highlighted, opacity)
}

// Dependencies are captured synchronously; rendering runs once with the latest
// snapshot. Pointer-only overlays do not invalidate the chart underneath them.
watchEffect(
    () => {
        if (!isAppActive.value) {
            chartFrame.cancel()
            return
        }
        const canvas = chartCanvas.value
        const inputs = contextInputs.value
        if (!canvas || !inputs.width || !inputs.height) return
        const entities = orderedEntities.value
        const hovered = inputs.recentlyActive ? undefined : hoveredSet.value
        const visibilities = view.visibilities
        // Captured here: the frame callback runs untracked.
        const scope = scopeLookup.value
        const showOtherObjects = settings.showOtherObjects
        const currentBeats = beats.value
        const currentTimes = times.value
        const division = view.division
        const laneDivision = view.laneDivision
        const beatDisplay = settings.beatDisplay
        const cursor = view.cursorTime
        const currentWaveform = settings.waveform === 'off' ? undefined : inputs.state.bgm.waveform
        const offset = inputs.state.bgm.offset + bgmOffsetDelta.value
        void waveformVersion.value
        chartFrame.schedule((timestamp) => {
            notes.beginFrame(timestamp)
            const ctx = prepareSurface(
                canvas,
                inputs.width,
                inputs.height,
                inputs.pixelRatio,
                inputs.bounds,
            )
            if (!ctx) return
            const context = { ...inputs, ctx }
            waveform.draw(context, currentWaveform, offset, currentTimes)
            drawGrid(context, currentBeats, currentTimes, division, laneDivision, beatDisplay)
            ctx.save()
            ctx.strokeStyle = '#fff'
            ctx.beginPath()
            ctx.moveTo(-7, cursor * inputs.ups)
            ctx.lineTo(7, cursor * inputs.ups)
            ctx.stroke()
            ctx.restore()
            drawEventInfinities(context, visibilities, scope, showOtherObjects)
            for (const { entity, highlighted, opacity } of entities) {
                drawEntity(context, entity, highlighted || !!hovered?.has(entity), opacity)
            }
        })
    },
    { flush: 'post' },
)

watchEffect(
    () => {
        if (!isAppActive.value) {
            overlayFrame.cancel()
            return
        }
        const canvas = overlayCanvas.value
        const inputs = contextInputs.value
        if (!canvas || !inputs.width || !inputs.height) return
        const creating = isScenePreview.value ? [] : view.entities.creating
        const range = artRange.value
        const hovered = hoveredEntities.value
        const selected = visibleSelectedEntities.value
        const selection = view.selection
        const hover = view.hoverTime
        overlayFrame.schedule((timestamp) => {
            notes.beginFrame(timestamp)
            const ctx = prepareSurface(
                canvas,
                inputs.width,
                inputs.height,
                inputs.pixelRatio,
                inputs.bounds,
            )
            if (!ctx) return
            if (creating.length) {
                // Composite the entire preview once, retaining SVG group opacity at
                // overlapping notes and connectors. Allocate only during gestures.
                creatingCanvas ??= document.createElement('canvas')
                const creatingContext = prepareSurface(
                    creatingCanvas,
                    inputs.width,
                    inputs.height,
                    inputs.pixelRatio,
                    inputs.bounds,
                )
                if (creatingContext) {
                    const context = { ...inputs, ctx: creatingContext }
                    for (const entity of creating) {
                        if (isEntityInBeatRange(entity, range.min, range.max))
                            drawEntity(context, entity, true)
                    }
                    ctx.save()
                    ctx.setTransform(1, 0, 0, 1, 0, 0)
                    ctx.globalAlpha = 0.5
                    ctx.drawImage(creatingCanvas, 0, 0)
                    ctx.restore()
                }
            } else if (creatingCanvas) {
                creatingCanvas.width = creatingCanvas.height = 1
                creatingCanvas = undefined
            }

            ctx.save()
            ctx.strokeStyle = '#fff'
            ctx.fillStyle = '#fff'
            ctx.setLineDash([6 / inputs.scale, 4 / inputs.scale])
            ctx.globalAlpha = 0.5
            for (const entities of [hovered, selected]) {
                for (const { hitbox } of entities) {
                    if (!hitbox) continue
                    ctx.strokeRect(
                        hitbox.lane - hitbox.w - 0.1,
                        beatToTime(inputs.state.bpms, hitbox.beat) * inputs.ups - hitbox.h - 0.1,
                        hitbox.w * 2 + 0.2,
                        hitbox.h * 2 + 0.2,
                    )
                }
            }
            if (selection) {
                const x = selection.laneMin
                const y = selection.timeMax * inputs.ups
                const w = selection.laneMax - selection.laneMin
                const h = (selection.timeMin - selection.timeMax) * inputs.ups
                ctx.globalAlpha = 0.25
                ctx.fillRect(x, y, w, h)
                ctx.globalAlpha = 0.5
                ctx.strokeRect(x, y, w, h)
            }
            ctx.beginPath()
            ctx.moveTo(-6, hover * inputs.ups)
            ctx.lineTo(6, hover * inputs.ups)
            ctx.stroke()
            ctx.restore()
        })
    },
    { flush: 'post' },
)

let pixelRatioQuery: MediaQueryList | undefined
const updatePixelRatio = () => {
    pixelRatio.value = devicePixelRatio || 1
    pixelRatioQuery?.removeEventListener('change', updatePixelRatio)
    pixelRatioQuery = matchMedia(`(resolution: ${pixelRatio.value}dppx)`)
    pixelRatioQuery.addEventListener('change', updatePixelRatio)
}
const updateFont = () => {
    if (container.value) {
        fontFamily.value = getComputedStyle(container.value).fontFamily
        fontMiddle.value = measureTextMiddle(fontFamily.value, container.value)
    }
    redrawVersion.value++
}
const restoreContext = () => {
    notes.clear()
    connectors.clear()
    // A restored surface has lost its pixels even if chart time is paused.
    redrawVersion.value++
}

onMounted(() => {
    updatePixelRatio()
    updateFont()
    window.addEventListener('resize', updatePixelRatio)
    document.fonts.addEventListener('loadingdone', updateFont)
})
onUnmounted(() => {
    chartFrame.cancel()
    overlayFrame.cancel()
    notes.clear()
    connectors.clear()
    waveform.clear()
    if (creatingCanvas) creatingCanvas.width = creatingCanvas.height = 1
    window.removeEventListener('resize', updatePixelRatio)
    pixelRatioQuery?.removeEventListener('change', updatePixelRatio)
    document.fonts.removeEventListener('loadingdone', updateFont)
})
</script>

<template>
    <div
        ref="container"
        class="editor absolute size-full touch-none"
        @pointerenter="activateEditorNavigation()"
        @focusin="activateEditorNavigation()"
        v-on="controlListeners"
    >
        <canvas
            ref="chart"
            class="editor-chart pointer-events-none absolute size-full"
            @contextrestored="restoreContext"
        />
        <canvas
            ref="overlay"
            class="editor-overlay pointer-events-none absolute size-full"
            @contextrestored="restoreContext"
        />
        <OffscreenNoteIndicators
            :notes="offscreenNotes"
            :width="view.w"
            :top="0"
            :bottom="view.h"
        />
    </div>
</template>
