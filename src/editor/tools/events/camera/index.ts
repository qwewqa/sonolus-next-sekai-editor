import { ref } from 'vue'
import type { Tool } from '../..'
import type { CameraEventObject, CameraZoomVerticalAlign } from '../../../../chart/events/camera'
import { applyEaseEdit, cycleEase, type EaseEdit, type WithEaseEdits } from '../../../../ease'
import { pushState, replaceState, state } from '../../../../history'
import { selectedEntities } from '../../../../history/selectedEntities'
import { i18n } from '../../../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../../../preview/edit'
import type { Entity } from '../../../../state/entities'
import {
    toCameraEventJointEntity,
    type CameraEventJointEntity,
} from '../../../../state/entities/events/joints/camera'
import { addCameraEventJoint } from '../../../../state/mutations/events/camera'
import { editSelectedCameraEvent } from '../../../../state/operations/events/camera'
import { createTransaction, type Transaction } from '../../../../state/transaction'
import { interpolate } from '../../../../utils/interpolate'
import { constrainLaneObject } from '../../../laneLimits'
import { notify } from '../../../notification'
import { isSidebarVisible, revealPropertiesSection } from '../../../sidebars'
import { showToolModal } from '../../../toolModals'
import {
    focusEntityAtBeat,
    setViewHover,
    snapYToBeat,
    view,
    xToLane,
    xToValidLane,
    yToValidBeat,
} from '../../../view'
import { hitEntitiesAtPoint, offset, resize } from '../../utils'
import CameraEventPropertiesModal from './CameraEventPropertiesModal.vue'
import CameraEventSidebar from './CameraEventSidebar.vue'

type DefaultCameraEventProperties = {
    cameraSize?: number
    cameraZoom?: number
    cameraZoomTargetLane?: number
    cameraZoomTargetY?: number
    cameraZoomVerticalAlign?: CameraZoomVerticalAlign
    cameraRotation?: number
    cameraStageTilt?: number
    eventEase?: EaseEdit
    copyProperties: boolean
}

export const defaultCameraEventProperties = ref<DefaultCameraEventProperties>({
    copyProperties: true,
})

let active:
    | {
          type: 'add'
          lane: number
      }
    | {
          type: 'edit'
          entity: CameraEventJointEntity
          lane: number
      }
    | {
          type: 'move'
          entity: CameraEventJointEntity
          lane: number
      }
    | undefined

