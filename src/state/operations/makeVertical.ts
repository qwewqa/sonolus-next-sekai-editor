import type { State } from '..'
import type { Entity } from '../entities'
import { getMakeVerticalChanges } from './makeVerticalValues'
import { getMaterializedNotePositions } from './notePositions'
import { transformSelection } from './transformSelection'

export const makeVertical = (source: State, selected: Entity[]): State => {
    const changes = getMakeVerticalChanges(selected, source)
    if (!changes) return source
    const notes = [...changes.keys()].filter((entity) => entity.type === 'note')
    for (const [note, { left, size }] of getMaterializedNotePositions(source, notes)) {
        changes.set(note, { ...changes.get(note), left, size })
    }
    return transformSelection(source, selected, changes)
}
