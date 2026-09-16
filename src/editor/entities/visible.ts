import { computed } from 'vue'
import { beats, keys } from '..'
import { bpms } from '../../history/bpms'
import { selectedEntities } from '../../history/selectedEntities'
import { cullAllEntities } from '../../history/store'
import { beatToTime } from '../../state/integrals/bpms'
import { computedArray } from '../../utils/array'
import { ups, view, viewBox } from '../view'
import { computedVisibleEntities, isHitboxInView } from './visibility'

const culledEntities = computedArray(() => [...cullAllEntities(keys.value.min, keys.value.max)])

export const selectedEntitySet = computed(() => new Set(selectedEntities.value))

// Preserve the array when scrolling does not change its members. This keeps the
// entity sort and Vue component tree out of the per-frame scroll path.
export const visibleEntities = computedVisibleEntities(
    () => culledEntities.value,
    () => beats.value,
)

export const visibleSelectedEntities = computedArray(() => {
    const selected = selectedEntitySet.value
    if (!selected.size) return []

    const bounds = viewBox.value
    // The outline has a 2px non-scaling stroke centered on its rectangle.
    const strokePadding = view.w > 0 ? bounds.w / view.w : 0
    const unitsPerSecond = ups.value
    const integrals = bpms.value

    return culledEntities.value.filter(
        (entity) =>
            selected.has(entity) &&
            entity.hitbox &&
            isHitboxInView(
                entity.hitbox,
                beatToTime(integrals, entity.hitbox.beat) * unitsPerSecond,
                bounds,
                strokePadding,
            ),
    )
})
