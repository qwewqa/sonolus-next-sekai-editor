<script setup lang="ts">
import FitText from './FitText.vue'

defineProps<{
    title: string
    /** Fill classes for a chip behind the text, for canvas object colors (dark text). */
    chip?: string
}>()
</script>

<template>
    <!-- In an icon column beside names, text glyphs fit its 20px. -->
    <div class="flex items-center justify-center whitespace-nowrap">
        <span v-if="chip" class="flex rounded-sm leading-4 text-on-accent" :class="chip"
            ><FitText
                class="px-0.5 [[data-icon-column]_&]:px-0"
                :text="title"
                :natural="12"
                :room="20"
                :sizes="[10, 9]"
        /></span>
        <FitText v-else :text="title" :natural="12" :room="20" :sizes="[11, 10]" />
    </div>
</template>
