<script setup lang="ts">
import { computed, useId, useTemplateRef, watch } from 'vue'
import SettingsIcon from '../editor/commands/settings/SettingsIcon.vue'
import { i18n } from '../i18n'
import { settings } from '../settings'
import { previewAspectRatios, previewNoteSpeed, previewRenderScale } from './options'
import { previewPositionOptions } from './settingsOptions'

const areControlsExpanded = defineModel<boolean>('expanded', { required: true })
const emit = defineEmits<{
    resize: [width: number, height: number, headerHeight: number]
    positionChange: []
}>()
const controls = useTemplateRef<HTMLDivElement>('controls')
const controlsBody = useTemplateRef<HTMLDivElement>('controlsBody')
const controlsId = useId()
const controlsToggleLabel = computed(() =>
    areControlsExpanded.value
        ? i18n.value.preview.minimizeSettings
        : i18n.value.preview.showSettings,
)
const toggleControls = (event: MouseEvent) => {
    areControlsExpanded.value = !areControlsExpanded.value
    // Pointer clicks return shortcuts to the editor; keyboard users retain focus.
    if (event.detail > 0) (event.currentTarget as HTMLButtonElement).blur()
}
const normalizeNumber = (
    value: number,
    { min, max, step }: { min: number; max: number; step: number },
) => Math.min(max, Math.max(min, Math.round(value * (1 / step)) / (1 / step)))

watch([controls, controlsBody], ([element, body], _previous, onCleanup) => {
    if (!element || !body) return
    let frame = 0
    const schedule = () => {
        if (frame) return
        // Measure once after observer delivery. Updating max-height inside its
        // callback would trigger same-frame ResizeObserver loop warnings.
        frame = requestAnimationFrame(() => {
            frame = 0
            const width = element.getBoundingClientRect().width
            const headerHeight = element.firstElementChild?.getBoundingClientRect().height ?? 0
            // The natural height stays stable when max-height makes the body
            // scroll, avoiding a feedback loop from the timestamp's reservation.
            emit('resize', width, headerHeight + body.scrollHeight, headerHeight)
        })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    observer.observe(body)
    schedule()
    onCleanup(() => {
        observer.disconnect()
        cancelAnimationFrame(frame)
    })
})

const onSpeedChange = (event: Event) => {
    const input = event.target as HTMLInputElement

    const value = Number.parseFloat(input.value)
    if (Number.isFinite(value)) {
        settings.previewNoteSpeed = normalizeNumber(value, previewNoteSpeed)
    }

    input.value = settings.previewNoteSpeed.toString()
}

const onScaleChange = (event: Event) => {
    const input = event.target as HTMLInputElement

    const value = Number.parseFloat(input.value)
    if (Number.isFinite(value)) {
        settings.previewRenderScale = normalizeNumber(value, previewRenderScale)
    }

    input.value = settings.previewRenderScale.toString()
}

const blurInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    input.blur()
}

const onRadioChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    // Pointer changes return shortcuts to the editor; keyboard radio navigation
    // keeps focus so arrow keys can continue through all three choices.
    if (!input.matches(':focus-visible')) input.blur()
}

const onDockChange = (event: Event) => {
    // Keep settings reachable when the new position leaves no room for a docked
    // transport. Ordinary resizes still preserve the bar's chosen visibility.
    emit('positionChange')
    onRadioChange(event)
}

const onSpeedKeydown = (event: KeyboardEvent) => {
    event.stopPropagation()

    if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur()
}
</script>

