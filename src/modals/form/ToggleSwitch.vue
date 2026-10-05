<script setup lang="ts">
defineProps<{
    /** On, off, or undefined for a mixed selection. */
    value: boolean | undefined
}>()
</script>

<template>
    <!-- The trailing glyph of an on/off field, where selects show their chevron:
    a small switch, mint when on, its knob centered for a mixed selection. -->
    <span class="form-field-toggle-icon" aria-hidden="true">
        <span
            class="relative h-3.5 w-6 rounded-full transition-colors group-active:bg-on-accent/30"
            :class="value ? 'bg-accent' : 'bg-fg/25'"
        >
            <span
                class="absolute top-0.5 size-2.5 rounded-full bg-white shadow-sm transition-[left]"
                :class="value === undefined ? 'left-[0.4375rem]' : value ? 'left-3' : 'left-0.5'"
            />
        </span>
    </span>
</template>
