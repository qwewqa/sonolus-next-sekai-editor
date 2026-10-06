<script setup lang="ts">
import { computed, nextTick, provide, shallowRef, useTemplateRef } from 'vue'
import { brushProperties } from '.'
import { isDynamicStages } from '../../../history/dynamicStages.ts'
import { defaultGroupId } from '../../../history/groups'
import { selectedEntities } from '../../../history/selectedEntities'
import { defaultStageId } from '../../../history/stages'
import { i18n } from '../../../i18n'
import { modals } from '../../../modals'
import { emptyLabelKey, unsetChoiceKey } from '../../../modals/form/emptyLabel'
import { isEditableEntity } from '../../../state/operations/editable'
import { interpolate, interpolateRaw } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { aggregateEntities } from '../../utils/properties'
import { view } from '../../view'
import CloseIcon from '../../workspace/CloseIcon.vue'
import AddIcon from '../../workspace/manager/icons/AddIcon.vue'
import ManagerMenu, { type ManagerMenuItem } from '../../workspace/manager/ManagerMenu.vue'
import { optionalFieldComponents } from '../../workspace/properties/fieldComponents'
import {
    brushFields,
    fieldLabel,
    isBrushAvailable,
    pickBrush,
    propertyKinds,
    type BrushKey,
    type PropertyField,
} from '../../workspace/properties/fields'

provide(emptyLabelKey, () => i18n.value.modals.form.unset.unchanged)
// Rows leave the brush through their remove button.
provide(unsetChoiceKey, false)

// A blank entry is rejected and reverts; rows leave only through their remove button.
const createModel = (key: BrushKey) =>
    computed({
        get: () => brushProperties.value[key],
        set: (value) => {
            if (value !== undefined)
                brushProperties.value = { ...brushProperties.value, [key]: value }
        },
    })
const models = Object.fromEntries(brushFields.map((field) => [field.key, createModel(field.key)]))

const root = useTemplateRef<HTMLElement>('root')
const addButton = useTemplateRef<HTMLButtonElement>('addButton')

const available = (field: PropertyField) => isBrushAvailable(field, isDynamicStages.value)

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

// Aggregated only when used, so selecting stays cheap while the brush shows.
const selection = computed(() => aggregateEntities(selectedEntities.value.filter(isEditableEntity)))
const canPick = computed(() => selectedEntities.value.some(isEditableEntity))

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

// Add Property opens a menu of the properties not in the brush, under their kinds.
const addMenu = shallowRef<{ modals: number }>()
const addItems = computed((): ManagerMenuItem[] => {
    const items: ManagerMenuItem[] = []
    for (const { kind, fields } of menu.value)
        for (const field of fields)
            items.push({
                key: field.key,
                label: field.label(i18n.value),
                group: i18n.value.tools.brush.kinds[kind],
            })
    return items
})

const toggleAddMenu = () => {
    addMenu.value = addMenu.value ? undefined : { modals: modals.length }
}

const closeAddMenu = (restoreFocus: boolean) => {
    const current = addMenu.value
    if (!current) return
    addMenu.value = undefined
    // Never take focus from a dialog that opened meanwhile.
    if (restoreFocus && modals.length <= current.modals) addButton.value?.focus()
}

const add = async (key: string) => {
    addMenu.value = undefined
    const field = brushFields.find((field) => field.key === key)
    if (!field) return
    brushProperties.value = { ...brushProperties.value, [field.key]: initialValue(field) }
    await nextTick()
    root.value
        ?.querySelector<HTMLElement>(`[data-brush-key="${field.key}"] :is(input, select)`)
        ?.focus()
}