<template>
    <div
        ref="controls"
        class="preview-controls absolute right-1 top-1 z-10 flex max-w-[calc(100%-0.5rem)] flex-col overflow-hidden text-xs text-fg accent-fg shadow-xl"
        :class="areControlsExpanded ? 'w-64 rounded-xl bg-modal' : 'w-11 rounded-full bg-button'"
        @keydown.stop
    >
        <button
            type="button"
            class="flex h-11 w-full shrink-0 items-center justify-center gap-2 px-3 transition-colors hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-accent active:text-on-accent"
            :class="areControlsExpanded ? 'bg-header' : 'rounded-full'"
            :aria-expanded="areControlsExpanded"
            :aria-controls="controlsId"
            :aria-label="controlsToggleLabel"
            :title="controlsToggleLabel"
            @click="toggleControls"
        >
            <SettingsIcon class="size-4 shrink-0 fill-current" aria-hidden="true" />
            <template v-if="areControlsExpanded">
                <span class="min-w-0 flex-1 truncate text-left">{{ i18n.preview.settings }}</span>
                <svg
                    class="size-4 shrink-0 fill-none stroke-current"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                >
                    <path d="m4 10 4-4 4 4" stroke-width="1.5" />
                </svg>
            </template>
        </button>
        <div
            v-show="areControlsExpanded"
            :id="controlsId"
            ref="controlsBody"
            class="preview-controls-body flex min-h-0 touch-pan-y flex-col gap-1.5 overflow-y-auto overscroll-contain px-2 pb-2 pt-1"
        >
            <div class="flex w-full min-w-0 shrink-0 items-center gap-2">
                <span class="w-10 shrink-0">{{ i18n.preview.shortLabels.noteSpeed }}</span>
                <input
                    v-model.number="settings.previewNoteSpeed"
                    :aria-label="i18n.settings.preview.noteSpeed"
                    class="min-w-0 flex-1"
                    type="range"
                    :min="previewNoteSpeed.min"
                    :max="previewNoteSpeed.max"
                    :step="previewNoteSpeed.sliderStep"
                />
                <input
                    class="number-input w-10 shrink-0 rounded-full bg-button px-1 text-right shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg"
                    type="number"
                    :min="previewNoteSpeed.min"
                    :max="previewNoteSpeed.max"
                    :step="previewNoteSpeed.step"
                    :aria-label="i18n.preview.noteSpeedValue"
                    :value="settings.previewNoteSpeed"
                    @change="onSpeedChange"
                    @keydown="onSpeedKeydown"
                />
            </div>
            <div class="flex w-full min-w-0 shrink-0 items-center gap-2">
                <span class="w-10 shrink-0">{{ i18n.preview.shortLabels.renderScale }}</span>
                <input
                    v-model.number="settings.previewRenderScale"
                    :aria-label="i18n.settings.preview.renderScale"
                    class="min-w-0 flex-1"
                    type="range"
                    :min="previewRenderScale.min"
                    :max="previewRenderScale.max"
                    :step="previewRenderScale.step"
                />
                <input
                    class="number-input w-10 shrink-0 rounded-full bg-button px-1 text-right shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg"
                    type="number"
                    :min="previewRenderScale.min"
                    :max="previewRenderScale.max"
                    :step="previewRenderScale.step"
                    :aria-label="i18n.preview.renderScaleValue"
                    :value="settings.previewRenderScale"
                    @change="onScaleChange"
                    @keydown="onSpeedKeydown"
                />
            </div>
            <div
                class="flex max-w-full shrink-0 flex-wrap items-center gap-1"
                role="radiogroup"
                :aria-label="i18n.settings.preview.position.title"
            >
                <span class="w-10 shrink-0">{{ i18n.preview.shortLabels.position }}</span>
                <label
                    v-for="[label, value] in previewPositionOptions"
                    :key="value"
                    class="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-button px-1.5 py-0.5 shadow-sm"
                >
                    <input
                        v-model="settings.previewPosition"
                        type="radio"
                        name="preview-dock-position"
                        :value="value"
                        @change="onDockChange"
                        @keydown.stop
                    />
                    <span>{{ label }}</span>
                </label>
            </div>
            <div
                class="flex max-w-full shrink-0 flex-wrap items-center gap-1"
                role="radiogroup"
                :aria-label="i18n.settings.preview.aspectRatio"
            >
                <span class="w-10 shrink-0">{{ i18n.preview.shortLabels.aspectRatio }}</span>
                <label
                    v-for="[label, value] in previewAspectRatios"
                    :key="label"
                    class="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-button px-1.5 py-0.5 shadow-sm"
                >
                    <input
                        v-model="settings.previewAspectRatio"
                        type="radio"
                        name="preview-aspect-ratio"
                        :value="value"
                        @change="onRadioChange"
                        @keydown.stop
                    />
                    <span>{{ label }}</span>
                </label>
            </div>
            <label class="flex w-full shrink-0 cursor-pointer items-center justify-between gap-2">
                <span>{{ i18n.settings.preview.showEffects }}</span>
                <input
                    v-model="settings.previewShowEffects"
                    class="size-4"
                    type="checkbox"
                    @change="blurInput"
                />
            </label>
            <label class="flex w-full shrink-0 cursor-pointer items-center justify-between gap-2">
                <span>{{ i18n.settings.preview.antialias }}</span>
                <input
                    v-model="settings.previewAntialias"
                    class="size-4"
                    type="checkbox"
                    @change="blurInput"
                />
            </label>
        </div>
    </div>
</template>

<style scoped>
.preview-controls {
    /* A short preview must still leave room to reach the expanded settings. */
    max-height: min(calc(100dvh - 0.5rem), max(11rem, calc(100% - 0.5rem)));
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
