<script setup lang="ts">
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    toRef,
    useId,
    useTemplateRef,
    type WritableComputedRef,
} from 'vue'
import { easeEditParts, easeFunctionOf, easeTypeOf, eases, type Ease } from '../../../ease'
import { i18n } from '../../../i18n'
import type { FieldUsage } from '../../../modals/form/fieldUsage'
import { settings } from '../../../settings'
import type { Entity } from '../../../state/entities'
import { interpolateRaw } from '../../../utils/interpolate'
import { toDisplayedBeat } from '../../beatDisplay'
import SelectIcon from '../../commands/select/SelectIcon.vue'
import { fieldApplies, useEntitiesProperties, type EntitiesAggregate } from '../../utils/properties'
import ChevronIcon from '../ChevronIcon.vue'
import { multiFieldComponents } from './fieldComponents'
import FieldUsageProvider from './FieldUsageProvider.vue'
import {
    connectorSummaryKeys,
    propertyFields,
    propertySections,
    type PropertyField,
    type PropertyKey,
    type PropertySection,
} from './fields'
import PropertiesFieldGroup from './PropertiesFieldGroup.vue'
import { selectOnly } from './selectOnly'
import type { SummaryKind } from './summary'

const props = defineProps<{
    /** The kind of the block's objects; General when unset. */
    kind?: SummaryKind
    entities: readonly Entity[]
    aggregate: EntitiesAggregate
    sections: Record<PropertySection, PropertyField[]>
    count: number
    slides: number
    /** Other kinds are selected too, so this one can be selected alone. */
    narrowable: boolean
}>()

const { createModel, createEaseModel } = useEntitiesProperties(
    toRef(props, 'entities'),
    toRef(props, 'aggregate'),
)

const models = Object.fromEntries(
    propertyFields.map((field) => [
        field.key,
        field.ease
            ? createEaseModel(field.key as 'connectorEase')
            : createModel(field.key as 'beat'),
    ]),
) as Record<PropertyKey, WritableComputedRef<unknown>>

// An ease counts for both its type and its function option.
const easeMatches = (value: unknown, option: unknown) =>
    value === option ||
    easeTypeOf(value as Ease) === option ||
    easeFunctionOf(value as Ease) === option

const usageOf = (field: PropertyField): FieldUsage => ({
    usage: props.aggregate.usage.get(field.key),
    map: field.key === 'beat' ? (value) => toDisplayedBeat(value as number) : undefined,
    matches: field.ease ? easeMatches : undefined,
    label: field.valueLabel && ((value) => field.valueLabel?.(i18n.value, value as never)),
    narrow: (predicate) => {
        selectOnly(
            props.entities.filter(
                (entity) =>
                    fieldApplies(entity, field.key) &&
                    predicate(entity[field.key as keyof typeof entity]),
            ),
        )
    },
})

// General names a field several kinds share by what it applies to.
const fieldProps = (field: PropertyField) =>
    !props.kind && field.key === 'eventEase' ? { qualified: true } : {}

const connectorId = useId()
const headerId = useId()

// One line standing in for the connector fields while they are collapsed.
const connectorSummary = computed(() => {
    const fields = props.sections.connector.filter((field) =>
        connectorSummaryKeys.includes(field.key),
    )
    const parts = fields.flatMap((field) => {
        const value = models[field.key].value
        if (field.ease) {
            if (eases.includes(value as Ease))
                return [field.valueLabel?.(i18n.value, value as never)]
            // Agreeing on one half alone still names it; None and Linear have no function to differ.
            const { type, name } = easeEditParts(value as Ease | undefined)
            const half = type ?? name
            return half ? [i18n.value.modals.form.ease[half]] : []
        }
        return value !== undefined && field.valueLabel
            ? [field.valueLabel(i18n.value, value as never)]
            : []
    })
    if (!fields.length) return ''
    return parts.length
        ? parts.join(' · ')
        : interpolateRaw(i18n.value.workspace.properties.valuesDiffer, `${fields.length}`)
})

const toggleConnector = (event: MouseEvent) => {
    // Collapsing unmounts the fields, so a typed value commits first.
    const element = document.activeElement
    if (element instanceof HTMLElement && document.getElementById(connectorId)?.contains(element))
        element.blur()
    settings.propertiesConnectorExpanded = !settings.propertiesConnectorExpanded
    // Pointer clicks return keyboard shortcuts to the editor.
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
}

const kindLabel = computed(() =>
    props.kind
        ? i18n.value.workspace.properties.kinds[props.kind]
        : i18n.value.tools.brush.kinds.general,
)
// The label but its last letter, which holds the count.
const kindHead = computed(() => Array.from(kindLabel.value).slice(0, -1).join(''))
const kindTail = computed(() => Array.from(kindLabel.value).at(-1) ?? '')
const slidesText = computed(() =>
    interpolateRaw(i18n.value.workspace.properties.inSlides, `${props.slides}`),
)
const selectOnlyLabel = computed(() =>
    interpolateRaw(i18n.value.modals.form.selectOnly, `${props.count}`, kindLabel.value),
)

const header = useTemplateRef<HTMLElement>('header')
const title = useTemplateRef<HTMLElement>('title')

