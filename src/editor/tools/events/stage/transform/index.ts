import { ref } from 'vue'
import type { Tool } from '../../..'
import type { Anchor, StageTransformEventObject } from '../../../../../chart/events/stage/transform'
import { applyEaseEdit, cycleEase, type EaseEdit, type WithEaseEdits } from '../../../../../ease'
import { pushState, replaceState, state } from '../../../../../history'
import { selectedEntities } from '../../../../../history/selectedEntities'
import { defaultStageId } from '../../../../../history/stages'
import { i18n } from '../../../../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../../../../preview/edit'
import type { Entity } from '../../../../../state/entities'
import {
    toStageTransformEventJointEntity,
    type StageTransformEventJointEntity,
} from '../../../../../state/entities/events/joints/stage/transform'
import { addStageTransformEventJoint } from '../../../../../state/mutations/events/stage/transform'
import { editSelectedStageTransformEvent } from '../../../../../state/operations/events/stage/transform'
import { createTransaction, type Transaction } from '../../../../../state/transaction'
import { interpolate } from '../../../../../utils/interpolate'
import { constrainLaneObject } from '../../../../laneLimits'
import { notify } from '../../../../notification'
import { revealAuthoringTarget } from '../../../../scope'
import { isSidebarVisible, revealPropertiesSection } from '../../../../sidebars'
import { showToolModal } from '../../../../toolModals'
import {
    focusEntityAtBeat,
    setViewHover,
    snapYToBeat,
    view,
    xToValidLane,
    yToValidBeat,
} from '../../../../view'
import SelectionPropertiesModal from '../../../../workspace/properties/SelectionPropertiesModal.vue'
import { hitEntitiesAtPoint } from '../../../utils'
import StageTransformEventSidebar from './StageTransformEventSidebar.vue'

type DefaultStageTransformEventProperties = {
    rotation?: number
    yTranslation?: number
    elevation?: number
    anchor?: Anchor
    eventEase?: EaseEdit
    copyProperties: boolean
}

export const defaultStageTransformEventProperties = ref<DefaultStageTransformEventProperties>({
    copyProperties: true,
})

let active:
    | {
          type: 'add'
      }
    | {
          type: 'move'
          entity: StageTransformEventJointEntity
      }
    | undefined

