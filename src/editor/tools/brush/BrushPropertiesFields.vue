<script setup lang="ts">
import { computed, nextTick, provide, useTemplateRef } from 'vue'
import { brushProperties } from '.'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { defaultGroupId } from '../../../history/groups'
import { selectedEntities } from '../../../history/selectedEntities'
import { defaultStageId } from '../../../history/stages'
import { i18n } from '../../../i18n'
import { emptyLabelKey } from '../../../modals/form/emptyLabel'
import { isEditableEntity } from '../../../state/operations/editable'
import { interpolate, interpolateRaw } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { aggregateEntities, useProperties } from '../../utils/properties'
import { view } from '../../view'
import CloseIcon from '../../workspace/CloseIcon.vue'
import AddIcon from '../../workspace/manager/icons/AddIcon.vue'
import { optionalFieldComponents } from '../../workspace/properties/fieldComponents'
import {
    brushFields,
    fieldLabel,
    pickBrush,
    propertyKinds,
    stageKinds,
    type BrushKey,
    type PropertyField,
} from '../../workspace/properties/fields'

provide(emptyLabelKey, () => i18n.value.modals.form.unset.unchanged)

const createModel = useProperties(brushProperties)
const models = Object.fromEntries(brushFields.map((field) => [field.key, createModel(field.key)]))

const root = useTemplateRef<HTMLElement>('root')

const available = (field: PropertyField) => isDynamicStages.value || !stageKinds.has(field.kind)

const isSet = (field: PropertyField & { key: BrushKey }) =>
    brushProperties.value[field.key] !== undefined

const byKind = (fields: (PropertyField & { key: BrushKey })[]) =>
    propertyKinds.flatMap((kind) => {
        const ofKind = fields.filter((field) => field.kind === kind)
        return ofKind.length ? [{ kind, fields: ofKind }] : []
    })

// Only properties in the brush are listed; the menu offers the rest.
const groups = computed(() => byKind(brushFields.filter(isSet)))
const menu = computed(() =>
    byKind(brushFields.filter((field) => !isSet(field) && available(field))),
)

const selection = computed(() => aggregateEntities(selectedEntities.value.filter(isEditableEntity)))

// Values the editor's view already suggests.
const fromView: Partial<Record<BrushKey, () => unknown>> = {
    groupId: () => view.groupId ?? defaultGroupId.value,
    stageId: () => view.stageId ?? defaultStageId.value,
    size: () => view.noteSize,
}

const initialValue = (field: PropertyField & { key: BrushKey }) => {
    // Start from the selection's value when it agrees, as Pick does.
    const picked = pickBrush(selection.value, isDynamicStages.value)[field.key]
    if (picked !== undefined) return picked
    return fromView[field.key]?.() ?? field.brush?.initial
}

const add = async (event: Event) => {
    const select = event.currentTarget as HTMLSelectElement
    const field = brushFields.find((field) => field.key === select.value)
    select.value = ''
    if (!field) return
    brushProperties.value = { ...brushProperties.value, [field.key]: initialValue(field) }
    await nextTick()
    root.value
        ?.querySelector<HTMLElement>(`[data-brush-key="${field.key}"] :is(input, select)`)
        ?.focus()
}

const remove = (key: BrushKey) => {
    const properties = { ...brushProperties.value }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete properties[key]
    brushProperties.value = properties
}

const pick = () => {
    brushProperties.value = pickBrush(selection.value, isDynamicStages.value)
    notify(
        interpolate(
            () => i18n.value.tools.brush.picked,
            `${Object.keys(brushProperties.value).length}`,
        ),
    )
}

const clear = () => {
    brushProperties.value = {}
}
</script>

<template>
    <div ref="root" class="contents">
        <div class="flex flex-wrap gap-2">
            <!-- A menu of the properties not in the brush, grouped by kind. -->
            <label
                class="brush-add relative flex min-w-0 flex-1 basis-36 items-center rounded-full bg-button shadow-md transition-colors focus-within:ring-2 focus-within:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:shadow-accent"
            >
                <AddIcon
                    class="pointer-events-none absolute left-3 size-3.5 fill-current"
                    aria-hidden="true"
                />
                <select
                    class="w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-transparent py-1 pl-8 pr-4 focus:outline-none [@media(pointer:coarse)]:py-2"
                    :aria-label="i18n.tools.brush.add"
                    @change="add"
                >
                    <option value="" disabled selected hidden>{{ i18n.tools.brush.add }}</option>
                    <optgroup
                        v-for="{ kind, fields } in menu"
                        :key="kind"
                        :label="i18n.tools.brush.kinds[kind]"
                        class="text-fg"
                    >
                        <option
                            v-for="field in fields"
                            :key="field.key"
                            :value="field.key"
                            class="text-fg"
                        >
                            {{ field.label(i18n) }}
                        </option>
                    </optgroup>
                </select>
            </label>
            <button
                type="button"
                class="brush-pick min-w-0 flex-1 basis-36 truncate rounded-full bg-button px-4 py-1 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:opacity-40 [@media(hover:hover)]:enabled:hover:shadow-accent [@media(pointer:coarse)]:py-2"
                :disabled="!selection.usage.size"
                @click="pick"
            >
                {{ i18n.tools.brush.pick }}
            </button>
            <button
                v-if="groups.length"
                type="button"
                class="brush-clear shrink-0 rounded-full px-4 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:bg-header-hover [@media(pointer:coarse)]:py-2"
                @click="clear"
            >
                {{ i18n.tools.brush.clear }}
            </button>
        </div>

        <p v-if="!groups.length" class="brush-empty text-fg/80">{{ i18n.tools.brush.empty }}</p>
        <section
            v-for="{ kind, fields } in groups"
            :key="kind"
            class="brush-group flex flex-col gap-3 border-t border-fg/15 pt-3"
            :aria-label="i18n.tools.brush.kinds[kind]"
        >
            <h3 class="text-xs font-bold text-fg/80">{{ i18n.tools.brush.kinds[kind] }}</h3>
            <div
                v-for="field in fields"
                :key="field.key"
                class="flex items-start gap-1"
                :data-brush-key="field.key"
            >
                <div class="flex min-w-0 flex-1 flex-col gap-3">
                    <component
                        :is="optionalFieldComponents[field.key]"
                        v-model="models[field.key]!.value"
                    />
                </div>
                <button
                    type="button"
                    class="brush-remove -mr-2 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:bg-header-hover [@media(pointer:coarse)]:size-11"
                    :aria-label="
                        interpolateRaw(i18n.tools.brush.remove, fieldLabel(field, i18n, true))
                    "
                    :title="interpolateRaw(i18n.tools.brush.remove, fieldLabel(field, i18n, true))"
                    @click="remove(field.key)"
                >
                    <CloseIcon class="size-3" />
                </button>
            </div>
        </section>
    </div>
</template>
