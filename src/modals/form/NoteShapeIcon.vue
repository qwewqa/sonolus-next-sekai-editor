<script setup lang="ts">
import { computed } from 'vue'
import { flickGlyphPoints } from '../../flickArrow'
import type { NoteShape } from './noteShapes'

// Simplified canvas shapes in note colours, with an edge for white rows.
const props = defineProps<{
    shape: NoteShape
    critical?: boolean
}>()

// [fill, edge] pairs; edges darken the canvas fills so pale ones hold on white.
const palette = {
    tap: ['#aabfff', '#8394f6'],
    flick: ['#fec3dc', '#ec7cb4'],
    critical: ['#fed983', '#e8ad1c'],
    trace: ['#5fefc2', '#27bf8c'],
    traceCritical: ['#fddd86', '#e8ad1c'],
    diamond: ['#abfbe3', '#27bf8c'],
    diamondCritical: ['#fff2c3', '#e8ad1c'],
    damage: ['#a50acc', '#7d0a9b'],
} as const

const colors = computed(() => {
    const { critical, shape } = props
    const body =
        shape === 'damage'
            ? palette.damage
            : shape === 'trace'
              ? palette[critical ? 'traceCritical' : 'trace']
              : critical
                ? palette.critical
                : palette[shape === 'flick' ? 'flick' : 'tap']
    const diamond = palette[critical ? 'diamondCritical' : 'diamond']
    return { body, diamond }
})

// Up, as the Flick Direction glyph draws it; raised above the body.
const arrow = flickGlyphPoints('up', 8, 6.5)
const arrowFill = computed(() => (props.critical ? '#ffc633' : '#ec7cb4'))

// The canvas tick: a kite twice as tall above its middle as below.
const kitePoints = [
    [-0.3, 0],
    [0, -0.3],
    [0.3, 0],
    [0, 0.15],
] as const
const kite = (cx: number, cy: number, scale: number) =>
    kitePoints.map(([x, y]) => `${cx + x * scale},${cy + y * scale}`).join(' ')
</script>

<template>
    <svg class="size-3.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
        <rect
            v-if="shape === 'tap'"
            x="1"
            y="4"
            width="14"
            height="8"
            rx="2"
            :fill="colors.body[0]"
            :stroke="colors.body[1]"
        />
        <template v-else-if="shape === 'flick'">
            <rect
                x="1"
                y="9.5"
                width="14"
                height="5"
                rx="1.75"
                :fill="colors.body[0]"
                :stroke="colors.body[1]"
            />
            <polygon :points="arrow" :fill="arrowFill" transform="translate(0 -3.75)" />
        </template>
        <rect
            v-else-if="shape === 'damage'"
            x="1"
            y="5.75"
            width="14"
            height="4.5"
            rx="1.5"
            :fill="colors.body[0]"
            :stroke="colors.body[1]"
        />
        <rect
            v-else-if="shape === 'anchor'"
            x="1.25"
            y="5.75"
            width="13.5"
            height="4.5"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            stroke-opacity="0.75"
            stroke-width="1.5"
        />
        <template v-else-if="shape === 'trace'">
            <rect
                x="1"
                y="6.85"
                width="14"
                height="5"
                rx="1.5"
                :fill="colors.body[0]"
                :stroke="colors.body[1]"
            />
            <polygon
                :points="kite(8, 9.35, 18)"
                :fill="colors.diamond[0]"
                :stroke="colors.diamond[1]"
                stroke-linejoin="round"
            />
        </template>
        <template v-else-if="shape === 'mute'">
            <path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor" fill-opacity="0.75" />
            <g
                stroke="currentColor"
                stroke-opacity="0.75"
                stroke-width="1.5"
                stroke-linecap="round"
            >
                <line x1="10.5" y1="6" x2="14.5" y2="10" />
                <line x1="10.5" y1="10" x2="14.5" y2="6" />
            </g>
        </template>
        <template v-else>
            <polygon
                :points="kite(8, 9.65, 22)"
                :fill="colors.diamond[0]"
                :stroke="colors.diamond[1]"
                stroke-linejoin="round"
            />
            <g
                v-if="shape === 'nonTick'"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
            >
                <line x1="5.5" y1="6" x2="10.5" y2="11" />
                <line x1="5.5" y1="11" x2="10.5" y2="6" />
            </g>
        </template>
    </svg>
</template>
