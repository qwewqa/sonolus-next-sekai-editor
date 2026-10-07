<script setup lang="ts">
import { computed, nextTick, onUpdated, useId, useTemplateRef, watch, type StyleValue } from 'vue'
import SettingsIcon from '../editor/commands/settings/SettingsIcon.vue'
import ChevronIcon from '../editor/workspace/ChevronIcon.vue'
import { valueOverflows, wordOverflows } from '../modals/form/fieldLayout'
import { optionName } from '../modals/form/fieldUsage'
import { observeWidth, unobserveWidth } from '../modals/form/widthObserver'
import { resyncInput, revertOnEscape } from '../modals/form/resync'
import ToggleSwitch from '../modals/form/ToggleSwitch.vue'
import { vScrollEdges } from '../directives/scrollEdges'
import { getPanelPosition, setPanelPosition, workspaceDockAttribute } from '../editor/workspace'
import type { PanelPosition } from '../editor/workspace/layout'
import { i18n } from '../i18n'
import { settings } from '../settings'
import { previewAspectRatios, previewNoteSpeed, previewRenderScale } from './options'
import { panelPositionOptions, previewTransportOptions } from './settingsOptions'
import SelectValue from '../modals/form/SelectValue.vue'
import { handOffPreviewSettings, isCoarsePointer, type ControlsMetrics } from './usePreviewViewport'

const props = defineProps<{
    /** Hides the toggle where it would sit on the playback bar. */
    buttonHidden: boolean
    buttonStyle: StyleValue
    panelStyle: StyleValue
    /** Whether the panel has been measured and positioned. */
    placed: boolean
    /** Whether this form replaces one whose Placement field had keyboard focus. */
    focusPlacement: boolean
    /** Whether the open form sits outside the panel, over the editor. */
    floating: boolean
}>()
const expanded = defineModel<boolean>('expanded', { required: true })
const emit = defineEmits<{
    resize: [metrics: ControlsMetrics]
}>()

const toggle = useTemplateRef<HTMLButtonElement>('toggle')
const header = useTemplateRef<HTMLButtonElement>('header')
const controls = useTemplateRef<HTMLDivElement>('controls')
const controlsBody = useTemplateRef<HTMLDivElement>('controlsBody')
const placement = useTemplateRef<HTMLSelectElement>('placement')
const id = useId()

const toggles = computed(
    () =>
        [
            ['previewHighlightSelection', i18n.value.settings.preview.highlightSelection],
            ['previewShowHitboxes', i18n.value.settings.preview.showHitboxes],
            ['previewShowEffects', i18n.value.settings.preview.showEffects],
            ['previewShowTime', i18n.value.settings.preview.showTime],
        ] as const,
)

// A form opened beside or under the dock covers the editor; any press outside
// it and its toggle dismisses it, like other popovers.
watch(
    () => expanded.value && props.floating,
    (active, _previous, onCleanup) => {
        if (!active) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target
            if (!(target instanceof Node)) return
            if (controls.value?.contains(target) || toggle.value?.contains(target)) return
            expanded.value = false
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        onCleanup(() => {
            document.removeEventListener('pointerdown', onPointerDown, true)
        })
    },
    { immediate: true },
)

const setExpanded = (value: boolean, event?: MouseEvent | KeyboardEvent) => {
    expanded.value = value
    // Pointer clicks return shortcuts to the editor. Keyboard users stay on the
    // toggle, which remains in place while the form is open.
    if (event instanceof MouseEvent && event.detail > 0) {
        ;(event.currentTarget as HTMLElement).blur()
        return
    }
    if (!value) void nextTick(() => toggle.value?.focus({ preventScroll: true }))
}

// The form is rendered at the end of the document so it can rise above the
// editor. Keep it next to its toggle in the tab order.
const focusableSelector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
const focusables = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(
        (element) => element.getClientRects().length > 0 && !element.closest('[inert]'),
    )
