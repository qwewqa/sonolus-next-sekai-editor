import type { Tool } from '..'
import type { GroupId } from '../../../chart/groups'
import type { TimeScaleObject } from '../../../chart/timeScale'
import type { WithEaseEdits } from '../../../ease'
import { pushState, replaceState, state } from '../../../history'
import { defaultGroupId } from '../../../history/groups'
import { selectedEntities } from '../../../history/selectedEntities'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../../preview/edit'
import type { Entity } from '../../../state/entities'
import { toTimeScaleEntity, type TimeScaleEntity } from '../../../state/entities/timeScale'
import { addTimeScale } from '../../../state/mutations/timeScale'
import {
    editTimeScale as applyTimeScaleEdit,
    editSelectedTimeScale,
} from '../../../state/operations/timeScale'
import { getInStoreGrid } from '../../../state/store/grid'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { revealSelectionProperties } from '../../editSelectionProperties'
import { constrainLaneObject } from '../../laneLimits'
import { notify } from '../../notification'
import { revealAuthoringTarget } from '../../scope'
import { isSidebarVisible, revealPropertiesSection } from '../../sidebars'
import { showToolModal } from '../../toolModals'
import {
    focusEntityAtBeat,
    setViewHover,
    snapYToBeat,
    view,
    xToValidLane,
    yToValidBeat,
} from '../../view'
import SelectionPropertiesModal from '../../workspace/properties/SelectionPropertiesModal.vue'
import { hitEntitiesAtPoint, isVisible } from '../utils'

let active:
    | {
          type: 'add'
      }
    | {
          type: 'move'
          entity: TimeScaleEntity
      }
    | undefined

