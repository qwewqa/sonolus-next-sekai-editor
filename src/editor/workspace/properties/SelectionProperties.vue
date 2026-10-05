<script setup lang="ts">
import { computed, useId, type WritableComputedRef } from 'vue'
import { easeFamily, easeMode, eases, type Ease } from '../../../ease'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { i18n } from '../../../i18n'
import type { FieldUsage } from '../../../modals/form/fieldUsage'
import { settings } from '../../../settings'
import { toDisplayedBeat } from '../../beatDisplay'
import ChevronIcon from '../ChevronIcon.vue'
import { isEditableEntity } from '../../sidebars/default'
import { fieldApplies, useSelectedEntitiesProperties } from '../../utils/properties'
import { multiFieldComponents } from './fieldComponents'
import FieldUsageProvider from './FieldUsageProvider.vue'
import {
    connectorSummaryKeys,
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

const connectorId = useId()

// One line standing in for the connector fields while they are collapsed.
const connectorSummary = computed(() =>
    visible.value.connector
        .filter((field) => connectorSummaryKeys.includes(field.key))
        .map((field) => {
            const value = models[field.key].value
            const known = field.ease ? eases.includes(value as Ease) : value !== undefined
            return known && field.valueLabel
                ? field.valueLabel(i18n.value, value as never)
                : i18n.value.modals.form.mixed
        })
        .join(' · '),
)

const toggleConnector = (event: MouseEvent) => {
    // Collapsing unmounts the fields, so a typed value commits first.
    const element = document.activeElement
    if (element instanceof HTMLElement && document.getElementById(connectorId)?.contains(element))
        element.blur()
    settings.propertiesConnectorExpanded = !settings.propertiesConnectorExpanded
    // Pointer clicks return keyboard shortcuts to the editor.
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
}
</script>

<template>
    <p v-if="!entities.length" class="text-fg/80">{{ i18n.sidebars.default.none }}</p>
    <template v-else>
        <SelectionSummary :entities />
        <template v-for="section in propertySections" :key="section">
            <!-- Connector fields fold into a subsection that keeps a summary. -->
            <PropertiesFieldGroup v-if="section === 'connector' && visible.connector.length">
                <button
                    type="button"
                    class="properties-subsection -mx-2 flex min-h-8 items-center gap-2 rounded-lg px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:bg-header-hover [@media(pointer:coarse)]:min-h-11"
                    :aria-expanded="settings.propertiesConnectorExpanded"
                    :aria-controls="connectorId"
                    @click="toggleConnector"
                >
                    <ChevronIcon
                        :direction="settings.propertiesConnectorExpanded ? 'down' : 'right'"
                    />
                    <span class="shrink-0 font-medium">{{
                        i18n.workspace.properties.connector
                    }}</span>
                    <span
                        v-if="!settings.propertiesConnectorExpanded"
                        class="properties-subsection-summary min-w-0 truncate text-sm text-fg/80"
                        >{{ connectorSummary }}</span
                    >
                </button>
                <div
                    v-if="settings.propertiesConnectorExpanded"
                    :id="connectorId"
                    class="flex flex-col gap-3"
                >
                    <FieldUsageProvider
                        v-for="field in visible.connector"
                        :key="field.key"
                        :usage="usageOf(field)"
                    >
                        <component
                            :is="multiFieldComponents[field.key]"
                            :model-value="models[field.key].value"
                            @update:model-value="
                                (value: unknown) => (models[field.key].value = value)
                            "
                        />
                    </FieldUsageProvider>
                </div>
            </PropertiesFieldGroup>
            <PropertiesFieldGroup v-else-if="visible[section].length">
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
