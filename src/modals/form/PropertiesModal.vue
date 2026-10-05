<script setup lang="ts">
import BaseModal from '../BaseModal.vue'

defineProps<{
    title: string
}>()
</script>

<template>
    <BaseModal :title>
        <div class="flex flex-col gap-3">
            <slot />
        </div>
    </BaseModal>
</template>
