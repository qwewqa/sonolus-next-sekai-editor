import { computed, ref } from 'vue'
import type { Tool } from '..'
import type { NoteObject } from '../../../chart/note'
import { applyEaseEdit, type Ease, type WithEaseEdits } from '../../../ease'
import { pushState, replaceState, state } from '../../../history'
import { defaultGroupId } from '../../../history/groups.ts'
import { selectedEntities } from '../../../history/selectedEntities'
import { defaultStageId } from '../../../history/stages.ts'
import { i18n } from '../../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../../preview/edit'
import { settings } from '../../../settings'
import type { Entity } from '../../../state/entities'
import { createSlideId } from '../../../state/entities/slides'
import { toNoteEntity, type NoteEntity } from '../../../state/entities/slides/note'
import { addNote } from '../../../state/mutations/slides/note'
import { editSelectedNote } from '../../../state/operations/note'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { shiftComputed } from '../../../utils/math'
import { constrainLaneObject, minimumNoteSize } from '../../laneLimits'
import { notify } from '../../notification'
import { revealAuthoringTarget } from '../../scope'
import { isSidebarVisible, revealPropertiesSection } from '../../sidebars'
import { showToolModal } from '../../toolModals'
import { quickEdit } from '../../utils/quickEdit'
import {
    focusEntityAtBeat,
    setViewHover,
    snapYToBeat,
    view,
    xToLane,
    xToValidLane,
    yToValidBeat,
} from '../../view'
import SelectionPropertiesModal from '../../workspace/properties/SelectionPropertiesModal.vue'
import {
    commitDrop,
    hitEntitiesAtPoint,
    isNoteResizeStart,
    isVisible,
    modifyEntities,
    moveLane,
    placementCursors,
    resize,
} from '../utils'
import NoteSidebar from './NoteSidebar.vue'

export const defaultNotePropertiesPresetIndex = ref(0)

export const defaultNoteProperties = computed({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    get: () => settings.defaultNotePropertiesPresets[defaultNotePropertiesPresetIndex.value]!,
    set: (properties) => {
        settings.defaultNotePropertiesPresets = settings.defaultNotePropertiesPresets.map(
            (preset, i) => (i === defaultNotePropertiesPresetIndex.value ? properties : preset),
        )
    },
})

let active:
    | {
          type: 'add'
          lane: number
      }
    | {
          type: 'edit'
          entity: NoteEntity
          lane: number
      }
    | {
          type: 'move'
          entity: NoteEntity
          lane: number
      }
    | undefined

