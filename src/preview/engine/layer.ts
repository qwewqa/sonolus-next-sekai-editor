import type { ZKey } from '../gl'

export type Layer = {
    layer: number
    sublayer: number
}

export const LAYER_ACTIVE_SLIDE_CONNECTOR_UNDER: Layer = { layer: 1, sublayer: 0 }
export const LAYER_GUIDE_CONNECTOR_UNDER: Layer = { layer: 2, sublayer: 0 }
export const LAYER_STAGE: Layer = { layer: 16, sublayer: -9 }
export const LAYER_COVER: Layer = { layer: 16, sublayer: -8 }
export const LAYER_SLOT_EFFECT: Layer = { layer: 16, sublayer: -7 }

export const LAYER_ACTIVE_SLIDE_CONNECTOR_BOTTOM: Layer = { layer: 16, sublayer: -5 }
export const LAYER_GUIDE_CONNECTOR_BOTTOM: Layer = { layer: 16, sublayer: -4 }
export const LAYER_ACTIVE_SLIDE_CONNECTOR_TOP: Layer = { layer: 16, sublayer: -3 }
export const LAYER_GUIDE_CONNECTOR_TOP: Layer = { layer: 16, sublayer: -2 }
export const LAYER_SIM_LINE: Layer = { layer: 16, sublayer: -1 }

export const LAYER_NOTE_SLIM_BODY: Layer = { layer: 16, sublayer: 0 }
export const LAYER_NOTE_FLICK_BODY: Layer = { layer: 16, sublayer: 1 }
export const LAYER_NOTE_BODY: Layer = { layer: 16, sublayer: 2 }
export const LAYER_NOTE_TICK: Layer = { layer: 16, sublayer: 3 }
export const LAYER_NOTE_ARROW: Layer = { layer: 16, sublayer: 4 }
export const LAYER_SLOT_GLOW_EFFECT: Layer = { layer: 16, sublayer: 5 }

export const LAYER_ACTIVE_SLIDE_CONNECTOR_OVER: Layer = { layer: 22, sublayer: 0 }
export const LAYER_GUIDE_CONNECTOR_OVER: Layer = { layer: 23, sublayer: 0 }

let currentTime = 0

export const setLayerTime = (time: number) => {
    currentTime = time
}

export const getZ = (
    layer: Layer,
    time = 0,
    lane = 0,
    etc = 0,
    invertTime = false,
    elevation = 0,
): ZKey => [
    layer.layer,
    elevation + layer.sublayer * 0.01,
    invertTime ? time - currentTime : currentTime - time,
    Math.abs(lane) + (lane > 0 ? 0.05 : 0) + etc * 1e-6,
]

export const getZAlt = (layer: Layer, order: number, elevation = 0): ZKey => [
    layer.layer,
    elevation + layer.sublayer * 0.01,
    order,
    0,
]
