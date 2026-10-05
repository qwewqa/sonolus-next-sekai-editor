<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import { interpolateRaw } from '../../../utils/interpolate'
import { selectOnly } from './selectOnly'
import { summarizeSelection, type SummaryKind } from './summary'

const props = defineProps<{
    entities: Entity[]
}>()

const summary = computed(() =>
    summarizeSelection(
        props.entities,
        (slideId) => store.value.slides.note.get(slideId)?.length ?? 0,
    ),
)

// With one kind there is nothing to narrow to.
const narrowable = computed(() => summary.value.kinds.length > 1)

const label = (kind: SummaryKind) => i18n.value.workspace.properties.kinds[kind]

const narrow = (kind: SummaryKind) => {
    selectOnly(props.entities.filter((entity) => entity.type === kind))
}
</script>

<template>
    <!-- What the fields below cover; each kind narrows the selection to it. -->
    <div class="selection-summary flex flex-wrap items-center gap-1.5 text-sm">
        <template v-for="{ kind, count } in summary.kinds" :key="kind">
            <button
                v-if="narrowable"
                type="button"
                class="selection-summary-kind flex items-center gap-1.5 rounded-full bg-button px-3 py-0.5 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:shadow-accent [@media(pointer:coarse)]:py-1.5"
                :title="interpolateRaw(i18n.modals.form.selectOnly, `${count}`, label(kind))"
                :aria-label="interpolateRaw(i18n.modals.form.selectOnly, `${count}`, label(kind))"
                @click="narrow(kind)"
            >
                {{ label(kind) }}
                <span class="tabular-nums text-fg/80">{{ count }}</span>
            </button>
            <span
                v-else
                class="selection-summary-kind flex items-center gap-1.5 py-0.5 font-medium"
            >
                {{ label(kind) }}
                <span class="tabular-nums text-fg/80">{{ count }}</span>
            </span>
            <span
                v-if="kind === 'note' && summary.slides"
                class="selection-summary-slides flex items-center gap-1.5 py-0.5 text-fg/80"
            >
                {{ i18n.workspace.properties.kinds.slides }}
                <span class="tabular-nums">{{ summary.slides }}</span>
            </span>
        </template>
    </div>
</template>
