import { onBeforeUnmount, onMounted, onUpdated, ref, type Ref } from 'vue'

// Room a select gives its value, as BaseField's styles set it (px).
const LEAD_PADDING = 30
const PLAIN_PADDING = 16

let context: CanvasRenderingContext2D | null | undefined

/**
 * A select's leading glyph gives way only when that lets the value fit, as a
 * label's glyph does; a value that truncates either way keeps its glyph.
 */
export const useLeadFit = (wrapper: Ref<HTMLElement | null>) => {
    const leadless = ref(false)
    let frame = 0
    const fit = () => {
        const element = wrapper.value
        const select = element?.querySelector('select')
        const lead = element?.querySelector<HTMLElement>('.form-field-select-lead')
        if (!element || !select || !lead) return (leadless.value = false)
        // Narrow layouts hide the glyph themselves; look past our own hiding.
        const hidden = lead.style.display
        lead.style.display = ''
        const narrow = getComputedStyle(lead).display === 'none'
        lead.style.display = hidden
        if (narrow) return (leadless.value = false)
        const style = getComputedStyle(select)
        context ??= document.createElement('canvas').getContext('2d')
        if (!context) return
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const need = context.measureText(select.selectedOptions[0]?.textContent.trim() ?? '').width
        const room = select.clientWidth - parseFloat(style.paddingRight)
        leadless.value = need > room - LEAD_PADDING + 0.5 && need <= room - PLAIN_PADDING + 0.5
    }
    const refit = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(fit)
    }
    let width = 0
    const observer = new ResizeObserver(([entry]) => {
        if (!entry || entry.contentRect.width === width) return
        width = entry.contentRect.width
        refit()
    })
    onMounted(() => {
        if (wrapper.value) observer.observe(wrapper.value)
        document.fonts.addEventListener('loadingdone', refit)
        fit()
    })
    // The value, its options or the locale changed.
    onUpdated(refit)
    onBeforeUnmount(() => {
        observer.disconnect()
        cancelAnimationFrame(frame)
        document.fonts.removeEventListener('loadingdone', refit)
    })
    return leadless
}