export const cameraEvent: Tool = {
    title: () => i18n.value.events.cameraEvent,
    sidebar: CameraEventSidebar,

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
                    toCameraEventJointEntity(
                        constrainLaneObject({
                            beat,
                            cameraLeft: lane,
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
                const selectedCameraEventJointEntities: Entity[] = selectedEntities.value.filter(
                    (entity) => entity.type === 'cameraEventJoint',
                )

                const targets = selectedCameraEventJointEntities.includes(entity)
                    ? selectedCameraEventJointEntities.filter((e) => e !== entity)
                    : [...selectedCameraEventJointEntities, entity]

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
                        () => i18n.value.events.cameraEvent,
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
                        void showToolModal(CameraEventPropertiesModal, {})
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
                            () => i18n.value.events.cameraEvent,
                        ),
                    )
                }
            }
        } else {
            add(
                constrainLaneObject({
                    beat,
                    cameraLeft: lane,
                    ...getPropertiesFromSelection(),
                }),
            )
            focusEntityAtBeat(beat)
        }
    },

    dragStart(x, y) {
        const [entity, beat, lane] = tryFind(x, y)
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

            const lane = xToLane(x)
            if (
                lane > entity.cameraLeft + 0.5 &&
                lane < entity.cameraLeft + entity.cameraSize - 0.5
            ) {
                notify(
                    interpolate(
                        () => i18n.value.tools.events.moving,
                        '1',
                        () => i18n.value.events.cameraEvent,
                    ),
                )

                active = {
                    type: 'move',
                    entity,
                    lane,
                }
            } else {
                notify(
                    interpolate(
                        () => i18n.value.tools.events.editing,
                        '1',
                        () => i18n.value.events.cameraEvent,
                    ),
                )

                active = {
                    type: 'edit',
                    entity,
                    lane:
                        entity.cameraLeft +
                        (lane >= entity.cameraLeft + entity.cameraSize / 2 ? 0 : entity.cameraSize),
                }
            }
        } else {
            focusEntityAtBeat(beat)

            notify(
                interpolate(
                    () => i18n.value.tools.events.adding,
                    '1',
                    () => i18n.value.events.cameraEvent,
                ),
            )

            active = {
                type: 'add',
                lane,
            }
        }

        return true
    },

    dragUpdate(x, y) {
        if (!active) return

        setViewHover(y)

        const lane = xToLane(x)

        switch (active.type) {
            case 'add': {
                const beat = yToValidBeat(y)
                const [cameraLeft, cameraSize] = resize(active.lane, lane, 6, 24)

                view.entities = {
                    hovered: [],
                    creating: [
                        toCameraEventJointEntity(
                            constrainLaneObject(
                                {
                                    beat,
                                    ...getPropertiesFromSelection(),
                                    cameraLeft,
                                    cameraSize,
                                },
                                { resizing: true },
                            ),
                        ),
                    ],
                }
                focusEntityAtBeat(beat)
                break
            }
            case 'edit': {
                const [cameraLeft, cameraSize] = resize(
                    active.lane,
                    lane,
                    6,
                    24,
                    active.entity.cameraLeft +
                        (active.lane === active.entity.cameraLeft ? active.entity.cameraSize : 0),
                )

                view.entities = {
                    hovered: [],
                    creating: [
                        toCameraEventJointEntity(
                            constrainLaneObject(
                                {
                                    ...active.entity,
                                    cameraLeft,
                                    cameraSize,
                                },
                                { resizing: true },
                            ),
                        ),
                    ],
                }
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)

                view.entities = {
                    hovered: [],
                    creating: [
                        toCameraEventJointEntity(
                            constrainLaneObject({
                                ...active.entity,
                                beat,
                                cameraLeft:
                                    active.entity.cameraLeft +
                                    offset(active.lane, lane, active.entity.cameraLeft),
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
            if (replacement?.type === 'cameraEventJoint') {
                setPreviewEdit(source, () => {
                    const transaction = createTransaction(source, { autoAddGroup: false })
                    return transaction.commit(
                        editSelectedCameraEvent(transaction, entity, replacement),
                    )
                }, [entity, replacement.beat, replacement.cameraLeft, replacement.cameraSize])
            }
        }
    },

    dragEnd(x, y) {
        clearPreviewEdit()
        if (!active) return

        const lane = xToLane(x)

        switch (active.type) {
            case 'add': {
                const beat = yToValidBeat(y)
                const [cameraLeft, cameraSize] = resize(active.lane, lane, 6, 24)

                add(
                    constrainLaneObject(
                        {
                            beat,
                            ...getPropertiesFromSelection(),
                            cameraLeft,
                            cameraSize,
                        },
                        { resizing: true },
                    ),
                )
                focusEntityAtBeat(beat)
                break
            }
            case 'edit': {
                const [cameraLeft, cameraSize] = resize(
                    active.lane,
                    lane,
                    6,
                    24,
                    active.entity.cameraLeft +
                        (active.lane === active.entity.cameraLeft ? active.entity.cameraSize : 0),
                )

                edit(
                    active.entity,
                    constrainLaneObject(
                        {
                            ...active.entity,
                            cameraLeft,
                            cameraSize,
                        },
                        { resizing: true },
                    ),
                )
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)

                move(
                    active.entity,
                    constrainLaneObject({
                        ...active.entity,
                        beat,
                        cameraLeft:
                            active.entity.cameraLeft +
                            offset(active.lane, lane, active.entity.cameraLeft),
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

export const editCameraEvent = (
    entity: CameraEventJointEntity,
    object: Partial<WithEaseEdits<CameraEventObject>>,
) => {
    edit(entity, object)
}

const getCameraEventJointFromSelection = () => {
    if (!defaultCameraEventProperties.value.copyProperties) return

    if (selectedEntities.value.length !== 1) return

    const [entity] = selectedEntities.value
    if (entity?.type !== 'cameraEventJoint') return

    return entity
}

const getPropertiesFromSelection = () => {
    const cameraEventJoint = getCameraEventJointFromSelection()

    return {
        cameraSize:
            defaultCameraEventProperties.value.cameraSize ?? cameraEventJoint?.cameraSize ?? 12,
        cameraZoom:
            defaultCameraEventProperties.value.cameraZoom ?? cameraEventJoint?.cameraZoom ?? 1,
        cameraZoomTargetLane:
            defaultCameraEventProperties.value.cameraZoomTargetLane ??
            cameraEventJoint?.cameraZoomTargetLane ??
            0,
        cameraZoomTargetY:
            defaultCameraEventProperties.value.cameraZoomTargetY ??
            cameraEventJoint?.cameraZoomTargetY ??
            0,
        cameraZoomVerticalAlign:
            defaultCameraEventProperties.value.cameraZoomVerticalAlign ??
            cameraEventJoint?.cameraZoomVerticalAlign ??
            'default',
        cameraRotation:
            defaultCameraEventProperties.value.cameraRotation ??
            cameraEventJoint?.cameraRotation ??
            0,
        cameraStageTilt:
            defaultCameraEventProperties.value.cameraStageTilt ??
            cameraEventJoint?.cameraStageTilt ??
            1,
        eventEase: applyEaseEdit(
            defaultCameraEventProperties.value.eventEase,
            cameraEventJoint?.eventEase ?? 'linear',
        ),
    }
}

const tryFind = (x: number, y: number): [CameraEventJointEntity] | [undefined, number, number] => {
    const [hit] = hitEntitiesAtPoint('cameraEventJoint', x, y).sort(
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

const add = (object: CameraEventObject) => {
    update(
        interpolate(
            () => i18n.value.tools.events.added,
            '1',
            () => i18n.value.events.cameraEvent,
        ),
        (transaction) => addCameraEventJoint(transaction, object),
    )
}

const edit = (
    entity: CameraEventJointEntity,
    object: Partial<WithEaseEdits<CameraEventObject>>,
) => {
    update(
        interpolate(
            () => i18n.value.tools.events.edited,
            '1',
            () => i18n.value.events.cameraEvent,
        ),
        (transaction) => editSelectedCameraEvent(transaction, entity, object),
    )
}

const move = (entity: CameraEventJointEntity, object: CameraEventObject) => {
    update(
        interpolate(
            () => i18n.value.tools.events.moved,
            '1',
            () => i18n.value.events.cameraEvent,
        ),
        (transaction) => editSelectedCameraEvent(transaction, entity, object),
    )
}
