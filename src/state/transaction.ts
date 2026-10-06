import type { State } from '.'
import { addToGroups, type GroupId, type Groups } from '../chart/groups'
import { settings } from '../settings'
import { nearlyEqual } from '../utils/math'
import type { Entity } from './entities'
import type { SlideId } from './entities/slides'
import type { SlideInfos } from './entities/slides/hiddenTicks'
import { beatToTime, calculateBpms, type BpmIntegral } from './integrals/bpms'
import { rebuildSlide } from './mutations/slides'

export type Transaction = ReturnType<typeof createTransaction>

export type TransactionOptions = { autoAddGroup?: boolean }

export const createTransaction = (
    state: State,
    { autoAddGroup = true }: TransactionOptions = {},
) => {
    const grid = createMapObjectTransaction(state.store.grid)
    const globalEventRanges = { ...state.store.globalEventRanges }
    const stageEventRanges = createMapObjectTransaction(state.store.stageEventRanges)
    const slides = createMapObjectTransaction(state.store.slides)
    const dirtySlideIds = new Set<SlideId>()

    let lastGroup: GroupId | undefined
    let groups: Groups | undefined

    let bpms: BpmIntegral[] | undefined

    return {
        store: {
            grid: grid.accessor,
            globalEventRanges,
            stageEventRanges: stageEventRanges.accessor,
            slides: slides.accessor,

            markDirty(slideId: SlideId) {
                dirtySlideIds.add(slideId)
            },
        },

        addToGroup: (groupId: GroupId) => {
            // Speculative preview edits do not need the editor's trailing empty
            // group. Preserve group identity so unchanged preview notes stay cached.
            if (!autoAddGroup || !settings.autoAddGroup) return

            lastGroup ??= [...state.groups.keys()].at(-1)
            if (groupId !== lastGroup) return

            groups = new Map(state.groups)
            addToGroups(groups)
        },

        get bpms() {
            return (bpms ??= [...state.bpms])
        },

        commit(selectedEntities: Entity[]): State {
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
                for (const [slideId, infos] of state.store.slides.info) {
                    if (dirtySlideIds.has(slideId)) continue
                    if (
                        !infos.some(
                            (info) =>
                                info.note !== info.attachHead &&
                                info.note !== info.attachTail &&
                                !nearlyEqual(fraction(state.bpms, info), fraction(newBpms, info)),
                        )
                    )
                        continue
                    const notes = this.store.slides.note.get(slideId)
                    if (!notes) continue
                    // Rebuilding sorts and replaces in place; keep the source state intact.
                    this.store.slides.note.set(slideId, [...notes])
                    dirtySlideIds.add(slideId)
                }
            }

            for (const slideId of dirtySlideIds) {
                rebuildSlide(this.store, slideId, selectedEntities, bpms ?? state.bpms)
            }

            return {
                ...state,
                store: {
                    grid: {
                        ...state.store.grid,
                        ...grid.value,
                    },
                    globalEventRanges,
                    stageEventRanges: {
                        ...state.store.stageEventRanges,
                        ...stageEventRanges.value,
                    },
                    slides: {
                        ...state.store.slides,
                        ...slides.value,
                    },
                },
                bpms: bpms ?? state.bpms,
                groups: groups ?? state.groups,
                selectedEntities,
            }
        },
    }
}

const createMapObjectTransaction = <T extends Record<string, Map<unknown, unknown>>>(object: T) => {
    const value: Record<string, Map<unknown, unknown>> = {}

    return {
        accessor: Object.defineProperties(
            {},
            Object.fromEntries(
                Object.entries(object).map(([k, v]) => [
                    k,
                    {
                        get: () => (value[k] ??= new Map(v)),
                    },
                ]),
            ),
        ) as T,

        value: value as Partial<T>,
    }
}
