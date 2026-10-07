<script setup lang="ts">
import { provide } from 'vue'
import BaseModal from '../BaseModal.vue'
import { stackLongValuesKey } from './fieldLayout'

// Long values go below their label, as in Settings.
provide(stackLongValuesKey, true)

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
