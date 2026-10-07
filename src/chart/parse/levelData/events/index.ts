import type { LevelDataEntity } from '@sonolus/core'
import { getOptionalRef } from '..'

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
        if (visited.has(ref)) throw new Error(`Invalid level: cyclic event ref "${ref}"`)
        visited.add(ref)

        const entity = refs.get(ref)
        if (!entity) throw new Error(`Invalid level: ref "${ref}" not found`)

        objects.push(getObject(entity))

        ref = getOptionalRef(entity, 'next')
    }
}
