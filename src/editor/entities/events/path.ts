import type { EventEase } from '../../../chart/events'
import { ease, easeOvershoot, isStepEase, sampleEase } from '../../../ease'
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

// Edge paths of a range whose width the engine floors at minWidth about its center.
export const getRangePathDs = (
    [leftMin, rightMin]: [number, number],
    [leftMax, rightMax]: [number, number],
    yMin: number,
    yMax: number,
    eventEase: EventEase,
    minWidth: number,
): [string, string] => {
    const widthAt = (q: number) => lerp(rightMin - leftMin, rightMax - leftMax, q)
    const overshoot = easeOvershoot(eventEase)
    if (Math.min(widthAt(-overshoot), widthAt(1 + overshoot)) >= minWidth)
        return [
            getPathD(leftMin, leftMax, yMin, yMax, eventEase),
            getPathD(rightMin, rightMax, yMin, yMax, eventEase),
        ]
    const edgesAt = (q: number) => {
        const center = lerp((leftMin + rightMin) / 2, (leftMax + rightMax) / 2, q)
        const half = Math.max(minWidth, widthAt(q)) / 2
        return { left: center - half, right: center + half }
    }
    if (isStepEase(eventEase)) {
        // Steps hold one value per half, so a jump shows as a gap, as in exact paths.
        const first = ease(eventEase, 0.25)
        const second = ease(eventEase, 0.75)
        const pieces =
            first === second
                ? [{ from: 0, to: 1, q: first }]
                : [
                      { from: 0, to: 0.5, q: first },
                      { from: 0.5, to: 1, q: second },
                  ]
        const side = (key: 'left' | 'right') =>
            pieces
                .map(
                    ({ from, to, q }) =>
                        `M ${edgesAt(q)[key]} ${lerp(yMin, yMax, from)} V ${lerp(yMin, yMax, to)}`,
                )
                .join(' ')
        return [side('left'), side('right')]
    }
    const span = Math.max(Math.abs(leftMax - leftMin), Math.abs(rightMax - rightMin))
    const points = sampleEase(
        eventEase,
        0,
        1,
        CURVE_TOLERANCE / Math.max(span, CURVE_TOLERANCE),
    ).map((p) => ({ ...edgesAt(ease(eventEase, p)), y: lerp(yMin, yMax, p) }))
    return [
        points.map(({ left, y }, index) => `${index ? 'L' : 'M'} ${left} ${y}`).join(' '),
        points.map(({ right, y }, index) => `${index ? 'L' : 'M'} ${right} ${y}`).join(' '),
    ]
}
