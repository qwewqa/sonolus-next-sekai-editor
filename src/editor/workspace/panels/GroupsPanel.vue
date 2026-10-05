<script setup lang="ts">
import ManagerList from '../manager/ManagerList.vue'
import { groupManager } from '../manager/groups'
</script>

<template>
    <ManagerList class="h-full bg-modal" :model="groupManager" scroll-key="panel:groups" />
</template>
