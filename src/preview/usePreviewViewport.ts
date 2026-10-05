import { computed, onMounted, onUnmounted, ref, shallowRef, watch, type Ref } from 'vue'
import { isElevationEditorOpen, isElevationSideBySide } from '../editor/elevation/state'
import { getPanelSide, workspaceLayout } from '../editor/workspace'
import { settings } from '../settings'
import {
    layoutPreviewControls,
    placePreviewSettings,
    previewGap,
    previewSettingsWidth,
    type Rect,
    type SettingsLayout,
} from './layout'

export type ControlsMetrics = {
    width: number
    naturalHeight: number
    headerHeight: number
}

/** Coarse pointers get larger touch targets for the settings toggle and header. */
export const isCoarsePointer = matchMedia('(pointer: coarse)').matches
// Settings toggle size; matches its size-9 class on every pointer (touch
// extends only its hit area).
export const settingsButtonSize = 36

// Editor controls the expanded settings must never cover when they extend
// beyond the panel: the elevation editor's beat, snapping and close controls,
// and the editor toolbar. Each selector's matches count as one combined area.
const editorObstacleSelectors = ['.elevation-header', '[data-editor-toolbar] > *']

const measureObstacles = () =>
    editorObstacleSelectors.flatMap((selector) => {
        const rects = [...document.querySelectorAll(selector)]
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width > 0 && rect.height > 0)
        if (!rects.length) return []
        return [
            {
                left: Math.min(...rects.map((rect) => rect.left)),
                top: Math.min(...rects.map((rect) => rect.top)),
                right: Math.max(...rects.map((rect) => rect.right)),
                bottom: Math.max(...rects.map((rect) => rect.bottom)),
            },
        ]
    })

// A placement change from the settings form can remount the preview in another
// dock. The new form opens there so the user sees where it went, and keyboard
// users continue in its Placement field.
let settingsHandoff: { focusPlacement: boolean } | undefined
export const handOffPreviewSettings = (focusPlacement: boolean) => {
    settingsHandoff = { focusPlacement }
    // When the preview stays in the same dock, nothing remounts to take it.
    setTimeout(() => {
        settingsHandoff = undefined
    })
}

