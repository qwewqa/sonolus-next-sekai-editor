<script setup lang="ts" generic="const T">
import { computed, useTemplateRef } from 'vue'
import { i18n } from '../../i18n'
import ChevronIcon from '../../editor/workspace/ChevronIcon.vue'
import BaseField from './BaseField.vue'
import { useLeadFit } from './leadFit'
import { resyncSelect } from './resync'
import { isUnknownValue, isUnset, mixedOptions, useFieldUsage } from './fieldUsage'
import { unknownLabel } from './unknownLabel'

const props = defineProps<{
    label: string
    options?: [string, NoInfer<T>][]
    /** Options in labeled sections (option groups), e.g. by folder; replaces `options`. */
    sections?: { label?: string; options: [string, NoInfer<T>][] }[]
    disabled?: boolean
    /** Text for the undefined value; defaults to "Mixed" (selected objects disagree). */
    emptyLabel?: string
}>()

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
const modelValue = defineModel<T | undefined>({ required: true })

type Section = { label?: string; options: [string, T][] }
const allSections = computed((): Section[] => props.sections ?? [{ options: props.options ?? [] }])

// While mixed, options in use carry their object counts.
const field = useFieldUsage()
const unknown = computed(() =>
    isUnknownValue(
        modelValue.value,
        allSections.value.flatMap((section) => section.options),
    ),
)
const mixed = computed(() =>
    modelValue.value === undefined && !props.disabled
        ? mixedOptions(
              field?.value,
              allSections.value.flatMap((section) => section.options),
          )
        : [],
)
const counts = computed(
    // By option, so options with equal names keep their own counts.
    () => new Map(mixed.value.map(({ option, count }) => [option, count] as const)),
)
const optionText = (name: string, value: T) => {
    const count = counts.value.get(value)
    return count ? `${name} · ${count}` : name
}

const leadless = useLeadFit(useTemplateRef<HTMLElement>('wrapper'))
</script>

<template>
    <BaseField :label :mixed>
        <div
            ref="wrapper"
            class="form-field-select group"
            :class="{
                'opacity-40': disabled,
                'form-field-select-leading': $slots.leading && !leadless,
            }"
        >
            <span
                v-if="$slots.leading"
                v-show="!leadless"
                class="form-field-select-lead group-active:text-on-accent"
                aria-hidden="true"
            >
                <slot name="leading" />
            </span>
            <select
                v-model.lazy="modelValue"
                :disabled
                :class="{ 'text-fg/80': modelValue === undefined }"
                class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:pointer-events-none"
                @change="resyncSelect($event, () => modelValue)"
            >
                <!-- The value while objects disagree; never listed or committed. -->
                <option v-if="modelValue === undefined" :value="undefined" disabled hidden>
                    {{
                        emptyLabel ??
                        (isUnset(field) ? i18n.modals.form.notSet : i18n.modals.form.mixed)
                    }}
                </option>
                <!-- A value no option names; shown, never listed or committed. -->
                <option v-if="unknown" :value="modelValue" disabled hidden>
                    {{ unknownLabel(modelValue) }}
                </option>
                <template v-for="(section, index) in allSections" :key="index">
                    <optgroup
                        v-if="section.label !== undefined"
                        :label="section.label"
                        class="text-fg"
                    >
                        <option
                            v-for="([name, value], option) in section.options"
                            :key="option"
                            class="text-fg"
                            :value
                        >
                            {{ optionText(name, value) }}
                        </option>
                    </optgroup>
                    <template v-else>
                        <option
                            v-for="([name, value], option) in section.options"
                            :key="option"
                            class="text-fg"
                            :value
                        >
                            {{ optionText(name, value) }}
                        </option>
                    </template>
                </template>
            </select>
            <span class="form-field-select-icon group-active:text-on-accent" aria-hidden="true">
                <ChevronIcon direction="down" />
            </span>
        </div>
    </BaseField>
</template>
