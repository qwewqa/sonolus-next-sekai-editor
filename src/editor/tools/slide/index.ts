import { computed, ref } from 'vue'
import type { Tool } from '..'
import type { NoteObject } from '../../../chart/note'
import { applyEaseEdit, type Ease } from '../../../ease'
import { pushState, replaceState, state } from '../../../history'
import { defaultGroupId } from '../../../history/groups.ts'
import { selectedEntities } from '../../../history/selectedEntities'
import { defaultStageId } from '../../../history/stages.ts'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../../preview/edit'
import { settings } from '../../../settings'
import type { Entity } from '../../../state/entities'
import { createSlideId, type SlideId } from '../../../state/entities/slides'
import { toNoteEntity, type NoteEntity } from '../../../state/entities/slides/note'
import { addNote, replaceNote } from '../../../state/mutations/slides/note'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { shiftComputed } from '../../../utils/math'
import { bisect } from '../../../utils/ordered'
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
    hitEntitiesAtPoint,
    isNoteResizeStart,
    isVisible,
    modifyEntities,
    moveLane,
    placementCursors,
    resize,
} from '../utils'
import SlideSidebar from './SlideSidebar.vue'

export const defaultSlidePropertiesPresetIndex = ref(0)

export const defaultSlideProperties = computed({
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    get: () => settings.defaultSlidePropertiesPresets[defaultSlidePropertiesPresetIndex.value]!,
    set: (properties) => {
        settings.defaultSlidePropertiesPresets = settings.defaultSlidePropertiesPresets.map(
            (preset, i) => (i === defaultSlidePropertiesPresetIndex.value ? properties : preset),
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

export const slide: Tool = {
    title: interpolate(
        () => i18n.value.tools.slide.title,
        () => `${defaultSlidePropertiesPresetIndex.value + 1}`,
    ),
    sidebar: SlideSidebar,

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
                        getSelectedSlideId() ?? createSlideId(),
                        constrainLaneObject({
                            beat,
                            left: lane,
                            ...getPropertiesFromSelection(beat),
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

                notify(interpolate(() => i18n.value.tools.slide.selected, `${targets.length}`))
            } else {
                if (entities.every((entity) => selectedEntities.value.includes(entity))) {
                    focusEntityAtBeat(entity.beat)

                    if (isSidebarVisible.value) {
                        // An explicit edit gesture on the selection shows its properties.
                        revealPropertiesSection('selection')
                        quickEdit(defaultSlideProperties.value)
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

                    notify(interpolate(() => i18n.value.tools.slide.selected, `${entities.length}`))
                }
            }
        } else {
            add(
                getSelectedSlideId() ?? createSlideId(),
                constrainLaneObject({
                    beat,
                    left: lane,
                    ...getPropertiesFromSelection(beat),
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

            notify(interpolate(() => i18n.value.tools.slide.adding, '1'))

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
                notify(interpolate(() => i18n.value.tools.slide.moving, '1'))

                active = {
                    type: 'move',
                    entity,
                    lane,
                }
            } else {
                notify(interpolate(() => i18n.value.tools.slide.editing, '1'))

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
                const properties = getPropertiesFromSelection(beat)
                const [left, size] = resize(active.lane, lane, minimumNoteSize(properties.noteType))

                view.entities = {
                    hovered: [],
                    creating: [
                        toNoteEntity(
                            getSelectedSlideId() ?? createSlideId(),
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
                const properties = getPropertiesFromSelection(beat)
                const [left, size] = resize(active.lane, lane, minimumNoteSize(properties.noteType))

                add(
                    getSelectedSlideId() ?? createSlideId(),
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

                edit(
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

                move(
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
    if (!defaultSlideProperties.value.copyProperties) return

    if (selectedEntities.value.length !== 1) return

    const [entity] = selectedEntities.value
    if (entity?.type !== 'note') return

    return entity
}

const getNearestNoteInSlide = (slideId: SlideId, beat: number) => {
    const notes = store.value.slides.note.get(slideId)
    if (!notes) throw new Error('Unexpected notes not found')

    const index = bisect(notes, 'beat', beat)
    return notes[index - 1] ?? notes[index]
}

export const getSlidePropertiesFromSelection = (beat: number) => {
    const note = getNoteFromSelection()
    const nearest = note && getNearestNoteInSlide(note.slideId, beat)

    return {
        groupId: view.groupId ?? note?.groupId ?? defaultGroupId.value,
        stageId: view.stageId ?? note?.stageId ?? defaultStageId.value,
        elevation: defaultSlideProperties.value.elevation ?? nearest?.elevation ?? 0,
        noteStyle: defaultSlideProperties.value.noteStyle ?? nearest?.noteStyle ?? 'default',
        connectorStyle:
            defaultSlideProperties.value.connectorStyle ?? nearest?.connectorStyle ?? 'default',
        noteType: defaultSlideProperties.value.noteType ?? note?.noteType ?? 'default',
        isAttached: defaultSlideProperties.value.isAttached ?? note?.isAttached ?? false,
        size: note?.size ?? view.noteSize,
        isCritical: defaultSlideProperties.value.isCritical ?? note?.isCritical ?? false,
        flickDirection:
            defaultSlideProperties.value.flickDirection ?? note?.flickDirection ?? 'none',
        isFake: defaultSlideProperties.value.isFake ?? note?.isFake ?? false,
        sfx: defaultSlideProperties.value.sfx ?? note?.sfx ?? 'default',
        isConnectorSeparator: defaultSlideProperties.value.isConnectorSeparator ?? false,
        connectorType:
            defaultSlideProperties.value.connectorType ?? nearest?.connectorType ?? 'active',
        connectorEase: applyEaseEdit<Ease>(defaultSlideProperties.value.connectorEase, 'linear'),
        connectorIsFake:
            defaultSlideProperties.value.connectorIsFake ??
            defaultSlideProperties.value.isFake ??
            nearest?.connectorIsFake ??
            false,
        connectorActiveIsCritical:
            defaultSlideProperties.value.connectorActiveIsCritical ??
            defaultSlideProperties.value.isCritical ??
            nearest?.connectorActiveIsCritical ??
            false,
        connectorGuideAlpha:
            defaultSlideProperties.value.connectorGuideAlpha ?? nearest?.connectorGuideAlpha ?? 1,
        connectorLayer:
            defaultSlideProperties.value.connectorLayer ?? nearest?.connectorLayer ?? 'top',
        connectorIsPassThrough:
            defaultSlideProperties.value.connectorIsPassThrough ??
            nearest?.connectorIsPassThrough ??
            false,
        connectorPresentation:
            defaultSlideProperties.value.connectorPresentation ??
            nearest?.connectorPresentation ??
            'default',
    }
}

const getPropertiesFromSelection = getSlidePropertiesFromSelection

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

export const getSelectedSlideId = () => {
    if (!selectedEntities.value.every((entity) => entity.type === 'note')) return

    const [entity] = selectedEntities.value
    if (!entity) return

    if (!selectedEntities.value.every(({ slideId }) => slideId === entity.slideId)) return

    return entity.slideId
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

const add = (slideId: SlideId, object: NoteObject) => {
    // Authoring reveals its target so the new object never vanishes.
    revealAuthoringTarget(object)
    update(
        () => i18n.value.tools.slide.added,
        (transaction) => addNote(transaction, slideId, object),
    )
}

const edit = (entity: NoteEntity, object: NoteObject) => {
    update(
        () => i18n.value.tools.slide.edited,
        (transaction) => replaceNote(transaction, entity, object),
    )
}

const previewEdit = (entity: NoteEntity, object: NoteObject) => {
    const source = state.value
    setPreviewEdit(source, () => {
        const transaction = createTransaction(source, { autoAddGroup: false })
        return transaction.commit(replaceNote(transaction, entity, object))
    }, [entity, object.beat, object.left, object.size])
}

const move = (entity: NoteEntity, object: NoteObject) => {
    update(
        () => i18n.value.tools.slide.moved,
        (transaction) => replaceNote(transaction, entity, object),
    )
}