export const usePreviewViewport = (container: Readonly<Ref<HTMLElement | null>>) => {
    const containerWidth = ref(0)
    const containerHeight = ref(0)
    const containerRect = shallowRef<Rect>({ left: 0, top: 0, right: 0, bottom: 0 })
    const viewportSize = shallowRef({ width: 0, height: 0 })
    const pixelRatio = ref(devicePixelRatio || 1)

    const clockSize = shallowRef({ width: 0, height: 0 })
    const controls = shallowRef<ControlsMetrics>()
    const obstacles = shallowRef<Rect[]>([])

    const onTimeResize = (width: number, height: number) => {
        clockSize.value = { width, height }
    }
    // The form's height at each width it has been laid out at. Placement compares
    // places with different widths; remembering both keeps that choice stable.
    const naturalHeights = new Map<number, number>()
    const onControlsResize = (metrics: ControlsMetrics) => {
        naturalHeights.set(Math.round(metrics.width), metrics.naturalHeight)
        controls.value = metrics
    }

    const side = computed(() => getPanelSide('preview') ?? 'top')

    // Whether the strip is shown while it has no place of its own. This is
    // session state only: once space allows, the strip returns regardless.
    const isTransportShown = ref(false)

    // The strip has a constant height, so the whole arrangement follows from the
    // panel's size alone; nothing is measured.
    const controlsLayout = computed(() =>
        layoutPreviewControls({
            width: containerWidth.value,
            height: containerHeight.value,
            aspectRatio: settings.previewAspectRatio,
            coarse: isCoarsePointer,
            showTime: settings.previewShowTime,
            anchor: side.value === 'top' ? 'center' : 'start',
            position: settings.previewTransportPosition,
        }),
    )
    const canvas = computed(() => controlsLayout.value.canvas)
    const canDockTransport = computed(() => controlsLayout.value.placement !== 'overlay')
    watch(canDockTransport, (docked) => {
        // Losing docking space later must not hide controls already in view.
        if (docked) isTransportShown.value = true
    })
    const areTransportControlsVisible = computed({
        get: () => canDockTransport.value || isTransportShown.value,
        set: (value: boolean) => {
            isTransportShown.value = value
        },
    })

    const canvasWidth = computed(() => canvas.value.width)
    const canvasHeight = computed(() => canvas.value.height)
    const canvasLeft = computed(() => canvas.value.left)
    const canvasTop = computed(() => canvas.value.top)

    const canvasStyle = computed(() => ({
        left: `${canvas.value.left}px`,
        top: `${canvas.value.top}px`,
        width: `${canvas.value.width}px`,
        height: `${canvas.value.height}px`,
    }))

    const settingsWidth = computed(() =>
        previewSettingsWidth(side.value, containerRect.value, viewportSize.value.width),
    )
    const nextSettingsLayout = computed(() => {
        const metrics = controls.value
        if (!metrics || !containerWidth.value || !containerHeight.value) return
        const tile = containerRect.value
        const image = canvas.value
        // The settings avoid the strip wherever it shows.
        const strip = controlsLayout.value.strip
        const transportRect: Rect | undefined = areTransportControlsVisible.value
            ? {
                  left: tile.left + strip.left,
                  right: tile.left + strip.left + strip.width,
                  top: tile.top + strip.top,
                  bottom: tile.top + strip.top + strip.height,
              }
            : undefined
        const clock = clockSize.value
        // The clock chip is centered on the settings toggle's line.
        const clockTop = tile.top + image.top + previewGap + (settingsButtonSize - clock.height) / 2
        const clockRect =
            clock.width && clock.height
                ? {
                      left: tile.left + image.left + previewGap,
                      top: clockTop,
                      right: tile.left + image.left + previewGap + clock.width,
                      bottom: clockTop + clock.height,
                  }
                : undefined
        return placePreviewSettings({
            side: side.value,
            tile,
            image: {
                left: tile.left + image.left,
                top: tile.top + image.top,
                right: tile.left + image.left + image.width,
                bottom: tile.top + image.top + image.height,
            },
            obstacles: obstacles.value,
            viewport: viewportSize.value,
            transport: transportRect,
            clock: clockRect,
            panelWidth: settingsWidth.value,
            naturalHeight: (width) =>
                naturalHeights.get(Math.round(width)) ?? metrics.naturalHeight,
            // The header and about two rows of fields.
            minHeight: metrics.headerHeight + 88,
            buttonSize: settingsButtonSize,
        })
    })
    // Settings live outside the panel, so their size is observed at a shallower
    // depth than the panel's own observers. Apply placement in the next frame
    // rather than resizing them from inside a ResizeObserver delivery.
    const settingsLayout = shallowRef<SettingsLayout>()
    let settingsFrame = 0
    watch(
        nextSettingsLayout,
        () => {
            if (settingsFrame) return
            settingsFrame = requestAnimationFrame(() => {
                settingsFrame = 0
                settingsLayout.value = nextSettingsLayout.value
            })
        },
        { immediate: true },
    )

    // Auto expansion is resolved once per mount from the measured panel, so
    // resizing a dock never opens or closes the form under the pointer.
    const autoExpanded = ref<boolean>()
    const handoff = settingsHandoff
    settingsHandoff = undefined
    if (handoff) autoExpanded.value = true
    // Only the first form after a handoff takes focus, not one shown after playback.
    const focusPlacementOnMount = ref(!!handoff?.focusPlacement)
    const isInPanel = (layout: SettingsLayout) =>
        layout.placement === 'below' || layout.placement === 'over'
    watch(settingsLayout, (layout, previous) => {
        if (!layout) return
        focusPlacementOnMount.value = false
        if (autoExpanded.value === undefined) {
            autoExpanded.value = !isCoarsePointer && layout.fitsInPanel
            return
        }
        // A form opened automatically inside the panel closes rather than jumping
        // out over the editor when the panel shrinks, e.g. as a sibling opens.
        if (
            settings.previewControls === 'auto' &&
            autoExpanded.value &&
            previous &&
            isInPanel(previous) &&
            !isInPanel(layout)
        ) {
            autoExpanded.value = false
        }
    })
    const areControlsExpanded = computed({
        get: () =>
            settings.previewControls === 'expanded' ||
            (settings.previewControls === 'auto' && !!autoExpanded.value),
        set: (expanded: boolean) => {
            settings.previewControls = expanded ? 'expanded' : 'collapsed'
        },
    })

    // Editor controls may have moved since the last measurement.
    watch(areControlsExpanded, (expanded) => {
        if (expanded) measureFrame()
    })

    const controlsStyle = computed(() => {
        const layout = settingsLayout.value
        if (!layout) return { left: '0px', top: '0px', visibility: 'hidden' as const }
        return {
            left: `${layout.left}px`,
            top: `${layout.top}px`,
            width: `${layout.width}px`,
            maxHeight: `${layout.maxHeight}px`,
        }
    })
    const controlsButtonStyle = computed(() => {
        const layout = settingsLayout.value
        const tile = containerRect.value
        // Hidden until placed, so it never appears first in the panel's corner.
        if (!layout) return { visibility: 'hidden' as const }
        return {
            left: `${layout.button.left - tile.left}px`,
            top: `${layout.button.top - tile.top}px`,
        }
    })

    const measureFrame = () => {
        const element = container.value
        const root = document.documentElement
        const visual = window.visualViewport
        viewportSize.value = {
            width: root.clientWidth,
            // An on-screen keyboard shrinks only the visual viewport.
            height: visual
                ? Math.min(root.clientHeight, visual.offsetTop + visual.height)
                : root.clientHeight,
        }
        const nextObstacles = measureObstacles()
        if (JSON.stringify(nextObstacles) !== JSON.stringify(obstacles.value)) {
            obstacles.value = nextObstacles
        }
        if (!element) return
        const { left, top, right, bottom } = element.getBoundingClientRect()
        const previous = containerRect.value
        if (
            previous.left !== left ||
            previous.top !== top ||
            previous.right !== right ||
            previous.bottom !== bottom
        ) {
            containerRect.value = { left, top, right, bottom }
        }
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
        if (!entry) return
        containerWidth.value = entry.contentRect.width
        containerHeight.value = entry.contentRect.height
        measureFrame()
    })
    // Moving between docks or resizing a neighbor can move the panel without
    // resizing it. Measure after the workspace has rendered the new layout.
    watch(workspaceLayout, measureFrame, { flush: 'post' })
    watch([isElevationEditorOpen, isElevationSideBySide], measureFrame, { flush: 'post' })

    let pixelRatioQuery: MediaQueryList | undefined
    const onPixelRatioChange = () => {
        pixelRatio.value = devicePixelRatio || 1
        pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
        pixelRatioQuery = matchMedia(`(resolution: ${pixelRatio.value}dppx)`)
        pixelRatioQuery.addEventListener('change', onPixelRatioChange)
    }
    const onWindowResize = () => {
        onPixelRatioChange()
        measureFrame()
    }

    onMounted(() => {
        // Lay out from the first frame; some engines deliver the first
        // ResizeObserver notification only after a frame has been painted.
        if (container.value) {
            const { width, height } = container.value.getBoundingClientRect()
            containerWidth.value = width
            containerHeight.value = height
            resizeObserver.observe(container.value)
        }
        onPixelRatioChange()
        measureFrame()
        window.addEventListener('resize', onWindowResize)
        window.visualViewport?.addEventListener('resize', measureFrame)
        window.visualViewport?.addEventListener('scroll', measureFrame)
    })
    onUnmounted(() => {
        resizeObserver.disconnect()
        cancelAnimationFrame(settingsFrame)
        window.removeEventListener('resize', onWindowResize)
        window.visualViewport?.removeEventListener('resize', measureFrame)
        window.visualViewport?.removeEventListener('scroll', measureFrame)
        pixelRatioQuery?.removeEventListener('change', onPixelRatioChange)
    })

    return {
        focusPlacementOnMount,
        canvasWidth,
        canvasHeight,
        canvasLeft,
        canvasTop,
        pixelRatio,
        canvasStyle,
        controlsLayout,
        settingsLayout,
        controlsStyle,
        controlsButtonStyle,
        areControlsExpanded,
        areTransportControlsVisible,
        canDockTransport,
        onControlsResize,
        onTimeResize,
    }
}
