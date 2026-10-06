export const easeModes = ['in', 'out', 'inOut', 'outIn'] as const

export type EaseMode = (typeof easeModes)[number]

/** An ease's first half: None and Linear stand alone, the modes take a function. */
export const easeTypes = ['none', 'linear', ...easeModes] as const

export type EaseType = (typeof easeTypes)[number]

// Sonolus' order, with Step last.
export const easeFunctionNames = [
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

export type EaseFunctionName = (typeof easeFunctionNames)[number]

export const timeScaleEaseFunctionNames = easeFunctionNames.filter(
    (name) => name !== 'back' && name !== 'elastic',
)

export type Ease = 'none' | 'linear' | `${EaseMode}${Capitalize<EaseFunctionName>}`

export type TimeScaleEase = Exclude<Ease, `${EaseMode}${'Back' | 'Elastic'}`>

export type EaseFunctionOf<E extends Ease> = {
    [F in EaseFunctionName]: E extends `${EaseMode}${Capitalize<F>}` ? F : never
}[EaseFunctionName]

// Partial edits keep the other half of each edited entity's ease.
export type EaseEdit<E extends Ease = Ease> =
    E | `type:${EaseMode}` | `function:${EaseFunctionOf<E>}`

export type WithEaseEdits<T> = {
    [K in keyof T]: Exclude<T[K], undefined> extends Ease
        ? EaseEdit<Exclude<T[K], undefined>>
        : T[K]
}

const isMode = (type: EaseType | undefined): type is EaseMode =>
    type !== undefined && type !== 'none' && type !== 'linear'

// A mode without a function takes Quad.
export const composeEase = (type: EaseType, name: EaseFunctionName = 'quad'): Ease =>
    isMode(type) ? (`${type}${(name[0]?.toUpperCase() ?? '') + name.slice(1)}` as Ease) : type

const parts = new Map<Ease, [EaseMode, EaseFunctionName]>()
for (const name of easeFunctionNames) {
    for (const mode of easeModes) parts.set(composeEase(mode, name), [mode, name])
}

export const eases: Ease[] = ['none', 'linear', ...parts.keys()]

export const easeEdits: EaseEdit[] = [
    ...eases,
    ...easeModes.map((mode) => `type:${mode}` as const),
    ...easeFunctionNames.map((name) => `function:${name}` as const),
]

export const easeTypeOf = (ease: Ease): EaseType => parts.get(ease)?.[0] ?? (ease as EaseType)

export const easeFunctionOf = (ease: Ease): EaseFunctionName | undefined => parts.get(ease)?.[1]

export const easeMode = (ease: Ease): EaseMode | undefined => parts.get(ease)?.[0]

/** None or In Step, which the engine treats alike: the value holds until the next joint. */
export const isNoneEase = (ease: Ease) => ease === 'none' || ease === 'inStep'

export const isStepEase = (ease: Ease) => ease === 'none' || easeFunctionOf(ease) === 'step'

// None plays as the step it equals; Out Step flips back to None, the usual change.
export const complementEase = <E extends Ease>(ease: E): E => {
    if (ease === 'none') return 'outStep' as E
    if (ease === 'outStep') return 'none' as E
    const mode = easeMode(ease)
    return mode === 'in' || mode === 'out'
        ? (composeEase(mode === 'in' ? 'out' : 'in', easeFunctionOf(ease)) as E)
        : ease
}

export const easeOvershoot = (ease: Ease) => {
    const name = easeFunctionOf(ease)
    return name === 'elastic' ? 0.374 : name === 'back' ? 0.101 : 0
}

const levelDataFunctionNames = [
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
    ['none', 0],
    ['linear', 1],
    ...levelDataFunctionNames.flatMap((name, i) =>
        easeModes.map((mode, j) => [composeEase(mode, name), 2 + i * 4 + j]),
    ),
]) as Record<Ease, number>

const easesByValue = new Map<number, Ease>(eases.map((ease) => [easeValues[ease], ease] as const))

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

