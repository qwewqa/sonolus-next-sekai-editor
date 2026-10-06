<script setup lang="ts">
import { provide } from 'vue'
import { stackLongValuesKey } from '../../modals/form/fieldLayout'

defineProps<{
    title: string
}>()

// Settings values such as languages are long; on narrow screens they go below their label.
provide(stackLongValuesKey, true)
</script>

<template>
    <section>
        <h2 class="mb-2 font-bold">{{ title }}</h2>

        <div class="flex flex-col gap-3">
            <slot />
        </div>
    </section>
</template>