export const timeScale: Tool = {
    title: () => i18n.value.tools.timeScale.title,

    hover(x, y) {
        const [entity, beat, lane] = tryFind(x, y)
        if (entity) {
            view.entities = {
                hovered: [entity],
                creating: [],
            }
        } else {
            view.entities = {
                hovered: [],
                creating: [
                    toTimeScaleEntity(
                        constrainLaneObject({
                            groupId: view.groupId ?? defaultGroupId.value,
                            beat,
                            editorLane: lane,
                            timeScale: 1,
                            skip: 0,
                            timeScaleEase: 'none',
                            timeScaleTransition: 'timeScale',
                            hideNotes: false,
                        }),
                    ),
                ],
            }
        }
    },

    tap(x, y, modifiers) {
        const [entity, beat, lane] = tryFind(x, y)
        if (entity) {
            if (modifiers.ctrl) {
                const selectedTimeScaleEntities: Entity[] = selectedEntities.value.filter(
                    (entity) => entity.type === 'timeScale',
                )

                const targets = selectedTimeScaleEntities.includes(entity)
                    ? selectedTimeScaleEntities.filter((e) => e !== entity)
                    : [...selectedTimeScaleEntities, entity]

                replaceState({
                    ...state.value,
                    selectedEntities: targets,
                })
                view.entities = {
                    hovered: [],
                    creating: [],
                }
                focusEntityAtBeat(entity.beat)

                notify(interpolate(() => i18n.value.tools.timeScale.selected, `${targets.length}`))
            } else {
                if (selectedEntities.value.includes(entity)) {
                    focusEntityAtBeat(entity.beat)

                    if (isSidebarVisible.value) {
                        // An explicit edit gesture on the selection shows its properties.
                        revealPropertiesSection('selection')
                        editMoveOrReplace(
                            entity,
                            constrainLaneObject({
                                groupId: entity.groupId,
                                beat: entity.beat,
                                editorLane: entity.editorLane,
                                timeScale: entity.timeScale,
                                skip: entity.skip,
                                timeScaleTransition: entity.timeScaleTransition,
                                // A tap toggles hiding notes and keeps the ease.
                                timeScaleEase: entity.timeScaleEase,
                                hideNotes: !entity.hideNotes,
                            }),
                        )
                    } else {
                        void showToolModal(SelectionPropertiesModal, { kind: 'timeScale' })
                    }
                } else {
                    replaceState({
                        ...state.value,
                        selectedEntities: [entity],
                    })
                    view.entities = {
                        hovered: [],
                        creating: [],
                    }
                    focusEntityAtBeat(entity.beat)

                    notify(interpolate(() => i18n.value.tools.timeScale.selected, '1'))
                }
            }
        } else {
            const object: TimeScaleObject = constrainLaneObject({
                groupId: view.groupId ?? defaultGroupId.value,
                beat,
                editorLane: lane,
                timeScale: 1,
                skip: 0,
                timeScaleEase: 'none',
                timeScaleTransition: 'timeScale',
                hideNotes: false,
            })

            // Reveal first: the placement may replace a time scale in its target group.
            revealAuthoringTarget(object)
            const overlap = find(object.groupId, object.beat)
            if (overlap) {
                edit(overlap, object)
            } else {
                add(object)
            }
            focusEntityAtBeat(object.beat)

            void revealSelectionProperties()
        }
    },

    cursor: (x, y) => (tryFind(x, y)[0] ? 'move' : 'crosshair'),

    dragStart(x, y) {
        const [entity, beat] = tryFind(x, y)
        if (entity) {
            replaceState({
                ...state.value,
                selectedEntities: [entity],
            })
            view.entities = {
                hovered: [],
                creating: [],
            }
            focusEntityAtBeat(entity.beat)

            notify(interpolate(() => i18n.value.tools.timeScale.moving, '1'))

            active = {
                type: 'move',
                entity,
            }
        } else {
            focusEntityAtBeat(beat)

            notify(interpolate(() => i18n.value.tools.timeScale.adding, '1'))

            active = {
                type: 'add',
            }
        }

        return true
    },

    dragUpdate(x, y) {
        if (!active) return

        setViewHover(y)

        const lane = xToValidLane(x)

        switch (active.type) {
            case 'add': {
                const [entity, beat] = tryFind(x, y)
                if (entity) {
                    view.entities = {
                        hovered: [entity],
                        creating: [],
                    }
                    focusEntityAtBeat(entity.beat)
                } else {
                    view.entities = {
                        hovered: [],
                        creating: [
                            toTimeScaleEntity(
                                constrainLaneObject({
                                    groupId: view.groupId ?? defaultGroupId.value,
                                    beat,
                                    editorLane: lane,
                                    timeScale: 1,
                                    skip: 0,
                                    timeScaleEase: 'none',
                                    timeScaleTransition: 'timeScale',
                                    hideNotes: false,
                                }),
                            ),
                        ],
                    }
                    focusEntityAtBeat(beat)
                }
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)
                const object: TimeScaleObject = constrainLaneObject({
                    groupId: active.entity.groupId,
                    beat,
                    editorLane: lane,
                    timeScale: active.entity.timeScale,
                    skip: active.entity.skip,
                    timeScaleEase: active.entity.timeScaleEase,
                    timeScaleTransition: active.entity.timeScaleTransition,
                    hideNotes: active.entity.hideNotes,
                })

                view.entities = {
                    hovered: [],
                    creating: [toTimeScaleEntity(object)],
                }
                previewMove(active.entity, object)
                focusEntityAtBeat(beat)
                break
            }
        }
    },

    dragEnd(x, y) {
        clearPreviewEdit()
        if (!active) return

        const lane = xToValidLane(x)

        switch (active.type) {
            case 'add': {
                const [entity, beat] = tryFind(x, y)
                if (entity) {
                    replaceState({
                        ...state.value,
                        selectedEntities: [entity],
                    })
                    view.entities = {
                        hovered: [],
                        creating: [],
                    }
                    focusEntityAtBeat(entity.beat)

                    void revealSelectionProperties()
                } else {
                    const object: TimeScaleObject = constrainLaneObject({
                        groupId: view.groupId ?? defaultGroupId.value,
                        beat,
                        editorLane: lane,
                        timeScale: 1,
                        skip: 0,
                        timeScaleEase: 'none',
                        timeScaleTransition: 'timeScale',
                        hideNotes: false,
                    })

                    // Reveal first: the placement may replace a time scale in its target group.
                    revealAuthoringTarget(object)
                    const overlap = find(object.groupId, object.beat)
                    if (overlap) {
                        edit(overlap, object)
                    } else {
                        add(object)
                    }
                    focusEntityAtBeat(object.beat)

                    void revealSelectionProperties()
                }
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)

                editMoveOrReplace(
                    active.entity,
                    constrainLaneObject({
                        groupId: active.entity.groupId,
                        beat,
                        editorLane: lane,
                        timeScale: active.entity.timeScale,
                        skip: active.entity.skip,
                        timeScaleEase: active.entity.timeScaleEase,
                        timeScaleTransition: active.entity.timeScaleTransition,
                        hideNotes: active.entity.hideNotes,
                    }),
                )
                focusEntityAtBeat(beat)
                break
            }
        }

        active = undefined
    },

    dragCancel() {
        clearPreviewEdit()
        active = undefined
    },
}

