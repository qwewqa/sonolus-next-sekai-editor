import assert from 'node:assert/strict'
import test from 'node:test'
import {
    applyEaseEdit,
    complementEase,
    cycleEase,
    ease,
    easeFromValue,
    easeIntegral,
    easeLevelDataValues,
    eases,
    easeValues,
    mergeEases,
    sampleEase,
    setEaseEditFamily,
    setEaseEditMode,
    timeScaleEaseLevelDataValues,
    type Ease,
    type TimeScaleEase,
} from '../../src/ease'

// sonolus.script.easing, transcribed literally.
const c1 = 1.70158
const c2 = c1 * 1.525
const c3 = c1 + 1
const c4 = (2 * Math.PI) / 3
const c5 = (2 * Math.PI) / 4.5
const reference: Partial<Record<Ease, (x: number) => number>> = {
    inSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
    outSine: (x) => Math.sin((x * Math.PI) / 2),
    inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
    outInSine: (x) => (x < 0.5 ? Math.sin(Math.PI * x) / 2 : 1 - Math.sin(Math.PI * x) / 2),
    inQuad: (x) => x ** 2,
    outQuad: (x) => 1 - (1 - x) ** 2,
    inOutQuad: (x) => (x < 0.5 ? 2 * x ** 2 : 1 - (-2 * x + 2) ** 2 / 2),
    outInQuad: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 2) / 2 : (2 * x - 1) ** 2 / 2 + 0.5),
    inCubic: (x) => x ** 3,
    outCubic: (x) => 1 - (1 - x) ** 3,
    inOutCubic: (x) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
    outInCubic: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 3) / 2 : (2 * x - 1) ** 3 / 2 + 0.5),
    inQuart: (x) => x ** 4,
    outQuart: (x) => 1 - (1 - x) ** 4,
    inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2),
    outInQuart: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 4) / 2 : (2 * x - 1) ** 4 / 2 + 0.5),
    inQuint: (x) => x ** 5,
    outQuint: (x) => 1 - (1 - x) ** 5,
    inOutQuint: (x) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2),
    outInQuint: (x) => (x < 0.5 ? (1 - (1 - 2 * x) ** 5) / 2 : (2 * x - 1) ** 5 / 2 + 0.5),
    inExpo: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
    outExpo: (x) => (x === 1 ? 1 : 1 - 2 ** (-10 * x)),
    inOutExpo: (x) =>
        x === 0 || x === 1 ? x : x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2,
    outInExpo: (x) =>
        x === 0 || x === 1 ? x : x < 0.5 ? (1 - 2 ** (-20 * x)) / 2 : 2 ** (20 * x - 20) / 2 + 0.5,
    inCirc: (x) => 1 - Math.sqrt(1 - x ** 2),
    outCirc: (x) => Math.sqrt(1 - (x - 1) ** 2),
    inOutCirc: (x) =>
        x < 0.5 ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2 : (Math.sqrt(1 - (2 * x - 2) ** 2) + 1) / 2,
    outInCirc: (x) =>
        x < 0.5
            ? Math.sqrt(1 - (2 * x - 1) ** 2) / 2
            : (1 - Math.sqrt(1 - (2 * x - 1) ** 2)) / 2 + 0.5,
    inBack: (x) => c3 * x ** 3 - c1 * x ** 2,
    outBack: (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,
    inOutBack: (x) =>
        x < 0.5
            ? ((2 * x) ** 2 * ((c2 + 1) * 2 * x - c2)) / 2
            : ((2 * x - 2) ** 2 * ((c2 + 1) * (2 * x - 2) + c2) + 2) / 2,
    outInBack: (x) =>
        x < 0.5
            ? (1 + c3 * (2 * x - 1) ** 3 + c1 * (2 * x - 1) ** 2) / 2
            : (c3 * (2 * x - 1) ** 3 - c1 * (2 * x - 1) ** 2) / 2 + 0.5,
    inElastic: (x) =>
        x === 0 || x === 1 ? x : -(2 ** (10 * x - 10)) * Math.sin((x * 10 - 10.75) * c4),
    outElastic: (x) =>
        x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1,
    inOutElastic: (x) =>
        x === 0 || x === 1
            ? x
            : x < 0.5
              ? -(2 ** (20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2
              : (2 ** (-20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1,
    outInElastic: (x) =>
        x < 0.5
            ? x === 0
                ? 0
                : (2 ** (-20 * x) * Math.sin((20 * x - 0.75) * c4)) / 2 + 0.5
            : x === 1
              ? 1
              : (-(2 ** (10 * (2 * x - 1) - 10)) * Math.sin((20 * x - 20.75) * c4)) / 2 + 0.5,
}

const samples = [0, 0.01, 0.1, 0.25, 0.3, 0.49, 0.5, 0.51, 0.7, 0.75, 0.9, 0.99, 1]

test('curved eases match the Sonolus native formulas exactly and clamp their input', () => {
    const curved = eases.filter((type) => type !== 'linear' && !type.endsWith('Step'))
    assert.equal(curved.length, 36)
    for (const type of curved) {
        const expected = reference[type]
        assert.ok(expected, type)
        for (const x of samples) {
            assert.equal(ease(type, x), expected(x), `${type}(${x})`)
        }
        assert.equal(ease(type, -0.5), ease(type, 0), type)
        assert.equal(ease(type, 1.5), ease(type, 1), type)
        assert.ok(Math.abs(ease(type, 0)) < 1e-12 && Math.abs(ease(type, 1) - 1) < 1e-12, type)
    }
    assert.equal(ease('linear', 0.3), 0.3)
    assert.equal(ease('linear', 2), 1)
})

test('steps take their interior value at both endpoints', () => {
    const values = (type: Ease) => [-0.1, 0, 0.25, 0.5, 0.75, 1, 1.1].map((x) => ease(type, x))
    assert.deepEqual(values('inStep'), [0, 0, 0, 0, 0, 0, 1])
    assert.deepEqual(values('outStep'), [0, 1, 1, 1, 1, 1, 1])
    assert.deepEqual(values('inOutStep'), [0, 0, 0, 1, 1, 1, 1])
    assert.deepEqual(values('outInStep'), [0, 0.5, 0.5, 0.5, 0.5, 0.5, 1])
})

test('complements reverse time within a family', () => {
    assert.equal(complementEase('inSine'), 'outSine')
    assert.equal(complementEase('outElastic'), 'inElastic')
    assert.equal(complementEase('inOutCirc'), 'inOutCirc')
    assert.equal(complementEase('outInBack'), 'outInBack')
    assert.equal(complementEase('inStep'), 'outStep')
    assert.equal(complementEase('outStep'), 'inStep')
    assert.equal(complementEase('inOutStep'), 'inOutStep')
    assert.equal(complementEase('outInStep'), 'outInStep')
    assert.equal(complementEase('linear'), 'linear')
    for (const type of eases.filter((type) => !type.endsWith('Step'))) {
        for (const x of samples) {
            // Native out-in expo and elastic are discontinuous at their midpoint.
            if (x === 0.5 && (type === 'outInExpo' || type === 'outInElastic')) continue
            assert.ok(
                Math.abs(ease(complementEase(type), x) - (1 - ease(type, 1 - x))) < 1e-12,
                `${type}(${x})`,
            )
        }
    }
})

test('level data values follow the shared encoding', () => {
    assert.deepEqual(
        easeLevelDataValues,
        Array.from({ length: 42 }, (_, value) => value),
    )
    assert.equal(easeFromValue(0), 'inStep')
    assert.equal(easeValues.inStep, 38)
    assert.equal(easeValues.linear, 1)
    const families = ['Quad', 'Sine', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back', 'Elastic']
    for (const [family, name] of [...families, 'Step'].entries()) {
        for (const [mode, prefix] of ['in', 'out', 'inOut', 'outIn'].entries()) {
            const value = 2 + family * 4 + mode
            assert.equal(easeValues[`${prefix}${name}` as Ease], value)
            assert.equal(easeFromValue(value), `${prefix}${name}`)
        }
    }
    assert.deepEqual(timeScaleEaseLevelDataValues, [
        ...Array.from({ length: 30 }, (_, value) => value),
        38,
        39,
        40,
        41,
    ])
    assert.throws(() => easeFromValue(42))
})

const timeScaleEases = eases.filter(
    (type): type is TimeScaleEase => !type.endsWith('Back') && !type.endsWith('Elastic'),
)

test('ease integrals match numeric integration', () => {
    const steps = 20000
    for (const type of timeScaleEases) {
        for (const u of [0.1, 0.37, 0.5, 0.63, 1]) {
            let sum = 0
            for (let i = 0; i < steps; i++) sum += ease(type, ((i + 0.5) / steps) * u)
            const numeric = (sum / steps) * u
            assert.ok(Math.abs(easeIntegral(type, u) - numeric) < 1e-6, `${type}(${u})`)
        }
        assert.equal(easeIntegral(type, 0), 0)
    }
})

test('partial ease edits keep the other half of each value', () => {
    assert.equal(applyEaseEdit<Ease>('family:sine', 'outQuad'), 'outSine')
    assert.equal(applyEaseEdit<Ease>('family:sine', 'linear'), 'inSine')
    assert.equal(applyEaseEdit<Ease>('family:linear', 'outQuad'), 'linear')
    assert.equal(applyEaseEdit<Ease>('mode:outIn', 'inCirc'), 'outInCirc')
    assert.equal(applyEaseEdit<Ease>('mode:outIn', 'linear'), 'linear')
    assert.equal(applyEaseEdit<Ease>('inOutStep', 'linear'), 'inOutStep')
    assert.equal(applyEaseEdit<Ease>(undefined, 'outExpo'), 'outExpo')

    assert.equal(mergeEases<Ease>([]), undefined)
    assert.equal(mergeEases<Ease>(['inSine', 'inSine']), 'inSine')
    assert.equal(mergeEases<Ease>(['inSine', 'outSine']), 'family:sine')
    assert.equal(mergeEases<Ease>(['inSine', 'inQuad']), 'mode:in')
    assert.equal(mergeEases<Ease>(['linear', 'outQuad', 'outBack']), 'mode:out')
    assert.equal(mergeEases<Ease>(['linear', 'linear']), 'linear')
    assert.equal(mergeEases<Ease>(['linear', 'inSine']), 'mode:in')
    assert.equal(mergeEases<Ease>(['inSine', 'outQuad']), undefined)

    assert.equal(setEaseEditFamily<Ease>('outQuad', 'sine'), 'outSine')
    assert.equal(setEaseEditFamily<Ease>('family:quad', 'sine'), 'family:sine')
    assert.equal(setEaseEditFamily<Ease>('mode:out', 'sine'), 'outSine')
    assert.equal(setEaseEditFamily<Ease>(undefined, 'sine'), 'family:sine')
    assert.equal(setEaseEditFamily<Ease>('linear', 'sine'), 'inSine')
    assert.equal(setEaseEditFamily<Ease>('outQuad', 'linear'), 'linear')
    assert.equal(setEaseEditFamily<Ease>('outQuad', undefined), 'mode:out')
    assert.equal(setEaseEditFamily<Ease>('family:quad', undefined), undefined)
    assert.equal(setEaseEditMode<Ease>('outQuad', 'inOut'), 'inOutQuad')
    assert.equal(setEaseEditMode<Ease>('family:quad', 'inOut'), 'inOutQuad')
    assert.equal(setEaseEditMode<Ease>('mode:out', 'in'), 'mode:in')
    assert.equal(setEaseEditMode<Ease>(undefined, 'in'), 'mode:in')
    assert.equal(setEaseEditMode<Ease>('outQuad', undefined), 'family:quad')
    assert.equal(setEaseEditMode<Ease>('mode:out', undefined), undefined)
})

test('quick edits cycle through the modes of the current family, then linear', () => {
    const cycle = (start: Ease, count: number) => {
        const values = [start]
        while (values.length < count) values.push(cycleEase(values.at(-1) ?? start))
        return values
    }
    assert.deepEqual(cycle('linear', 6), [
        'linear',
        'inQuad',
        'outQuad',
        'inOutQuad',
        'outInQuad',
        'linear',
    ])
    assert.deepEqual(cycle('outSine', 5), ['outSine', 'inOutSine', 'outInSine', 'linear', 'inQuad'])
    assert.deepEqual(cycle('inStep', 5), ['inStep', 'outStep', 'inOutStep', 'outInStep', 'linear'])
})

test('ease samples follow every curve within the tolerance', () => {
    for (const type of eases.filter((type) => type !== 'linear' && !type.endsWith('Step'))) {
        for (const [from, to] of [
            [0, 1],
            [0.2, 0.9],
        ] as const) {
            const tolerance = 0.002
            const fractions = sampleEase(type, from, to, tolerance)
            assert.equal(fractions[0], from)
            assert.equal(fractions.at(-1), to)
            for (const [index, a] of fractions.slice(0, -1).entries()) {
                const b = fractions[index + 1]!
                assert.ok(b > a)
                for (let i = 1; i < 16; i++) {
                    const x = a + ((b - a) * i) / 16
                    const chord = ease(type, a) + ((ease(type, b) - ease(type, a)) * i) / 16
                    // Near vertical tangents the chord stays close along its normal.
                    const error = Math.abs(ease(type, x) - chord)
                    assert.ok(error < 0.02 || b - a < 1e-3, `${type} ${a}..${b}: ${error}`)
                }
            }
        }
    }
})