// Literal transcriptions of sonolus.script.easing, so results match the engine bit for bit.
const curves: Record<Exclude<EaseFunctionName, 'step'>, Record<EaseMode, (x: number) => number>> = {
    quad: {
        in: (x) => x ** 2,
        out: (x) => 1 - (1 - x) ** 2,
        inOut: (x) => (x < 0.5 ? 2 * x ** 2 : 1 - (-2 * x + 2) ** 2 / 2),
        outIn: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 2) / 2 : (2 * x - 1) ** 2 / 2 + 0.5),
    },
    sine: {
        in: (x) => 1 - Math.cos((x * Math.PI) / 2),
        out: (x) => Math.sin((x * Math.PI) / 2),
        inOut: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
        outIn: (x) => (x < 0.5 ? Math.sin(Math.PI * x) / 2 : 1 - Math.sin(Math.PI * x) / 2),
    },
    cubic: {
        in: (x) => x ** 3,
        out: (x) => 1 - (1 - x) ** 3,
        inOut: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
        outIn: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 3) / 2 : (2 * x - 1) ** 3 / 2 + 0.5),
    },
    quart: {
        in: (x) => x ** 4,
        out: (x) => 1 - (1 - x) ** 4,
        inOut: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
        outIn: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 4) / 2 : (2 * x - 1) ** 4 / 2 + 0.5),
    },
    quint: {
        in: (x) => x ** 5,
        out: (x) => 1 - (1 - x) ** 5,
        inOut: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
        outIn: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 5) / 2 : (2 * x - 1) ** 5 / 2 + 0.5),
    },
    expo: {
        in: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
        out: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
        inOut: (x) =>
            x === 0 || x === 1
                ? x
                : x < 0.5
                  ? 2 ** (20 * x - 10) / 2
                  : (2 - 2 ** (-20 * x + 10)) / 2,
        outIn: (x) =>
            x === 0 || x === 1
                ? x
                : x < 0.5
                  ? (1 - 2 ** (-20 * x)) / 2
                  : 2 ** (20 * x - 20) / 2 + 0.5,
    },
    circ: {
        in: (x) => 1 - Math.sqrt(1 - x ** 2),
        out: (x) => Math.sqrt(1 - (x - 1) ** 2),
        inOut: (x) =>
            x < 0.5
                ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2
                : (Math.sqrt(1 - (2 * x - 2) ** 2) + 1) / 2,
        outIn: (x) =>
            x < 0.5
                ? Math.sqrt(1 - (2 * x - 1) ** 2) / 2
                : (1 - Math.sqrt(1 - (2 * x - 1) ** 2)) / 2 + 0.5,
    },
    back: {
        in: (x) => c3 * x ** 3 - c1 * x ** 2,
        out: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
        inOut: (x) =>
            x < 0.5
                ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2
                : ((2 * x - 2) ** 2 * ((c2 + 1) * (2 * x - 2) + c2) + 2) / 2,
        outIn: (x) =>
            x < 0.5
                ? (1 + c3 * (2 * x - 1) ** 3 + c1 * (2 * x - 1) ** 2) / 2
                : (c3 * (2 * x - 1) ** 3 - c1 * (2 * x - 1) ** 2) / 2 + 0.5,
    },
    elastic: {
        in: (x) =>
            x === 0 || x === 1 ? x : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * c4),
        out: (x) => (x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
        inOut: (x) =>
            x === 0 || x === 1
                ? x
                : x < 0.5
                  ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2
                  : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1,
        outIn: (x) =>
            x < 0.5
                ? x === 0
                    ? 0
                    : (2 ** (-20 * x) * Math.sin((20 * x - 0.75) * c4)) / 2 + 0.5
                : x === 1
                  ? 1
                  : -(2 ** (10 * (2 * x - 1) - 10) * Math.sin((20 * x - 20.75) * c4)) / 2 + 0.5,
    },
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
    if (ease === 'none') return steps.in
    const mode = easeMode(ease)
    const name = easeFunctionOf(ease)
    if (!mode || !name) return clamp01
    if (name === 'step') return steps[mode]

    const f = curves[name][mode]
    return (x) => f(clamp01(x))
}

const easeFunctions = new Map(eases.map((ease) => [ease, createEaseFunction(ease)]))

/** Sonolus' native easing functions, with steps taking their interior value at both endpoints. */
export const ease = (type: Ease, x: number) =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    easeFunctions.get(type)!(x)

export const easeEvaluator = (type: Ease) =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    easeFunctions.get(type)!

