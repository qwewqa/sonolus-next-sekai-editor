import { shallowRef } from 'vue'
import { settings } from '../settings'
import type { Entity } from '../state/entities'
import type { Modifiers } from './controls/gestures/pointer'

export type EditorNavigation = {
    bounds: { x: number; y: number; w: number; h: number }
    scrollY: (pixels: number) => void
    getScaleX?: () => number
    getScaleY: () => number
    setScaleY: (scale: number) => void
    hitPoint: (x: number, y: number, minimumNoteWidth: number) => Entity[]
    selectPoint: (x: number, y: number) => void
    positionAtPoint: (x: number, y: number) => { lane: number; beat: number; elevation: number }
    pasteAtPoint: (x: number, y: number, modifiers: Modifiers) => Promise<boolean>
}

export const editorNavigation = shallowRef<EditorNavigation>()
export const getControlBounds = (fallback: EditorNavigation['bounds']) =>
    editorNavigation.value?.bounds ?? fallback
export const getVerticalScale = () => editorNavigation.value?.getScaleY() ?? settings.pps
export const setVerticalScale = (scale: number) => {
    if (editorNavigation.value) editorNavigation.value.setScaleY(scale)
    else settings.pps = scale
}
