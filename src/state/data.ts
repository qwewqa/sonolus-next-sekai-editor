import type { State } from '.'

// Selection and document metadata can change without replacing chart data.
export const hasSameChartData = (left: State, right: State) =>
    left.store === right.store &&
    left.bpms === right.bpms &&
    left.groups === right.groups &&
    left.stages === right.stages &&
    left.isDynamicStages === right.isDynamicStages
