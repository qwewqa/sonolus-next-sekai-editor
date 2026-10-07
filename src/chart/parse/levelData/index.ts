import type { LevelDataEntity } from '@sonolus/core'
import Type from 'typebox'
import Value from 'typebox/value'
import type { Chart } from '../..'
import { settings } from '../../../settings'
import {
    groupFolderArchetype,
    normalizeFolders,
    stageFolderArchetype,
    type FolderId,
    type Folders,
} from '../../folders'
import { addToGroups, type GroupId, type GroupObject } from '../../groups'
import { addDefaultStageToStages, addToStages, type StageId, type StageObject } from '../../stages'
import { parseBpmsToChart } from './bpm'
import { parseCameraEventsToChart } from './events/camera'
import { parseStageMaskEventsToChart } from './events/stage/mask'
import { parseStagePivotEventsToChart } from './events/stage/pivot'
import { parseStageStyleEventsToChart } from './events/stage/style'
import { parseStageTransformEventsToChart } from './events/stage/transform'
import { parseFoldersToChart } from './folder'
import { parseGroupsToChart } from './group'
import { parseInitializationToChart } from './initialization'
import { parseSlidesToChart } from './slide'
import { parseStagesToChart } from './stage'
import { parseTimeScalesToChart } from './timeScale'

export type ParseCtx = {
    chart: Chart
    entities: LevelDataEntity[]
    defaultGuideColors: ReadonlySet<LevelDataEntity>

    /** The folder an entity's `editorFolder` ref names, if it exists. */
    getGroupFolderId: (entity: LevelDataEntity) => FolderId | undefined
    getStageFolderId: (entity: LevelDataEntity) => FolderId | undefined

    getGroupId: (entity: LevelDataEntity) => GroupId
    addGroup: (
        name: string | undefined,
        editorName: string | undefined,
        object: Omit<GroupObject, 'name'>,
    ) => void

    getStageId: (entity: LevelDataEntity) => StageId
    addStage: (
        name: string | undefined,
        editorName: string | undefined,
        object: Omit<StageObject, 'name'>,
    ) => StageId
}