const onToggleKeydown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key !== 'Tab' || event.shiftKey || !expanded.value) return
    event.preventDefault()
    header.value?.focus()
}
const onFormTab = (event: KeyboardEvent) => {
    const form = controls.value
    const button = toggle.value
    if (!form || !button) return
    const inside = focusables(form)
    if (event.shiftKey && event.target === inside[0]) {
        event.preventDefault()
        button.focus()
    } else if (!event.shiftKey && event.target === inside.at(-1)) {
        const all = focusables(document).filter((element) => !form.contains(element))
        const next = all[all.indexOf(button) + 1]
        if (!next) return
        event.preventDefault()
        next.focus()
    }
}

watch([controls, controlsBody], ([element, body], _previous, onCleanup) => {
    if (!element || !body) return
    let frame = 0
    const schedule = () => {
        if (frame) return
        // Measure once after observer delivery. Updating placement inside its
        // callback would trigger same-frame ResizeObserver loop warnings.
        frame = requestAnimationFrame(() => {
            frame = 0
            const headerHeight = element.firstElementChild?.getBoundingClientRect().height ?? 0
            // The natural height stays stable while max-height makes the body
            // scroll, so placement cannot feed back into this measurement.
            emit('resize', {
                width: element.getBoundingClientRect().width,
                naturalHeight: headerHeight + body.scrollHeight,
                headerHeight,
            })
        })
    }
    const observer = new ResizeObserver(schedule)
    // The form lives near the document root. A dock change during another
    // observer's delivery can mount it there; observing it in that same delivery
    // would skip it as too shallow. Start observing in the next frame instead.
    const start = requestAnimationFrame(() => {
        observer.observe(body)
        for (const child of body.children) observer.observe(child)
    })
    schedule()
    onCleanup(() => {
        cancelAnimationFrame(start)
        observer.disconnect()
        cancelAnimationFrame(frame)
    })
})

// As in Properties, labels whose word or phrase would break take back some of the
// controls' room, and a label or value that still doesn't fit stacks. An on/off value
// is measured at its longer state, so a click doesn't move the row.
let fitFrame = 0
// Labels are measured again only when the width or language changes, as that
// forces layouts; values are measured on every update.
let labelsFit = false
const labelStacked = new WeakSet<HTMLElement>()
const fitRows = () => {
    const body = controlsBody.value
    if (!body) return
    const { enabled, disabled } = i18n.value.modals.form.toggle
    const rows = [...body.querySelectorAll<HTMLElement>('.preview-setting')]
    if (!labelsFit) {
        labelsFit = true
        const labels = rows.map((row) => row.querySelector<HTMLElement>('.preview-setting-label'))
        body.classList.remove('preview-controls-roomy')
        for (const row of rows) row.classList.remove('preview-setting-stacked')
        // One column for every row keeps the controls' edges aligned.
        if (labels.some((label) => label && wordOverflows(label)))
            body.classList.add('preview-controls-roomy')
        rows.forEach((row, index) => {
            const label = labels[index]
            if (label && wordOverflows(label)) labelStacked.add(row)
            else labelStacked.delete(row)
        })
    }
    for (const row of rows) {
        if (labelStacked.has(row)) {
            row.classList.add('preview-setting-stacked')
            continue
        }
        row.classList.remove('preview-setting-stacked')
        const control = row.querySelector<HTMLElement>('.preview-toggle, select.preview-field')
        const others = control instanceof HTMLSelectElement ? [] : [enabled, disabled]
        if (control && valueOverflows(control, others)) row.classList.add('preview-setting-stacked')
    }
}
const refitRows = () => {
    cancelAnimationFrame(fitFrame)
    fitFrame = requestAnimationFrame(fitRows)
}
const refitLabels = () => {
    labelsFit = false
    refitRows()
}
watch(
    controlsBody,
    (body, _previous, onCleanup) => {
        if (!body) return
        labelsFit = false
        fitRows()
        observeWidth(body, refitLabels)
        onCleanup(() => {
            unobserveWidth(body)
            cancelAnimationFrame(fitFrame)
        })
    },
    { flush: 'post' },
)
watch(() => i18n.value, refitLabels)
onUpdated(refitRows)

// Focus the new form once it is placed; before that it is not yet visible.
if (props.focusPlacement) {
    watch(
        () => props.placed,
        async () => {
            await nextTick()
            placement.value?.focus({ preventScroll: true })
        },
        { once: true },
    )
}

