import type { Chart } from '../chart'
import { normalizeFolders, type Folders } from '../chart/folders'
import type { Groups } from '../chart/groups'
import type { Stages } from '../chart/stages'
import type { Bgm } from './bgm'
import type { Entity } from './entities'
import { createBpms, type BpmIntegral } from './integrals/bpms'
import type { Store } from './store'
import { createStore } from './store/creates'

export type State = {
    filename?: string

    bgm: Bgm
    initialLife: number
    isDynamicStages: boolean
    store: Store
    bpms: BpmIntegral[]
    groups: Groups
    stages: Stages
    groupFolders: Folders
    stageFolders: Folders

    selectedEntities: Entity[]
}

export const createState = (chart: Chart, offset: number, filename?: string): State => {
    // Folders keep their members together; parsing already did, other sources may not.
    const groups = chart.groupFolders?.size
        ? normalizeFolders(chart.groups, chart.groupFolders)
        : { entries: chart.groups, folders: chart.groupFolders ?? (new Map() as Folders) }
    const stages = chart.stageFolders?.size
        ? normalizeFolders(chart.stages, chart.stageFolders)
        : { entries: chart.stages, folders: chart.stageFolders ?? (new Map() as Folders) }
    return {
        filename,

        bgm: { offset },
        initialLife: chart.initialLife,
        isDynamicStages: chart.isDynamicStages,
        store: createStore(chart),
        bpms: createBpms(chart),
        groups: groups.entries,
        stages: stages.entries,
        groupFolders: groups.folders,
        stageFolders: stages.folders,

        selectedEntities: [],
    }
}
