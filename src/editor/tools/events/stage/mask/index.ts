import { ref } from 'vue'
import type { Tool } from '../../..'
import type { StageMaskEventObject } from '../../../../../chart/events/stage/mask'
import { applyEaseEdit, cycleEase, type EaseEdit, type WithEaseEdits } from '../../../../../ease'
import { pushState, replaceState, state } from '../../../../../history'
import { selectedEntities } from '../../../../../history/selectedEntities'
import { defaultStageId } from '../../../../../history/stages.ts'
import { i18n } from '../../../../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../../../../preview/edit'
import type { Entity } from '../../../../../state/entities'
import {
    toStageMaskEventJointEntity,
    type StageMaskEventJointEntity,
} from '../../../../../state/entities/events/joints/stage/mask'
import { addStageMaskEventJoint } from '../../../../../state/mutations/events/stage/mask'
import { editSelectedStageMaskEvent } from '../../../../../state/operations/events/stage/mask'
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
    xToLane,
    xToValidLane,
    yToValidBeat,
} from '../../../../view'
import SelectionPropertiesModal from '../../../../workspace/properties/SelectionPropertiesModal.vue'
import {
    hitEntitiesAtPoint,
    isRangeResizeStart,
    moveLane,
    placementCursors,
    resize,
} from '../../../utils'
import StageMaskEventSidebar from './StageMaskEventSidebar.vue'

type DefaultStageMaskEventProperties = {
    maskSize?: number
    isMaskNotes?: boolean
    eventEase?: EaseEdit
    copyProperties: boolean
}

export const defaultStageMaskEventProperties = ref<DefaultStageMaskEventProperties>({
    copyProperties: true,
})

let active:
    | {
          type: 'add'
          lane: number
      }
    | {
          type: 'edit'
          entity: StageMaskEventJointEntity
          lane: number
      }
    | {
          type: 'move'
          entity: StageMaskEventJointEntity
          lane: number
      }
    | undefined

