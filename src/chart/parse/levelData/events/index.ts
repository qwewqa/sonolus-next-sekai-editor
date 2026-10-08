import type { LevelDataEntity } from '@sonolus/core'
import { getOptionalRef } from '..'
import { ImportRefusal } from '../../../refusal'

export const getEventRefs = (entities: LevelDataEntity[], archetype: string) => {
    const refs = new Map<string, LevelDataEntity>()

    for (const entity of entities) {
        if (entity.archetype !== archetype) continue
        if (!entity.name) continue

        refs.set(entity.name, entity)
    }

    return refs
}

export const parseEvents = <T>(
    refs: Map<string, LevelDataEntity>,
    firstRef: string,
    objects: T[],
    getObject: (entity: LevelDataEntity) => NoInfer<T>,
) => {
    const visited = new Set<string>()
    let ref: string | undefined = firstRef
    while (ref) {
        if (visited.has(ref)) throw new ImportRefusal('cyclicEventRef', ref)
        visited.add(ref)

        const entity = refs.get(ref)
        if (!entity) throw new ImportRefusal('refNotFound', ref)

        objects.push(getObject(entity))

        ref = getOptionalRef(entity, 'next')
    }
}
