<script setup lang="ts">
import { vScrollEdges } from '../../../directives/scrollEdges'
import {
    computed,
    onBeforeUnmount,
    onMounted,
    shallowRef,
    useTemplateRef,
    watch,
    type Component,
} from 'vue'
import { i18n } from '../../../i18n'
import { propertiesSections, settings, type PropertiesSection } from '../../../settings'
import {
    nextPropertiesSection,
    propertiesPresentation,
    type PropertiesPresentation,
} from '../properties/presentation'
import SelectionProperties from '../properties/SelectionProperties.vue'
import ToolProperties from '../properties/ToolProperties.vue'
import ViewProperties from '../properties/ViewProperties.vue'
import ChevronIcon from '../ChevronIcon.vue'
import { useScrollMemory } from '../useScrollMemory'

const root = useTemplateRef<HTMLElement>('root')
const scroller = useTemplateRef<HTMLElement>('scroller')
const tablist = useTemplateRef<HTMLElement>('tablist')

const components: Record<PropertiesSection, Component> = {
    selection: SelectionProperties,
    tool: ToolProperties,
    view: ViewProperties,
}

const title = (section: PropertiesSection) => i18n.value.workspace.properties[section]
const headerId = (section: PropertiesSection) => `properties-section-${section}-header`
const bodyId = (section: PropertiesSection) => `properties-section-${section}`

// The presentation follows the panel's own size, which depends on its dock and
// siblings rather than on the viewport, with hysteresis so resizing across the
// threshold does not flip it repeatedly. Measuring before the first content
// render avoids flashing the wrong presentation.
const presentation = shallowRef<PropertiesPresentation>()
let observer: ResizeObserver | undefined

const measure = (width: number, height: number) => {
    const next = propertiesPresentation(width, height, presentation.value)
    if (next !== presentation.value) presentation.value = next
}

onMounted(() => {
    const element = root.value
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    measure(width, height)
    observer = new ResizeObserver(([entry]) => {
        if (entry) measure(entry.contentRect.width, entry.contentRect.height)
        updateRaised()
    })
    observer.observe(element)
})

const active = computed(() => settings.propertiesSection)
const isExpanded = (section: PropertiesSection) => !settings.propertiesCollapsed.includes(section)

useScrollMemory(
    () => (presentation.value === 'tabs' ? `properties:${active.value}` : 'properties:sections'),
    scroller,
)

// Bands raise over content scrolled beneath them, as in the managers: the tab
// band once its section scrolls, or the stuck header of the section that spans
// the top of the scroller.
const tabsRaised = shallowRef(false)
const raisedSection = shallowRef<PropertiesSection>()

const updateRaised = () => {
    const element = scroller.value
    tabsRaised.value = presentation.value === 'tabs' && !!element && element.scrollTop > 0
    if (presentation.value !== 'sections' || !element) {
        raisedSection.value = undefined
        return
    }
    const top = element.getBoundingClientRect().top
    raisedSection.value = propertiesSections.find((section) => {
        const rect = element
            .querySelector(`[data-properties-section="${section}"]`)
            ?.getBoundingClientRect()
        return !!rect && rect.top < top - 0.5 && rect.bottom > top + 0.5
    })
}

// A switch shows another scroll position, restored without a scroll event when
// it is the top, and expanding or collapsing moves the sections.
watch(
    [presentation, active, () => settings.propertiesCollapsed],
    () => {
        updateRaised()
        requestAnimationFrame(updateRaised)
    },
    { flush: 'post' },
)

// Section switches unmount the fields they hide. Blurring a focused field first
// commits any pending typed value (Safari does not move focus to a tapped
// button). Buttons, such as the section tabs, keep their focus.
const commitPendingEdit = (except: EventTarget | null) => {
    const element = document.activeElement
    if (
        element instanceof HTMLElement &&
        element !== except &&
        element.matches('input, select, textarea') &&
        root.value?.contains(element)
    )
        element.blur()
}

// Whatever hides a field (a section or presentation switch, or the panel
// itself unmounting because another panel was activated without moving focus,
// as on iOS) first commits its typed value. These run before the fields' own
// unmount hooks, which would otherwise cancel the pending edit.
watch(
    [presentation, active],
    () => {
        commitPendingEdit(null)
    },
    { flush: 'pre' },
)

onBeforeUnmount(() => {
    commitPendingEdit(null)
    observer?.disconnect()
})

// Pointer clicks return keyboard shortcuts to the editor; keyboard activation
// keeps focus on the control.
const blurAfterPointer = (event: MouseEvent) => {
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
}

const toggle = (event: MouseEvent, section: PropertiesSection) => {
    commitPendingEdit(event.currentTarget)
    settings.propertiesCollapsed = isExpanded(section)
        ? [...settings.propertiesCollapsed, section]
        : settings.propertiesCollapsed.filter((value) => value !== section)
    blurAfterPointer(event)
}

const select = (event: Event, section: PropertiesSection) => {
    commitPendingEdit(event.currentTarget)
    settings.propertiesSection = section
}

const onTab = (event: MouseEvent, section: PropertiesSection) => {
    select(event, section)
    blurAfterPointer(event)
}

const onTabKeydown = (event: KeyboardEvent) => {
    const section = nextPropertiesSection(propertiesSections, active.value, event.key)
    if (!section) return
    event.preventDefault()
    select(event, section)
    tablist.value?.querySelector<HTMLElement>(`#${headerId(section)}`)?.focus()
}
</script>

