export const easeFamilies = [
    'linear',
    'sine',
    'quad',
    'cubic',
    'quart',
    'quint',
    'expo',
    'circ',
    'back',
    'elastic',
    'step',
] as const

export type EaseFamily = (typeof easeFamilies)[number]

// Step first, as the usual time scale change.
export const timeScaleEaseFamilies = [
    'step',
    ...easeFamilies.filter(
        (family) => family !== 'back' && family !== 'elastic' && family !== 'step',
    ),
] as const satisfies readonly EaseFamily[]

export const easeModes = ['in', 'out', 'inOut', 'outIn'] as const

export type EaseMode = (typeof easeModes)[number]

type CurveFamily = Exclude<EaseFamily, 'linear'>

export type Ease = 'linear' | `${EaseMode}${Capitalize<CurveFamily>}`

export type TimeScaleEase = Exclude<Ease, `${EaseMode}${'Back' | 'Elastic'}`>

export type EaseFamilyOf<E extends Ease> = E extends 'linear'
    ? 'linear'
    : { [F in CurveFamily]: E extends `${EaseMode}${Capitalize<F>}` ? F : never }[CurveFamily]

// Partial edits keep the other half of each edited entity's ease.
export type EaseEdit<E extends Ease = Ease> = E | `family:${EaseFamilyOf<E>}` | `mode:${EaseMode}`

export type WithEaseEdits<T> = {
    [K in keyof T]: Exclude<T[K], undefined> extends Ease
        ? EaseEdit<Exclude<T[K], undefined>>
        : T[K]
}

export const composeEase = (family: EaseFamily, mode: EaseMode): Ease =>
    family === 'linear'
        ? 'linear'
        : (`${mode}${(family[0]?.toUpperCase() ?? '') + family.slice(1)}` as Ease)

const parts = new Map<Ease, [CurveFamily, EaseMode]>()
for (const family of easeFamilies) {
    if (family === 'linear') continue
    for (const mode of easeModes) parts.set(composeEase(family, mode), [family, mode])
}

export const eases: Ease[] = ['linear', ...parts.keys()]

export const easeEdits: EaseEdit[] = [
    ...eases,
    ...easeFamilies.map((family) => `family:${family}` as const),
    ...easeModes.map((mode) => `mode:${mode}` as const),
]

export const easeFamily = (ease: Ease): EaseFamily => parts.get(ease)?.[0] ?? 'linear'

export const easeMode = (ease: Ease): EaseMode | undefined => parts.get(ease)?.[1]

export const isStepEase = (ease: Ease) => easeFamily(ease) === 'step'

export const complementEase = <E extends Ease>(ease: E): E => {
    const mode = easeMode(ease)
    return mode === 'in' || mode === 'out'
        ? (composeEase(easeFamily(ease), mode === 'in' ? 'out' : 'in') as E)
        : ease
}

export const easeOvershoot = (ease: Ease) => {
    const family = easeFamily(ease)
    return family === 'elastic' ? 0.374 : family === 'back' ? 0.101 : 0
}

const levelDataFamilies = [
    'quad',
    'sine',
    'cubic',
    'quart',
    'quint',
    'expo',
    'circ',
    'back',
    'elastic',
    'step',
] as const

export const easeValues = Object.fromEntries([
    ['linear', 1],
    ...levelDataFamilies.flatMap((family, i) =>
        easeModes.map((mode, j) => [composeEase(family, mode), 2 + i * 4 + j]),
    ),
]) as Record<Ease, number>

// NONE, which v2.14 engines also accept.
export const easeLevelDataValue = (ease: Ease) => (ease === 'inStep' ? 0 : easeValues[ease])

const easesByValue = new Map<number, Ease>([
    [0, 'inStep'],
    ...eases.map((ease) => [easeValues[ease], ease] as const),
])

export const easeLevelDataValues = [...easesByValue.keys()].sort((a, b) => a - b)

export const timeScaleEaseLevelDataValues = easeLevelDataValues.filter(
    (value) => value < 30 || value > 37,
)

export const easeFromValue = (value: number) => {
    const ease = easesByValue.get(value)
    if (!ease) throw new Error(`Unexpected ease: ${value}`)
    return ease
}

const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5

const ins: Record<Exclude<CurveFamily, 'step'>, (x: number) => number> = {
    sine: (x) => 1 - Math.cos((x * Math.PI) / 2),
    quad: (x) => x * x,
    cubic: (x) => x ** 3,
    quart: (x) => x ** 4,
    quint: (x) => x ** 5,
    expo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
    circ: (x) => 1 - Math.sqrt(1 - x * x),
    back: (x) => c3 * x ** 3 - c1 * x ** 2,
    elastic: (x) =>
        x === 0 || x === 1 ? x : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * c4),
}

