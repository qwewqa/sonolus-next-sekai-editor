<script setup lang="ts">
import { computed, type WritableComputedRef } from 'vue'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { i18n } from '../../../i18n'
import { isEditableEntity } from '../../sidebars/default'
import { useSelectedEntitiesProperties } from '../../utils/properties'
import { multiFieldComponents } from './fieldComponents'
import {
    propertyFields,
    propertySections,
    type PropertyField,
    type PropertyKey,
    type PropertySection,
} from './fields'
import PropertiesFieldGroup from './PropertiesFieldGroup.vue'

const { entities, types, noteFields, createModel, createEaseModel } =
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
</script>

<template>
    <p v-if="!entities.length" class="text-fg/80">{{ i18n.sidebars.default.none }}</p>
    <template v-else>
        <template v-for="section in propertySections" :key="section">
            <PropertiesFieldGroup v-if="visible[section].length">
                <component
                    :is="multiFieldComponents[field.key]"
                    v-for="field in visible[section]"
                    :key="field.key"
                    :model-value="models[field.key].value"
                    @update:model-value="(value: unknown) => (models[field.key].value = value)"
                />
            </PropertiesFieldGroup>
        </template>
    </template>
</template>
