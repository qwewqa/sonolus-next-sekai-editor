import { computed, onScopeDispose, provide, shallowRef, watch, type Ref } from 'vue'
import { mergeEases, type Ease } from '../../ease'
import { state as historyState } from '../../history'
import { selectedEntities } from '../../history/selectedEntities'
import { store } from '../../history/store'
import { numberEditKey } from '../../modals/form/numberEdit'
import { clearPreviewEdit, previewEdit, setPreviewEdit, type PreviewEdit } from '../../preview/edit'
import type { State } from '../../state'
import type { Entity, EntityType } from '../../state/entities'
import type { EditableObject } from '../../state/operations/editable'
import {
    appliesToEditIn,
    fieldAppliesIn,
    noteFieldsApply,
} from '../../state/operations/properties/applicability'
import { planEdit } from '../../state/operations/properties/plan'
import { entries } from '../../utils/object'
import { editSelectedEditableEntities } from '../sidebars/default'
import { aggregateValues } from './aggregate'
import { getNoteFields, type NoteFields } from './noteFields'

export const useProperties =
    <T>(ref: Ref<T>) =>
    <K extends keyof T>(key: K) =>
        computed({
            get: () => ref.value[key],
            set: (value) => {
                const properties = { ...ref.value }
                if (value === undefined) {
                    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                    delete properties[key]
                } else {
                    properties[key] = value
                }
                ref.value = properties
            },
        })

export const useSelectedEntitiesProperties = <T extends Entity>(
    filter: (entity: Entity) => entity is T,
) => {
    const entities = computed(() => selectedEntities.value.filter(filter))
    const draft = shallowRef<EditableObject>()
    const revision = shallowRef(0)
    let owner: symbol | undefined
    let source: State | undefined
    let ownedPreview: PreviewEdit | undefined
    let previewing = false
    let valid = false

    const clearOwnedPreview = () => {
        if (ownedPreview && previewEdit.value === ownedPreview) clearPreviewEdit()
        ownedPreview = undefined
    }
    const reset = () => {
        clearOwnedPreview()
        owner = undefined
        source = undefined
        draft.value = undefined
        valid = false
        revision.value++
    }

    provide(numberEditKey, {
        revision,
        preview: (field, update) => {
            if (owner !== undefined && owner !== field) reset()
            owner = field
            source ??= historyState.value
            valid = true
            previewing = true
            try {
                update()
            } finally {
                previewing = false
            }
            const object = draft.value
            if (!object) return
            const current = source
            // The preview is exactly what the commit will do.
            setPreviewEdit(
                current,
                () =>
                    planEdit(current, current.selectedEntities, object, {
                        autoAddGroup: false,
                        only: appliesToEditIn(current.store, object),
                    }).state,
            )
            ownedPreview = previewEdit.value
        },
        invalidate: (field) => {
            if (owner !== field) return
            valid = false
            clearOwnedPreview()
        },
        commit: (field) => {
            if (owner !== field) return
            const object = valid && source === historyState.value ? draft.value : undefined
            reset()
            if (object) editSelectedEditableEntities(object, appliesToEdit(object))
        },
        cancel: (field) => {
            if (owner === field) reset()
        },
    })
    watch(historyState, reset, { flush: 'sync' })
    onScopeDispose(reset)

    const state = computed(() => aggregateEntities(entities.value))

    return {
        entities,
        types: computed(() => state.value.types),
        noteFields: computed(() => state.value.noteFields),
        usage: computed(() => state.value.usage),
        createModel: <K extends DistributedKeyOf<T> & keyof EditableObject>(key: K) =>
            computed({
                get: () => draft.value?.[key] ?? state.value.model[key],
                set: (value) => {
                    if (value === undefined) return

                    if (previewing && source) {
                        if (state.value.model[key] === value) {
                            draft.value = undefined
                            clearOwnedPreview()
                            return
                        }
                        draft.value = { [key]: value }
                        return
                    }

                    reset()
                    const object = { [key]: value }
                    editSelectedEditableEntities(object, appliesToEdit(object))
                },
            }),
        createEaseModel: <K extends 'connectorEase' | 'eventEase' | 'timeScaleEase'>(key: K) =>
            computed({
                get: () =>
                    mergeEases(
                        entities.value.flatMap((entity) =>
                            fieldApplies(entity, key)
                                ? [entity[key as never] as EditableEase<K>]
                                : [],
                        ),
                    ),
                set: (value) => {
                    if (value === undefined) return

                    reset()
                    const object = { [key]: value }
                    editSelectedEditableEntities(object, appliesToEdit(object))
                },
            }),
    }
}

type EditableEase<K extends keyof EditableObject> = Extract<
    Exclude<EditableObject[K], undefined>,
    Ease
>

type DistributedKeyOf<T> = T extends T ? keyof T : never

/** Whether an object uses a property; a tail's connector or an attached tick's lane is unused. */
export const fieldApplies = (entity: Entity, key: string) =>
    fieldAppliesIn(store.value, entity, key)

/** Selected objects an edit writes to: those using one of its properties. */
export const appliesToEdit = (object: EditableObject) => appliesToEditIn(store.value, object)

export const aggregateEntities = (entities: readonly Entity[]) => {
    const types: Partial<Record<EntityType, boolean>> = {}
    const noteFields: Partial<NoteFields> = {}
    const noteFieldsOf = new Map<Entity, NoteFields>()

    for (const entity of entities) {
        types[entity.type] = true
        if (entity.type !== 'note') continue

        const fields = getNoteFields(entity)
        noteFieldsOf.set(entity, fields)
        aggregate(noteFields, fields)
    }

    // A note's value for a field hidden for it is unused, so it cannot make the field mixed.
    const { model, usage } = aggregateValues(entities, (entity) => {
        const fields = noteFieldsOf.get(entity)
        return fields ? noteFieldsApply(fields) : () => true
    })

    return { model: model as Partial<EditableObject>, usage, types, noteFields }
}

const aggregate = <T extends object>(
    aggregate: Partial<T>,
    object: T,
    include?: (key: keyof T) => boolean,
) => {
    for (const [key, value] of entries(object)) {
        if (include && !include(key)) continue

        if (key in aggregate) {
            if (aggregate[key] === undefined) continue

            if (aggregate[key] !== value) {
                aggregate[key] = undefined
            }
        } else {
            aggregate[key] = value
        }
    }
}