const inOuts: Partial<Record<CurveFamily, (x: number) => number>> = {
    back: (x) =>
        x < 0.5
            ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2
            : ((2 * x - 2) ** 2 * ((c2 + 1) * (2 * x - 2) + c2) + 2) / 2,
    elastic: (x) =>
        x === 0 || x === 1
            ? x
            : x < 0.5
              ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2
              : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1,
}

// The native forms only special-case the endpoints, not the midpoint.
const outIns: Partial<Record<CurveFamily, (x: number) => number>> = {
    expo: (x) =>
        x === 0 || x === 1 ? x : x < 0.5 ? (1 - 2 ** (-20 * x)) / 2 : 2 ** (20 * x - 20) / 2 + 0.5,
    elastic: (x) =>
        x === 0 || x === 1
            ? x
            : x < 0.5
              ? (2 ** (-20 * x) * Math.sin((20 * x - 0.75) * c4)) / 2 + 0.5
              : -(2 ** (20 * x - 20) * Math.sin((20 * x - 20.75) * c4)) / 2 + 0.5,
}

// Steps take the value inside the interval at both endpoints.
const steps: Record<EaseMode, (x: number) => number> = {
    in: (x) => (x <= 1 ? 0 : 1),
    out: (x) => (x >= 0 ? 1 : 0),
    inOut: (x) => (x < 0.5 ? 0 : 1),
    outIn: (x) => (x < 0 ? 0 : x > 1 ? 1 : 0.5),
}

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

const createEaseFunction = (ease: Ease): ((x: number) => number) => {
    const family = easeFamily(ease)
    const mode = easeMode(ease)
    if (family === 'linear' || !mode) return clamp01
    if (family === 'step') return steps[mode]

    const inEase = ins[family]
    const outEase = (x: number) => 1 - inEase(1 - x)
    let f: (x: number) => number
    switch (mode) {
        case 'in':
            f = inEase
            break
        case 'out':
            f = outEase
            break
        case 'inOut':
            f = inOuts[family] ?? ((x) => (x < 0.5 ? inEase(2 * x) / 2 : 1 - inEase(2 - 2 * x) / 2))
            break
        case 'outIn':
            f =
                outIns[family] ??
                ((x) => (x < 0.5 ? outEase(2 * x) / 2 : 0.5 + inEase(2 * x - 1) / 2))
            break
    }
    return (x) => f(clamp01(x))
}

const easeFunctions = new Map(eases.map((ease) => [ease, createEaseFunction(ease)]))

/** Sonolus' native easing functions, with steps taking their interior value at both endpoints. */
export const ease = (type: Ease, x: number) =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    easeFunctions.get(type)!(x)

export const easeFunction = (type: Ease) =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    easeFunctions.get(type)!

// Integrals from 0 of each family's in curve.
const inIntegrals: Record<EaseFamilyOf<TimeScaleEase>, (y: number) => number> = {
    linear: (y) => (y * y) / 2,
    sine: (y) => y - (2 / Math.PI) * Math.sin((Math.PI * y) / 2),
    quad: (y) => y ** 3 / 3,
    cubic: (y) => y ** 4 / 4,
    quart: (y) => y ** 5 / 5,
    quint: (y) => y ** 6 / 6,
    expo: (y) => (2 ** (10 * y - 10) - 2 ** -10) / (10 * Math.LN2),
    circ: (y) => y - (y * Math.sqrt(1 - y * y) + Math.asin(y)) / 2,
    step: () => 0,
}

const stepIntegrals: Record<EaseMode, (u: number) => number> = {
    in: () => 0,
    out: (u) => u,
    inOut: (u) => Math.max(0, u - 0.5),
    outIn: (u) => u / 2,
}

/** The integral of an ease from 0 to u, for u in [0, 1]. */
export const easeIntegral = (type: TimeScaleEase, u: number) => {
    const family = easeFamily(type) as EaseFamilyOf<TimeScaleEase>
    const mode = easeMode(type)
    if (family === 'linear' || !mode) return inIntegrals.linear(u)
    if (family === 'step') return stepIntegrals[mode](u)

    const integral = inIntegrals[family]
    const whole = integral(1)
    switch (mode) {
        case 'in':
            return integral(u)
        case 'out':
            return u - whole + integral(1 - u)
        case 'inOut':
            return u <= 0.5 ? integral(2 * u) / 4 : u - 0.5 + integral(2 - 2 * u) / 4
        case 'outIn':
            return u <= 0.5
                ? u / 2 - (whole - integral(1 - 2 * u)) / 4
                : 0.25 - whole / 4 + (u - 0.5) / 2 + integral(2 * u - 1) / 4
    }
}

