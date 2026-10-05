<script setup lang="ts">
import { i18n } from '../../i18n'
import SelectField from '../../modals/form/SelectField.vue'
import { panelPositionOptions } from '../../preview/settingsOptions'
import { getPanelPosition, setPanelPosition } from '../workspace'
import { panelIds } from '../workspace/layout'
import { panelTitle } from '../workspace/panels'
import SettingsSection from './SettingsSection.vue'
</script>

<template>
    <SettingsSection :title="i18n.settings.panels.title">
        <SelectField
            v-for="id in panelIds"
            :key="id"
            :model-value="getPanelPosition(id)"
            :label="panelTitle(id)"
            :options="panelPositionOptions"
            @update:model-value="setPanelPosition(id, $event)"
        />
    </SettingsSection>
</template>