const normalizeNumber = (
    value: number,
    { min, max, step }: { min: number; max: number; step: number },
) => Math.min(max, Math.max(min, Math.round(value * (1 / step)) / (1 / step)))

// Written on change only, so re-renders never overwrite the typing.
const numberField = (
    key: 'previewNoteSpeed' | 'previewRenderScale',
    range: { min: number; max: number; step: number },
) =>
    computed({
        get: () => settings[key],
        set: (value: number | string) => {
            const number = Number.parseFloat(`${value}`)
            if (Number.isFinite(number)) settings[key] = normalizeNumber(number, range)
        },
    })
const noteSpeedField = numberField('previewNoteSpeed', previewNoteSpeed)
const renderScaleField = numberField('previewRenderScale', previewRenderScale)
const positionField = computed({
    get: () => getPanelPosition('preview'),
    set: (position: PanelPosition) => {
        setPanelPosition('preview', position)
    },
})

const onNumberKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur()
}

// Pointer interactions return shortcuts to the editor once a value is chosen.
// Keyboard changes keep focus for repeated arrow keys and Space presses.
let isPointerInput = false
let isPointerChange = false
const onPointerDown = () => {
    isPointerInput = true
}
const onKeydown = (event: KeyboardEvent) => {
    isPointerInput = false
    if (event.key === 'Tab') onFormTab(event)
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    setExpanded(false, event)
}
const onChange = (event: Event) => {
    const target = event.target
    isPointerChange = isPointerInput
    isPointerInput = false
    if (
        isPointerChange &&
        target instanceof HTMLElement &&
        !(target instanceof HTMLInputElement && target.type === 'number')
    ) {
        target.blur()
    }
}

const onPlacementChange = () => {
    handOffPreviewSettings(!isPointerChange)
}
</script>

