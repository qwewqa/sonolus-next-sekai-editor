<script setup lang="ts">
import { computed, provide } from 'vue'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { i18n } from '../../../i18n'
import OptionalGroupField from '../../../modals/form/OptionalGroupField.vue'
import OptionalStageField from '../../../modals/form/OptionalStageField.vue'
import SelectField from '../../../modals/form/SelectField.vue'
import ChoiceField from '../../../modals/form/ChoiceField.vue'
import { entries } from '../../../utils/object'
import { commands } from '../../commands'
import { groupScope, stageScope } from '../../scope'
import { toolName, tools } from '../../tools'
import { view } from '../../view'
import SizeField from '../../../modals/form/SizeField.vue'
import { stackLongValuesKey } from '../../../modals/form/fieldLayout'

// Long values, such as event tool names, go below their label, as in Settings.
provide(stackLongValuesKey, true)

// A cancelled dialog or declined prompt leaves the value; the select shows it again.
const tool = computed({
    get: () => toolName.value,
    set: (tool) => {
        void commands[tool].execute()
    },
})

const toolOptions = computed(() =>
    entries(tools).map(([name, tool]) => [tool.title(), name] as const),
)

const groupId = computed({
    get: () => view.groupId,
    // Focus isolates or reveals an entry; All restores its saved visibility choices.
    set: (id) => {
        if (id === undefined) groupScope.focusAll()
        else groupScope.focus(id)
    },
})

const stageId = computed({
    get: () => view.stageId,
    set: (id) => {
        if (id === undefined) stageScope.focusAll()
        else stageScope.focus(id)
    },
})

const divisions = [1, 2, 3, 4, 6, 8, 12, 16]

const division = computed({
    get: () => view.division,
    set: (division) => {
        switch (division) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 6:
            case 8:
            case 12:
            case 16:
                void commands[`division${division}`].execute()
                break
            default:
                void commands.divisionCustom.execute()
                break
        }
    },
})

const divisionOptions = computed(() =>
    [...divisions, divisions.includes(view.division) ? undefined : view.division].map(
        (division) => [`1/${division ?? 'n'}`, division ?? 0] as const,
    ),
)

const snapping = computed({
    get: () => view.snapping,
    set: (snapping) => {
        if (snapping === view.snapping) return
        void commands.snapping.execute()
    },
})

const layout = computed({
    get: () => view.layout,
    set: (layout) => {
        if (layout === view.layout) return
        void commands.editorLayout.execute()
    },
})
</script>

<template>
    <ChoiceField
        v-if="isDynamicStages"
        v-model="layout"
        :label="i18n.sidebars.view.layout.label"
        :options="[
            [i18n.sidebars.view.layout.basic, 'basic'],
            [i18n.sidebars.view.layout.composed, 'composed'],
        ]"
    />
    <SelectField v-model="tool" :label="i18n.sidebars.view.tool" :options="toolOptions" />
    <!-- The current group and stage, not the selection's: Selection sets ownership. -->
    <OptionalGroupField
        v-model="groupId"
        :label="i18n.sidebars.view.group"
        :empty-label="i18n.workspace.groups.all"
    />
    <OptionalStageField
        v-if="isDynamicStages"
        v-model="stageId"
        :label="i18n.sidebars.view.stage"
        :empty-label="i18n.workspace.stages.all"
    />
    <SizeField v-model="view.noteSize" />
    <SelectField
        v-model="division"
        :label="i18n.sidebars.view.division"
        :options="divisionOptions"
    />
    <ChoiceField
        v-model="snapping"
        :label="i18n.sidebars.view.snapping.label"
        :options="[
            [i18n.sidebars.view.snapping.absolute, 'absolute'],
            [i18n.sidebars.view.snapping.relative, 'relative'],
        ]"
    />
</template>
