<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
    useSlots,
    useTemplateRef,
    watch,
    watchEffect,
} from 'vue'
import { i18n } from '../../i18n'
import { interpolateRaw } from '../../utils/interpolate'
import { formatNumber, mixedValues, useFieldUsage, type MixedValue } from './fieldUsage'

const props = defineProps<{
    label: string
    /** Makes the row a plain group whose control is named by this label id. */
    labelId?: string
    /** Values in use while mixed; toggles leave it unset and get theirs from the usage. */
    mixed?: MixedValue[]
    /** Short remarks under the field, such as a shortcut's conflicts. */
    notes?: string[]
}>()

const field = useFieldUsage()
const row = useTemplateRef<HTMLElement>('row')
const descriptionId = useId()

const coverage = computed(() => {
    const usage = field?.value?.usage
    return usage && usage.covered < usage.total ? usage : undefined
})

const values = computed(
    () =>
        props.mixed ??
        mixedValues(field?.value, (value) =>
            typeof value === 'boolean'
                ? value
                    ? i18n.value.modals.form.toggle.enabled
                    : i18n.value.modals.form.toggle.disabled
                : typeof value === 'number'
                  ? formatNumber(value)
                  : undefined,
        ),
)

const description = computed(() =>
    [
        coverage.value &&
            interpolateRaw(
                i18n.value.modals.form.coverage,
                `${coverage.value.covered}`,
                `${coverage.value.total}`,
            ),
        values.value.length &&
            `${i18n.value.modals.form.mixed}: ${values.value
                .map(({ label, count }) => `${label} ${count}`)
                .join(', ')}`,
        ...(props.notes ?? []),
    ]
        .filter(Boolean)
        .join('. '),
)

// A glyph before the label gives way before the label would clamp.
const slots = useSlots()
const labelRow = useTemplateRef<HTMLElement>('labelRow')
let observer: ResizeObserver | undefined
let width = 0
let frame = 0

const fitIcon = () => {
    const element = labelRow.value
    const text = element?.querySelector<HTMLElement>('.form-field-text')
    if (!slots.icon || !element || !text) return
    element.classList.remove('form-field-iconless')
    if (text.scrollHeight > text.clientHeight + 1) element.classList.add('form-field-iconless')
}

onMounted(() => {
    if (!slots.icon || !labelRow.value) return
    fitIcon()
    // Refits after the frame, so hiding the icon never re-enters the observer.
    observer = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width === width) return
        width = entry.contentRect.width
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(fitIcon)
    })
    observer.observe(labelRow.value)
})

watch(() => props.label, fitIcon, { flush: 'post' })

onBeforeUnmount(() => {
    observer?.disconnect()
    cancelAnimationFrame(frame)
})

/** The detail row: how many objects the field covers, then the values in use. */
type Chip = {
    /** What the chip shows; a value's name and count otherwise. */
    text?: string
    name: string
    count: number
    /** The chip's action, as its accessible name. */
    label: string
    coverage?: boolean
    narrow?: () => void
}

const chips = computed((): Chip[] => {
    const usage = coverage.value
    return [
        ...(usage
            ? [
                  {
                      text: interpolateRaw(
                          i18n.value.modals.form.coverageChip,
                          `${usage.covered}`,
                          `${usage.total}`,
                      ),
                      name: '',
                      label: interpolateRaw(
                          i18n.value.modals.form.selectCovered,
                          `${usage.covered}`,
                          `${usage.total}`,
                      ),
                      count: usage.covered,
                      coverage: true,
                      narrow: field?.value?.narrow && (() => field.value?.narrow?.(() => true)),
                  },
              ]
            : []),
        ...[...values.value, ...(field?.value?.extra ?? [])].map((value) => ({
            name: value.label,
            count: value.count,
            label: interpolateRaw(i18n.value.modals.form.selectOnly, `${value.count}`, value.label),
            narrow: value.narrow,
        })),
    ]
})

// The row is one Tab stop; arrows move between its chips.
const current = ref(0)
const chipRow = useTemplateRef<HTMLElement>('chipRow')
const move = (event: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const buttons = [...(chipRow.value?.querySelectorAll<HTMLElement>('button:enabled') ?? [])]
    const index = buttons.indexOf(event.target as HTMLElement)
    if (index < 0) return
    const next =
        event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : event.key in keys
                ? Math.min(Math.max(index + (keys[event.key] ?? 0), 0), buttons.length - 1)
                : undefined
    if (next === undefined) return
    event.preventDefault()
    current.value = next
    buttons[next]?.focus()
}
watch(chips, () => (current.value = 0))

// Keys narrowing away the focused chip move on to the field's control.
const narrow = async (value: Chip, event: MouseEvent) => {
    const chip = event.currentTarget as HTMLElement
    value.narrow?.()
    if (event.detail > 0) return
    await nextTick()
    if (chip.isConnected) return
    row.value
        ?.querySelector<HTMLElement>('input:checked, select, input, button, [tabindex]')
        ?.focus()
}

