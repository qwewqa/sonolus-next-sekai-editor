import { computed, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { screenSm, screenWidth } from '../screen'
import { settings } from '../settings'

export const usePreviewViewport = (container: Readonly<Ref<HTMLElement | null>>) => {
    const isTransportVisible = ref(false)
    const transportHeight = ref(0)
    const transportWidth = ref(0)
    const transportRight = ref(0)
    const timestampWidth = ref(0)
    const timestampHeight = ref(0)
    const controlsWidth = ref(0)
    const controlsHeight = ref(0)
    const controlsHeaderHeight = ref(0)

    const onTransportResize = (height: number, width: number, right: number) => {
        transportHeight.value = height
        transportWidth.value = width
        transportRight.value = right
    }

    const onTimeResize = (width: number, height: number) => {
        timestampWidth.value = width
        timestampHeight.value = height
    }

    const onControlsResize = (width: number, height: number, headerHeight: number) => {
        controlsWidth.value = width
        controlsHeight.value = height
        controlsHeaderHeight.value = headerHeight
    }

    const prefersCompactControls = matchMedia('(pointer: coarse)').matches
    const areControlsExpanded = computed({
        get: () =>
            settings.previewControls === 'expanded' ||
            (settings.previewControls === 'auto' && screenSm.value && !prefersCompactControls),
        set: (expanded: boolean) => {
            settings.previewControls = expanded ? 'expanded' : 'collapsed'
        },
    })
    const canvasWidth = ref(0)
    const canvasHeight = ref(0)
    const canvasLeft = ref(0)
    const canvasTop = ref(0)
    const pixelRatio = ref(devicePixelRatio || 1)

    let containerWidth = 0
    let containerHeight = 0

    const canDockTransport = computed(
        () =>
            transportHeight.value > 0 &&
            // Do not latch visibility using the previous width's unwrapped bar height.
            Math.abs(transportWidth.value - (canvasWidth.value + canvasLeft.value * 2)) < 0.1 &&
            canvasTop.value * 2 >= transportHeight.value + 8,
    )
    watch(canDockTransport, (docked) => {
        if (docked) isTransportVisible.value = true
    })
    const areTransportControlsVisible = computed({
        get: () => canDockTransport.value || isTransportVisible.value,
        set: (value: boolean) => {
            isTransportVisible.value = value
        },
    })

    // Make room below the image by spending spare space above it before overlapping
    // the playfield. Showing controls only repositions the existing canvas.
    const displayedCanvasTop = computed(() =>
        areTransportControlsVisible.value
            ? Math.max(
                  0,
                  Math.min(canvasTop.value, canvasTop.value * 2 - transportHeight.value - 8),
              )
            : canvasTop.value,
    )

    const canvasStyle = computed(() => ({
        left: `${canvasLeft.value}px`,
        top: `${displayedCanvasTop.value}px`,
        width: `${canvasWidth.value}px`,
        height: `${canvasHeight.value}px`,
    }))

    const controlsStyle = computed(() => {
        let top = 4
        let clockLimit = Infinity
        const imageBottom = displayedCanvasTop.value + canvasHeight.value
        const naturalHeight = Math.min(
            controlsHeight.value,
            canDockTransport.value
                ? Math.max(controlsHeaderHeight.value, imageBottom - top)
                : Infinity,
        )
        const left = canvasWidth.value + canvasLeft.value * 2 - controlsWidth.value - 4
        const timeLeft = canvasLeft.value + 4
        const timeTop = displayedCanvasTop.value + 4
        if (
            timestampWidth.value &&
            timestampHeight.value &&
            left < timeLeft + timestampWidth.value &&
            left + controlsWidth.value > timeLeft &&
            top < timeTop + timestampHeight.value &&
            top + naturalHeight > timeTop
        ) {
            if (timeTop - top >= controlsHeaderHeight.value + 28) {
                // A clock further down the image only needs the body to scroll.
                clockLimit = timeTop - top - 4
            } else {
                // Reserve one line when the header itself would cover the clock.
                top = timeTop + timestampHeight.value + 4
            }
        }
        const beside = transportRight.value + 4
        const remainingWidth = screenWidth.value - beside - 4
        if (
            (settings.previewPosition === 'left' ||
                (settings.previewPosition === 'auto' && screenSm.value)) &&
            canDockTransport.value &&
            controlsHeaderHeight.value > 0 &&
            imageBottom - top < controlsHeaderHeight.value + (areControlsExpanded.value ? 24 : 0) &&
            remainingWidth >= controlsHeaderHeight.value * (areControlsExpanded.value ? 2.5 : 1)
        ) {
            // An exceptionally short, narrow left preview cannot stack the clock,
            // header and bar. Open settings beside the bar if the screen has room.
            return {
                top: '4px',
                left: `${beside}px`,
                right: 'auto',
                maxWidth: `${remainingWidth}px`,
                maxHeight: 'calc(100dvh - 8px)',
            }
        }
        const maxHeight = canDockTransport.value
            ? `${Math.max(controlsHeaderHeight.value, imageBottom - top)}px`
            : `min(calc(100dvh - ${top + 4}px), max(11rem, calc(100% - ${top + 4}px)))`
        return {
            top: `${top}px`,
            // Keep a gap above the docked bar and let the settings body scroll. When
            // undocked it may extend beyond a short preview, but never the screen.
            maxHeight: clockLimit < Infinity ? `min(${clockLimit}px, ${maxHeight})` : maxHeight,
        }
    })

    const updateCanvasSize = () => {
        if (!containerWidth || !containerHeight) return

        // Preserve the exact logical ratio; backing pixels are rounded separately.
        // Independent CSS width/height rounding would subtly stretch the engine field.
        canvasWidth.value = Math.min(containerWidth, containerHeight * settings.previewAspectRatio)
        canvasHeight.value = canvasWidth.value / settings.previewAspectRatio
        canvasLeft.value = (containerWidth - canvasWidth.value) / 2
        canvasTop.value = (containerHeight - canvasHeight.value) / 2
    }

    watch(() => settings.previewAspectRatio, updateCanvasSize)

    const resizeObserver = new ResizeObserver(([entry]) => {
        if (!entry) return

        containerWidth = entry.contentRect.width
        containerHeight = entry.contentRect.height
        updateCanvasSize()
    })

    let pixelRatioQuery: MediaQueryList | undefined
    const onPixelRatioChange = () => {
        pixelRatio.value = devicePixelRatio || 1
        updateCanvasSize()
        pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
        pixelRatioQuery = matchMedia(`(resolution: ${pixelRatio.value}dppx)`)
        pixelRatioQuery.addEventListener('change', onPixelRatioChange)
    }

    onMounted(() => {
        if (container.value) resizeObserver.observe(container.value)
        onPixelRatioChange()
        window.addEventListener('resize', onPixelRatioChange)
    })
    onUnmounted(() => {
        resizeObserver.disconnect()
        window.removeEventListener('resize', onPixelRatioChange)
        pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
    })

    const onDockChange = () => {
        // Keep settings reachable when the new position cannot dock the transport.
        isTransportVisible.value = false
    }

    return {
        canvasWidth,
        canvasHeight,
        canvasLeft,
        displayedCanvasTop,
        pixelRatio,
        canvasStyle,
        controlsStyle,
        areControlsExpanded,
        areTransportControlsVisible,
        canDockTransport,
        onControlsResize,
        onTransportResize,
        onTimeResize,
        onDockChange,
    }
}
