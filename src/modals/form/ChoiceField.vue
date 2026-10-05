<script setup lang="ts" generic="const T">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    useId,
    useTemplateRef,
    watch,
    type ComponentPublicInstance,
} from 'vue'
import { i18n } from '../../i18n'
import BaseField from './BaseField.vue'
import MultiSelectField from './MultiSelectField.vue'
import OptionalSelectField from './OptionalSelectField.vue'
import { segmentsFit } from './segmented'
import SelectField from './SelectField.vue'

const props = defineProps<{
    label: string
    options: (readonly [string, NoInfer<T>])[]
    /** `multi`: undefined means mixed. `optional`: undefined means not set, with its own option. */
    variant?: 'multi' | 'optional'
    disabled?: boolean
}>()

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
const modelValue = defineModel<T | undefined>({ required: true })

const id = useId()
const optional = computed(() => props.variant === 'optional')
const isMixed = computed(() => props.variant === 'multi' && modelValue.value === undefined)
const selectOptions = computed(() =>
    props.options.map(([name, value]): [string, T] => [name, value]),
)

const segment =
    'flex h-7 items-center justify-center rounded-full px-2 transition-colors peer-checked:bg-button peer-checked:shadow-md peer-hover:bg-white/50 peer-checked:peer-hover:bg-button peer-focus-visible:ring-2 peer-focus-visible:ring-fg peer-active:bg-accent peer-active:text-on-accent'
const input = 'peer absolute inset-0 size-full cursor-pointer opacity-0 focus-visible:outline-none'

// Both names show side by side when they fit in full; otherwise a select.
const segmented = ref(false)
const field = useTemplateRef<ComponentPublicInstance>('field')
// The field may render as a fragment that starts with a comment.
const fieldRoot = () => {
    let node = field.value?.$el as Node | null | undefined
    while (node && !(node instanceof HTMLElement)) node = node.nextSibling
    return node ?? undefined
}
const control = () =>
    fieldRoot()?.querySelector<HTMLElement>('.form-field-row > :last-child') ?? undefined

let context: CanvasRenderingContext2D | null | undefined
const measure = () => {
    const element = control()
    if (!element) return
    context ??= document.createElement('canvas').getContext('2d')
    const text = context
    if (!text) return
    const style = getComputedStyle(element)
    text.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    const widths = props.options.map(([name]) => Math.ceil(text.measureText(name).width) + 1)
    segmented.value = segmentsFit(element.clientWidth, widths, optional.value, rem)
}

// Swapping controls inside the observer callback would warn of a resize loop.
let frame = 0
const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
})
let observed: HTMLElement | undefined
const observe = () => {
    const element = control()
    if (element === observed) return
    if (observed) observer.unobserve(observed)
    observed = element
    if (element) observer.observe(element)
    measure()
}
onMounted(() => {
    observe()
    void document.fonts.ready.then(measure)
})
onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    observer.disconnect()
})

watch(
    () => props.options.map(([name]) => name),
    () => void nextTick(measure),
)

// The swapped-in control keeps keyboard focus.
watch(
    segmented,
    async () => {
        const focused = !!fieldRoot()?.contains(document.activeElement)
        await nextTick()
        observe()
        if (!focused) return
        const root = fieldRoot()
        const next =
            root?.querySelector<HTMLElement>('select, input:checked') ??
            root?.querySelector('input')
        next?.focus({ preventScroll: true })
    },
    { flush: 'pre' },
)
</script>

<template>
    <BaseField v-if="segmented" ref="field" :label :label-id="`${id}-label`">
        <div
            class="form-field-segmented flex min-w-0 rounded-full bg-fg/10 p-0.5 shadow-[inset_0_1px_2px_rgb(48_51_77/0.2)]"
            :class="{ 'pointer-events-none opacity-40': disabled, 'text-fg/80': isMixed }"
            role="radiogroup"
            :aria-labelledby="isMixed ? `${id}-label ${id}-mixed` : `${id}-label`"
        >
            <span v-if="isMixed" :id="`${id}-mixed`" class="sr-only">{{
                i18n.modals.form.mixed
            }}</span>
            <label v-if="optional" class="relative w-8 flex-none" :title="i18n.modals.form.notSet">
                <input
                    v-model="modelValue"
                    :class="input"
                    type="radio"
                    :name="id"
                    :value="undefined"
                    :disabled
                    :aria-label="i18n.modals.form.notSet"
                />
                <span :class="segment" aria-hidden="true">—</span>
            </label>
            <label
                v-for="([name, value], index) in options"
                :key="index"
                class="relative min-w-0 flex-auto"
                :title="name"
            >
                <input
                    v-model="modelValue"
                    :class="input"
                    type="radio"
                    :name="id"
                    :value
                    :disabled
                />
                <span :class="segment"
                    ><span class="truncate">{{ name }}</span></span
                >
            </label>
        </div>
    </BaseField>
    <OptionalSelectField
        v-else-if="variant === 'optional'"
        ref="field"
        v-model="modelValue"
        :label
        :options="selectOptions"
        :disabled
    />
    <MultiSelectField
        v-else-if="variant === 'multi'"
        ref="field"
        v-model="modelValue"
        :label
        :options="selectOptions"
        :disabled
    />
    <SelectField v-else ref="field" v-model="modelValue" :label :options :disabled />
</template>
