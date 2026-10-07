<script setup lang="ts">
import { i18n } from '../../../i18n'
</script>

<template>
    <button
        type="button"
        class="flex size-8 items-center justify-center rounded-full shadow-md shadow-transparent transition-colors hover:bg-button hover:shadow-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:fill-on-accent forced-colors:fill-[ButtonText] [@media(pointer:coarse)]:size-11"
        :aria-label="i18n.settings.toolbar.add"
        :title="i18n.settings.toolbar.add"
    >
        <svg
            class="size-4 [@media(pointer:coarse)]:size-5"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 448 512"
            aria-hidden="true"
        >
            <!--! Font Awesome Free 6.6.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2024 Fonticons, Inc. -->
            <path
                d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z"
            />
        </svg>
    </button>
</template>
