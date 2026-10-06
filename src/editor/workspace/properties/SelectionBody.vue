<script setup lang="ts">
import { computed } from 'vue'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { selectedEntities } from '../../../history/selectedEntities'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import type { Entity, EntityType } from '../../../state/entities'
import { isEditableEntity } from '../../../state/operations/editable'
import { aggregateEntities, mergeAggregates } from '../../utils/properties'
import { generalKeys, layoutFields, sharedKeys, type SelectionContext } from './fields'
import PropertiesBlock from './PropertiesBlock.vue'
import { summarizeSelection, type SummaryKind } from './summary'

const props = defineProps<{
    /** Shows only this kind's objects, as a kind's dialog does. */
    kind?: SummaryKind
}>()

const entities = computed(() =>
    selectedEntities.value.filter(
        (entity) => isEditableEntity(entity) && (!props.kind || entity.type === props.kind),
    ),
)

const summary = computed(() =>
    summarizeSelection(
        entities.value,
        (slideId) => store.value.slides.note.get(slideId)?.length ?? 0,
    ),
)

// Each kind is aggregated once; General merges the kinds' keys it shows.
const byKind = computed(() => {
    const groups = new Map<EntityType, Entity[]>()
    for (const entity of entities.value) {
        const group = groups.get(entity.type)
        if (group) group.push(entity)
        else groups.set(entity.type, [entity])
    }
    return new Map(
        [...groups].map(([kind, list]) => [
            kind,
            { entities: list, aggregate: aggregateEntities(list) },
        ]),
    )
})

const context = (kinds: SummaryKind[], count: number): SelectionContext => {
    const types: SelectionContext['types'] = {}
    const noteFields = byKind.value.get('note')?.aggregate.noteFields ?? {}
    for (const kind of kinds) types[kind] = true
    return { types, noteFields, count, isDynamicStages: isDynamicStages.value }
}

const blocks = computed(() => {
    const kinds = summary.value.kinds.map(({ kind }) => kind)
    const counts = new Map(summary.value.kinds.map(({ kind, count }) => [kind, count]))
    const layout = layoutFields(
        kinds,
        (kind) => context([kind as SummaryKind], counts.get(kind as SummaryKind) ?? 0),
        context(kinds, entities.value.length),
    )
    return layout.map(({ kind, sections }) => {
        const own = kind && byKind.value.get(kind)
        return {
            key: kind ?? 'general',
            kind: kind as SummaryKind | undefined,
            sections,
            entities: own ? own.entities : entities.value,
            aggregate: own
                ? own.aggregate
                : mergeAggregates(
                      [...byKind.value.values()].map(({ aggregate }) => aggregate),
                      [...generalKeys, ...sharedKeys],
                  ),
            count: kind ? (counts.get(kind as SummaryKind) ?? 0) : entities.value.length,
            slides: kind === 'note' ? summary.value.slides : 0,
        }
    })
})
</script>

<template>
    <p v-if="!entities.length" class="text-fg/80">{{ i18n.sidebars.default.none }}</p>
    <PropertiesBlock
        v-for="block in blocks"
        v-else
        :key="block.key"
        :kind="block.kind"
        :entities="block.entities"
        :aggregate="block.aggregate"
        :sections="block.sections"
        :count="block.count"
        :slides="block.slides"
        :narrowable="blocks.length > 1"
    />
</template>
