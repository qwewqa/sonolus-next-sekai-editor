import type { Entity } from '../../entities'
import type { Store } from '../../store'
import type { EditableObject } from '../editable'
import { getNoteFieldsIn, type NoteFields } from './noteFields'

/** Keys whose edits also set another key, so they must reach its objects too. */
const coupledKeys: Partial<Record<keyof EditableObject, (keyof EditableObject)[]>> = {
    isFake: ['connectorIsFake'],
    isCritical: ['connectorActiveIsCritical'],
}

export const noteFieldsApply = (fields: NoteFields) => (key: string) =>
    !(key in fields) || fields[key as keyof NoteFields]

/** Which of its keys an object uses; a tail's connector or an attached tick's lane is unused. */
const appliesIn = (store: Store, entity: Entity) =>
    entity.type === 'note' ? noteFieldsApply(getNoteFieldsIn(store, entity)) : () => true

export const fieldAppliesIn = (store: Store, entity: Entity, key: string) =>
    key in entity && appliesIn(store, entity)(key)

/** Selected objects an edit writes to: those using one of its properties. */
export const appliesToEditIn = (store: Store, object: EditableObject) => {
    const keys = Object.keys(object).flatMap((key) => [
        key,
        ...(coupledKeys[key as keyof EditableObject] ?? []),
    ])
    return (entity: Entity) => {
        const applies = appliesIn(store, entity)
        return keys.some((key) => key in entity && applies(key))
    }
}
