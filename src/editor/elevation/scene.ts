import { computed } from 'vue'
import type { StageId } from '../../chart/stages'
import { state } from '../../history'
import { getPreviewState, previewEdit } from '../../preview/edit'
import { attachEasedFrac, createPreviewChartBuilder } from '../../preview/engine/chart'
import type { PreviewNote } from '../../preview/engine/model'
import { getStagePropsFrom } from '../../preview/engine/stage'
import { settings } from '../../settings'
import type { NoteEntity } from '../../state/entities/slides/note'
import { beatToTime } from '../../state/integrals/bpms'
import { scopeLookup } from '../scope'
import { entityScopeVisibility } from '../scopeRules'
import { view } from '../view'
import { getNotesAtBeat } from './candidates'
import { layoutElevationNotes, type ElevationNote } from './layout'
import { elevationBeat } from './state'
import { elevationBounds, elevationViewport } from './viewport'

const buildChart = createPreviewChartBuilder()
export const elevationState = computed(() => getPreviewState(state.value, previewEdit.value))
const compileChart = () => {
    const chart = buildChart(elevationState.value, settings.previewNoteSpeed)
    const orders = new Map<NoteEntity['slideId'], number>()
    const bySource = new Map<
        NoteEntity,
        { compiled: PreviewNote; order: number; ordinal: number }
    >()
    for (const [ordinal, compiled] of chart.notes.entries()) {
        const source = compiled.source
        if (!source) continue
        const order = orders.get(source.slideId) ?? 0
        orders.set(source.slideId, order + 1)
        bySource.set(source, { compiled, order, ordinal })
    }
    return { chart, bySource }
}
const compiledChart = computed((previous?: ReturnType<typeof compileChart>) => {
    const chart = buildChart(elevationState.value, settings.previewNoteSpeed)
    return previous?.chart === chart ? previous : compileChart()
})
const gridNotes = computed(() => elevationState.value.store.grid.note)
const bpms = computed(() => elevationState.value.bpms)
export const getElevationStageProps = (stageId: StageId, beat: number) => {
    const current = elevationState.value
    const chart = compiledChart.value.chart
    const index = [...current.stages.keys()].indexOf(stageId)
    const stage = current.isDynamicStages ? chart.stages[index] : undefined
    return stage
        ? getStagePropsFrom(stage, beatToTime(current.bpms, beat))
        : { elevation: 0, pivotLane: 0 }
}
export const elevationNotes = computed(() => {
    const { chart, bySource } = compiledChart.value
    const props = chart.stages.map((stage) =>
        getStagePropsFrom(stage, beatToTime(bpms.value, elevationBeat.value)),
    )
    const basic = (note: PreviewNote) => ({
        lane: note.lane + (props[note.stageIndex]?.pivotLane ?? 0),
        elevation: (note.elevation ?? 0) + (props[note.stageIndex]?.elevation ?? 0),
    })
    const notes: ElevationNote[] = []
    const scope = scopeLookup.value
    const candidates = getNotesAtBeat(gridNotes.value, elevationBeat.value).sort(
        (a, b) => (bySource.get(a)?.ordinal ?? 0) - (bySource.get(b)?.ordinal ?? 0),
    )
    for (const note of candidates) {
        const indexed = bySource.get(note)
        if (!indexed) continue
        const { order, compiled } = indexed
        // The elevation editor only shows editable notes: dimmed groups and
        // stages are omitted rather than drawn faintly.
        if (!view.visibilities.note || entityScopeVisibility(note, scope) !== 'full') continue
        let position = basic(compiled)
        if (compiled.isAttached && compiled.attachHead && compiled.attachTail) {
            const head = basic(compiled.attachHead)
            const tail = basic(compiled.attachTail)
            const frac = attachEasedFrac(compiled)
            position = {
                lane: head.lane + (tail.lane - head.lane) * frac,
                elevation: head.elevation + (tail.elevation - head.elevation) * frac,
            }
        }
        notes.push({
            note,
            ...position,
            size: compiled.size * 2,
            attached: compiled.isAttached,
            order,
        })
    }
    return notes
})
export const elevationLayout = computed(() => {
    const width = settings.width * 1.1
    return layoutElevationNotes(elevationNotes.value, {
        width: elevationBounds.w,
        height: elevationBounds.h,
        laneLeft: view.lane - width / 2,
        laneScale: elevationBounds.w / width,
        elevationCenter: elevationViewport.center,
        elevationScale: elevationViewport.scale,
    })
})
