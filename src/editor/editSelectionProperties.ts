import { computed, type Component } from 'vue'
import { selectedEntities } from '../history/selectedEntities'
import type { Entity } from '../state/entities'
import { isEditableEntity } from '../state/operations/editable'
import { isSidebarVisible, revealPropertiesSection, showPropertiesSection } from './sidebars'
import { showToolModal } from './toolModals'
import BpmPropertiesModal from './tools/bpm/BpmPropertiesModal.vue'
import CameraEventPropertiesModal from './tools/events/camera/CameraEventPropertiesModal.vue'
import StageMaskEventPropertiesModal from './tools/events/stage/mask/StageMaskEventPropertiesModal.vue'
import StagePivotEventPropertiesModal from './tools/events/stage/pivot/StagePivotEventPropertiesModal.vue'
import StageStyleEventPropertiesModal from './tools/events/stage/style/StageStyleEventPropertiesModal.vue'
import StageTransformEventPropertiesModal from './tools/events/stage/transform/StageTransformEventPropertiesModal.vue'
import NotePropertiesModal from './tools/note/NotePropertiesModal.vue'
import TimeScalePropertiesModal from './tools/timeScale/TimeScalePropertiesModal.vue'
import { isPanelEnabled } from './workspace'

const modals: Partial<Record<Entity['type'], Component>> = {
    note: NotePropertiesModal,
    bpm: BpmPropertiesModal,
    timeScale: TimeScalePropertiesModal,
    cameraEventJoint: CameraEventPropertiesModal,
    stageMaskEventJoint: StageMaskEventPropertiesModal,
    stagePivotEventJoint: StagePivotEventPropertiesModal,
    stageStyleEventJoint: StageStyleEventPropertiesModal,
    stageTransformEventJoint: StageTransformEventPropertiesModal,
}

/** The properties dialog for a selection of one editable type, if any. */
const selectionModal = computed(() => {
    const types = new Set(selectedEntities.value.filter(isEditableEntity).map(({ type }) => type))
    const [type] = types
    return types.size === 1 && type ? modals[type] : undefined
})

/**
 * Whether the selection's properties can be edited: in the visible Properties
 * panel, otherwise in its type's dialog, or for mixed types in the panel.
 */
export const canEditSelectionProperties = computed(
    () =>
        selectedEntities.value.some(isEditableEntity) &&
        (isSidebarVisible.value ||
            selectionModal.value !== undefined ||
            isPanelEnabled('properties')),
)

/**
 * Shows the selection's properties without changing them, following the rule
 * every command uses: the visible panel, else a dialog. Only the panel edits
 * mixed selections, so it is opened for them on this explicit request.
 */
export const editSelectionProperties = () => {
    const modal = selectionModal.value
    if (isSidebarVisible.value) revealPropertiesSection('selection')
    else if (modal) void showToolModal(modal, {})
    else showPropertiesSection('selection')
}
