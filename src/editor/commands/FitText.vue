<script setup lang="ts">
import { onMounted, useTemplateRef, watch } from 'vue'

const props = defineProps<{
    text: string
    /** Size in px where the glyph has room, as on a toolbar button. */
    natural: number
    /** Width the text may take in an icon column, in px. */
    room: number
    /** Font sizes to try in an icon column in px, largest first. */
    sizes: number[]
}>()

const element = useTemplateRef<HTMLElement>('element')

// Measured in the element's own font, so hidden icons fit before they show.
let context: CanvasRenderingContext2D | null | undefined
const measure = (element: HTMLElement, size: number) => {
    context ??= document.createElement('canvas').getContext('2d')
    if (!context) return 0
    const { fontFamily, fontWeight } = getComputedStyle(element)
    context.font = `${fontWeight} ${size}px ${fontFamily}`
    return context.measureText(props.text).width
}

// In an icon column, wide text tightens its spacing, then steps down a size;
// spacing keeps the glyphs crisp, which a scaled transform would not.
const fit = () => {
    const target = element.value
    if (!target) return
    let size = props.natural
    let tighten = 0
    if (target.closest('[data-icon-column]')) {
        const gaps = Math.max(1, props.text.length - 1)
        for (const candidate of props.sizes) {
            size = candidate
            tighten = Math.max(0, measure(target, candidate) - props.room) / gaps
            if (tighten <= candidate * 0.08) break
        }
    }
    target.style.fontSize = `${size}px`
    target.style.letterSpacing = tighten ? `${-tighten}px` : ''
    // The last glyph's spacing is not a gap.
    target.style.marginRight = tighten ? `${tighten}px` : ''
}

onMounted(fit)
watch(() => `${props.text} ${props.room} ${props.sizes.join()}`, fit)
</script>

<template>
    <span ref="element" class="whitespace-nowrap">{{ text }}</span>
</template>
