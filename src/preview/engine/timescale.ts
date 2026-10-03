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

type ExtendedValue = { significand: number; exponent: number }
type TransferValue = number | ExtendedValue

type Transfer = {
    ratio: TransferValue
    forward: TransferValue
    backward: TransferValue
}

const MIN_NORMAL = 2 ** -1022

const extend = (value: TransferValue): ExtendedValue => {
    if (typeof value !== 'number') return value
    const exponent = Math.min(1023, Math.floor(Math.log2(Math.abs(value))))
    return { significand: value / 2 ** exponent, exponent }
}

const normalize = (significand: number, exponent: number): TransferValue => {
    if (significand === 0) return 0
    const shift = Math.floor(Math.log2(Math.abs(significand)))
    significand /= 2 ** shift
    exponent += shift
    if (exponent >= -1022 && exponent <= 1023) {
        const value = significand * 2 ** exponent
        if (Number.isFinite(value)) return value
    }
    return { significand, exponent }
}

// Most transfers fit in a double. Preserve the exponent only when a product
// leaves its normal range: later scroll transitions can bring it back again.
const multiply = (a: TransferValue, b: TransferValue): TransferValue => {
    if (typeof a === 'number' && typeof b === 'number') {
        const value = a * b
        if (a === 0 || b === 0 || (Number.isFinite(value) && Math.abs(value) >= MIN_NORMAL))
            return value
    }
    if (a === 0 || b === 0) return 0
    const left = extend(a)
    const right = extend(b)
    return normalize(left.significand * right.significand, left.exponent + right.exponent)
}

const divide = (a: TransferValue, b: TransferValue): TransferValue => {
    if (typeof a === 'number' && typeof b === 'number') {
        const value = a / b
        if (a === 0 || (Number.isFinite(value) && Math.abs(value) >= MIN_NORMAL)) return value
    }
    if (a === 0) return 0
    const left = extend(a)
    const right = extend(b)
    return normalize(left.significand / right.significand, left.exponent - right.exponent)
}

const add = (a: TransferValue, b: TransferValue): TransferValue => {
    if (typeof a === 'number' && typeof b === 'number') {
        const value = a + b
        if (Number.isFinite(value)) return value
    }
    if (a === 0) return b
    if (b === 0) return a
    const left = extend(a)
    const right = extend(b)
    const exponent = Math.max(left.exponent, right.exponent)
    return normalize(
        left.significand * 2 ** (left.exponent - exponent) +
            right.significand * 2 ** (right.exponent - exponent),
        exponent,
    )
}

const toNumber = (value: TransferValue) => {
    if (typeof value === 'number') return value
    // Split the power so rounding into the subnormal range happens last.
    const exponent = clamp(value.exponent, -1022, 1023)
    return value.significand * 2 ** exponent * 2 ** (value.exponent - exponent)
}

export type TimescaleGroup = {
    changes: TimescaleChange[]
    scaledAtChanges: TransferValue[]
    forceNoteSpeed: number
    hasScroll: boolean
    transfers: Transfer[]
    transferOffset: number
}

const identityTransfer = (): Transfer => ({ ratio: 1, forward: 0, backward: 0 })

// D(left, hit) = forward + ratio * D(right, hit). Keep the reverse distance
// separately so a reverse query does not divide by the combined ratio.
const composeTransfers = (a: Transfer, b: Transfer): Transfer => ({
    ratio: multiply(a.ratio, b.ratio),
    forward: add(a.forward, multiply(a.ratio, b.forward)),
    backward: add(b.backward, divide(a.backward, b.ratio)),
})

const complementEase = (value: TimescaleEase): TimescaleEase =>
    value === 2 ? 3 : value === 3 ? 2 : value

const timeFraction = (left: number, right: number, t: number) => {
    const width = right - left
    const offset = t - left
    return Number.isFinite(width) && Number.isFinite(offset)
        ? offset / width
        : toNumber(divide(add(t, -left), add(right, -left)))
}

const interpolateSpeed = (left: number, right: number, fraction: number) => {
    const value = lerp(left, right, fraction)
    // Opposite finite endpoint speeds can have an overflowing difference.
    return Number.isFinite(value) ? value : left * (1 - fraction) + right * fraction
}

