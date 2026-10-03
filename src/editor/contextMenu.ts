import { shallowRef } from 'vue'
import { selectedEntities } from '../history/selectedEntities'
import { editorNavigation } from './navigation'
import { select } from './tools/select'
import { hitAllEntitiesAtPoint } from './tools/utils'

export const contextMenu = shallowRef<{ x: number; y: number }>()

export const closeContextMenu = () => {
    contextMenu.value = undefined
}

export const openContextMenu = (x: number, y: number) => {
    const hits = hitAllEntitiesAtPoint(x, y)
    if (
        !selectedEntities.value.length ||
        (hits.length && !hits.some((entity) => selectedEntities.value.includes(entity)))
    ) {
        if (editorNavigation.value) editorNavigation.value.selectPoint(x, y)
        else void select.tap?.(x, y, { ctrl: false, shift: false })
    }
    contextMenu.value = { x, y }
}