// Coverage alone sits beside the label, giving way before the label would wrap more or break a word.
const coverageOnly = computed(() => chips.value.length === 1 && !!chips.value[0]?.coverage)
const line = useTemplateRef<HTMLElement>('line')
let lineWidth = 0
let lineFrame = 0
const fitCoverage = () => {
    const element = line.value
    const text = labelRow.value?.querySelector<HTMLElement>('.form-field-text')
    if (!element || !text) return
    element.classList.add('form-field-stacked')
    if (!coverageOnly.value) return
    const stackedHeight = text.scrollHeight
    element.classList.remove('form-field-stacked')
    text.style.overflowWrap = 'normal'
    const fits =
        text.scrollWidth <= text.clientWidth + 1 &&
        text.scrollHeight <= Math.min(stackedHeight, text.clientHeight) + 1
    text.style.overflowWrap = ''
    if (!fits) element.classList.add('form-field-stacked')
}
const lineObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width === lineWidth) return
    lineWidth = entry.contentRect.width
    refitCoverage()
})
const observeLine = () => {
    lineObserver.disconnect()
    lineWidth = 0
    if (coverageOnly.value && line.value) lineObserver.observe(line.value)
    fitCoverage()
}
const refitCoverage = () => {
    if (!coverageOnly.value) return
    cancelAnimationFrame(lineFrame)
    lineFrame = requestAnimationFrame(fitCoverage)
}
onMounted(() => {
    observeLine()
    document.fonts.addEventListener('loadingdone', refitCoverage)
})
watch([coverageOnly, () => props.label, () => chips.value[0]?.text], observeLine, {
    flush: 'post',
})
onBeforeUnmount(() => {
    lineObserver.disconnect()
    cancelAnimationFrame(lineFrame)
    document.fonts.removeEventListener('loadingdone', refitCoverage)
})

// The control is slotted, so it is linked to the description here.
watchEffect(
    () => {
        const control = row.value?.querySelector('[role="radiogroup"], input, select, button')
        if (!control) return
        if (description.value) control.setAttribute('aria-describedby', descriptionId)
        else control.removeAttribute('aria-describedby')
    },
    { flush: 'post' },
)
</script>

<template>
    <!-- Lays out by the width the field actually receives (dialog, tool modal or
    dock panel), not by the viewport: the wrapper is the query container. -->
    <div class="form-field">
        <!-- Coverage alone joins the label's column where it fits. -->
        <div ref="line" :class="{ 'form-field-inline': coverageOnly }">
            <component
                :is="labelId === undefined ? 'label' : 'div'"
                ref="row"
                class="form-field-row"
            >
                <span ref="labelRow" class="form-field-label"
                    ><slot name="icon" /><span :id="labelId" class="form-field-text">{{
                        label
                    }}</span></span
                >
                <slot />
            </component>
            <!-- Which objects the field covers and which values they hold; each chip
        selects only its objects. -->
            <div
                v-if="chips.length"
                ref="chipRow"
                class="form-field-mixed"
                role="toolbar"
                :aria-label="label"
                @keydown="move"
            >
                <button
                    v-for="(chip, index) in chips"
                    :key="index"
                    type="button"
                    class="form-field-mixed-value"
                    :class="{ 'form-field-coverage-chip': chip.coverage }"
                    :tabindex="index === current ? 0 : -1"
                    :title="chip.label"
                    :aria-label="chip.label"
                    :disabled="!chip.narrow"
                    @focus="current = index"
                    @click="narrow(chip, $event)"
                >
                    <template v-if="chip.text">{{ chip.text }}</template>
                    <template v-else
                        >{{ chip.name }}
                        <span class="tabular-nums">{{ chip.count }}</span></template
                    >
                </button>
            </div>
        </div>
        <div v-if="notes?.length" class="form-field-notes" aria-hidden="true">
            <p v-for="note in notes" :key="note">{{ note }}</p>
        </div>
        <span v-if="description" :id="descriptionId" class="sr-only">{{ description }}</span>
    </div>
</template>

<style>
.form-field {
    container-type: inline-size;
}

/* Values too long for their pill end in an ellipsis instead of clipping. */
.form-field-row > :is(input, select, button),
.form-field-select > select,
.form-field-toggle > input {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Selects carry a trailing chevron inside the pill, which sits near its end so
   values such as Unchanged fit at the default dock; the value keeps clear of it. */
.form-field-select {
    position: relative;
}

.form-field-select > select {
    padding-right: 2rem;
}

.form-field-select-icon {
    pointer-events: none;
    position: absolute;
    inset-block: 0;
    right: 0.75rem;
    display: flex;
    align-items: center;
}

/* A leading icon, such as an ease's curve, sits before the value. */
.form-field-select-leading > select {
    padding-left: 1.875rem;
}

.form-field-select-lead {
    pointer-events: none;
    position: absolute;
    inset-block: 0;
    left: 0.625rem;
    display: flex;
    align-items: center;
}

/* On/off fields carry a small switch in the same place, so they read as
   toggles rather than text fields. */
.form-field-toggle {
    position: relative;
}

.form-field-toggle > input {
    padding-right: 3rem;
}

.form-field-toggle-icon {
    pointer-events: none;
    position: absolute;
    inset-block: 0;
    right: 0.875rem;
    display: flex;
    align-items: center;
}

/* Numbers step with the keyboard and wheel; native spinners stay hidden. */
.form-field input[type='number'] {
    appearance: textfield;
    -moz-appearance: textfield;
}

.form-field input[type='number']::-webkit-inner-spin-button,
.form-field input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.form-field-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

/* A command's icon before its name, as in the keyboard shortcut list; icons
   share one 20px column (text glyphs fit it), so names line up. */
.form-field-icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    margin-right: 0.5rem;
    vertical-align: middle;
}

