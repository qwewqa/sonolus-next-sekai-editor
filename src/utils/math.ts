export const clamp = (value: number, min = 0, max = 1) => Math.min(Math.max(value, min), max)

export const lerp = (x: number, y: number, s: number) => x + s * (y - x)

export const unlerp = (a: number, b: number, x: number) => (x - a) / (b - a)

export const remap = (a: number, b: number, c: number, d: number, x: number) =>
    lerp(c, d, unlerp(a, b, x))

export const align = (value: number, division = 1) => Math.round(value * division) / division

// Snaps values within rounding error of the grid; values off the grid stay.
export const alignNear = (value: number, division = 1) => {
    const aligned = align(value, division)
    return Math.abs(value - aligned) * division < 1e-6 ? aligned : value
}

// Snaps the float noise of a lane or size computed from others; keeps 1/256 and 1/100 steps.
export const alignComputed = (value: number) => alignNear(value, 6400)

/** Equal up to floating-point noise; NaN equals NaN. */
export const nearlyEqual = (a: number, b: number, epsilon = 1e-9) =>
    Object.is(a, b) || Math.abs(a - b) <= epsilon
