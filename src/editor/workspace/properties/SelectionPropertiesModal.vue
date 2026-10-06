<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '../../../i18n'
import PropertiesModal from '../../../modals/form/PropertiesModal.vue'
import { interpolateRaw } from '../../../utils/interpolate'
import SelectionBody from './SelectionBody.vue'
import type { SummaryKind } from './summary'

const props = defineProps<{
    /** One kind's objects, as a tool's tap on them asks; the whole selection otherwise. */
    kind?: SummaryKind
}>()

const events = {
    cameraEventJoint: 'cameraEvent',
    stageMaskEventJoint: 'stageMaskEvent',
    stagePivotEventJoint: 'stagePivotEvent',
    stageStyleEventJoint: 'stageStyleEvent',
    stageTransformEventJoint: 'stageTransformEvent',
} as const

const title = computed(() => {
    const t = i18n.value
    switch (props.kind) {
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
            return interpolateRaw(t.tools.events.modal.title, t.events[events[props.kind]])
    }
})
</script>

<template>
    <PropertiesModal :title>
        <SelectionBody :kind />
    </PropertiesModal>
</template>
