import { clamp, ease, lerp, type EaseTypeValue } from './math'

export const MIN_START_TIME = -2

export type TimescaleEase = EaseTypeValue
export type TransitionStyle = 0 | 1 // timescale | scroll

export type TimescaleChange = {
    time: number
    timescale: number
    skipSeconds: number
    ease: TimescaleEase
    transitionStyle: TransitionStyle
    hideNotes: boolean
}

type Transfer = {
    ratio: number
    forward: number
    backward: number
}

export type TimescaleGroup = {
    changes: TimescaleChange[]
    scaledAtChanges: number[]
    forceNoteSpeed: number
    hasScroll: boolean
    transfers: Transfer[]
    transferOffset: number
}

const identityTransfer = (): Transfer => ({ ratio: 1, forward: 0, backward: 0 })

// D(left, hit) = forward + ratio * D(right, hit). Keep the reverse distance
// separately so a reverse query does not divide by the combined ratio.
const composeTransfers = (a: Transfer, b: Transfer): Transfer => ({
    ratio: a.ratio * b.ratio,
    forward: a.forward + a.ratio * b.forward,
    backward: b.backward + a.backward / b.ratio,
})

const complementEase = (value: TimescaleEase): TimescaleEase =>
    value === 2 ? 3 : value === 3 ? 2 : value

const speedAt = (change: TimescaleChange, next: TimescaleChange | undefined, t: number) => {
    if (!next || change.ease === 0 || t <= change.time) return change.timescale
    if (t >= next.time) return next.timescale

    // Evaluate a falling curve from its lower speed, as the engine does.
    return next.timescale >= change.timescale
        ? lerp(
              change.timescale,
              next.timescale,
              ease(change.ease, (t - change.time) / (next.time - change.time)),
          )
        : lerp(
              next.timescale,
              change.timescale,
              ease(complementEase(change.ease), (next.time - t) / (next.time - change.time)),
          )
}

const integrate = (
    change: TimescaleChange,
    next: TimescaleChange | undefined,
    left: number,
    right: number,
): number => {
    if (left === right || change.time === next?.time) return 0
    if (left > right) return -integrate(change, next, right, left)
    if (!next || change.ease === 0) return (right - left) * change.timescale

    const midpoint = (change.time + next.time) / 2
    if ((change.ease === 4 || change.ease === 5) && left < midpoint && midpoint < right) {
        return integrate(change, next, left, midpoint) + integrate(change, next, midpoint, right)
    }

    // Simpson's rule integrates each supported quadratic easing piece exactly.
    return (
        ((right - left) *
            (speedAt(change, next, left) +
                4 * speedAt(change, next, left + (right - left) / 2) +
                speedAt(change, next, right))) /
        6
    )
}

const scrollSpeed = (speed: number) => (speed < 0 ? Math.min(speed, -1e-4) : Math.max(speed, 1e-4))

const partialTransfer = (
    group: TimescaleGroup,
    index: number,
    left: number,
    right: number,
    destination: boolean,
): Transfer => {
    const change = group.changes[index]
    const next = group.changes[index + 1]
    const skip = destination ? (next?.skipSeconds ?? 0) : 0

    if (!change || change.transitionStyle === 0) {
        const distance = (change ? integrate(change, next, left, right) : right - left) + skip
        return { ratio: 1, forward: distance, backward: distance }
    }

    const leftSpeed = scrollSpeed(speedAt(change, next, left))
    const rightSpeed = scrollSpeed(
        destination && next ? next.timescale : speedAt(change, next, right),
    )
    // A marker skip uses the outgoing speed of its destination, even if that
    // marker changes transition style or shares its timestamp with another.
    const width = right - left + skip / rightSpeed
    return {
        ratio: leftSpeed / rightSpeed,
        forward: leftSpeed * width,
        backward: rightSpeed * width,
    }
}