const speedAt = (change: TimescaleChange, next: TimescaleChange | undefined, t: number) => {
    if (!next || change.ease === 0 || t <= change.time) return change.timescale
    if (t >= next.time) return next.timescale

    // Evaluate a falling curve from its lower speed, as the engine does.
    return next.timescale >= change.timescale
        ? interpolateSpeed(
              change.timescale,
              next.timescale,
              ease(change.ease, timeFraction(change.time, next.time, t)),
          )
        : interpolateSpeed(
              next.timescale,
              change.timescale,
              ease(complementEase(change.ease), timeFraction(-next.time, -change.time, -t)),
          )
}

const integrate = (
    change: TimescaleChange,
    next: TimescaleChange | undefined,
    left: number,
    right: number,
): TransferValue => {
    if (left === right || change.time === next?.time) return 0
    if (left > right) return multiply(-1, integrate(change, next, right, left))
    const width = add(right, -left)
    if (!next || change.ease === 0) return multiply(width, change.timescale)

    const sum = change.time + next.time
    const midpoint = Number.isFinite(sum) ? sum / 2 : change.time / 2 + next.time / 2
    if ((change.ease === 4 || change.ease === 5) && left < midpoint && midpoint < right) {
        return add(
            integrate(change, next, left, midpoint),
            integrate(change, next, midpoint, right),
        )
    }

    // Simpson's rule integrates each supported quadratic easing piece exactly.
    const middle = typeof width === 'number' ? left + width / 2 : left / 2 + right / 2
    const speeds = add(
        add(speedAt(change, next, left), multiply(4, speedAt(change, next, middle))),
        speedAt(change, next, right),
    )
    return divide(multiply(width, speeds), 6)
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
        const distance = add(
            change ? integrate(change, next, left, right) : add(right, -left),
            skip,
        )
        return { ratio: 1, forward: distance, backward: distance }
    }

    const leftSpeed = scrollSpeed(speedAt(change, next, left))
    const rightSpeed = scrollSpeed(
        destination && next ? next.timescale : speedAt(change, next, right),
    )
    // A marker skip uses the outgoing speed of its destination, even if that
    // marker changes transition style or shares its timestamp with another.
    const width = add(add(right, -left), divide(skip, rightSpeed))
    return {
        ratio: divide(leftSpeed, rightSpeed),
        forward: multiply(leftSpeed, width),
        backward: multiply(rightSpeed, width),
    }
}

export const createTimescaleGroup = (
    changes: TimescaleChange[],
    forceNoteSpeed: number,
): TimescaleGroup => {
    changes.sort((a, b) => a.time - b.time)

    const scaledAtChanges: TransferValue[] = []
    let previous: TimescaleChange | undefined
    let scaled: TransferValue = 0
    for (const change of changes) {
        scaled = previous
            ? add(scaled, integrate(previous, change, previous.time, change.time))
            : change.time
        scaled = add(scaled, change.skipSeconds)
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

const findLastChange = (changes: TimescaleChange[], t: number, leftLimit = false) => {
    let lo = 0
    let hi = changes.length - 1
    let result = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (leftLimit ? changes[mid]!.time < t : changes[mid]!.time <= t) {
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

    return toNumber(
        add(
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            group.scaledAtChanges[index]!,
            integrate(change, group.changes[index + 1], change.time, t),
        ),
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
export const noteDistance = (
    group: TimescaleGroup,
    now: number,
    targetTime: number,
    leftLimit = false,
) => {
    const reverse = now > targetTime
    const left = reverse ? targetTime : now
    const right = reverse ? now : targetTime
    const first = findLastChange(group.changes, left, leftLimit && !reverse)
    const last = findLastChange(group.changes, right, leftLimit && reverse)
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
    return clamp(reverse ? -toNumber(transfer.backward) : toNumber(transfer.forward), -1e20, 1e20)
}

export const hideNotesAt = (group: TimescaleGroup, t: number, leftLimit = false) => {
    const index = findLastChange(group.changes, t, leftLimit)
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