<template>
    <!-- The toggle mirrors the clock in the image's other top corner and stays
    there while the form is open. -->
    <button
        v-show="!buttonHidden"
        ref="toggle"
        type="button"
        class="preview-settings-toggle absolute z-10 flex items-center justify-center rounded-full shadow-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent"
        :class="[
            // An occasional control over a small image: 36px, with a 40px hit
            // area on touch.
            'size-9',
            { 'preview-settings-toggle-touch': isCoarsePointer },
            expanded
                ? 'bg-button text-fg shadow-accent active:bg-accent active:text-on-accent'
                : 'bg-button text-fg hover:shadow-accent active:bg-accent active:text-on-accent',
        ]"
        :style="buttonStyle"
        :aria-expanded="expanded"
        :aria-controls="id"
        :aria-label="expanded ? i18n.preview.settings : i18n.preview.showSettings"
        :title="expanded ? i18n.preview.settings : i18n.preview.showSettings"
        @click="setExpanded(!expanded, $event)"
        @keydown="onToggleKeydown"
    >
        <SettingsIcon class="size-4 fill-current" aria-hidden="true" />
    </button>

    <!-- Above editor notifications and any neighboring panel it extends over. -->
    <Teleport to="body">
        <div
            :id
            ref="controls"
            :[workspaceDockAttribute]="'preview-settings'"
            class="preview-controls fixed z-40 flex flex-col overflow-hidden rounded-xl bg-modal text-fg shadow-xl ring-1 ring-fg/10"
            :class="{ 'pointer-events-none invisible': !expanded }"
            :style="panelStyle"
            :inert="!expanded"
            role="group"
            :aria-label="i18n.preview.settings"
            @keydown.stop="onKeydown"
            @pointerdown.capture="onPointerDown"
            @change.capture="onChange"
            @contextmenu.prevent
        >
            <button
                ref="header"
                type="button"
                class="flex w-full shrink-0 items-center gap-2 bg-header px-4 font-bold transition-colors hover:bg-header-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-accent active:text-on-accent"
                :class="isCoarsePointer ? 'h-[52px]' : 'h-12'"
                :aria-expanded="true"
                :aria-controls="`${id}-body`"
                :aria-label="i18n.preview.minimizeSettings"
                :title="i18n.preview.minimizeSettings"
                @click="setExpanded(false, $event)"
            >
                <span class="min-w-0 flex-1 truncate text-left">{{ i18n.preview.settings }}</span>
                <ChevronIcon direction="up" />
            </button>
            <div
                :id="`${id}-body`"
                ref="controlsBody"
                v-scroll-edges
                class="preview-controls-body flex min-h-0 touch-pan-y flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3"
            >
                <div class="preview-setting">
                    <span class="preview-setting-label">{{ i18n.settings.preview.noteSpeed }}</span>
                    <span class="preview-setting-control flex items-center gap-2">
                        <input
                            v-model.number="settings.previewNoteSpeed"
                            class="preview-range min-w-0 flex-1"
                            type="range"
                            :aria-label="i18n.settings.preview.noteSpeed"
                            :title="i18n.settings.preview.noteSpeed"
                            :min="previewNoteSpeed.min"
                            :max="previewNoteSpeed.max"
                            :step="previewNoteSpeed.sliderStep"
                        />
                        <input
                            v-model.lazy="noteSpeedField"
                            class="preview-number"
                            type="number"
                            :aria-label="i18n.settings.preview.noteSpeed"
                            :title="i18n.settings.preview.noteSpeed"
                            :min="previewNoteSpeed.min"
                            :max="previewNoteSpeed.max"
                            :step="previewNoteSpeed.step"
                            @change="resyncInput($event, () => `${settings.previewNoteSpeed}`)"
                            @keydown.esc="revertOnEscape($event, `${settings.previewNoteSpeed}`)"
                            @keydown="onNumberKeydown"
                        />
                    </span>
                </div>

                <label v-for="[key, label] in toggles" :key class="preview-setting cursor-pointer">
                    <span class="preview-setting-label">{{ label }}</span>
                    <span class="preview-setting-control group relative">
                        <input
                            v-model="settings[key]"
                            class="peer absolute inset-0 size-full cursor-pointer opacity-0"
                            type="checkbox"
                            role="switch"
                            :aria-label="label"
                            :title="
                                settings[key]
                                    ? i18n.modals.form.toggle.enabled
                                    : i18n.modals.form.toggle.disabled
                            "
                        />
                        <span
                            class="preview-field preview-toggle peer-hover:shadow-accent peer-focus-visible:ring-2 peer-active:bg-accent peer-active:text-on-accent forced-colors:peer-focus-visible:outline-[color:Highlight]"
                        >
                            {{
                                settings[key]
                                    ? i18n.modals.form.toggle.enabled
                                    : i18n.modals.form.toggle.disabled
                            }}
                        </span>
                        <ToggleSwitch :value="settings[key]" />
                    </span>
                </label>

                <div class="preview-setting">
                    <span :id="`${id}-aspect`" class="preview-setting-label">{{
                        i18n.settings.preview.aspectRatio
                    }}</span>
                    <span
                        class="preview-setting-control flex rounded-full bg-fg/10 p-0.5 shadow-[inset_0_1px_2px_rgb(48_51_77/0.2)] outline-none"
                        role="radiogroup"
                        :aria-labelledby="`${id}-aspect`"
                    >
                        <label
                            v-for="[label, value] in previewAspectRatios"
                            :key="label"
                            class="relative min-w-0 flex-1 rounded-full has-[:checked]:outline has-[:checked]:outline-1 has-[:checked]:outline-transparent"
                        >
                            <input
                                v-model="settings.previewAspectRatio"
                                class="peer absolute inset-0 size-full cursor-pointer opacity-0"
                                type="radio"
                                :name="`${id}-aspect`"
                                :value
                            />
                            <span
                                class="flex h-9 items-center justify-center rounded-full tabular-nums transition-colors peer-checked:bg-button peer-checked:shadow-md peer-hover:bg-white/50 peer-checked:peer-hover:bg-button peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-fg peer-active:bg-accent peer-active:text-on-accent forced-colors:peer-focus-visible:outline-[color:Highlight]"
                            >
                                {{ label }}
                            </span>
                        </label>
                    </span>
                </div>

                <div class="preview-setting">
                    <span class="preview-setting-label">{{
                        i18n.settings.preview.renderScale
                    }}</span>
                    <span class="preview-setting-control flex items-center gap-2">
                        <input
                            v-model.number="settings.previewRenderScale"
                            class="preview-range min-w-0 flex-1"
                            type="range"
                            :aria-label="i18n.settings.preview.renderScale"
                            :title="i18n.settings.preview.renderScale"
                            :min="previewRenderScale.min"
                            :max="previewRenderScale.max"
                            :step="previewRenderScale.step"
                        />
                        <input
                            v-model.lazy="renderScaleField"
                            class="preview-number"
                            type="number"
                            :aria-label="i18n.settings.preview.renderScale"
                            :title="i18n.settings.preview.renderScale"
                            :min="previewRenderScale.min"
                            :max="previewRenderScale.max"
                            :step="previewRenderScale.step"
                            @change="resyncInput($event, () => `${settings.previewRenderScale}`)"
                            @keydown.esc="revertOnEscape($event, `${settings.previewRenderScale}`)"
                            @keydown="onNumberKeydown"
                        />
                    </span>
                </div>

                <label class="preview-setting cursor-pointer">
                    <span class="preview-setting-label">{{ i18n.settings.preview.antialias }}</span>
                    <span class="preview-setting-control group relative">
                        <input
                            v-model="settings.previewAntialias"
                            class="peer absolute inset-0 size-full cursor-pointer opacity-0"
                            type="checkbox"
                            role="switch"
                            :aria-label="i18n.settings.preview.antialias"
                            :title="
                                settings.previewAntialias
                                    ? i18n.modals.form.toggle.enabled
                                    : i18n.modals.form.toggle.disabled
                            "
                        />
                        <span
                            class="preview-field preview-toggle peer-hover:shadow-accent peer-focus-visible:ring-2 peer-active:bg-accent peer-active:text-on-accent forced-colors:peer-focus-visible:outline-[color:Highlight]"
                        >
                            {{
                                settings.previewAntialias
                                    ? i18n.modals.form.toggle.enabled
                                    : i18n.modals.form.toggle.disabled
                            }}
                        </span>
                        <ToggleSwitch :value="settings.previewAntialias" />
                    </span>
                </label>

                <label class="preview-setting">
                    <span :id="`${id}-transport`" class="preview-setting-label">{{
                        i18n.settings.preview.transport.title
                    }}</span>
                    <span class="preview-setting-control group relative">
                        <select
                            v-model="settings.previewTransportPosition"
                            :aria-labelledby="`${id}-transport`"
                            :title="
                                optionName(
                                    settings.previewTransportPosition,
                                    previewTransportOptions,
                                )
                            "
                            class="preview-field cursor-pointer appearance-none pr-9 hover:shadow-accent focus-visible:ring-2 active:bg-accent active:text-on-accent"
                        >
                            <option
                                v-for="[label, value] in previewTransportOptions"
                                :key="value"
                                :value
                            >
                                {{ label }}
                            </option>
                        </select>
                        <SelectValue
                            :value="
                                optionName(
                                    settings.previewTransportPosition,
                                    previewTransportOptions,
                                )
                            "
                            class="pl-4 pr-9 group-active:text-on-accent"
                        />
                        <span
                            class="pointer-events-none absolute inset-y-0 right-4 flex items-center group-active:text-on-accent"
                            aria-hidden="true"
                        >
                            <ChevronIcon direction="down" />
                        </span>
                    </span>
                </label>

                <label class="preview-setting">
                    <span :id="`${id}-placement`" class="preview-setting-label">{{
                        i18n.settings.preview.position.title
                    }}</span>
                    <!-- A select carries the trailing chevron every select field has. -->
                    <span class="preview-setting-control group relative">
                        <select
                            ref="placement"
                            v-model="positionField"
                            :aria-labelledby="`${id}-placement`"
                            :title="optionName(settings.previewPosition, panelPositionOptions)"
                            class="preview-field cursor-pointer appearance-none pr-9 hover:shadow-accent focus-visible:ring-2 active:bg-accent active:text-on-accent"
                            @change="onPlacementChange"
                        >
                            <option
                                v-for="[label, value] in panelPositionOptions"
                                :key="value"
                                :value
                            >
                                {{ label }}
                            </option>
                        </select>
                        <SelectValue
                            :value="optionName(settings.previewPosition, panelPositionOptions)"
                            class="pl-4 pr-9 group-active:text-on-accent"
                        />
                        <span
                            class="pointer-events-none absolute inset-y-0 right-4 flex items-center group-active:text-on-accent"
                            aria-hidden="true"
                        >
                            <ChevronIcon direction="down" />
                        </span>
                    </span>
                </label>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.preview-settings-toggle-touch::before {
    content: '';
    position: absolute;
    inset: -0.125rem;
    border-radius: 9999px;
}

