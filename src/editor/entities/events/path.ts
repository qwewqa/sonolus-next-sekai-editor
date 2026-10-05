import type { EventEase } from '../../../chart/events'
import { ease, sampleEase } from '../../../ease'
import { lerp } from '../../../utils/math'

type PathD = (xMin: number, xMax: number, yMin: number, yMax: number) => string

const exactPaths: Partial<Record<EventEase, PathD>> = {
    linear: (xMin, xMax, yMin, yMax) => `M ${xMin} ${yMin} L ${xMax} ${yMax}`,
    inQuad: (xMin, xMax, yMin, yMax) =>
        `M ${xMin} ${yMin} Q ${xMin} ${lerp(yMin, yMax, 0.5)} ${xMax} ${yMax}`,
    outQuad: (xMin, xMax, yMin, yMax) =>
        `M ${xMin} ${yMin} Q ${xMax} ${lerp(yMin, yMax, 0.5)} ${xMax} ${yMax}`,
    inOutQuad: (xMin, xMax, yMin, yMax) =>
        `M ${xMin} ${yMin} Q ${xMin} ${lerp(yMin, yMax, 0.25)} ${lerp(xMin, xMax, 0.5)} ${lerp(yMin, yMax, 0.5)} Q ${xMax} ${lerp(yMin, yMax, 0.75)} ${xMax} ${yMax}`,
    outInQuad: (xMin, xMax, yMin, yMax) =>
        `M ${xMin} ${yMin} Q ${lerp(xMin, xMax, 0.5)} ${lerp(yMin, yMax, 0.25)} ${lerp(xMin, xMax, 0.5)} ${lerp(yMin, yMax, 0.5)} Q ${lerp(xMin, xMax, 0.5)} ${lerp(yMin, yMax, 0.75)} ${xMax} ${yMax}`,
    // Steps hold their interior value, so the jump shows as a gap.
    inStep: (xMin, _xMax, yMin, yMax) => `M ${xMin} ${yMin} V ${yMax}`,
    outStep: (_xMin, xMax, yMin, yMax) => `M ${xMax} ${yMin} V ${yMax}`,
    inOutStep: (xMin, xMax, yMin, yMax) =>
        `M ${xMin} ${yMin} V ${lerp(yMin, yMax, 0.5)} M ${xMax} ${lerp(yMin, yMax, 0.5)} V ${yMax}`,
    outInStep: (xMin, xMax, yMin, yMax) => `M ${lerp(xMin, xMax, 0.5)} ${yMin} V ${yMax}`,
}

export const getPathD = (
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    eventEase: EventEase,
) =>
    exactPaths[eventEase]?.(xMin, xMax, yMin, yMax) ??
    sampleEase(eventEase, 0, 1, CURVE_TOLERANCE / Math.max(Math.abs(xMax - xMin), CURVE_TOLERANCE))
        .map(
            (p, index) =>
                `${index ? 'L' : 'M'} ${lerp(xMin, xMax, ease(eventEase, p))} ${lerp(yMin, yMax, p)}`,
        )
        .join(' ')

const CURVE_TOLERANCE = 0.01
