import type { State } from '.'
import { addToGroups, type GroupId, type Groups } from '../chart/groups'
import { settings } from '../settings'
import { nearlyEqual } from '../utils/math'
import type { Entity } from './entities'
import type { SlideId } from './entities/slides'
import type { SlideInfos } from './entities/slides/hiddenTicks'
import { beatToTime, calculateBpms, type BpmIntegral } from './integrals/bpms'
import { rebuildSlide } from './mutations/slides'
import { createStoreGridOwnership } from './store/grid'
import { createSlideNoteDrafts } from './store/slideNoteDrafts'

export type Transaction = ReturnType<typeof createTransaction>

export type TransactionOptions = { autoAddGroup?: boolean }

export const createTransaction = (
    state: State,
    { autoAddGroup = true }: TransactionOptions = {},
) => {
    let currentState = state
    const grid = createMapObjectTransaction(state.store.grid)
    const gridOwnership = createStoreGridOwnership(grid.accessor)
    const globalEventRanges = { ...state.store.globalEventRanges }
    const stageEventRanges = createMapObjectTransaction(state.store.stageEventRanges)
    const slides = createMapObjectTransaction(state.store.slides)
    const noteDrafts = createSlideNoteDrafts(() => slides.accessor.note)
    const dirtySlideIds = new Set<SlideId>()

    let lastGroup: GroupId | undefined
    let groups: Groups | undefined

    let bpms: BpmIntegral[] | undefined

    return {
        store: {
            grid: grid.accessor,
            globalEventRanges,
            stageEventRanges: stageEventRanges.accessor,
            slides: {
                get note() {
                    return noteDrafts.readMap()
                },
                get info() {
                    return slides.accessor.info
                },
                get connector() {
                    return slides.accessor.connector
                },
            },
            noteDrafts,

            markDirty(slideId: SlideId) {
                dirtySlideIds.add(slideId)
            },
        },

        addToGroup: (groupId: GroupId) => {
            // Speculative preview edits do not need the editor's trailing empty
            // group. Preserve group identity so unchanged preview notes stay cached.
            if (!autoAddGroup || !settings.autoAddGroup) return

            lastGroup ??= [...currentState.groups.keys()].at(-1)
            if (groupId !== lastGroup) return

            groups = new Map(currentState.groups)
            addToGroups(groups)
        },

        get bpms() {
            return (bpms ??= [...currentState.bpms])
        },

        commit(selectedEntities: Entity[]): State {
            // Rebuilding can replace attached selections. The caller may pass a
            // published state's selection, which must remain part of its history.
            const selection = [...selectedEntities]
            if (bpms) {
                bpms = calculateBpms(bpms)
                // Attached notes sit at their time fraction, which BPM changes may move.
                const newBpms = bpms
                const fraction = (
                    bpms: BpmIntegral[],
                    { note, attachHead, attachTail }: SlideInfos[number],
                ) => {
                    const head = beatToTime(bpms, attachHead.beat)
                    return (
                        (beatToTime(bpms, note.beat) - head) /
                        (beatToTime(bpms, attachTail.beat) - head)
                    )
                }
                for (const [slideId, infos] of currentState.store.slides.info) {
                    if (dirtySlideIds.has(slideId)) continue
                    if (
                        !infos.some(
                            (info) =>
                                info.note !== info.attachHead &&
                                info.note !== info.attachTail &&
                                !nearlyEqual(
                                    fraction(currentState.bpms, info),
                                    fraction(newBpms, info),
                                ),
                        )
                    )
                        continue
                    const notes = slides.accessor.note.get(slideId)
                    if (!notes) continue
                    // prepare() acquires an owned array before rebuilding.
                    dirtySlideIds.add(slideId)
                }
            }

            for (const slideId of dirtySlideIds) {
                noteDrafts.prepare(slideId)
                rebuildSlide(this.store, slideId, selection, bpms ?? currentState.bpms)
            }

            const result: State = {
                ...currentState,
                store: {
                    grid: {
                        ...currentState.store.grid,
                        ...grid.value,
                    },
                    globalEventRanges: { ...globalEventRanges },
                    stageEventRanges: {
                        ...currentState.store.stageEventRanges,
                        ...stageEventRanges.value,
                    },
                    slides: {
                        ...currentState.store.slides,
                        ...slides.value,
                    },
                },
                bpms: bpms ?? currentState.bpms,
                groups: groups ?? currentState.groups,
                selectedEntities: selection,
            }

            // Published maps, buckets, and arrays become shared history. A later
            // edit through this transaction must acquire fresh ownership.
            currentState = result
            noteDrafts.reset()
            slides.checkpoint()
            stageEventRanges.checkpoint()
            grid.checkpoint()
            gridOwnership.reset()
            dirtySlideIds.clear()
            bpms = undefined
            groups = undefined
            lastGroup = undefined
            return result
        },
    }
}

const createMapObjectTransaction = <T extends Record<string, Map<unknown, unknown>>>(object: T) => {
    let sources = object
    const value: Record<string, Map<unknown, unknown>> = {}

    return {
        accessor: Object.defineProperties(
            {},
            Object.fromEntries(
                Object.keys(object).map((k) => [
                    k,
                    {
                        get: () => (value[k] ??= new Map(sources[k])),
                    },
                ]),
            ),
        ) as T,

        value: value as Partial<T>,
        checkpoint() {
            sources = { ...sources, ...value }
            for (const key of Object.keys(value)) Reflect.deleteProperty(value, key)
        },
    }
}