.form-field-iconless .form-field-icon {
    display: none;
}

/* One full-width row under the label and control, so labels keep their width. */
.form-field-mixed {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.375rem;
    font-size: 0.75rem;
    line-height: 1rem;
    color: #30334d;
}

/* Coverage alone sits in the label's column, leaving the control where it is. */
@container (min-width: 19rem) {
    .form-field-inline:not(.form-field-stacked) {
        display: grid;
        grid-template-columns:
            minmax(0, 1fr) auto
            calc(100% - min(max(calc(45% - 0.375rem), 11rem), calc(100% - 9rem)) - 0.75rem);
        align-items: center;
    }

    .form-field-inline:not(.form-field-stacked) > .form-field-row {
        display: contents;
    }

    .form-field-inline:not(.form-field-stacked) .form-field-label {
        grid-area: 1 / 1;
        width: auto;
        min-width: 0;
    }

    .form-field-inline:not(.form-field-stacked) > .form-field-row > :not(.form-field-label) {
        grid-area: 1 / 3;
    }

    /* The usual 12px label gap before the control, and half that after the label. */
    .form-field-inline:not(.form-field-stacked) > .form-field-mixed {
        grid-area: 1 / 2;
        margin-left: 0.375rem;
        margin-right: 0.75rem;
        flex-wrap: nowrap;
        margin-top: 0;
        white-space: nowrap;
    }
}

@container (min-width: 32rem) {
    .form-field-inline:not(.form-field-stacked) {
        grid-template-columns: minmax(0, 1fr) auto calc(40% - 0.75rem);
    }
}

.form-field-notes {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    line-height: 1rem;
    color: rgb(68 68 102 / 0.8);
}

/* Tinted pills read as actions; coverage is muted text, apart from the values. */
.form-field-mixed-value {
    border-radius: 9999px;
    padding: 0.125rem 0.5rem;
    background-color: rgb(68 68 102 / 0.08);
    transition-property: color, background-color;
    transition-duration: 150ms;
}

.form-field-coverage-chip {
    background-color: transparent;
    color: rgb(68 68 102 / 0.8);
}

/* Fingers get a real target. */
@media (pointer: coarse) {
    .form-field-mixed-value {
        min-height: 2rem;
        padding-inline: 0.75rem;
    }
}

.form-field-mixed-value:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px #444466;
}

@media (hover: hover) {
    .form-field-mixed-value:enabled:hover {
        background-color: #d7d7e3;
    }
}

.form-field-mixed-value:enabled:active {
    background-color: #77efdc;
    color: #30334d;
}

/* Long labels wrap to at most two lines rather than pushing the field down. */
.form-field-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.25;
    overflow-wrap: anywhere;
}

/* Label and control share a row once the control keeps a usable width. */
@container (min-width: 13.5rem) {
    .form-field-row {
        flex-direction: row;
        align-items: center;
        gap: 0.75rem;
    }

    .form-field-label {
        display: flex;
        flex: none;
        align-items: center;
        /* About half the row, but long labels such as "Connector Pass Through"
           may take up to 11rem while the control keeps about 8.25rem. */
        width: min(max(calc(45% - 0.375rem), 11rem), calc(100% - 9rem));
        min-height: 2rem;
    }

    .form-field-row > :not(.form-field-label) {
        flex: 1 1 0%;
        min-width: 0;
    }
}

/* Narrow docks and drawers: the control takes half the row (at least 6.25rem),
   leaving labels such as "Flick Direction" one line; longer ones clamp. */
@container (min-width: 13.5rem) and (max-width: 18.99rem) {
    .form-field-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(6.25rem, 50%);
        column-gap: 0.5rem;
    }

    .form-field-label {
        width: auto;
    }

    .form-field-row
        > :not(.form-field-label, .form-field-select, .form-field-toggle, .form-field-segmented),
    .form-field-select > select,
    .form-field-toggle > input {
        padding-inline: 0.75rem;
    }

    .form-field-select > select {
        padding-right: 1.75rem;
    }

    .form-field-toggle > input {
        padding-right: 2.5rem;
    }

    .form-field-select-icon {
        right: 0.75rem;
    }

    .form-field-toggle-icon {
        right: 0.625rem;
    }

    /* Too narrow for the leading icon; the value keeps the room. */
    .form-field-select-lead {
        display: none;
    }
}

@container (min-width: 32rem) {
    .form-field-label {
        width: 60%;
    }
}
</style>
