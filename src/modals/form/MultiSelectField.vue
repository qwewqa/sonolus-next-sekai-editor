<script setup lang="ts" generic="const T">
import { computed } from 'vue'
import { i18n } from '../../i18n'
import ChevronIcon from '../../editor/workspace/ChevronIcon.vue'
import BaseField from './BaseField.vue'

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
</script>

<template>
    <BaseField :label>
        <div class="form-field-select group" :class="{ 'opacity-40': disabled }">
            <select
                v-model.lazy="modelValue"
                :disabled
                :class="{ 'text-fg/80': modelValue === undefined }"
                class="w-full appearance-none rounded-full bg-button px-4 py-1 shadow-md transition-colors hover:shadow-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:pointer-events-none"
            >
                <!-- Selected objects disagree; this option is never committed. -->
                <option :value="undefined" disabled>
                    {{ emptyLabel ?? i18n.modals.form.mixed }}
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
                            {{ name }}
                        </option>
                    </optgroup>
                    <template v-else>
                        <option
                            v-for="([name, value], option) in section.options"
                            :key="option"
                            class="text-fg"
                            :value
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
