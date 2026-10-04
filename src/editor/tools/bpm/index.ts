import type { Tool } from '..'
import type { BpmObject } from '../../../chart/bpm'
import { pushState, replaceState, state } from '../../../history'
import { selectedEntities } from '../../../history/selectedEntities'
import { store } from '../../../history/store'
import { i18n } from '../../../i18n'
import { clearPreviewEdit, setPreviewEdit } from '../../../preview/edit'
import type { Entity } from '../../../state/entities'
import { toBpmEntity, type BpmEntity } from '../../../state/entities/bpm'
import { addBpm } from '../../../state/mutations/bpm'
import { editBpm as applyBpmEdit, editSelectedBpm } from '../../../state/operations/bpm'
import { getInStoreGrid } from '../../../state/store/grid'
import { createTransaction, type Transaction } from '../../../state/transaction'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'
import { isSidebarVisible } from '../../sidebars'
import { showToolModal } from '../../toolModals'
import { focusEntityAtBeat, setViewHover, snapYToBeat, view, yToValidBeat } from '../../view'
import { hitEntitiesAtPoint } from '../utils'
import BpmPropertiesModal from './BpmPropertiesModal.vue'

let active:
    | {
          type: 'add'
      }
    | {
          type: 'move'
          entity: BpmEntity
      }
    | undefined

export const bpm: Tool = {
    title: () => i18n.value.tools.bpm.title,

    hover(x, y) {
        const [entity, beat] = tryFind(x, y)
        if (entity) {
            view.entities = {
                hovered: [entity],
                creating: [],
            }
        } else {
            view.entities = {
                hovered: [],
                creating: [
                    toBpmEntity({
                        beat,
                        bpm: 60,
                    }),
                ],
            }
        }
    },

    tap(x, y, modifiers) {
        const [entity, beat] = tryFind(x, y)
        if (entity) {
            if (modifiers.ctrl) {
                const selectedBpmEntities: Entity[] = selectedEntities.value.filter(
                    (entity) => entity.type === 'bpm',
                )

                const targets = selectedBpmEntities.includes(entity)
                    ? selectedBpmEntities.filter((e) => e !== entity)
                    : [...selectedBpmEntities, entity]

                replaceState({
                    ...state.value,
                    selectedEntities: targets,
                })
                view.entities = {
                    hovered: [],
                    creating: [],
                }
                focusEntityAtBeat(entity.beat)

                notify(interpolate(() => i18n.value.tools.bpm.selected, `${targets.length}`))
            } else {
                if (selectedEntities.value.includes(entity)) {
                    focusEntityAtBeat(entity.beat)

                    if (!isSidebarVisible.value) {
                        void showToolModal(BpmPropertiesModal, {})
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

                    notify(interpolate(() => i18n.value.tools.bpm.selected, '1'))
                }
            }
        } else {
            const object: BpmObject = {
                beat,
                bpm: 60,
            }

            const overlap = find(object.beat)
            if (overlap) {
                edit(overlap, object)
            } else {
                add(object)
            }
            focusEntityAtBeat(object.beat)

            void showToolModal(BpmPropertiesModal, {})
        }
    },

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

            notify(interpolate(() => i18n.value.tools.bpm.moving, '1'))

            active = {
                type: 'move',
                entity,
            }
        } else {
            focusEntityAtBeat(beat)

            notify(interpolate(() => i18n.value.tools.bpm.adding, '1'))

            active = {
                type: 'add',
            }
        }

        return true
    },

    dragUpdate(x, y) {
        if (!active) return

        setViewHover(y)

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
                            toBpmEntity({
                                beat,
                                bpm: 60,
                            }),
                        ],
                    }
                    focusEntityAtBeat(beat)
                }
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)
                const object: BpmObject = {
                    beat,
                    bpm: active.entity.bpm,
                }

                view.entities = {
                    hovered: [],
                    creating: [toBpmEntity(object)],
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

                    void showToolModal(BpmPropertiesModal, {})
                } else {
                    const object: BpmObject = {
                        beat,
                        bpm: 60,
                    }

                    const overlap = find(object.beat)
                    if (overlap) {
                        edit(overlap, object)
                    } else {
                        add(object)
                    }
                    focusEntityAtBeat(object.beat)

                    void showToolModal(BpmPropertiesModal, {})
                }
                break
            }
            case 'move': {
                const beat = snapYToBeat(y, active.entity.beat)

                editMoveOrReplace(active.entity, {
                    beat,
                    bpm: active.entity.bpm,
                })
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

export const editBpm = (entity: BpmEntity, object: Partial<BpmObject>) => {
    editMoveOrReplace(entity, object)
}

const find = (beat: number) =>
    getInStoreGrid(store.value.grid, 'bpm', beat)?.find((entity) => entity.beat === beat)

const tryFind = (x: number, y: number): [BpmEntity] | [undefined, number] => {
    const [hit] = hitEntitiesAtPoint('bpm', x, y).sort(
        (a, b) => +selectedEntities.value.includes(b) - +selectedEntities.value.includes(a),
    )
    if (hit) return [hit]

    const beat = yToValidBeat(y)
    const nearest = find(beat)
    if (nearest) return [nearest]

    return [undefined, beat]
}

const previewMove = (entity: BpmEntity, object: BpmObject) => {
    const source = state.value
    setPreviewEdit(source, () => {
        const transaction = createTransaction(source, { autoAddGroup: false })
        return transaction.commit(applyBpmEdit(transaction, entity, object))
    }, [entity, object.beat, object.bpm])
}

const editMoveOrReplace = (entity: BpmEntity, object: Partial<BpmObject>) => {
    const beat = object.beat ?? entity.beat
    const message = entity.beat === beat ? 'edited' : find(beat) ? 'replaced' : 'moved'
    update(
        () => i18n.value.tools.bpm[message],
        (transaction) => applyBpmEdit(transaction, entity, object),
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

const add = (object: BpmObject) => {
    update(
        () => i18n.value.tools.bpm.added,
        (transaction) => {
            return addBpm(transaction, object)
        },
    )
}

const edit = (entity: BpmEntity, object: BpmObject) => {
    update(
        () => i18n.value.tools.bpm.edited,
        (transaction) => editSelectedBpm(transaction, entity, object),
    )
}
