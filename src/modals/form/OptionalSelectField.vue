<script setup lang="ts" generic="const T">
import { computed, useTemplateRef } from 'vue'
import ChevronIcon from '../../editor/workspace/ChevronIcon.vue'
import BaseField from './BaseField.vue'
import { useLeadFit } from './leadFit'
import { resyncSelect } from './resync'
import { i18n } from '../../i18n'
import { useEmptyLabel, useUnsetChoice } from './emptyLabel'
import { isUnknownValue } from './fieldUsage'
import { unknownLabel } from './unknownLabel'

const props = defineProps<{
    label: string
    options?: [string, NoInfer<T>][]
    /** Options in labeled sections (option groups), e.g. by folder; replaces `options`. */
    sections?: { label?: string; options: [string, NoInfer<T>][] }[]
    disabled?: boolean
    /** Text for the unset value; defaults to the form's, such as Unchanged, or Not Set. */
    emptyLabel?: string
}>()

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
const modelValue = defineModel<T | undefined>({ required: true })

type Section = { label?: string; options: [string, T][] }
const injectedEmptyLabel = useEmptyLabel()
const unsetChoice = useUnsetChoice()

const allSections = computed((): Section[] => props.sections ?? [{ options: props.options ?? [] }])
const unknown = computed(() =>
    isUnknownValue(
        modelValue.value,
        allSections.value.flatMap((section) => section.options),
    ),
)

const leadless = useLeadFit(useTemplateRef<HTMLElement>('wrapper'))
</script>

<template>
    <BaseField :label>
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
            <!-- Unset reads like an empty number field's placeholder; the list stays dark. -->
            <select
                v-model.lazy="modelValue"
                :disabled
                :class="{ 'text-fg/80': modelValue === undefined }"
                class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:pointer-events-none"
                @change="resyncSelect($event, () => modelValue)"
            >
                <!-- Without the choice, an unset value still shows but is never listed. -->
                <option
                    v-if="unsetChoice || modelValue === undefined"
                    :value="undefined"
                    :disabled="!unsetChoice"
                    :hidden="!unsetChoice"
                    class="text-fg"
                >
                    {{ emptyLabel ?? injectedEmptyLabel?.() ?? i18n.modals.form.notSet }}
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
                            :value
                            class="text-fg"
                        >
                            {{ name }}
                        </option>
                    </optgroup>
                    <template v-else>
                        <option
                            v-for="([name, value], option) in section.options"
                            :key="option"
                            :value
                            class="text-fg"
                        >
                            {{ name }}
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
