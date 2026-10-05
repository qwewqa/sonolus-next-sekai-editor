<template>
    <!-- Groups related fields; groups separate themselves from earlier non-empty
    groups so conditional fields never leave stray dividers. -->
    <div class="properties-field-group flex flex-col gap-3">
        <slot />
    </div>
</template>

<style>
.properties-field-group:empty {
    display: none;
}

.properties-field-group:not(:empty) ~ .properties-field-group:not(:empty) {
    border-top: 1px solid rgb(68 68 102 / 0.15);
    padding-top: 0.75rem;
}
</style>
