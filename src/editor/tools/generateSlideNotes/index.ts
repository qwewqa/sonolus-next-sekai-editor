import type { Tool } from '..'
import { applyEaseEdit, type Ease } from '../../../ease'
import { pushState, replaceState, state } from '../../../history'
import { defaultGroupId } from '../../../history/groups'
import { selectedEntities } from '../../../history/selectedEntities'
import { defaultStageId } from '../../../history/stages'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import type { SlideId } from '../../../state/entities/slides'
import type { NoteEntity } from '../../../state/entities/slides/note'
import { addNote } from '../../../state/mutations/slides/note'
import { createTransaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { bisect } from '../../../utils/ordered'
import { notify } from '../../notification'
import { revealAuthoredEntities } from '../../scope'
import {
    focusEntityAtBeat,
    focusViewAtBeat,
    setViewHover,
    view,
    xToLane,
    yToTime,
    yToValidBeat,
} from '../../view'
import { defaultSlideProperties } from '../slide'
import { hitEntitiesAtPoint, hitEntitiesInSelection, toSelection } from '../utils'

let active:
    | {
          lane: number
          time: number
          count: number
      }
    | undefined

export const generateSlideNotes: Tool = {
    title: () => i18n.value.tools.generateSlideNotes.title,

    hover(x, y) {
        const entities = hitEntitiesAtPoint('note', x, y, 0.5)

        view.entities = {
            hovered: entities,
            creating: [],
        }
    },

    tap(x, y) {
        const entities = hitEntitiesAtPoint('note', x, y)

        if (entities.some((entity) => selectedEntities.value.includes(entity))) {
            applyGeneratedSlideNotes(
                selectedEntities.value.filter((entity) => entity.type === 'note'),
            )
            focusEntityAtBeat(yToValidBeat(y))
        } else {
            const [entity] = entities
            if (entity) {
                applyGeneratedSlideNotes(entities)
                focusEntityAtBeat(entity.beat)
            } else {
                const selectedLength = selectedEntities.value.length

                replaceState({
                    ...state.value,
                    selectedEntities: [],
                })
                view.entities = {
                    hovered: [],
                    creating: [],
                }

                focusViewAtBeat(yToValidBeat(y))
                if (selectedLength) notify(() => i18n.value.tools.generateSlideNotes.deselected)
            }
        }
    },

    dragStart(x, y) {
        active = {
            lane: xToLane(x),
            time: yToTime(y),
            count: -1,
        }

        return true
    },

    dragUpdate(x, y) {
        if (!active) return

        setViewHover(y)

        const selection = toSelection(active.lane, active.time, x, y)
        const targets = hitEntitiesInSelection('note', selection)

        replaceState({
            ...state.value,
            selectedEntities: targets,
        })
        view.selection = selection
        view.entities = {
            hovered: [],
            creating: [],
        }

        if (active.count === targets.length) return
        active.count = targets.length

        notify(
            interpolate(() => i18n.value.tools.generateSlideNotes.selecting, `${targets.length}`),
        )
    },

    dragEnd(x, y) {
        if (!active) return

        const selection = toSelection(active.lane, active.time, x, y)

        view.selection = undefined

        applyGeneratedSlideNotes(hitEntitiesInSelection('note', selection))

        active = undefined
    },

    dragCancel() {
        active = undefined
    },
}

export const applyGeneratedSlideNotes = (notes: NoteEntity[]) => {
    const transaction = createTransaction(state.value)

    const entities: Entity[] = []

    const slides = new Map<SlideId, [NoteEntity, ...NoteEntity[]]>()
    for (const note of notes) {
        const slide = slides.get(note.slideId)
        if (slide) {
            slide.push(note)
        } else {
            slides.set(note.slideId, [note])
        }
    }

    for (const [slideId, notes] of slides) {
        let minBeat = Number.POSITIVE_INFINITY
        let maxBeat = Number.NEGATIVE_INFINITY
        if (notes.length > 1) {
            for (const joint of notes) {
                minBeat = Math.min(minBeat, joint.beat)
                maxBeat = Math.max(maxBeat, joint.beat)
            }
        } else {
            const notes = store.value.slides.note.get(slideId)
            if (!notes) throw new Error('Unexpected range not found')

            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            minBeat = notes[0]!.beat
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            maxBeat = notes.at(-1)!.beat
        }

        const slideNotes = store.value.slides.note.get(slideId)
        if (!slideNotes) throw new Error('Unexpected notes not found')

        const disallowed = new Set(slideNotes.map((entity) => entity.beat * view.division))

        const min = Math.floor(minBeat * view.division) + 1
        const max = Math.ceil(maxBeat * view.division) - 1
        for (let i = min; i <= max; i++) {
            if (disallowed.has(i)) continue

            const beat = i / view.division

            const index = bisect(slideNotes, 'beat', beat)
            const nearest = slideNotes[index - 1] ?? slideNotes[index]

            entities.push(
                ...addNote(transaction, slideId, {
                    groupId: view.groupId ?? nearest?.groupId ?? defaultGroupId.value,
                    stageId: view.stageId ?? nearest?.stageId ?? defaultStageId.value,
                    beat,
                    left: 0,
                    elevation: defaultSlideProperties.value.elevation ?? nearest?.elevation ?? 0,
                    noteStyle:
                        defaultSlideProperties.value.noteStyle ?? nearest?.noteStyle ?? 'default',
                    connectorStyle:
                        defaultSlideProperties.value.connectorStyle ??
                        nearest?.connectorStyle ??
                        'default',
                    noteType:
                        defaultSlideProperties.value.noteType ?? nearest?.noteType ?? 'default',
                    isAttached: true,
                    size: 0,
                    isCritical:
                        defaultSlideProperties.value.isCritical ?? nearest?.isCritical ?? false,
                    flickDirection:
                        defaultSlideProperties.value.flickDirection ??
                        nearest?.flickDirection ??
                        'none',
                    isFake: defaultSlideProperties.value.isFake ?? nearest?.isFake ?? false,
                    sfx: defaultSlideProperties.value.sfx ?? nearest?.sfx ?? 'default',
                    isConnectorSeparator:
                        defaultSlideProperties.value.isConnectorSeparator ?? false,
                    connectorType:
                        defaultSlideProperties.value.connectorType ??
                        nearest?.connectorType ??
                        'active',
                    connectorEase: applyEaseEdit<Ease>(
                        defaultSlideProperties.value.connectorEase,
                        'linear',
                    ),
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
                        defaultSlideProperties.value.connectorGuideAlpha ??
                        nearest?.connectorGuideAlpha ??
                        1,
                    connectorLayer:
                        defaultSlideProperties.value.connectorLayer ??
                        nearest?.connectorLayer ??
                        'top',
                    connectorIsPassThrough:
                        defaultSlideProperties.value.connectorIsPassThrough ??
                        nearest?.connectorIsPassThrough ??
                        false,
                    connectorPresentation:
                        defaultSlideProperties.value.connectorPresentation ??
                        nearest?.connectorPresentation ??
                        'default',
                }),
            )
        }
    }

    // Authoring reveals its target so generated notes never vanish.
    revealAuthoredEntities(entities)
    pushState(
        interpolate(() => i18n.value.tools.generateSlideNotes.generated, `${entities.length}`),
        transaction.commit(entities),
    )
    view.entities = {
        hovered: [],
        creating: [],
    }

    notify(interpolate(() => i18n.value.tools.generateSlideNotes.generated, `${entities.length}`))
}
