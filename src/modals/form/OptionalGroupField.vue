<script setup lang="ts">
import type { GroupId } from '../../chart/groups'
import { folderSections } from '../../chart/folders'
import { groupFolders, groups } from '../../history/groups'
import { i18n } from '../../i18n'
import OptionalSelectField from './OptionalSelectField.vue'

defineProps<{
    /** Replaces the field's label, e.g. where it picks the current group. */
    label?: string
    /** Text for no group, e.g. when it means every group rather than 'unchanged'. */
    emptyLabel?: string
}>()

const modelValue = defineModel<GroupId | undefined>({ required: true })
</script>

<template>
    <OptionalSelectField
        v-model="modelValue"
        :empty-label
        :label="label ?? i18n.modals.form.group.label"
        :sections="folderSections(groups, groupFolders)"
    />
</template>