const remove = async (key: BrushKey, event: MouseEvent) => {
    const properties = { ...brushProperties.value }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete properties[key]
    brushProperties.value = properties
    // Keyboard removal moves on to the next row, or to Add Property.
    if (event.detail > 0) return
    const rows = [...(root.value?.querySelectorAll<HTMLElement>('[data-brush-key]') ?? [])]
    const index = rows.findIndex((row) => row.dataset.brushKey === key)
    const next = rows[index + 1] ?? rows[index - 1]
    await nextTick()
    const target = next?.isConnected
        ? next.querySelector<HTMLElement>('input, select')
        : addButton.value
    target?.focus()
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
            <!-- A menu of the properties not in the brush, grouped by kind, on its own row
            so its label fits; Pick and Clear share the next. -->
            <button
                ref="addButton"
                type="button"
                class="brush-add flex min-w-0 basis-full items-center gap-2.5 rounded-full py-1 pl-3 pr-4 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:opacity-40 [@media(hover:hover)]:enabled:hover:shadow-accent [@media(pointer:coarse)]:py-2"
                :class="addMenu ? 'bg-accent text-on-accent' : 'bg-button'"
                :title="i18n.tools.brush.add"
                aria-haspopup="menu"
                :aria-expanded="addMenu ? 'true' : 'false'"
                :disabled="!addItems.length"
                @click="toggleAddMenu"
                @keydown.down.prevent.stop="addMenu ??= { modals: modals.length }"
            >
                <AddIcon class="size-3.5 shrink-0 fill-current" aria-hidden="true" />
                <span class="min-w-0 truncate">{{ i18n.tools.brush.add }}</span>
            </button>
            <ManagerMenu
                v-if="addMenu && addButton"
                :anchor="addButton"
                :label="i18n.tools.brush.add"
                :items="addItems"
                @select="add"
                @close="closeAddMenu"
            />
            <button
                type="button"
                class="brush-pick min-w-0 flex-[1_0_auto] truncate rounded-full bg-button px-4 py-1 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent disabled:opacity-40 [@media(hover:hover)]:enabled:hover:shadow-accent [@media(pointer:coarse)]:py-2"
                :disabled="!canPick"
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

        <section
            v-for="{ kind, fields } in groups"
            :key="kind"
            class="brush-group flex flex-col gap-3 border-t border-fg/15 pt-3"
            :aria-label="i18n.tools.brush.kinds[kind]"
        >
            <h3 class="text-sm font-bold">{{ i18n.tools.brush.kinds[kind] }}</h3>
            <!-- Fields measure the full row, as elsewhere in the panel, so their columns
            line up; remove sits at the end of the label column. -->
            <div
                v-for="field in fields"
                :key="field.key"
                class="brush-row relative flex flex-col gap-3"
                :data-brush-key="field.key"
            >
                <component
                    :is="optionalFieldComponents[field.key]"
                    v-model="models[field.key]!.value"
                />
                <button
                    type="button"
                    class="brush-remove absolute flex size-8 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:bg-header-hover [@media(pointer:coarse)]:size-11"
                    :aria-label="
                        interpolateRaw(i18n.tools.brush.remove, fieldLabel(field, i18n, true))
                    "
                    :title="interpolateRaw(i18n.tools.brush.remove, fieldLabel(field, i18n, true))"
                    @click="remove(field.key, $event)"
                >
                    <CloseIcon class="size-3" />
                </button>
            </div>
        </section>
    </div>
</template>

<style scoped>
/*
 * Remove ends the label column, which BaseField sizes from the field's width.
 * --label-w repeats that rule per layout, on the descendants, since a container
 * query never styles its own container. The glyph centre sits 1.25rem before
 * the column ends; labels keep clear of it.
 */
.brush-row {
    container-type: inline-size;
    --remove-size: 2rem;
    --remove-room: calc(1.25rem + var(--remove-size) / 2);
}

@media (pointer: coarse) {
    .brush-row {
        --remove-size: 2.75rem;
    }
}

.brush-remove {
    inset-block: 0;
    margin-block: auto;
}

/* An ease brings two fields; remove belongs to the first. */
.brush-row:has(> .form-field + .form-field) .brush-remove {
    inset-block: auto;
    top: calc(1rem - var(--remove-size) / 2);
    margin-block: 0;
}

@container (min-width: 13.5rem) {
    .brush-remove {
        left: calc(var(--label-w) - var(--remove-room));
    }

    .brush-row :deep(.form-field-label) {
        padding-right: var(--remove-room);
    }
}

@container (min-width: 19rem) {
    .brush-remove,
    .brush-row :deep(.form-field-label) {
        --label-w: min(max(calc(45cqw - 0.375rem), 11rem), calc(100cqw - 10rem));
    }
}

@container (min-width: 32rem) {
    .brush-remove,
    .brush-row :deep(.form-field-label) {
        --label-w: 60cqw;
    }
}

@container (min-width: 13.5rem) and (max-width: 18.99rem) {
    .brush-remove,
    .brush-row :deep(.form-field-label) {
        --label-w: calc(100cqw - max(6.25rem, 50cqw) - 0.5rem);
    }
}

/* Stacked: remove ends the label line, which keeps clear of it. */
@container (max-width: 13.49rem) {
    .brush-remove {
        inset-block: auto;
        top: calc(0.625rem - var(--remove-size) / 2);
        right: calc(0.75rem - var(--remove-size) / 2);
        margin-block: 0;
    }

    .brush-row :deep(.form-field-label) {
        padding-right: var(--remove-room);
    }
}
</style>
