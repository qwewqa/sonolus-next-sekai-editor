<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { state } from '../../../history'
import { i18n } from '../../../i18n'
import PropertiesModal from '../../../modals/form/PropertiesModal.vue'
import type { Entity } from '../../../state/entities'
import { isEditableEntity } from '../../../state/operations/editable'
import { interpolateRaw } from '../../../utils/interpolate'
import SelectionBody from './SelectionBody.vue'
import type { SummaryKind } from './summary'

const props = defineProps<{
    /** One kind's objects, as a tool's tap on them asks; the whole selection otherwise. */
    kind?: SummaryKind
}>()

const emit = defineEmits<{
    close: []
}>()

const kind = ref(props.kind)

const kindsOf = (entities: readonly Entity[]) =>
    [...new Set(entities.filter(isEditableEntity).map(({ type }) => type))].sort()

const sameEntities = (a: readonly Entity[], b: readonly Entity[]) =>
    a.length === b.length && a.every((entity, i) => entity === b[i])

// A new selection retitles the dialog for its kinds, or closes it when empty. Edits
// replace the objects but keep their kinds, so a kind's dialog stays through them.
watch(
    () => state.value,
    (current, previous) => {
        const kinds = kindsOf(current.selectedEntities)
        const selected =
            current.store === previous.store
                ? !sameEntities(current.selectedEntities, previous.selectedEntities)
                : kinds.join() !== kindsOf(previous.selectedEntities).join()
        if (!selected) return
        if (!kinds.length) emit('close')
        else kind.value = kinds.length === 1 ? kinds[0] : undefined
    },
)

const events = {
    cameraEventJoint: 'cameraEvent',
    stageMaskEventJoint: 'stageMaskEvent',
    stagePivotEventJoint: 'stagePivotEvent',
    stageStyleEventJoint: 'stageStyleEvent',
    stageTransformEventJoint: 'stageTransformEvent',
} as const

const title = computed(() => {
    const t = i18n.value
    switch (kind.value) {
        case undefined:
            return t.workspace.properties.selection
        case 'note':
            return t.tools.note.modal.title
        case 'bpm':
            return t.tools.bpm.modal.title
        case 'timeScale':
            return t.tools.timeScale.modal.title
        case 'cameraEventJoint':
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
            return interpolateRaw(t.tools.events.modal.title, t.events[events[kind.value]])
    }
})
</script>

<template>
    <PropertiesModal :title @close="emit('close')">
        <SelectionBody :kind />
    </PropertiesModal>
</template>