// Integrals from 0 of each function's in curve, and linear's.
const inIntegrals: Record<EaseFunctionOf<TimeScaleEase> | 'linear', (y: number) => number> = {
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
    if (type === 'none') return stepIntegrals.in(u)
    const mode = easeMode(type)
    const name = easeFunctionOf(type) as EaseFunctionOf<TimeScaleEase> | undefined
    if (!mode || !name) return inIntegrals.linear(u)
    if (name === 'step') return stepIntegrals[mode](u)

    const integral = inIntegrals[name]
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

const typeEdit = (edit: string) =>
    edit.startsWith('type:') ? (edit.slice(5) as EaseMode) : undefined

const functionEdit = (edit: string) =>
    edit.startsWith('function:') ? (edit.slice(9) as EaseFunctionName) : undefined

/** Applies an edit; a Type alone gives None and Linear Quad, a Function alone skips them. */
export const applyEaseEdit = <E extends Ease>(
    edit: EaseEdit<NoInfer<E>> | undefined,
    ease: E,
): E => {
    if (edit === undefined) return ease

    const type = typeEdit(edit)
    if (type) return composeEase(type, easeFunctionOf(ease)) as E

    const name = functionEdit(edit)
    if (name) {
        const mode = easeMode(ease)
        return mode ? (composeEase(mode, name) as E) : ease
    }

    return edit as E
}

/** The type and function an edit sets, or undefined for the halves it leaves unchanged. */
export const easeEditParts = (edit: EaseEdit | undefined) => {
    if (edit === undefined) return { type: undefined, name: undefined }

    const type = typeEdit(edit)
    const name = functionEdit(edit)
    if (type || name) return { type, name }

    return { type: easeTypeOf(edit as Ease), name: easeFunctionOf(edit as Ease) }
}

const toEaseEdit = (type: EaseType | undefined, name: EaseFunctionName | undefined) =>
    type && (!isMode(type) || name)
        ? composeEase(type, name)
        : type
          ? (`type:${type}` as const)
          : name
            ? (`function:${name}` as const)
            : undefined

/** Combines eases into one edit, leaving out the halves they disagree on. */
export const mergeEases = <E extends Ease>(values: Iterable<E>): EaseEdit<E> | undefined => {
    let type: EaseType | undefined
    let name: EaseFunctionName | undefined
    let first = true
    let mixedType = false
    let mixedName = false
    for (const value of values) {
        const valueType = easeTypeOf(value)
        if (first) {
            type = valueType
            first = false
        } else if (type !== valueType) {
            mixedType = true
        }
        // None and Linear have no function, so they take any other value's.
        const valueName = easeFunctionOf(value)
        if (!valueName) continue
        if (name === undefined) {
            name = valueName
        } else if (name !== valueName) {
            mixedName = true
        }
    }
    if (first) return
    return toEaseEdit(mixedType ? undefined : type, mixedName ? undefined : name) as
        EaseEdit<E> | undefined
}

/** Sets an edit's type; a mode after None or Linear starts from Quad. */
export const setEaseEditType = <E extends Ease>(
    edit: EaseEdit<E> | undefined,
    type: EaseType | undefined,
): EaseEdit<E> | undefined => {
    const { type: previous, name } = easeEditParts(edit)
    const standalone = previous !== undefined && !isMode(previous)
    return toEaseEdit(type, standalone && isMode(type) ? 'quad' : name) as EaseEdit<E> | undefined
}

export const setEaseEditFunction = <E extends Ease>(
    edit: EaseEdit<E> | undefined,
    name: EaseFunctionOf<E> | undefined,
): EaseEdit<E> | undefined => {
    const { type } = easeEditParts(edit)
    // None and Linear have no function to set.
    if (type !== undefined && !isMode(type)) return edit
    return toEaseEdit(type, name) as EaseEdit<E> | undefined
}

/** None, Linear, then each mode of the current function (Quad from None or Linear). */
export const cycleEase = <E extends Ease>(ease: E): E => {
    if (ease === 'none') return 'linear' as E
    const mode = easeMode(ease)
    if (!mode) return composeEase('in', 'quad') as E

    const next = easeModes[easeModes.indexOf(mode) + 1]
    return (next ? composeEase(next, easeFunctionOf(ease)) : 'none') as E
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
