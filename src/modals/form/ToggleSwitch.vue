<script setup lang="ts">
defineProps<{
    /** On, off, or undefined for a mixed selection. */
    value: boolean | undefined
}>()
</script>

<template>
    <!-- The trailing glyph of an on/off field, where selects show their chevron:
    a small switch, mint when on, its knob centered for a mixed selection. High
    contrast draws its edge and knob in the button text colour. -->
    <span class="form-field-toggle-icon" aria-hidden="true">
        <span
            class="relative h-3.5 w-6 rounded-full outline outline-1 outline-transparent transition-colors group-active:bg-on-accent/30 forced-colors:outline-[color:ButtonText]"
            :class="value ? 'bg-accent' : 'bg-fg/25'"
        >
            <span
                class="absolute top-0.5 size-2.5 rounded-full bg-white shadow-sm transition-[left] forced-colors:bg-[ButtonText]"
                :class="value === undefined ? 'left-[0.4375rem]' : value ? 'left-3' : 'left-0.5'"
            />
        </span>
    </span>
</template>
