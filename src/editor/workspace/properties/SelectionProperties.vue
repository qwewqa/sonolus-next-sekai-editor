<script setup lang="ts">
import { computed, type WritableComputedRef } from 'vue'
import { easeFamily, easeMode, type Ease } from '../../../ease'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { i18n } from '../../../i18n'
import type { FieldUsage } from '../../../modals/form/fieldUsage'
import { toDisplayedBeat } from '../../beatDisplay'
import { isEditableEntity } from '../../sidebars/default'
import { fieldApplies, useSelectedEntitiesProperties } from '../../utils/properties'
import { multiFieldComponents } from './fieldComponents'
import FieldUsageProvider from './FieldUsageProvider.vue'
import {
    propertyFields,
    propertySections,
    type PropertyField,
    type PropertyKey,
    type PropertySection,
} from './fields'
import PropertiesFieldGroup from './PropertiesFieldGroup.vue'
import SelectionSummary from './SelectionSummary.vue'
import { selectOnly } from './selectOnly'

const { entities, types, noteFields, usage, createModel, createEaseModel } =
    useSelectedEntitiesProperties(isEditableEntity)

const models = Object.fromEntries(
    propertyFields.map((field) => [
        field.key,
        field.ease
            ? createEaseModel(field.key as 'connectorEase')
            : createModel(field.key as 'beat'),
    ]),
) as Record<PropertyKey, WritableComputedRef<unknown>>

const visible = computed(() => {
    const context = {
        types: types.value,
        noteFields: noteFields.value,
        count: entities.value.length,
        isDynamicStages: isDynamicStages.value,
    }
    const sections = Object.fromEntries(
        propertySections.map((section) => [section, [] as PropertyField[]]),
    ) as Record<PropertySection, PropertyField[]>
    for (const field of propertyFields) {
        if (field.show(context)) sections[field.section].push(field)
    }
    return sections
})

// An ease counts for both its easing and its mode option.
const easeMatches = (value: unknown, option: unknown) =>
    value === option || easeFamily(value as Ease) === option || easeMode(value as Ease) === option

const usageOf = (field: PropertyField): FieldUsage => ({
    usage: usage.value.get(field.key),
    map: field.key === 'beat' ? (value) => toDisplayedBeat(value as number) : undefined,
    matches: field.ease ? easeMatches : undefined,
    label: field.valueLabel && ((value) => field.valueLabel?.(i18n.value, value as never)),
    narrow: (predicate) => {
        selectOnly(
            entities.value.filter(
                (entity) =>
                    fieldApplies(entity, field.key) &&
                    predicate(entity[field.key as keyof typeof entity]),
            ),
        )
    },
})
</script>

<template>
    <p v-if="!entities.length" class="text-fg/80">{{ i18n.sidebars.default.none }}</p>
    <template v-else>
        <SelectionSummary :entities />
        <template v-for="section in propertySections" :key="section">
            <PropertiesFieldGroup v-if="visible[section].length">
                <FieldUsageProvider
                    v-for="field in visible[section]"
                    :key="field.key"
                    :usage="usageOf(field)"
                >
                    <component
                        :is="multiFieldComponents[field.key]"
                        :model-value="models[field.key].value"
                        @update:model-value="(value: unknown) => (models[field.key].value = value)"
                    />
                </FieldUsageProvider>
            </PropertiesFieldGroup>
        </template>
    </template>
</template>
