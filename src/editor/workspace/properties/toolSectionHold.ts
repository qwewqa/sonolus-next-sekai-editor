import { shallowRef } from 'vue'

/** Bumped as brushing changes the selection, so Properties keeps the Tool section in place. */
export const toolSectionHolds = shallowRef(0)

export const holdToolSection = () => {
    toolSectionHolds.value++
}