<template>
    <div ref="root" class="properties-panel h-full w-full bg-modal text-fg">
        <!-- Constrained: one section at a time behind a fixed tab strip. -->
        <div v-if="presentation === 'tabs'" class="flex h-full flex-col">
            <!-- Section tabs in a lavender band. Like the rail's tabs, the shown
            section is marked on the edge facing its content: a fg bar flush
            with the band, the same marker the All row uses when current. -->
            <div
                class="properties-tabs relative z-10 flex shrink-0 bg-header px-1.5 transition-shadow"
                :class="{ 'shadow-band': tabsRaised }"
            >
                <div
                    ref="tablist"
                    class="properties-tablist flex w-full min-w-0"
                    role="tablist"
                    :aria-label="i18n.workspace.properties.sections"
                >
                    <button
                        v-for="section in propertiesSections"
                        :id="headerId(section)"
                        :key="section"
                        type="button"
                        role="tab"
                        class="properties-tab group flex min-w-0 flex-auto items-center justify-center font-bold text-fg focus-visible:outline-none"
                        :class="{ 'properties-tab-active': section === active }"
                        :title="title(section)"
                        :aria-selected="section === active"
                        :aria-controls="section === active ? bodyId(section) : undefined"
                        :tabindex="section === active ? 0 : -1"
                        @click="onTab($event, section)"
                        @keydown="onTabKeydown"
                    >
                        <!-- The whole band height is the hit area; the pill carries
                        hover, press and focus. Only the label truncates. -->
                        <span
                            class="properties-tab-pill flex h-9 min-w-0 max-w-full items-center justify-center rounded-full px-3 transition-colors group-focus-visible:ring-2 group-focus-visible:ring-inset group-focus-visible:ring-fg group-active:bg-accent group-active:text-on-accent"
                        >
                            <span class="properties-tab-label relative min-w-0">
                                <span class="block truncate">{{ title(section) }}</span>
                            </span>
                        </span>
                    </button>
                </div>
            </div>
            <!-- Content scrolled under the band raises it, as the manager band does;
            only the far end fades, so the top is never marked twice. -->
            <div
                :id="bodyId(active)"
                ref="scroller"
                :key="active"
                v-scroll-edges.end
                class="properties-scroller min-h-0 flex-1 scroll-pt-2 overflow-y-auto overscroll-contain"
                role="tabpanel"
                :aria-labelledby="headerId(active)"
                @scroll.passive="updateRaised"
            >
                <div class="flex flex-col gap-3 p-4">
                    <component :is="components[active]" />
                </div>
            </div>
        </div>

        <!-- Roomy: every section stacked, each expandable on its own. -->
        <div
            v-else-if="presentation === 'sections'"
            ref="scroller"
            v-scroll-edges.end
            class="properties-scroller properties-scroller-sections h-full scroll-pt-12 overflow-y-auto overscroll-contain"
            @scroll.passive="updateRaised"
        >
            <section
                v-for="(section, index) in propertiesSections"
                :key="section"
                :data-properties-section="section"
                :class="{ 'border-t border-fg/25': index > 0 }"
            >
                <!-- Opaque so the band never shows fields scrolling beneath, and raised
                while they do. Section headers are occasional toggles, so they are
                more compact than a panel band: 40px, or 44px on touch. -->
                <h2
                    class="sticky top-0 z-10 bg-modal transition-shadow"
                    :class="{ 'shadow-band': raisedSection === section }"
                >
                    <button
                        :id="headerId(section)"
                        type="button"
                        class="flex h-10 w-full items-center gap-2 bg-header px-4 text-left font-bold transition-colors hover:bg-header-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(pointer:coarse)]:h-11"
                        :aria-expanded="isExpanded(section)"
                        :aria-controls="bodyId(section)"
                        @click="toggle($event, section)"
                    >
                        <ChevronIcon :direction="isExpanded(section) ? 'down' : 'right'" />
                        <span class="min-w-0 truncate">{{ title(section) }}</span>
                    </button>
                </h2>
                <div
                    v-if="isExpanded(section)"
                    :id="bodyId(section)"
                    class="flex flex-col gap-3 p-4"
                    role="region"
                    :aria-labelledby="headerId(section)"
                >
                    <component :is="components[section]" />
                </div>
            </section>
        </div>
    </div>
</template>

<style scoped>
/* Classic scrollbars keep their room, so selecting more objects never shifts
   the fields sideways. */
.properties-scroller {
    scrollbar-gutter: stable;
}

/* Stacked section bands stick inside the scroller and cannot paint into a
   reserved gutter, so they would stop short of the panel edge: reserve none,
   and keep the scrollbar thin when it does appear. */
.properties-scroller-sections {
    scrollbar-gutter: auto;
    scrollbar-width: thin;
}

.properties-tabs {
    height: 3rem;
}

/* The bar sits on the band's lower edge: 6px below the 36px pill (48px band),
   8px on coarse pointers (52px band), plus the pill's 6px below the label. Like
   the rail's marker it spans the hover pill less 4px a side, and it matches the
   All row's 4px bar. */
.properties-tab-active .properties-tab-label::after {
    content: '';
    @apply pointer-events-none absolute -bottom-3 -left-2 -right-2 h-1 rounded-t-full bg-fg;
}

@media (hover: hover) {
    /* Not while pressed, so the press fill shows as on every other control. */
    .properties-tab:not(.properties-tab-active):not(:active):hover .properties-tab-pill {
        @apply bg-header-hover;
    }
}

@media (pointer: coarse) {
    .properties-tabs {
        height: 3.25rem;
    }

    .properties-tab-active .properties-tab-label::after {
        @apply -bottom-3.5;
    }
}
</style>