export const stageMaskEvent: Tool = {
    title: () => i18n.value.events.stageMaskEvent,
    sidebar: StageMaskEventSidebar,

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
                    toStageMaskEventJointEntity(
                        constrainLaneObject({
                            beat,
                            maskLeft: lane,
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
                const selectedStageMaskEventJointEntities: Entity[] = selectedEntities.value.filter(
                    (entity) => entity.type === 'stageMaskEventJoint',
                )

                const targets = selectedStageMaskEventJointEntities.includes(entity)
                    ? selectedStageMaskEventJointEntities.filter((e) => e !== entity)
                    : [...selectedStageMaskEventJointEntities, entity]

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
                        () => i18n.value.eventKinds.stageMaskEvent,
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
                            kind: 'stageMaskEventJoint',
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
                            () => i18n.value.eventKinds.stageMaskEvent,
                        ),
                    )
                }
            }
        } else {
            add(
                constrainLaneObject({
                    beat,
                    maskLeft: lane,
                    ...getPropertiesFromSelection(),
                }),
            )
            focusEntityAtBeat(beat)
        }
    },

    cursor: (x, y) => placementCursors[resolveDrag(x, y).type],

    dragStart(x, y) {
        const target = resolveDrag(x, y)
        if (target.type !== 'add') {
            const { entity, lane } = target
            replaceState({
                ...state.value,
                selectedEntities: [entity],
            })
            view.entities = {
                hovered: [],
                creating: [],
            }
            focusEntityAtBeat(entity.beat)

            if (target.type === 'move') {
                notify(
                    interpolate(
                        () => i18n.value.tools.events.moving,
                        '1',
                        () => i18n.value.eventKinds.stageMaskEvent,
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
                        () => i18n.value.eventKinds.stageMaskEvent,
                    ),
                )

                active = {
                    type: 'edit',
                    entity,
                    lane:
                        entity.maskLeft +
                        (lane >= entity.maskLeft + entity.maskSize / 2 ? 0 : entity.maskSize),
                }
            }
        } else {
            focusEntityAtBeat(target.beat)

            notify(
                interpolate(
                    () => i18n.value.tools.events.adding,
                    '1',
                    () => i18n.value.eventKinds.stageMaskEvent,
                ),
            )

            active = {
                type: 'add',
                lane: target.lane,
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
                const [maskLeft, maskSize] = resize(active.lane, lane)

                view.entities = {
                    hovered: [],
                    creating: [
                        toStageMaskEventJointEntity(
                            constrainLaneObject(
                                {
                                    beat,
                                    ...getPropertiesFromSelection(),
                                    maskLeft,
                                    maskSize,
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
                const [maskLeft, maskSize] = resize(
                    active.lane,
                    lane,
                    0,
                    Number.POSITIVE_INFINITY,
                    active.entity.maskLeft +
                        (active.lane === active.entity.maskLeft ? active.entity.maskSize : 0),
                )

                view.entities = {
                    hovered: [],
                    creating: [
                        toStageMaskEventJointEntity(
                            constrainLaneObject(
                                {
                                    ...active.entity,
                                    maskLeft,
                                    maskSize,
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
                        toStageMaskEventJointEntity(
                            constrainLaneObject({
                                ...active.entity,
                                beat,
                                maskLeft: moveLane(
                                    active.entity.maskLeft,
                                    active.lane,
                                    lane,
                                    active.entity.maskLeft,
                                ),
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
            if (replacement?.type === 'stageMaskEventJoint') {
                setPreviewEdit(source, () => {
                    const transaction = createTransaction(source, { autoAddGroup: false })
                    return transaction.commit(
                        editSelectedStageMaskEvent(transaction, entity, replacement),
                    )
                }, [entity, replacement.beat, replacement.maskLeft, replacement.maskSize])
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
                const [maskLeft, maskSize] = resize(active.lane, lane)

                add(
                    constrainLaneObject(
                        {
                            beat,
                            ...getPropertiesFromSelection(),
                            maskLeft,
                            maskSize,
                        },
                        { resizing: true },
                    ),
                )
                focusEntityAtBeat(beat)
                break
            }
            case 'edit': {
                const [maskLeft, maskSize] = resize(
                    active.lane,
                    lane,
                    0,
                    Number.POSITIVE_INFINITY,
                    active.entity.maskLeft +
                        (active.lane === active.entity.maskLeft ? active.entity.maskSize : 0),
                )

                edit(
                    active.entity,
                    constrainLaneObject(
                        {
                            ...active.entity,
                            maskLeft,
                            maskSize,
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
                        maskLeft: moveLane(
                            active.entity.maskLeft,
                            active.lane,
                            lane,
                            active.entity.maskLeft,
                        ),
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

const getStageMaskEventJointFromSelection = () => {
    if (!defaultStageMaskEventProperties.value.copyProperties) return

    if (selectedEntities.value.length !== 1) return

    const [entity] = selectedEntities.value
    if (entity?.type !== 'stageMaskEventJoint') return

    return entity
}

const getPropertiesFromSelection = () => {
    const stageMaskEventJoint = getStageMaskEventJointFromSelection()

    return {
        stageId: view.stageId ?? stageMaskEventJoint?.stageId ?? defaultStageId.value,
        maskSize:
            defaultStageMaskEventProperties.value.maskSize ?? stageMaskEventJoint?.maskSize ?? 12,
        isMaskNotes:
            defaultStageMaskEventProperties.value.isMaskNotes ??
            stageMaskEventJoint?.isMaskNotes ??
            false,
        eventEase: applyEaseEdit(
            defaultStageMaskEventProperties.value.eventEase,
            stageMaskEventJoint?.eventEase ?? 'linear',
        ),
    }
}

const resolveDrag = (x: number, y: number) => {
    const [entity, beat, lane] = tryFind(x, y)
    if (!entity) return { type: 'add', beat, lane } as const

    const pointerLane = xToLane(x)
    return {
        type: isRangeResizeStart(entity.maskLeft, entity.maskSize, pointerLane) ? 'edit' : 'move',
        entity,
        lane: pointerLane,
    } as const
}

const tryFind = (
    x: number,
    y: number,
): [StageMaskEventJointEntity] | [undefined, number, number] => {
    const [hit] = hitEntitiesAtPoint('stageMaskEventJoint', x, y).sort(
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

const add = (object: StageMaskEventObject) => {
    // Authoring reveals its target so the new object never vanishes.
    revealAuthoringTarget(object)
    update(
        interpolate(
            () => i18n.value.tools.events.added,
            '1',
            () => i18n.value.eventKinds.stageMaskEvent,
        ),
        (transaction) => addStageMaskEventJoint(transaction, object),
    )
}

const edit = (
    entity: StageMaskEventJointEntity,
    object: Partial<WithEaseEdits<StageMaskEventObject>>,
) => {
    update(
        interpolate(
            () => i18n.value.tools.events.edited,
            '1',
            () => i18n.value.eventKinds.stageMaskEvent,
        ),
        (transaction) => editSelectedStageMaskEvent(transaction, entity, object),
    )
}

const move = (entity: StageMaskEventJointEntity, object: StageMaskEventObject) => {
    update(
        interpolate(
            () => i18n.value.tools.events.moved,
            '1',
            () => i18n.value.eventKinds.stageMaskEvent,
        ),
        (transaction) => editSelectedStageMaskEvent(transaction, entity, object),
    )
}
