import type { GroupId } from '../chart/groups'
import type { StageId } from '../chart/stages'
import type { Entity } from '../state/entities'

/**
 * Pure group/stage visibility rules shared by the main and elevation editors.
 * This module intentionally has no runtime imports so it stays testable; the
 * reactive wiring lives in `scope.ts`.
 */
export type ScopeOverride = 'shown' | 'hidden'

/** `full` entries are interactive; `dimmed` entries are drawn faintly only. */
export type ScopeVisibility = 'full' | 'dimmed' | 'hidden'

export const resolveScopeVisibility = <T>(
    id: T,
    focus: T | undefined,
    override: ScopeOverride | undefined,
    showOthers: boolean,
): ScopeVisibility => {
    // Isolation is temporary: saved All-view choices never override the focus.
    if (!showOthers && focus !== undefined) return id === focus ? 'full' : 'hidden'
    if (override === 'hidden') return 'hidden'
    if (focus === undefined || focus === id) return 'full'
    if (override === 'shown' || showOthers) return 'dimmed'
    return 'hidden'
}

/** The entry Next (`1`) or Previous (`-1`) focuses; `undefined` is All, between the ends. */
export const stepFocus = <T>(ids: readonly T[], focus: T | undefined, step: 1 | -1) => {
    const index = focus === undefined ? -1 : ids.indexOf(focus)
    if (index < 0) return step > 0 ? ids[0] : ids.at(-1)
    return ids[index + step]
}

const ranks: Record<ScopeVisibility, number> = { hidden: 0, dimmed: 1, full: 2 }

/** Both scopes must allow the entity: the less visible of the two. */
export const worstScope = (a: ScopeVisibility, b: ScopeVisibility) => (ranks[a] <= ranks[b] ? a : b)

/** Either scope suffices: the more visible of the two. */
export const bestScope = (a: ScopeVisibility, b: ScopeVisibility) => (ranks[a] >= ranks[b] ? a : b)

/** A snapshot of the effective visibility of every group and stage. */
export type ScopeLookup = {
    readonly group: (id: GroupId) => ScopeVisibility
    readonly stage: (id: StageId) => ScopeVisibility
    /** The inputs the lookup was created from, when known. */
    readonly inputs?: Readonly<Required<Omit<ScopeInputs, 'groupId' | 'stageId'>>> &
        Pick<ScopeInputs, 'groupId' | 'stageId'>
}

export type ScopeInputs = {
    groupId?: GroupId
    stageId?: StageId
    groupVisibility?: ReadonlyMap<GroupId, ScopeOverride>
    stageVisibility?: ReadonlyMap<StageId, ScopeOverride>
    showOtherGroups?: boolean
    showOtherStages?: boolean
    /** Without dynamic stages every stage is fully visible. */
    isDynamicStages?: boolean
}

const noOverrides = new Map<never, ScopeOverride>()

/**
 * Captures plain values, so the result can be used from untracked render
 * callbacks and compared by identity to detect scope changes.
 */
export const createScopeLookup = ({
    groupId,
    stageId,
    groupVisibility = noOverrides,
    stageVisibility = noOverrides,
    showOtherGroups = true,
    showOtherStages = true,
    isDynamicStages = true,
}: ScopeInputs): ScopeLookup => ({
    group: (id) => resolveScopeVisibility(id, groupId, groupVisibility.get(id), showOtherGroups),
    stage: isDynamicStages
        ? (id) => resolveScopeVisibility(id, stageId, stageVisibility.get(id), showOtherStages)
        : () => 'full',
    inputs: {
        groupId,
        stageId,
        groupVisibility,
        stageVisibility,
        showOtherGroups,
        showOtherStages,
        isDynamicStages,
    },
})

const overrideRanks = { hidden: 0, none: 1, shown: 2 }

const reducesOverrides = <T>(
    previous: ReadonlyMap<T, ScopeOverride>,
    next: ReadonlyMap<T, ScopeOverride>,
) => {
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
        if (overrideRanks[next.get(id) ?? 'none'] < overrideRanks[previous.get(id) ?? 'none'])
            return true
    }
    return false
}

/**
 * Whether going from `previous` to `next` may make any entry less visible.
 * Pure reveals (showing entries) never hide the object of an active gesture,
 * so they do not need to cancel it. Focus, settings and dynamic stage changes
 * are conservatively treated as reductions.
 */
export const isScopeReduced = (previous: ScopeLookup | undefined, next: ScopeLookup) => {
    const a = previous?.inputs
    const b = next.inputs
    if (!a || !b) return true
    return (
        a.groupId !== b.groupId ||
        a.stageId !== b.stageId ||
        a.showOtherGroups !== b.showOtherGroups ||
        a.showOtherStages !== b.showOtherStages ||
        a.isDynamicStages !== b.isDynamicStages ||
        reducesOverrides(a.groupVisibility, b.groupVisibility) ||
        reducesOverrides(a.stageVisibility, b.stageVisibility)
    )
}

/** The groups and stages an entity belongs to, for revealing authored objects. */
export const entityScopeIds = (entity: Entity): { groupId?: GroupId; stageId?: StageId } => {
    switch (entity.type) {
        case 'note':
            return { groupId: entity.groupId, stageId: entity.stageId }
        case 'timeScale':
            return { groupId: entity.groupId }
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
            return { stageId: entity.stageId }
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
            return { stageId: entity.min.stageId }
        case 'connector':
            return {}
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
            return {}
    }
}

export const fullScope: ScopeLookup = {
    group: () => 'full',
    stage: () => 'full',
}

const noteScope = (note: { groupId: GroupId; stageId: StageId }, scope: ScopeLookup) =>
    worstScope(scope.group(note.groupId), scope.stage(note.stageId))

/**
 * Effective group/stage visibility of an entity.
 *
 * - BPM and camera events belong to no group or stage.
 * - Time scales only belong to a group; stage events only to a stage (event
 *   connections use their earlier joint's stage).
 * - Notes need both their group and their stage.
 * - Connectors are drawn between their attach endpoints (`attachHead` and
 *   `attachTail`), the non-attached notes that define the connector's
 *   position. Each endpoint is evaluated like a note (the worse of its group
 *   and stage), and the connector takes the more visible endpoint. A connector
 *   therefore stays drawn alongside any visible endpoint, and disappears once
 *   both endpoints are hidden, whichever axis hides each of them.
 */
export const entityScopeVisibility = (entity: Entity, scope: ScopeLookup): ScopeVisibility => {
    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
            return 'full'
        case 'timeScale':
            return scope.group(entity.groupId)
        case 'note':
            return noteScope(entity, scope)
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
            return scope.stage(entity.stageId)
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
            return scope.stage(entity.min.stageId)
        case 'connector':
            return bestScope(
                noteScope(entity.attachHead, scope),
                noteScope(entity.attachTail, scope),
            )
    }
}