export const parseLevelDataChart = (
    entities: LevelDataEntity[],
    defaultGuideColors: readonly number[] = [],
): Chart => {
    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: false,
        bpms: [],
        groups: new Map(),
        stages: new Map(),
        cameraEvents: [],
        stageMaskEvents: [],
        stagePivotEvents: [],
        stageStyleEvents: [],
        stageTransformEvents: [],
        timeScales: [],
        slides: [],
    }

    const groupFolders: Folders = new Map()
    const stageFolders: Folders = new Map()
    const groupFolderIds = parseFoldersToChart({ entities }, groupFolderArchetype, groupFolders)
    const stageFolderIds = parseFoldersToChart({ entities }, stageFolderArchetype, stageFolders)
    const folderIdOf = (ids: Map<string, FolderId>, entity: LevelDataEntity) => {
        const ref = getOptionalRef(entity, 'editorFolder')
        return ref === undefined ? undefined : ids.get(ref)
    }

    const groupIds: Record<string, GroupId> = {}
    const stageIds: Record<string, StageId> = {}
    let defaultStageId: StageId

    const ctx: ParseCtx = {
        chart,
        entities,
        defaultGuideColors: new Set(defaultGuideColors.flatMap((index) => entities[index] ?? [])),

        getGroupFolderId: (entity) => folderIdOf(groupFolderIds, entity),
        getStageFolderId: (entity) => folderIdOf(stageFolderIds, entity),

        getGroupId(entity) {
            const ref = getRef(entity, '#TIMESCALE_GROUP')
            const id = groupIds[ref]
            if (!id) throw new Error(`Invalid level: ref "${ref}" not found`)

            return id
        },
        addGroup(name, editorName, object) {
            const [id] = addToGroups(chart.groups, editorName, object)

            if (name) {
                groupIds[name] = id
            }
        },

        getStageId(entity) {
            const ref = getOptionalRef(entity, 'stage')
            if (chart.isDynamicStages) {
                if (ref === undefined) throw new Error(`Invalid level: data stage not found`)

                const id = stageIds[ref]
                if (!id) throw new Error(`Invalid level: ref "${ref}" not found`)

                return id
            } else {
                if (ref !== undefined) throw new Error(`Invalid level: ref "${ref}" not found`)

                return defaultStageId
            }
        },
        addStage(name, editorName, object) {
            chart.isDynamicStages = true
            const [id] = addToStages(chart.stages, editorName, object)

            if (name) {
                stageIds[name] = id
            }

            return id
        },
    }

    const firstCameraRef = parseInitializationToChart(ctx)

    parseBpmsToChart(ctx)

    parseGroupsToChart(ctx)
    while (chart.groups.size < (settings.autoAddGroup ? 2 : 1)) {
        addToGroups(chart.groups)
    }

    const { firstMaskRefs, firstPivotRefs, firstStyleRefs, firstTransformRefs } =
        parseStagesToChart(ctx)
    if (!chart.stages.size) {
        ;[defaultStageId] = addDefaultStageToStages(chart.stages)
    }

    // Folders gather their members wherever the file listed them.
    ;({ entries: chart.groups, folders: chart.groupFolders } = normalizeFolders(
        chart.groups,
        groupFolders,
    ))
    // Stage folders exist only with dynamic stages.
    if (chart.isDynamicStages)
        ({ entries: chart.stages, folders: chart.stageFolders } = normalizeFolders(
            chart.stages,
            stageFolders,
        ))

    parseCameraEventsToChart(ctx, firstCameraRef)

    parseStageMaskEventsToChart(ctx, firstMaskRefs)
    parseStagePivotEventsToChart(ctx, firstPivotRefs)
    parseStageStyleEventsToChart(ctx, firstStyleRefs)
    parseStageTransformEventsToChart(ctx, firstTransformRefs)

    parseTimeScalesToChart(ctx)

    parseSlidesToChart(ctx)

    return chart
}

// A choice the editor doesn't know is unknown; other refused values are invalid.
const assertValue: <T extends Type.TSchema>(
    name: string,
    schema: T,
    value: unknown,
) => asserts value is Type.Static<T> = (name, schema, value) => {
    if (Value.Check(schema, value)) return
    const isChoice = Type.IsUnion(schema) && schema.anyOf.every((option) => Type.IsLiteral(option))
    const words = name
        .replace(/^#/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase()
    throw new Error(`Invalid level: ${isChoice ? 'unknown' : 'invalid'} ${words}`)
}

export const getValue = <T extends Type.TSchema>(
    entity: LevelDataEntity,
    name: string,
    schema: T,
) => {
    const data = entity.data.find((data) => data.name === name)
    if (!data) throw new Error(`Invalid level: data ${name} not found`)
    if (!('value' in data)) throw new Error(`Invalid level: data ${name} has no value`)

    assertValue(name, schema, data.value)
    return data.value
}

export const getOptionalValue = <T extends Type.TSchema>(
    entity: LevelDataEntity,
    name: string,
    schema: T,
) => {
    const data = entity.data.find((data) => data.name === name)
    if (!data) return
    if (!('value' in data)) return

    assertValue(name, schema, data.value)
    return data.value
}

export const getRef = (entity: LevelDataEntity, name: string) => {
    const data = entity.data.find((data) => data.name === name)
    if (!data) throw new Error(`Invalid level: data ${name} not found`)
    if (!('ref' in data)) throw new Error(`Invalid level: data ${name} has no ref`)

    return data.ref
}

export const getOptionalRef = (entity: LevelDataEntity, name: string) => {
    const data = entity.data.find((data) => data.name === name)
    if (!data) return
    if (!('ref' in data)) return

    return data.ref
}
