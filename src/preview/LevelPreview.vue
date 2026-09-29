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
const resources = usePreviewResources()
const { status, loadSkin } = resources
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
usePreviewRendering(canvas, resources, viewport)
</script>

<template>
    <div ref="container" class="preview relative h-full w-full">
        <div class="preview-viewport absolute overflow-hidden" :style="canvasStyle">
            <canvas
                ref="canvas"
                :key="settings.previewAntialias ? 'aa' : 'no-aa'"
                class="absolute inset-0 h-full w-full"
            />

            <div
                v-if="status !== 'ready'"
                class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-white/75"
            >
                <template v-if="status === 'loading'">{{ i18n.preview.loadingSkin }}</template>
                <template v-else>
                    <p>{{ i18n.preview.skinUnavailable }}</p>
                    <button
                        class="min-h-11 rounded-full bg-button px-4 py-2 text-fg shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-accent active:text-on-accent"
                        @click="loadSkin"
                    >
                        {{ i18n.preview.reload }}
                    </button>
                </template>
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
.preview-viewport {
    background: url('./bg.png') center / cover no-repeat;
}
</style>
