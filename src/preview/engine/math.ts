import { easeFromValue, easeFunction, easeLevelDataValues } from '../../ease'

export type Vec = {
    x: number
    y: number
}

export type Quad = {
    bl: Vec
    tl: Vec
    tr: Vec
    br: Vec
}

export const vec = (x: number, y: number): Vec => ({ x, y })

export const addVec = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })

export const subVec = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })

export const scaleVec = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s })

export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
})

export const rotateVec = (v: Vec, a: number): Vec => {
    const c = Math.cos(a)
    const s = Math.sin(a)

    return {
        x: v.x * c - v.y * s,
        y: v.x * s + v.y * c,
    }
}

export const orthogonalVec = (v: Vec): Vec => ({ x: -v.y, y: v.x })

export const normalizeVecOrZero = (v: Vec): Vec => {
    const m = Math.hypot(v.x, v.y)
    if (!m) return { x: 0, y: 0 }

    return { x: v.x / m, y: v.y / m }
}

export const dotVec = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y

export const translateQuad = (q: Quad, offset: Vec): Quad => ({
    bl: addVec(q.bl, offset),
    tl: addVec(q.tl, offset),
    tr: addVec(q.tr, offset),
    br: addVec(q.br, offset),
})

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

export const unlerp = (a: number, b: number, x: number) => (a === b ? 0 : (x - a) / (b - a))

export const clamp = (x: number, min: number, max: number) => Math.min(Math.max(x, min), max)

export const unlerpClamped = (a: number, b: number, x: number) => clamp(unlerp(a, b, x), 0, 1)

export const safeUnlerp = (a: number, b: number, x: number, fallback = 0.5) =>
    Math.abs(a - b) < 1e-6 ? fallback : unlerp(a, b, x)

// The engine's safe_unlerp_clamped: coincident endpoints use a fixed fraction.
export const safeUnlerpClamped = (a: number, b: number, x: number, fallback = 0.5) =>
    Math.abs(a - b) < 1e-6 ? fallback : unlerpClamped(a, b, x)

export const remap = (a: number, b: number, c: number, d: number, x: number) =>
    lerp(c, d, unlerp(a, b, x))

export const remapClamped = (a: number, b: number, c: number, d: number, x: number) =>
    lerp(c, d, unlerpClamped(a, b, x))

export const EaseType = {
    none: 0,
    linear: 1,
    inQuad: 2,
    outQuad: 3,
    inOutQuad: 4,
    outInQuad: 5,
    inSine: 6,
    outSine: 7,
    inOutSine: 8,
    outInSine: 9,
    inCubic: 10,
    outCubic: 11,
    inOutCubic: 12,
    outInCubic: 13,
    inQuart: 14,
    outQuart: 15,
    inOutQuart: 16,
    outInQuart: 17,
    inQuint: 18,
    outQuint: 19,
    inOutQuint: 20,
    outInQuint: 21,
    inExpo: 22,
    outExpo: 23,
    inOutExpo: 24,
    outInExpo: 25,
    inCirc: 26,
    outCirc: 27,
    inOutCirc: 28,
    outInCirc: 29,
    inBack: 30,
    outBack: 31,
    inOutBack: 32,
    outInBack: 33,
    inElastic: 34,
    outElastic: 35,
    inOutElastic: 36,
    outInElastic: 37,
    inStep: 38,
    outStep: 39,
    inOutStep: 40,
    outInStep: 41,
} as const

export type EaseTypeValue = (typeof EaseType)[keyof typeof EaseType]

const easeFunctions = easeLevelDataValues.map((value) => easeFunction(easeFromValue(value)))

export const ease = (easeType: EaseTypeValue, x: number): number =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    easeFunctions[easeType]!(x)

export const easeOvershoot = (easeType: EaseTypeValue) =>
    easeType >= EaseType.inElastic && easeType <= EaseType.outInElastic
        ? 0.374
        : easeType >= EaseType.inBack && easeType <= EaseType.outInBack
          ? 0.101
          : 0

export const isNoneEase = (easeType: EaseTypeValue) =>
    easeType === EaseType.none || easeType === EaseType.inStep

// Steps hold their interior value inside the connector, not at its endpoints.
export const pinnedEase = (easeType: EaseTypeValue, x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : ease(easeType, x)

// sekai/lib/connector.py get_connector_interp_frac. Unclamped, so overshooting
// eases leave the endpoints.
export const connectorInterpFrac = (
    easeType: EaseTypeValue,
    headEaseFrac: number,
    tailEaseFrac: number,
    easeFrac: number,
    fallback: number,
) =>
    isNoneEase(easeType)
        ? 0
        : safeUnlerp(
              pinnedEase(easeType, headEaseFrac),
              pinnedEase(easeType, tailEaseFrac),
              ease(easeType, easeFrac),
              fallback,
          )

export const easeOutCubic = (x: number) => {
    const t = clamp(x, 0, 1)
    return 1 - (1 - t) ** 3
}

export const easeInCubic = (x: number) => {
    const t = clamp(x, 0, 1)
    return t ** 3
}

export type AffineTransform = {
    a00: number
    a01: number
    a02: number
    a10: number
    a11: number
    a12: number
}

export const identityAffineTransform: AffineTransform = {
    a00: 1,
    a01: 0,
    a02: 0,
    a10: 0,
    a11: 1,
    a12: 0,
}

export const applyAffine = (t: AffineTransform, p: Vec): Vec => ({
    x: t.a00 * p.x + t.a01 * p.y + t.a02,
    y: t.a10 * p.x + t.a11 * p.y + t.a12,
})

export const transformQuadAffine = (t: AffineTransform, q: Quad): Quad =>
    t === identityAffineTransform
        ? q
        : {
              bl: applyAffine(t, q.bl),
              tl: applyAffine(t, q.tl),
              tr: applyAffine(t, q.tr),
              br: applyAffine(t, q.br),
          }