.preview-controls {
    container-type: inline-size;
    width: min(22rem, calc(100vw - 0.5rem));
}

.preview-setting {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 10rem;
    align-items: center;
    column-gap: 0.75rem;
    row-gap: 0.25rem;
    min-height: 2rem;
    flex-shrink: 0;
}

/* Labels whose word or phrase would break take back some of the controls' room. */
.preview-controls-roomy .preview-setting:not(.preview-setting-stacked) {
    grid-template-columns: minmax(0, 1fr) 9rem;
}

/* A value too long to sit beside its label takes the full row below it. */
.preview-setting.preview-setting-stacked {
    grid-template-columns: minmax(0, 1fr);
}

/* Long translations wrap within their column instead of pushing fields out. */
.preview-setting-label {
    overflow-wrap: anywhere;
    line-height: 1.25;
}

/* High contrast paints the transparent outline as the edge, and Highlight on focus. */
.preview-field {
    @apply block w-full truncate rounded-full bg-button px-4 py-1 text-left shadow-md outline-none ring-fg transition-colors;
}

/* On/off fields carry the same trailing switch as form toggles. */
.preview-toggle {
    @apply pr-12;
}

.preview-setting-control :deep(.form-field-toggle-icon) {
    @apply pointer-events-none absolute inset-y-0 right-3.5 flex items-center;
}

