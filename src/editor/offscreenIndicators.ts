import { onUnmounted, shallowRef } from 'vue'
import { replaceState, state } from '../history'
import { i18n } from '../i18n'
import type { NoteEntity } from '../state/entities/slides/note'
import { interpolate } from '../utils/interpolate'
import type { Modifiers } from './controls/gestures/pointer'
import { editorNavigation, type EditorNavigation } from './navigation'
import { notify } from './notification'
import { combineSelection, hitOffscreenGroup, type OffscreenNoteGroup } from './offscreenNotes'
import { modifyEntities } from './tools/utils'
import { view } from './view'

type IndicatorLayer = {
    navigation: () => EditorNavigation | undefined
    bounds: () => { x: number; y: number; w: number }
    groups: () => OffscreenNoteGroup<NoteEntity>[]
}

const layers = shallowRef<IndicatorLayer[]>([])

// A pane's off-screen badges, hit-tested by the select tools while it is active.
export const useOffscreenIndicators = (layer: IndicatorLayer) => {
    layers.value = [...layers.value, layer]
    onUnmounted(() => {
        layers.value = layers.value.filter((item) => item !== layer)
    })
}

/** The active pane's badge with selectable notes at a client point. */
export const hitOffscreenIndicator = (x: number, y: number) => {
    for (const layer of layers.value) {
        if (layer.navigation() !== editorNavigation.value) continue
        const bounds = layer.bounds()
        const group = hitOffscreenGroup(layer.groups(), x - bounds.x, y - bounds.y, bounds.w)
        if (group) return group
    }
}

export const selectOffscreenNotes = (notes: NoteEntity[], modifiers: Modifiers) => {
    const entities = modifyEntities(notes, modifiers)
    const targets = combineSelection(state.value.selectedEntities, entities, modifiers.ctrl)

    replaceState({
        ...state.value,
        selectedEntities: targets,
    })
    view.entities = {
        hovered: entities,
        creating: [],
    }

    notify(interpolate(() => i18n.value.tools.select.selected, `${targets.length}`))
}