export const createTimescaleGroup = (
    changes: TimescaleChange[],
    forceNoteSpeed: number,
): TimescaleGroup => {
    changes.sort((a, b) => a.time - b.time)

    const scaledAtChanges: number[] = []
    let previous: TimescaleChange | undefined
    let scaled = 0
    for (const change of changes) {
        scaled = previous
            ? scaled + integrate(previous, change, previous.time, change.time)
            : change.time
        scaled += change.skipSeconds
        scaledAtChanges.push(scaled)
        previous = change
    }

    let transferOffset = 1
    while (transferOffset < changes.length - 1) transferOffset *= 2
    const group: TimescaleGroup = {
        changes,
        scaledAtChanges,
        forceNoteSpeed,
        hasScroll: changes.some((change) => change.transitionStyle === 1),
        transfers: Array.from({ length: transferOffset * 2 }, identityTransfer),
        transferOffset,
    }
    for (let index = 0; index + 1 < changes.length; index++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const change = changes[index]!
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const next = changes[index + 1]!
        group.transfers[transferOffset + index] = partialTransfer(
            group,
            index,
            change.time,
            next.time,
            true,
        )
    }
    for (let index = transferOffset - 1; index > 0; index--) {
        group.transfers[index] = composeTransfers(
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            group.transfers[index * 2]!,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            group.transfers[index * 2 + 1]!,
        )
    }

    return group
}

const findLastChange = (changes: TimescaleChange[], t: number) => {
    let lo = 0
    let hi = changes.length - 1
    let result = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (changes[mid]!.time <= t) {
            result = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return result
}

export const scaledTimeAt = (group: TimescaleGroup, t: number) => {
    const index = findLastChange(group.changes, t)
    const change = group.changes[index]
    if (!change) return t

    return (
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        group.scaledAtChanges[index]! + integrate(change, group.changes[index + 1], change.time, t)
    )
}

const rangeTransfer = (group: TimescaleGroup, first: number, last: number) => {
    let left = first + group.transferOffset
    let right = last + group.transferOffset
    let before = identityTransfer()
    let after = identityTransfer()
    while (left < right) {
        if (left % 2) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            before = composeTransfers(before, group.transfers[left++]!)
        }
        if (right % 2) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            after = composeTransfers(group.transfers[--right]!, after)
        }
        left = Math.floor(left / 2)
        right = Math.floor(right / 2)
    }
    return composeTransfers(before, after)
}

// Scroll transitions change a note's distance relative to its hit time. They
// cannot be represented by subtracting two global scaled-time coordinates.
export const noteDistance = (group: TimescaleGroup, now: number, targetTime: number) => {
    const reverse = now > targetTime
    const left = reverse ? targetTime : now
    const right = reverse ? now : targetTime
    const first = findLastChange(group.changes, left)
    const last = findLastChange(group.changes, right)
    let transfer: Transfer
    if (first === last) {
        transfer = partialTransfer(group, first, left, right, false)
    } else {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const next = group.changes[first + 1]!
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const final = group.changes[last]!
        transfer = composeTransfers(
            composeTransfers(
                partialTransfer(group, first, left, next.time, true),
                rangeTransfer(group, first + 1, last),
            ),
            partialTransfer(group, last, final.time, right, false),
        )
    }
    return clamp(reverse ? -transfer.backward : transfer.forward, -1e20, 1e20)
}

export const hideNotesAt = (group: TimescaleGroup, t: number) => {
    const index = findLastChange(group.changes, t)
    if (index === -1) return false

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return group.changes[index]!.hideNotes
}

export const preemptTime = (noteSpeed: number, forceSpeed: number) => {
    const speed = forceSpeed > 0 ? forceSpeed : noteSpeed
    return lerp(0.35, 4, ((1 - speed / 12) / (1 - 1 / 12)) ** 1.31)
}

export const progressTo = (targetScaledTime: number, nowScaledTime: number, preempt: number) =>
    (nowScaledTime - targetScaledTime + preempt) / preempt