.preview-number {
    @apply w-16 shrink-0 rounded-full bg-button px-3 py-1 text-left tabular-nums shadow-md outline-none ring-fg transition-colors hover:shadow-accent focus-visible:ring-2;
    appearance: textfield;
}

.preview-number::-webkit-outer-spin-button,
.preview-number::-webkit-inner-spin-button {
    margin: 0;
    appearance: none;
}

/* Sliders look alike in every browser: an inset track like the segmented
   control's, with a raised white thumb that glows on hover and fills on press. */
.preview-range {
    appearance: none;
    background: transparent;
    cursor: pointer;
    height: 2rem;
}

.preview-range:focus-visible {
    @apply rounded-full outline-none ring-2 ring-fg;
}

.preview-range::-webkit-slider-runnable-track {
    @apply h-1.5 rounded-full bg-fg/10 shadow-track;
}

.preview-range::-moz-range-track {
    @apply h-1.5 rounded-full bg-fg/10 shadow-track;
}

.preview-range::-webkit-slider-thumb {
    @apply -mt-[0.3125rem] size-4 rounded-full bg-button shadow-md transition-colors;
    appearance: none;
}

.preview-range::-moz-range-thumb {
    @apply size-4 rounded-full border-0 bg-button shadow-md transition-colors;
}

@media (hover: hover) {
    .preview-range:hover::-webkit-slider-thumb {
        @apply shadow-accent;
    }

    .preview-range:hover::-moz-range-thumb {
        @apply shadow-accent;
    }
}

.preview-range:active::-webkit-slider-thumb {
    @apply bg-accent;
}

.preview-range:active::-moz-range-thumb {
    @apply bg-accent;
}

@media (pointer: coarse) {
    .preview-range::-webkit-slider-thumb {
        @apply -mt-[0.4375rem] size-5;
    }

    .preview-range::-moz-range-thumb {
        @apply size-5;
    }
}

/* Narrow panels give labels a little more of the row, then stack them. */
@container (max-width: 19rem) {
    .preview-setting {
        grid-template-columns: minmax(0, 1fr) 8.5rem;
        column-gap: 0.5rem;
    }

    .preview-controls-roomy .preview-setting:not(.preview-setting-stacked) {
        grid-template-columns: minmax(0, 1fr) 7.5rem;
    }
}

@container (max-width: 15.99rem) {
    .preview-setting,
    .preview-controls-roomy .preview-setting:not(.preview-setting-stacked) {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