// The action names itself when the header has room and shows its icon otherwise.
const iconOnly = ref(false)
let context: CanvasRenderingContext2D | null | undefined
// The header's width and the title's font, read as it resizes, so a count change forces no layout.
let room: { width: number; fontSize: string; fontFamily: string; rem: number } | undefined
const readRoom = () => {
    const element = header.value
    if (!element || !title.value) return
    const { fontSize, fontFamily } = getComputedStyle(title.value)
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    room = { width: element.clientWidth, fontSize, fontFamily, rem }
}
const measure = () => {
    if (!title.value) return
    if (!room) readRoom()
    context ??= document.createElement('canvas').getContext('2d')
    if (!context || !room) return
    const { width: available, fontSize, fontFamily, rem } = room
    const width = (text: string, weight: string) => {
        if (!context) return 0
        context.font = `${weight} ${fontSize} ${fontFamily}`
        return context.measureText(text).width
    }
    // Only the kind's name is bold.
    const tail = `\u00a0${props.count}${props.slides ? ` · ${slidesText.value}` : ''}`
    const titleWidth = width(kindLabel.value, 'bold') + (props.kind ? width(tail, 'normal') : 0)
    // Icon (0.875rem tall, 320:512), gap and padding around the action's name; its
    // negative margin takes back the gap before it.
    const actionWidth =
        width(i18n.value.workspace.properties.selectOnly, 'normal') +
        (0.875 * (320 / 512) + 0.375 + 1.5) * rem
    iconOnly.value = titleWidth + actionWidth > available
}

let frame = 0
const observer = new ResizeObserver(() => {
    readRoom()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(measure)
})
onMounted(() => {
    if (header.value) observer.observe(header.value)
    void document.fonts.ready.then(() => {
        readRoom()
        measure()
    })
})
onBeforeUnmount(() => {
    cancelAnimationFrame(frame)
    observer.disconnect()
})

const narrowKind = async (event: MouseEvent) => {
    const kind = props.kind
    if (!kind) return
    selectOnly(props.entities.filter((entity) => entity.type === kind))
    // Keys keep their place on the header once the action leaves.
    if (event.detail > 0) return
    await nextTick()
    title.value?.focus()
}
</script>

<template>
    <section class="properties-block flex flex-col gap-3" :aria-labelledby="headerId">
        <div ref="header" class="properties-block-header flex min-h-8 items-center gap-2">
            <h3
                :id="headerId"
                ref="title"
                tabindex="-1"
                class="min-w-0 flex-1 text-sm focus:outline-none"
                @vue:updated="measure"
            >
                <template v-if="kind">
                    <!-- The count wraps with the label's last letter, never alone. -->
                    <span class="font-bold">{{ kindHead }}</span
                    ><span class="whitespace-nowrap"
                        ><span class="font-bold">{{ kindTail }}</span
                        >&nbsp;<span class="tabular-nums text-fg/80">{{ count }}</span></span
                    >
                    <span v-if="slides" class="text-fg/80"> · {{ slidesText }}</span>
                </template>
                <span v-else class="font-bold">{{ kindLabel }}</span>
            </h3>
            <button
                v-if="kind && narrowable"
                type="button"
                class="properties-select-only -mr-2 flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:bg-header-hover [@media(pointer:coarse)]:h-11"
                :class="iconOnly ? 'w-8 [@media(pointer:coarse)]:w-11' : 'px-3 text-sm'"
                :title="selectOnlyLabel"
                :aria-label="selectOnlyLabel"
                @click="narrowKind"
            >
                <SelectIcon class="h-3.5 shrink-0 fill-current" aria-hidden="true" />
                <span v-if="!iconOnly">{{ i18n.workspace.properties.selectOnly }}</span>
            </button>
        </div>
        <template v-for="section in propertySections" :key="section">
            <!-- Connector fields fold into a subsection that keeps a summary. -->
            <PropertiesFieldGroup v-if="section === 'connector' && sections.connector.length">
                <button
                    type="button"
                    class="properties-subsection -mx-2 flex min-h-8 items-center gap-2 rounded-lg px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:bg-header-hover [@media(pointer:coarse)]:min-h-11"
                    :aria-expanded="settings.propertiesConnectorExpanded"
                    :aria-controls="connectorId"
                    @click="toggleConnector"
                >
                    <ChevronIcon
                        :direction="settings.propertiesConnectorExpanded ? 'down' : 'right'"
                    />
                    <span :id="`${connectorId}-heading`" class="shrink-0 text-sm font-bold">{{
                        i18n.workspace.properties.connector
                    }}</span>
                    <span
                        v-if="!settings.propertiesConnectorExpanded"
                        class="properties-subsection-summary min-w-0 truncate text-sm text-fg/80"
                        >{{ connectorSummary }}</span
                    >
                </button>
                <div
                    v-if="settings.propertiesConnectorExpanded"
                    :id="connectorId"
                    role="group"
                    :aria-labelledby="`${connectorId}-heading`"
                    class="flex flex-col gap-3"
                >
                    <FieldUsageProvider
                        v-for="field in sections.connector"
                        :key="field.key"
                        :usage="usageOf(field)"
                    >
                        <component
                            :is="multiFieldComponents[field.key]"
                            :model-value="models[field.key].value"
                            @update:model-value="
                                (value: unknown) => (models[field.key].value = value)
                            "
                        />
                    </FieldUsageProvider>
                </div>
            </PropertiesFieldGroup>
            <PropertiesFieldGroup v-else-if="sections[section].length">
                <FieldUsageProvider
                    v-for="field in sections[section]"
                    :key="field.key"
                    :usage="usageOf(field)"
                >
                    <component
                        :is="multiFieldComponents[field.key]"
                        v-bind="fieldProps(field)"
                        :model-value="models[field.key].value"
                        @update:model-value="(value: unknown) => (models[field.key].value = value)"
                    />
                </FieldUsageProvider>
            </PropertiesFieldGroup>
        </template>
    </section>
</template>

<style>
/* Blocks of different kinds are set apart more than field groups are. */
.properties-block + .properties-block {
    border-top: 1px solid rgb(68 68 102 / 0.3);
    padding-top: 0.5rem;
}
</style>