const familyEdit = (edit: string) =>
    edit.startsWith('family:') ? (edit.slice(7) as EaseFamily) : undefined

const modeEdit = (edit: string) =>
    edit.startsWith('mode:') ? (edit.slice(5) as EaseMode) : undefined

export const applyEaseEdit = <E extends Ease>(
    edit: EaseEdit<NoInfer<E>> | undefined,
    ease: E,
): E => {
    if (edit === undefined) return ease

    const family = familyEdit(edit)
    if (family) return composeEase(family, easeMode(ease) ?? 'in') as E

    const mode = modeEdit(edit)
    if (mode) return composeEase(easeFamily(ease), mode) as E

    return edit as E
}

/** The family and mode an edit sets, or undefined for the halves it leaves unchanged. */
export const easeEditParts = (edit: EaseEdit | undefined) => {
    if (edit === undefined) return { family: undefined, mode: undefined }

    const family = familyEdit(edit)
    const mode = modeEdit(edit)
    if (family || mode) return { family, mode }

    return { family: easeFamily(edit as Ease), mode: easeMode(edit as Ease) }
}

const toEaseEdit = (family: EaseFamily | undefined, mode: EaseMode | undefined) =>
    family === 'linear'
        ? 'linear'
        : family && mode
          ? composeEase(family, mode)
          : family
            ? (`family:${family}` as const)
            : mode
              ? (`mode:${mode}` as const)
              : undefined

/** Combines eases into one edit, leaving out the halves they disagree on. */
export const mergeEases = <E extends Ease>(values: Iterable<E>): EaseEdit<E> | undefined => {
    let family: EaseFamily | undefined
    let mode: EaseMode | undefined
    let first = true
    let mixedFamily = false
    let mixedMode = false
    for (const value of values) {
        const valueFamily = easeFamily(value)
        const valueMode = easeMode(value)
        if (first) {
            family = valueFamily
            first = false
        } else if (family !== valueFamily) {
            mixedFamily = true
        }
        // Linear has no mode, so it takes any other value's mode.
        if (!valueMode) continue
        if (mode === undefined) {
            mode = valueMode
        } else if (mode !== valueMode) {
            mixedMode = true
        }
    }
    if (first) return
    if (!mixedFamily && family === 'linear') return 'linear' as E
    return toEaseEdit(mixedFamily ? undefined : family, mixedMode ? undefined : mode) as
        EaseEdit<E> | undefined
}

export const setEaseEditFamily = <E extends Ease>(
    edit: EaseEdit<E> | undefined,
    family: EaseFamilyOf<E> | undefined,
): EaseEdit<E> | undefined => {
    const { family: previous, mode } = easeEditParts(edit)
    return toEaseEdit(family, previous === 'linear' && family ? 'in' : mode) as
        EaseEdit<E> | undefined
}

export const setEaseEditMode = <E extends Ease>(
    edit: EaseEdit<E> | undefined,
    mode: EaseMode | undefined,
): EaseEdit<E> | undefined => {
    const { family } = easeEditParts(edit)
    return toEaseEdit(family, mode) as EaseEdit<E> | undefined
}

/** Steps through the modes of an ease's family, and linear. */
export const cycleEase = <E extends Ease>(ease: E): E => {
    const mode = easeMode(ease)
    const family = easeFamily(ease)
    if (!mode) return composeEase(family === 'linear' ? 'quad' : family, 'in') as E

    const next = easeModes[easeModes.indexOf(mode) + 1]
    return (next ? composeEase(family, next) : 'linear') as E
}

/**
 * Fractions in [from, to] whose polyline follows an ease within the tolerance,
 * as a fraction of the eased range. Oscillating eases are sampled evenly first.
 */
export const sampleEase = (type: Ease, from: number, to: number, tolerance: number) => {
    const fractions = [from]
    const subdivide = (a: number, b: number, depth: number) => {
        const mid = (a + b) / 2
        if (
            depth < (easeOvershoot(type) ? 4 : 0) ||
            (depth < 12 &&
                Math.abs(ease(type, mid) - (ease(type, a) + ease(type, b)) / 2) > tolerance)
        ) {
            subdivide(a, mid, depth + 1)
            fractions.push(mid)
            subdivide(mid, b, depth + 1)
        }
    }
    // Compound eases may turn sharply at their midpoint.
    const mode = easeMode(type)
    if ((mode === 'inOut' || mode === 'outIn') && from < 0.5 && 0.5 < to) {
        subdivide(from, 0.5, 1)
        fractions.push(0.5)
        subdivide(0.5, to, 1)
    } else {
        subdivide(from, to, 0)
    }
    fractions.push(to)
    return fractions
}
