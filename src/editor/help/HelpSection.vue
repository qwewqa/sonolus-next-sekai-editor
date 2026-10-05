<script setup lang="ts">
defineProps<{
    title: string
}>()
</script>

<template>
    <section>
        <h2 class="font-bold">{{ title }}</h2>

        <ul class="mt-2 list-outside list-disc pl-5">
            <slot />
        </ul>
    </section>
</template>
