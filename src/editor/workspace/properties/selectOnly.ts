import { replaceState, state } from '../../../history'
import { i18n } from '../../../i18n'
import type { Entity } from '../../../state/entities'
import { interpolate } from '../../../utils/interpolate'
import { notify } from '../../notification'

/** Narrows the selection; like other selection changes it is not an edit. */
export const selectOnly = (entities: Entity[]) => {
    replaceState({
        ...state.value,
        selectedEntities: entities,
    })
    notify(interpolate(() => i18n.value.workspace.manager.selected, `${entities.length}`))
}
