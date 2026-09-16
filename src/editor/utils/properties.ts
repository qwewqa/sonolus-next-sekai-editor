import { computed, onScopeDispose, provide, shallowRef, watch, type Ref } from 'vue'
import { state as historyState } from '../../history'
import { selectedEntities } from '../../history/selectedEntities'
import { numberEditKey } from '../../modals/form/numberEdit'
import { clearPreviewEdit, previewEdit, setPreviewEdit, type PreviewEdit } from '../../preview/edit'
import type { State } from '../../state'
import type { Entity, EntityType } from '../../state/entities'
import { entries } from '../../utils/object'
import {
    createEditedEntitiesState,
    editSelectedEditableEntities,
    type EditableObject,
} from '../sidebars/default'
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
            setPreviewEdit(current, () =>
                createEditedEntitiesState(current, current.selectedEntities, object, {
                    autoAddGroup: false,
                }),
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
            if (object) editSelectedEditableEntities(object)
        },
        cancel: (field) => {
            if (owner === field) reset()
        },
    })
    watch(historyState, reset, { flush: 'sync' })
    onScopeDispose(reset)

    const state = computed(() => {
        const model: Partial<T & EditableObject> = {}
        const types: Partial<Record<EntityType, boolean>> = {}
        const noteFields: Partial<NoteFields> = {}

        for (const entity of entities.value) {
            aggregate(model, entity)

            types[entity.type] = true

            if (entity.type === 'note') aggregate(noteFields, getNoteFields(entity))
        }

        return {
            model,
            types,
            noteFields,
        }
    })

    return {
        entities,
        types: computed(() => state.value.types),
        noteFields: computed(() => state.value.noteFields),
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
                    editSelectedEditableEntities({ [key]: value })
                },
            }),
    }
}

type DistributedKeyOf<T> = T extends T ? keyof T : never

const aggregate = <T extends object>(aggregate: Partial<T>, object: T) => {
    for (const [key, value] of entries(object)) {
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
