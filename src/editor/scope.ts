import { computed } from 'vue'
import type { GroupId } from '../chart/groups'
import type { StageId } from '../chart/stages'
import { isDynamicStages } from '../history/dynamicStages'
import { groups } from '../history/groups'
import { onResetState } from '../history/resetHooks'
import { stages } from '../history/stages'
import { settings } from '../settings'
import type { Entity } from '../state/entities'
import { switchToGroup } from './commands/groups'
import { switchToStage } from './commands/stages'
import {
    createScopeLookup,
    entityScopeIds,
    entityScopeVisibility,
    followShowOthers,
    resolveScopeVisibility,
    type ScopeOverride,
    type ScopeVisibility,
} from './scopeRules'
import { view } from './view'

/**
 * Group and stage visibility in the main and elevation editors.
 *
 * Three concepts stay separate:
 * - The focused entry (`view.groupId` / `view.stageId`) is both the authoring
 *   target for new objects and the editing scope; only focused entries are
 *   interactive when a focus is set.
 * - `settings.showOtherGroups` / `showOtherStages` decide whether unfocused
 *   entries are dimmed or hidden by default.
 * - Explicit overrides show or hide individual entries. They are transient view
 *   state: never saved, never in history, and never read by the preview,
 *   serialization, or the clipboard. Authoring never reads them either, so
 *   hiding an entry never reassigns newly created objects. The All commands
 *   clear them (deleted entries keep theirs for undo), and changing a
 *   show-other setting drops those contradicting it.
 *
 * The pure rules, including how each entity type maps onto groups and stages,
 * live in `scopeRules.ts`.
 */
export { resolveScopeVisibility }
export type { ScopeOverride, ScopeVisibility }

const createScope = <T>(options: {
    ids: () => T[]
    isEnabled: () => boolean
    getFocus: () => T | undefined
    setFocus: (id: T | undefined) => void
    getOverrides: () => ReadonlyMap<T, ScopeOverride>
    setOverrides: (overrides: ReadonlyMap<T, ScopeOverride>) => void
    showOthers: () => boolean
}) => {
    const visibility = (id: T): ScopeVisibility =>
        options.isEnabled()
            ? resolveScopeVisibility(
                  id,
                  options.getFocus(),
                  options.getOverrides().get(id),
                  options.showOthers(),
              )
            : 'full'

    const withOverride = (
        overrides: Map<T, ScopeOverride>,
        id: T,
        shown: boolean,
    ): Map<T, ScopeOverride> => {
        const focus = options.getFocus()
        if (!shown) {
            overrides.set(id, 'hidden')
        } else if (focus !== undefined && focus !== id) {
            // Remember an explicit show even while `showOther*` already dims the
            // entry, so turning that setting off later keeps it visible.
            overrides.set(id, 'shown')
        } else {
            overrides.delete(id)
        }
        return overrides
    }

    const shownCount = computed(
        () => options.ids().filter((id) => visibility(id) !== 'hidden').length,
    )

    return {
        visibility,

        isShown: (id: T) => visibility(id) !== 'hidden',

        /** Shows or hides one entry without changing the authoring target. */
        setShown(id: T, shown: boolean) {
            options.setOverrides(withOverride(new Map(options.getOverrides()), id, shown))
        },

        /** Shows or hides several entries as one change, e.g. a folder's members. */
        setSomeShown(ids: readonly T[], shown: boolean) {
            const overrides = new Map(options.getOverrides())
            for (const id of ids) withOverride(overrides, id, shown)
            options.setOverrides(overrides)
        },

        /**
         * Shows exactly these entries and hides the rest, as one change. Deleted
         * entries keep their overrides, so undoing the delete restores them as they were.
         */
        showOnly(ids: readonly T[]) {
            const shown = new Set(ids)
            const overrides = new Map(options.getOverrides())
            for (const id of options.ids()) withOverride(overrides, id, shown.has(id))
            options.setOverrides(overrides)
        },

        /** Shows a hidden entry; already visible entries are left unchanged. */
        reveal(id: T) {
            if (visibility(id) !== 'hidden') return
            options.setOverrides(withOverride(new Map(options.getOverrides()), id, true))
        },

        /** Shows or hides every entry without changing the authoring target; deleted ones keep theirs. */
        setAllShown(shown: boolean) {
            const overrides = new Map(options.getOverrides())
            for (const id of options.ids()) withOverride(overrides, id, shown)
            options.setOverrides(overrides)
        },

        /** Focuses an entry, revealing it if hidden; `undefined` clears the focus but keeps hides. */
        focus(id: T | undefined) {
            if (id !== undefined && options.getOverrides().get(id) === 'hidden') {
                const overrides = new Map(options.getOverrides())
                overrides.delete(id)
                options.setOverrides(overrides)
            }
            options.setFocus(id)
        },

        /**
         * The All command: clears the focus and every current entry's override,
         * showing everything; deleted ones keep theirs.
         */
        focusAll() {
            const overrides = new Map(options.getOverrides())
            for (const id of options.ids()) overrides.delete(id)
            if (overrides.size < options.getOverrides().size) options.setOverrides(overrides)
            options.setFocus(undefined)
        },

        shownCount,
        totalCount: computed(() => options.ids().length),

        /** Drops overrides contradicting the show-others setting after it changed. */
        followSetting() {
            options.setOverrides(followShowOthers(options.getOverrides(), options.showOthers()))
        },

        /** Drops every override while the entries are disabled. */
        pruneDisabled() {
            if (options.isEnabled() || !options.getOverrides().size) return
            options.setOverrides(new Map())
        },
    }
}

