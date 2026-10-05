<script setup lang="ts">
defineProps<{
    label: string
}>()
</script>

<template>
    <!-- Lays out by the width the field actually receives (dialog, tool modal or
    dock panel), not by the viewport: the wrapper is the query container. -->
    <div class="form-field">
        <label class="form-field-row">
            <span class="form-field-label"
                ><span class="form-field-text">{{ label }}</span></span
            >
            <slot />
        </label>
    </div>
</template>

<style>
.form-field {
    container-type: inline-size;
}

/* Values too long for their pill end in an ellipsis instead of clipping. */
.form-field-row > :is(input, select, button),
.form-field-select > select,
.form-field-toggle > input {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* Selects carry a trailing chevron inside the pill; the value keeps clear of it. */
.form-field-select {
    position: relative;
}

.form-field-select > select {
    padding-right: 2.25rem;
}

.form-field-select-icon {
    pointer-events: none;
    position: absolute;
    inset-block: 0;
    right: 1rem;
    display: flex;
    align-items: center;
}

/* A leading icon, such as an ease's curve, sits before the value. */
.form-field-select-leading > select {
    padding-left: 2.5rem;
}

.form-field-select-lead {
    pointer-events: none;
    position: absolute;
    inset-block: 0;
    left: 1rem;
    display: flex;
    align-items: center;
}

/* On/off fields carry a small switch in the same place, so they read as
   toggles rather than text fields. */
.form-field-toggle {
    position: relative;
}

.form-field-toggle > input {
    padding-right: 3rem;
}

.form-field-toggle-icon {
    pointer-events: none;
    position: absolute;
    inset-block: 0;
    right: 0.875rem;
    display: flex;
    align-items: center;
}

/* Numbers step with the keyboard and wheel; native spinners stay hidden. */
.form-field input[type='number'] {
    appearance: textfield;
    -moz-appearance: textfield;
}

.form-field input[type='number']::-webkit-inner-spin-button,
.form-field input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
}

.form-field-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
}

/* Long labels wrap to at most two lines rather than pushing the field down. */
.form-field-text {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    line-height: 1.25;
    overflow-wrap: anywhere;
}

/* Label and control share a row once the control keeps a usable width. */
@container (min-width: 13.5rem) {
    .form-field-row {
        flex-direction: row;
        align-items: center;
        gap: 0.75rem;
    }

    .form-field-label {
        display: flex;
        flex: none;
        align-items: center;
        /* About half the row, but long labels such as "Connector Pass Through"
           may take up to 11rem while the control keeps about 8.25rem. */
        width: min(max(calc(45% - 0.375rem), 11rem), calc(100% - 9rem));
        min-height: 2rem;
    }

    .form-field-row > :not(.form-field-label) {
        flex: 1 1 0%;
        min-width: 0;
    }
}

/* Narrow docks and drawers: the control takes half the row (at least 6.25rem),
   leaving labels such as "Flick Direction" one line; longer ones clamp. */
@container (min-width: 13.5rem) and (max-width: 18.99rem) {
    .form-field-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(6.25rem, 50%);
        column-gap: 0.5rem;
    }

    .form-field-label {
        width: auto;
    }

    .form-field-row > :not(.form-field-label, .form-field-select, .form-field-toggle),
    .form-field-select > select,
    .form-field-toggle > input {
        padding-inline: 0.75rem;
    }

    .form-field-select > select {
        padding-right: 1.75rem;
    }

    .form-field-toggle > input {
        padding-right: 2.5rem;
    }

    .form-field-select-icon {
        right: 0.75rem;
    }

    .form-field-toggle-icon {
        right: 0.625rem;
    }

    .form-field-select-leading > select {
        padding-left: 2rem;
    }

    .form-field-select-lead {
        left: 0.75rem;
    }
}

@container (min-width: 32rem) {
    .form-field-label {
        width: 60%;
    }
}
</style>
