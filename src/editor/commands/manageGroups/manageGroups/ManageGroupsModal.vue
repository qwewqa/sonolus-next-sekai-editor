<script setup lang="ts">
import { i18n } from '../../../../i18n'
import BaseModal from '../../../../modals/BaseModal.vue'
import { groupManager } from '../../../workspace/manager/groups'
import ManagerList from '../../../workspace/manager/ManagerList.vue'

// The fallback for a disabled panel position offers the same manager. A rule
// keeps its band from merging with the dialog band above it.
</script>

<template>
    <BaseModal :title="i18n.commands.manageGroups.modal.title">
        <ManagerList
            class="-m-4 [&_.manager-band]:border-t [&_.manager-band]:border-fg/25"
            :model="groupManager"
        />
    </BaseModal>
</template>