export const groupScope = createScope<GroupId>({
    ids: () => [...groups.value.keys()],
    isEnabled: () => true,
    getFocus: () => view.groupId,
    // Late-bound: the commands import this module.
    setFocus: (id) => {
        switchToGroup(id)
    },
    getOverrides: () => view.groupVisibility,
    setOverrides: (overrides) => (view.groupVisibility = overrides),
    showOthers: () => settings.showOtherGroups,
})

export const stageScope = createScope<StageId>({
    ids: () => [...stages.value.keys()],
    isEnabled: () => isDynamicStages.value,
    getFocus: () => view.stageId,
    setFocus: (id) => {
        switchToStage(id)
    },
    getOverrides: () => view.stageVisibility,
    setOverrides: (overrides) => (view.stageVisibility = overrides),
    showOthers: () => settings.showOtherStages,
})

/**
 * The current effective visibility of every group and stage, captured as plain
 * values. A new snapshot is produced whenever the focus, the overrides, the
 * related settings or dynamic stages change (never on selection changes), so
 * its identity doubles as a scope version: gestures and deferred edits started
 * under one snapshot are cancelled when it changes.
 */
export const scopeLookup = computed(() =>
    createScopeLookup({
        groupId: view.groupId,
        stageId: view.stageId,
        groupVisibility: view.groupVisibility,
        stageVisibility: view.stageVisibility,
        showOtherGroups: settings.showOtherGroups,
        showOtherStages: settings.showOtherStages,
        isDynamicStages: isDynamicStages.value,
    }),
)

/** Whether the entity shows: its type is visible and its group and stage aren't hidden. */
export const isEntityShown = (entity: Entity) =>
    view.visibilities[entity.type] && entityScopeVisibility(entity, scopeLookup.value) !== 'hidden'

/** Whether the entity's group and stage allow hovering, selecting and editing it. */
export const isEntityInScope = (entity: Entity) =>
    entityScopeVisibility(entity, scopeLookup.value) === 'full'

/**
 * Authoring reveals its target: an object created, pasted or placed into a
 * hidden group or stage would otherwise vanish, and a placement could replace
 * an object the user cannot see. Call before applying the edit. This is a view
 * change only and never enters history.
 */
export const revealAuthoringTarget = (target: { groupId?: GroupId; stageId?: StageId }) => {
    if (target.groupId !== undefined) groupScope.reveal(target.groupId)
    if (target.stageId !== undefined) stageScope.reveal(target.stageId)
}

/** Reveals the groups and stages of newly authored entities. */
export const revealAuthoredEntities = (entities: Iterable<Entity>) => {
    for (const entity of entities) revealAuthoringTarget(entityScopeIds(entity))
}

// Ids are reused across charts, so a new chart or replaced history starts with
// a clean focus and no visibility overrides.
onResetState(() => {
    view.groupId = undefined
    view.stageId = undefined
    view.groupVisibility = new Map()
    view.stageVisibility = new Map()
})