export const stageTransformEvent: Tool = {
    title: () => i18n.value.events.stageTransformEvent,
    sidebar: StageTransformEventSidebar,

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
                    toStageTransformEventJointEntity(
                        constrainLaneObject({
                            beat,
                            xTranslation: lane,
                            ...getPropertiesFromSelection(),
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
                const selectedStageTransformEventJointEntities: Entity[] =
                    selectedEntities.value.filter(
                        (entity) => entity.type === 'stageTransformEventJoint',
                    )

                const targets = selectedStageTransformEventJointEntities.includes(entity)
                    ? selectedStageTransformEventJointEntities.filter((e) => e !== entity)
                    : [...selectedStageTransformEventJointEntities, entity]

                replaceState({
                    ...state.value,
                    selectedEntities: targets,
                })
                view.entities = {
                    hovered: [],
                    creating: [],
                }
                focusEntityAtBeat(entity.beat)

                notify(
                    interpolate(
                        () => i18n.value.tools.events.selected,
                        `${targets.length}`,
                        () => i18n.value.eventKinds.stageTransformEvent,
                    ),
                )
            } else {
                if (selectedEntities.value.includes(entity)) {
                    focusEntityAtBeat(entity.beat)

                    if (isSidebarVisible.value) {
                        // An explicit edit gesture on the selection shows its properties.
                        revealPropertiesSection('selection')
                        edit(entity, {
                            ...entity,
                            eventEase: cycleEase(entity.eventEase),
                        })
                    } else {
                        void showToolModal(SelectionPropertiesModal, {
                            kind: 'stageTransformEventJoint',
                        })
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

                    notify(
                        interpolate(
                            () => i18n.value.tools.events.selected,
                            '1',
                            () => i18n.value.eventKinds.stageTransformEvent,
                        ),
                    )
                }
            }
        } else {
            add(
                constrainLaneObject({
                    beat,
                    xTranslation: lane,
                    ...getPropertiesFromSelection(),
                }),
            )
            focusEntityAtBeat(beat)
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

            notify(
                interpolate(
                    () => i18n.value.tools.events.moving,
                    '1',
                    () => i18n.value.eventKinds.stageTransformEvent,
                ),
            )

            active = {
                type: 'move',
                entity,
            }
        } else {
            focusEntityAtBeat(beat)

            notify(
                interpolate(
                    () => i18n.value.tools.events.adding,
                    '1',
                    () => i18n.value.eventKinds.stageTransformEvent,
                ),
            )

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
                const beat = yToValidBeat(y)

                view.entities = {
                    hovered: [],
                    creating: [
                        toStageTransformEventJointEntity(
                            constrainLaneObject({
                                beat,
                                xTranslation: lane,
                                ...getPropertiesFromSelection(),
                            }),
                        ),
                    ],
                }
                focusEntityAtBeat(beat)
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)

                view.entities = {
                    hovered: [],
                    creating: [
                        toStageTransformEventJointEntity(
                            constrainLaneObject({
                                ...active.entity,
                                beat,
                                xTranslation: lane,
                            }),
                        ),
                    ],
                }
                focusEntityAtBeat(beat)
                break
            }
        }

        if (active.type !== 'add') {
            const source = state.value
            const entity = active.entity
            const [replacement] = view.entities.creating
            if (replacement?.type === 'stageTransformEventJoint') {
                setPreviewEdit(source, () => {
                    const transaction = createTransaction(source, { autoAddGroup: false })
                    return transaction.commit(
                        editSelectedStageTransformEvent(transaction, entity, replacement),
                    )
                }, [entity, replacement.beat, replacement.xTranslation])
            }
        }
    },

    dragEnd(x, y) {
        clearPreviewEdit()
        if (!active) return

        const lane = xToValidLane(x)

        switch (active.type) {
            case 'add': {
                const beat = yToValidBeat(y)

                add(
                    constrainLaneObject({
                        beat,
                        xTranslation: lane,
                        ...getPropertiesFromSelection(),
                    }),
                )
                focusEntityAtBeat(beat)
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)

                move(
                    active.entity,
                    constrainLaneObject({
                        ...active.entity,
                        beat,
                        xTranslation: lane,
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

const getStageTransformEventJointFromSelection = () => {
    if (!defaultStageTransformEventProperties.value.copyProperties) return

    if (selectedEntities.value.length !== 1) return

    const [entity] = selectedEntities.value
    if (entity?.type !== 'stageTransformEventJoint') return

    return entity
}

const getPropertiesFromSelection = () => {
    const stageTransformEventJoint = getStageTransformEventJointFromSelection()

    return {
        stageId: view.stageId ?? stageTransformEventJoint?.stageId ?? defaultStageId.value,
        rotation:
            defaultStageTransformEventProperties.value.rotation ??
            stageTransformEventJoint?.rotation ??
            0,
        yTranslation:
            defaultStageTransformEventProperties.value.yTranslation ??
            stageTransformEventJoint?.yTranslation ??
            0,
        elevation:
            defaultStageTransformEventProperties.value.elevation ??
            stageTransformEventJoint?.elevation ??
            0,
        anchor:
            defaultStageTransformEventProperties.value.anchor ??
            stageTransformEventJoint?.anchor ??
            'default',
        eventEase: applyEaseEdit(
            defaultStageTransformEventProperties.value.eventEase,
            stageTransformEventJoint?.eventEase ?? 'linear',
        ),
    }
}

const tryFind = (
    x: number,
    y: number,
): [StageTransformEventJointEntity] | [undefined, number, number] => {
    const [hit] = hitEntitiesAtPoint('stageTransformEventJoint', x, y).sort(
        (a, b) => +selectedEntities.value.includes(b) - +selectedEntities.value.includes(a),
    )

    return hit ? [hit] : [undefined, yToValidBeat(y), xToValidLane(x)]
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

const add = (object: StageTransformEventObject) => {
    // Authoring reveals its target so the new object never vanishes.
    revealAuthoringTarget(object)
    update(
        interpolate(
            () => i18n.value.tools.events.added,
            '1',
            () => i18n.value.eventKinds.stageTransformEvent,
        ),
        (transaction) => addStageTransformEventJoint(transaction, object),
    )
}

const edit = (
    entity: StageTransformEventJointEntity,
    object: Partial<WithEaseEdits<StageTransformEventObject>>,
) => {
    update(
        interpolate(
            () => i18n.value.tools.events.edited,
            '1',
            () => i18n.value.eventKinds.stageTransformEvent,
        ),
        (transaction) => editSelectedStageTransformEvent(transaction, entity, object),
    )
}

const move = (entity: StageTransformEventJointEntity, object: StageTransformEventObject) => {
    update(
        interpolate(
            () => i18n.value.tools.events.moved,
            '1',
            () => i18n.value.eventKinds.stageTransformEvent,
        ),
        (transaction) => editSelectedStageTransformEvent(transaction, entity, object),
    )
}