export const note: Tool = {
    title: interpolate(
        () => i18n.value.tools.note.title,
        () => `${defaultNotePropertiesPresetIndex.value + 1}`,
    ),
    sidebar: NoteSidebar,

    hover(x, y, modifiers) {
        const [entity, beat, lane] = tryFind(x, y, 0.5)
        if (entity) {
            view.entities = {
                hovered: modifyEntities([entity], modifiers),
                creating: [],
            }
        } else {
            view.entities = {
                hovered: [],
                creating: [
                    toNoteEntity(
                        createSlideId(),
                        constrainLaneObject({
                            beat,
                            left: lane,
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
            const entities = modifyEntities([entity], modifiers)

            if (modifiers.ctrl) {
                const selectedNoteEntities: Entity[] = selectedEntities.value.filter(
                    (entity) => entity.type === 'note',
                )

                const targets = entities.every((entity) => selectedNoteEntities.includes(entity))
                    ? selectedNoteEntities.filter((entity) => !entities.includes(entity))
                    : [...new Set([...selectedNoteEntities, ...entities])]

                replaceState({
                    ...state.value,
                    selectedEntities: targets,
                })
                view.entities = {
                    hovered: [],
                    creating: [],
                }
                focusEntityAtBeat(entity.beat)

                notify(interpolate(() => i18n.value.tools.note.selected, `${targets.length}`))
            } else {
                if (entities.every((entity) => selectedEntities.value.includes(entity))) {
                    focusEntityAtBeat(entity.beat)

                    if (isSidebarVisible.value) {
                        // An explicit edit gesture on the selection shows its properties.
                        revealPropertiesSection('selection')
                        quickEdit(defaultNoteProperties.value)
                    } else {
                        void showToolModal(SelectionPropertiesModal, { kind: 'note' })
                    }
                } else {
                    replaceState({
                        ...state.value,
                        selectedEntities: entities,
                    })
                    view.entities = {
                        hovered: [],
                        creating: [],
                    }
                    focusEntityAtBeat(entity.beat)

                    notify(interpolate(() => i18n.value.tools.note.selected, `${entities.length}`))
                }
            }
        } else {
            add(
                constrainLaneObject({
                    beat,
                    left: lane,
                    ...getPropertiesFromSelection(),
                }),
            )
            focusEntityAtBeat(beat)
        }
    },

    cursor: (x, y) => placementCursors[resolveDrag(x, y).type],

    dragStart(x, y) {
        const target = resolveDrag(x, y)
        if (target.type === 'add') {
            focusEntityAtBeat(target.beat)

            notify(interpolate(() => i18n.value.tools.note.adding, '1'))

            active = {
                type: 'add',
                lane: target.lane,
            }
        } else {
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
                notify(interpolate(() => i18n.value.tools.note.moving, '1'))

                active = {
                    type: 'move',
                    entity,
                    lane,
                }
            } else {
                notify(interpolate(() => i18n.value.tools.note.editing, '1'))

                active = {
                    type: 'edit',
                    entity,
                    lane: shiftComputed(
                        entity.left,
                        lane >= entity.left + entity.size / 2 ? 0 : entity.size,
                    ),
                }
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
                const properties = getPropertiesFromSelection()
                const [left, size] = resize(active.lane, lane, minimumNoteSize(properties.noteType))

                view.entities = {
                    hovered: [],
                    creating: [
                        toNoteEntity(
                            createSlideId(),
                            constrainLaneObject(
                                {
                                    beat,
                                    ...properties,
                                    left,
                                    size,
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
                const [left, size] = resize(
                    active.lane,
                    lane,
                    minimumNoteSize(active.entity.noteType),
                    Number.POSITIVE_INFINITY,
                    active.entity.left +
                        (active.lane === active.entity.left ? active.entity.size : 0),
                )
                const object = constrainLaneObject(
                    { ...active.entity, left, size },
                    { resizing: true },
                )

                view.entities = {
                    hovered: [],
                    creating: [toNoteEntity(active.entity.slideId, object, active.entity)],
                }
                previewEdit(active.entity, object)
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)
                const object = constrainLaneObject({
                    ...active.entity,
                    beat,
                    left: moveLane(active.entity.left, active.lane, lane, active.entity.left),
                })

                view.entities = {
                    hovered: [],
                    creating: [toNoteEntity(active.entity.slideId, object, active.entity)],
                }
                previewEdit(active.entity, object)
                focusEntityAtBeat(beat)
                break
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
                const properties = getPropertiesFromSelection()
                const [left, size] = resize(active.lane, lane, minimumNoteSize(properties.noteType))

                add(
                    constrainLaneObject(
                        {
                            beat,
                            ...properties,
                            left,
                            size,
                        },
                        { resizing: true },
                    ),
                )
                focusEntityAtBeat(beat)
                break
            }
            case 'edit': {
                const [left, size] = resize(
                    active.lane,
                    lane,
                    minimumNoteSize(active.entity.noteType),
                    Number.POSITIVE_INFINITY,
                    active.entity.left +
                        (active.lane === active.entity.left ? active.entity.size : 0),
                )

                commitDrop(
                    edit,
                    active.entity,
                    constrainLaneObject(
                        {
                            ...active.entity,
                            left,
                            size,
                        },
                        { resizing: true },
                    ),
                )
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)

                commitDrop(
                    move,
                    active.entity,
                    constrainLaneObject({
                        ...active.entity,
                        beat,
                        left: moveLane(active.entity.left, active.lane, lane, active.entity.left),
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

const getNoteFromSelection = () => {
    if (!defaultNoteProperties.value.copyProperties) return

    if (selectedEntities.value.length !== 1) return

    const [entity] = selectedEntities.value
    if (entity?.type !== 'note') return

    return entity
}

export const getNotePropertiesFromSelection = () => {
    const note = getNoteFromSelection()

    return {
        groupId: view.groupId ?? note?.groupId ?? defaultGroupId.value,
        stageId: view.stageId ?? note?.stageId ?? defaultStageId.value,
        elevation: defaultNoteProperties.value.elevation ?? note?.elevation ?? 0,
        noteStyle: defaultNoteProperties.value.noteStyle ?? note?.noteStyle ?? 'default',
        connectorStyle:
            defaultNoteProperties.value.connectorStyle ?? note?.connectorStyle ?? 'default',
        noteType: defaultNoteProperties.value.noteType ?? note?.noteType ?? 'default',
        isAttached: defaultNoteProperties.value.isAttached ?? note?.isAttached ?? false,
        size: note?.size ?? view.noteSize,
        isCritical: defaultNoteProperties.value.isCritical ?? note?.isCritical ?? false,
        flickDirection:
            defaultNoteProperties.value.flickDirection ?? note?.flickDirection ?? 'none',
        isFake: defaultNoteProperties.value.isFake ?? note?.isFake ?? false,
        sfx: defaultNoteProperties.value.sfx ?? note?.sfx ?? 'default',
        isConnectorSeparator: defaultNoteProperties.value.isConnectorSeparator ?? false,
        connectorType: defaultNoteProperties.value.connectorType ?? 'active',
        connectorEase: applyEaseEdit<Ease>(defaultNoteProperties.value.connectorEase, 'linear'),
        connectorIsFake:
            defaultNoteProperties.value.connectorIsFake ??
            defaultNoteProperties.value.isFake ??
            false,
        connectorActiveIsCritical:
            defaultNoteProperties.value.connectorActiveIsCritical ??
            defaultNoteProperties.value.isCritical ??
            false,
        connectorGuideAlpha: defaultNoteProperties.value.connectorGuideAlpha ?? 1,
        connectorLayer: defaultNoteProperties.value.connectorLayer ?? 'top',
        connectorIsPassThrough: defaultNoteProperties.value.connectorIsPassThrough ?? false,
        connectorPresentation: defaultNoteProperties.value.connectorPresentation ?? 'default',
    }
}

const getPropertiesFromSelection = getNotePropertiesFromSelection

const tryFind = (
    x: number,
    y: number,
    minimumNoteWidth = 1.5,
): [NoteEntity] | [undefined, number, number] => {
    // Only notes whose type, group and stage are fully visible are editable.
    const [hit] = hitEntitiesAtPoint('note', x, y, minimumNoteWidth)
        .filter(isVisible)
        .sort((a, b) => +selectedEntities.value.includes(b) - +selectedEntities.value.includes(a))

    return hit ? [hit] : [undefined, yToValidBeat(y), xToValidLane(x)]
}

const resolveDrag = (x: number, y: number) => {
    const [entity, beat, lane] = tryFind(x, y)
    if (!entity) return { type: 'add', beat, lane } as const

    const pointerLane = xToLane(x)
    return {
        type: isNoteResizeStart(entity, pointerLane) ? 'edit' : 'move',
        entity,
        lane: pointerLane,
    } as const
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

const add = (object: NoteObject) => {
    // Authoring reveals its target so the new object never vanishes.
    revealAuthoringTarget(object)
    update(
        () => i18n.value.tools.note.added,
        (transaction) => addNote(transaction, createSlideId(), object),
    )
}

const edit = (entity: NoteEntity, object: Partial<WithEaseEdits<NoteObject>>) => {
    update(
        () => i18n.value.tools.note.edited,
        (transaction) => editSelectedNote(transaction, entity, object),
    )
}

const previewEdit = (entity: NoteEntity, object: NoteObject) => {
    const source = state.value
    setPreviewEdit(source, () => {
        const transaction = createTransaction(source, { autoAddGroup: false })
        return transaction.commit(editSelectedNote(transaction, entity, object))
    }, [entity, object.beat, object.left, object.size])
}

const move = (entity: NoteEntity, object: NoteObject) => {
    update(
        () => i18n.value.tools.note.moved,
        (transaction) => editSelectedNote(transaction, entity, object),
    )
}