export const editTimeScale = (
    entity: TimeScaleEntity,
    object: Partial<WithEaseEdits<TimeScaleObject>>,
) => {
    editMoveOrReplace(entity, object)
}

// Data-level lookup. A time scale created at an occupied beat of its own group
// replaces the existing one, so a group never holds two time scales at one
// beat; placement reveals the target group first, so the replaced time scale
// is always visible. The nearest-object fallback only offers fully visible
// time scales.
const find = (
    groupId: GroupId | undefined,
    beat: number,
    filter: (entity: TimeScaleEntity) => boolean = () => true,
) =>
    getInStoreGrid(store.value.grid, 'timeScale', beat)?.find(
        (entity) =>
            entity.beat === beat &&
            (groupId === undefined || entity.groupId === groupId) &&
            filter(entity),
    )

const tryFind = (x: number, y: number): [TimeScaleEntity] | [undefined, number, number] => {
    const [hit] = hitEntitiesAtPoint('timeScale', x, y).sort(
        (a, b) => +selectedEntities.value.includes(b) - +selectedEntities.value.includes(a),
    )
    if (hit) return [hit]

    const beat = yToValidBeat(y)
    const nearest = find(view.groupId, beat, isVisible)
    if (nearest) return [nearest]

    return [undefined, beat, xToValidLane(x)]
}

const previewMove = (entity: TimeScaleEntity, object: TimeScaleObject) => {
    const source = state.value
    setPreviewEdit(source, () => {
        const transaction = createTransaction(source, { autoAddGroup: false })
        return transaction.commit(applyTimeScaleEdit(transaction, entity, object))
    }, [entity, object.beat, object.editorLane])
}

const editMoveOrReplace = (
    entity: TimeScaleEntity,
    object: Partial<WithEaseEdits<TimeScaleObject>>,
) => {
    const beat = object.beat ?? entity.beat
    const message =
        entity.beat === beat
            ? 'edited'
            : find(object.groupId ?? entity.groupId, beat)
              ? 'replaced'
              : 'moved'
    update(
        () => i18n.value.tools.timeScale[message],
        (transaction) => applyTimeScaleEdit(transaction, entity, object),
    )
    if (entity.beat !== beat) focusEntityAtBeat(beat)
}

const update = (message: () => string, action: (transaction: Transaction) => Entity[]) => {
    const transaction = createTransaction(state.value)

    const selectedEntities = action(transaction)

    pushState(
        interpolate(message, `${selectedEntities.length}`),
        transaction.commit(selectedEntities),
    )
    view.entities = {
        hovered: [],
        creating: [],
    }

    notify(interpolate(message, `${selectedEntities.length}`))
}

const add = (object: TimeScaleObject) => {
    // Authoring reveals its target so the new object never vanishes.
    revealAuthoringTarget(object)
    update(
        () => i18n.value.tools.timeScale.added,
        (transaction) => {
            return addTimeScale(transaction, object)
        },
    )
}

const edit = (entity: TimeScaleEntity, object: TimeScaleObject) => {
    update(
        () => i18n.value.tools.timeScale.edited,
        (transaction) => editSelectedTimeScale(transaction, entity, object),
    )
}
