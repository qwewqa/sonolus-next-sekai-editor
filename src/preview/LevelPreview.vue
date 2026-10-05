<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import ChevronIcon from '../editor/workspace/ChevronIcon.vue'
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
const selectionCanvas = useTemplateRef<HTMLCanvasElement>('selection')
const resources = usePreviewResources()
const { status, errorDetail, loadVersion, reload } = resources
const viewport = usePreviewViewport(container)
const {
    canvasStyle,
    controlsLayout,
    controlsStyle,
    controlsButtonStyle,
    settingsLayout,
    focusPlacementOnMount,
    areControlsExpanded,
    areTransportControlsVisible,
    onControlsResize,
    onTimeResize,
} = viewport
usePreviewRendering(canvas, background, resources, viewport, selectionCanvas)

const isErrorDetailOpen = ref(false)
</script>

<template>
    <div ref="container" class="preview relative h-full w-full">
        <!-- Until the skin is ready there is no strip to make room for, so the
        status fills the whole panel rather than leaving an empty band. -->
        <div
            class="preview-viewport absolute overflow-hidden bg-black"
            :class="{ 'inset-0': status !== 'ready' }"
            :style="status === 'ready' ? canvasStyle : undefined"
        >
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

            <canvas
                ref="selection"
                class="preview-selection pointer-events-none absolute inset-0 h-full w-full"
                aria-hidden="true"
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
                            @toggle="isErrorDetailOpen = ($event.target as HTMLDetailsElement).open"
                        >
                            <!-- The shared chevron in place of the native marker. -->
                            <summary
                                class="flex cursor-pointer list-none items-center justify-center gap-2 rounded-full px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
                            >
                                <ChevronIcon :direction="isErrorDetailOpen ? 'down' : 'right'" />
                                {{ i18n.preview.errorDetails }}
                            </summary>
                            <p>{{ errorDetail }}</p>
                        </details>
                        <button
                            type="button"
                            class="h-8 rounded-full bg-button px-4 text-fg shadow-md transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                            @click="reload"
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
            :layout="controlsLayout"
            @time-resize="onTimeResize"
        />

        <PreviewSettings
            v-if="status === 'ready' && !isPlaying"
            v-model:expanded="areControlsExpanded"
            :button-hidden="!!settingsLayout?.isButtonBlocked"
            :button-style="controlsButtonStyle"
            :panel-style="controlsStyle"
            :placed="!!settingsLayout"
            :focus-placement="focusPlacementOnMount"
            :floating="
                !!settingsLayout &&
                settingsLayout.placement !== 'below' &&
                settingsLayout.placement !== 'over'
            "
            @resize="onControlsResize"
        />
    </div>
</template>

<style scoped>
.preview-background {
    background: url('./bg.png') center / cover no-repeat;
}
</style>
