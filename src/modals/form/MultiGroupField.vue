<script setup lang="ts">
import type { GroupId } from '../../chart/groups'
import { folderSections } from '../../chart/folders'
import { groupFolders, groups } from '../../history/groups'
import { i18n } from '../../i18n'
import MultiSelectField from './MultiSelectField.vue'

const modelValue = defineModel<GroupId | undefined>({ required: true })
</script>

<template>
    <MultiSelectField
        v-model="modelValue"
        :label="i18n.modals.form.group.label"
        :sections="folderSections(groups, groupFolders)"
    />
</template>
