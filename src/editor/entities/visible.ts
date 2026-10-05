import { computed } from 'vue'
import { keys } from '..'
import { beatToTime } from '../../state/integrals/bpms'
import { computedArray } from '../../utils/array'
import { cullAllSceneEntities, sceneBpms, sceneState } from '../sceneState'
import { scopeLookup } from '../scope'
import { entityScopeVisibility } from '../scopeRules'
import { ups, view, viewBox } from '../view'
import { isHitboxInView } from './visibility'

export const culledEntities = computedArray(() => [
    ...cullAllSceneEntities(keys.value.min, keys.value.max),
])

export const selectedEntitySet = computed(() => new Set(sceneState.value.selectedEntities))

// Selection outlines follow drawing: dimmed groups/stages keep their outline,
// hidden ones are never outlined (and are deselected by the controls).
export const visibleSelectedEntities = computedArray(() => {
    const selected = selectedEntitySet.value
    if (!selected.size) return []

    const scope = scopeLookup.value

    const bounds = viewBox.value
    // The outline has a 2px non-scaling stroke centered on its rectangle.
    const strokePadding = view.w > 0 ? bounds.w / view.w : 0
    const unitsPerSecond = ups.value
    const integrals = sceneBpms.value

    return culledEntities.value.filter(
        (entity) =>
            selected.has(entity) &&
            entity.hitbox &&
            entityScopeVisibility(entity, scope) !== 'hidden' &&
            isHitboxInView(
                entity.hitbox,
                beatToTime(integrals, entity.hitbox.beat) * unitsPerSecond,
                bounds,
                strokePadding,
            ),
    )
})
