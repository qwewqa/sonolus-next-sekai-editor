<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
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

// Shows the pick while its command runs, then the actual value, so a
// cancelled dialog or declined prompt leaves no stale pick in the select.
const commandModel = <T,>(current: () => T, run: (value: T) => void | Promise<void>) => {
    const shown = ref(current()) as Ref<T>
    watch(current, (value) => {
        shown.value = value
    })
    return computed({
        get: () => shown.value,
        set: (value: T) => {
            shown.value = value
            void Promise.resolve(run(value)).finally(() => {
                shown.value = current()
            })
        },
    })
}

const tool = commandModel(
    () => toolName.value,
    (tool) => commands[tool].execute(),
)

const toolOptions = computed(() =>
    entries(tools).map(([name, tool]) => [tool.title(), name] as const),
)

const groupId = computed({
    get: () => view.groupId,
    // Focusing an entry also reveals it if it was hidden.
    set: (id) => {
        groupScope.focus(id)
    },
})

const stageId = computed({
    get: () => view.stageId,
    set: (id) => {
        stageScope.focus(id)
    },
})

const divisions = [1, 2, 3, 4, 6, 8, 12, 16]

const division = commandModel(
    () => view.division,
    (division) => {
        switch (division) {
            case 1:
            case 2:
            case 3:
            case 4:
            case 6:
            case 8:
            case 12:
            case 16:
                return commands[`division${division}`].execute()
            default:
                return commands.divisionCustom.execute()
        }
    },
)

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
</script>

<template>
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
