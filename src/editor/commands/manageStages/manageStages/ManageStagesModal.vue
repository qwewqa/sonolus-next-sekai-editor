<script setup lang="ts">
import { i18n } from '../../../../i18n'
import BaseModal from '../../../../modals/BaseModal.vue'
import StagesManager from '../../../workspace/manager/StagesManager.vue'

// The fallback for a disabled panel position offers the same manager. A rule
// keeps its band from merging with the dialog band above it.
</script>

<template>
    <BaseModal :title="i18n.commands.manageStages.modal.title">
        <StagesManager class="-m-4 [&_.manager-band]:border-t [&_.manager-band]:border-fg/25" />
    </BaseModal>
</template>
