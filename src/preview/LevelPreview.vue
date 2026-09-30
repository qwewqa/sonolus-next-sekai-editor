<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { i18n } from '../i18n'
import { isPlaying } from '../player'
import { settings } from '../settings'
import PreviewSettings from './PreviewSettings.vue'
import PreviewTransport from './PreviewTransport.vue'
import { usePreviewRendering } from './usePreviewRendering'
import { usePreviewResources } from './usePreviewResources'
import { usePreviewViewport } from './usePreviewViewport'

const container = useTemplateRef<HTMLDivElement>('container')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const background = useTemplateRef<HTMLDivElement>('background')
const resources = usePreviewResources()
const { status, errorDetail, loadVersion, loadSkin } = resources
const viewport = usePreviewViewport(container)
const {
    canvasHeight,
    canvasLeft,
    displayedCanvasTop,
    canvasStyle,
    controlsStyle,
    areControlsExpanded,
    areTransportControlsVisible,
    canDockTransport,
    onControlsResize,
    onTransportResize,
    onTimeResize,
    onDockChange,
} = viewport
usePreviewRendering(canvas, background, resources, viewport)
</script>

<template>
    <div ref="container" class="preview relative h-full w-full">
        <div class="preview-viewport absolute overflow-hidden bg-black" :style="canvasStyle">
            <div
                ref="background"
                class="preview-background pointer-events-none absolute inset-0 origin-top-left"
                aria-hidden="true"
            />
            <canvas
                ref="canvas"
                :key="`${loadVersion}:${settings.previewAntialias}`"
                class="absolute inset-0 h-full w-full"
            />

            <div
                v-if="status !== 'ready'"
                class="absolute inset-0 flex overflow-y-auto bg-black/40 p-4 text-center text-sm text-white/90"
            >
                <div class="m-auto flex w-full shrink-0 flex-col items-center gap-2">
                    <template v-if="status === 'loading'">{{ i18n.preview.loadingSkin }}</template>
                    <template v-else>
                        <p>
                            {{
                                status === 'error'
                                    ? i18n.preview.graphicsUnavailable
                                    : i18n.preview.skinUnavailable
                            }}
                        </p>
                        <p v-if="status === 'error'">{{ i18n.preview.graphicsHelp }}</p>
                        <details
                            v-if="errorDetail"
                            class="max-h-32 max-w-full overflow-auto break-words"
                        >
                            <summary class="cursor-pointer">
                                {{ i18n.preview.errorDetails }}
                            </summary>
                            <p>{{ errorDetail }}</p>
                        </details>
                        <button
                            class="min-h-11 rounded-full bg-button px-4 py-2 text-fg shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-accent active:text-on-accent"
                            @click="loadSkin"
                        >
                            {{ i18n.preview.reload }}
                        </button>
                    </template>
                </div>
            </div>
        </div>

        <PreviewTransport
            v-if="status === 'ready'"
            v-model="areTransportControlsVisible"
            :viewport-left="canvasLeft"
            :viewport-top="displayedCanvasTop"
            :viewport-bottom="displayedCanvasTop + canvasHeight"
            :persistent="canDockTransport"
            @resize="onTransportResize"
            @time-resize="onTimeResize"
        />

        <PreviewSettings
            v-if="status === 'ready' && !isPlaying"
            v-show="!areTransportControlsVisible || canDockTransport"
            v-model:expanded="areControlsExpanded"
            :style="controlsStyle"
            @resize="onControlsResize"
            @position-change="onDockChange"
        />
    </div>
</template>

<style scoped>
.preview-background {
    background: url('./bg.png') center / cover no-repeat;
}
</style>
