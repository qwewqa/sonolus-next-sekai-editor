import assert from 'node:assert/strict'
import test from 'node:test'
import { elevationGuideAlphaFraction } from '../../src/utils/guideAlpha'

type Point = { beat: number; elevation: number; attachHead?: Point; attachTail?: Point }
const point = (elevation: number, beat = 2): Point => ({ beat, elevation })
const fraction = (marker: Point, head: Point, tail: Point) =>
    elevationGuideAlphaFraction(marker, head, tail, (note) => note)
const attached = (head: Point, tail: Point, elevation: number): Point => ({
    beat: head.beat,
    elevation,
    attachHead: head,
    attachTail: tail,
})

test('same-beat guide alpha uses authored height, reversal and pinned identities', () => {
    const head = point(0),
        tail = point(4)
    assert.equal(fraction(point(1), head, tail), 0.25)
    assert.equal(fraction(point(1), tail, head), 0.75)
    assert.equal(fraction(point(-3), head, tail), 0)
    assert.equal(fraction(point(8), head, tail), 1)
    assert.equal(fraction(head, head, tail), 0)
    assert.equal(fraction(tail, head, tail), 1)
    const flat = point(0)
    assert.equal(fraction(point(3), head, flat), 0.5)
    assert.equal(fraction(flat, head, flat), 1)
    assert.equal(fraction(head, head, point(4, 2 + 1e-7)), undefined)
})

test('common attachment families normalize separator fractions after each raw clamp', () => {
    const head = point(0),
        tail = point(4)
    const separator = attached(head, tail, 1)
    const middle = attached(head, tail, 2)
    assert.equal(fraction(middle, separator, tail), 1 / 3)
    assert.equal(fraction(attached(head, tail, -2), separator, tail), 0)
    assert.equal(fraction(attached(head, tail, 9), separator, tail), 1)
    assert.equal(fraction(middle, tail, separator), 2 / 3)
    const clampedStart = attached(head, tail, -3)
    const clampedEnd = attached(head, tail, 8)
    assert.equal(fraction(separator, clampedStart, clampedEnd), 0.25)
})

test('equal raw root heights retain midpoint attachment weights and pinned root endpoints', () => {
    const head = point(0),
        tail = point(0)
    const marker = attached(head, tail, 99)
    assert.equal(fraction(marker, head, tail), 0.5)
    assert.equal(fraction(marker, head, attached(head, tail, -99)), 1)
    assert.equal(fraction(marker, attached(head, tail, -99), tail), 0)
})

test('different families use clamp-resolved authored heights without applying lane ease', () => {
    const head = point(0),
        tail = point(8)
    const a = point(2),
        b = point(4)
    assert.equal(fraction(attached(a, b, -99), head, tail), 0.25)
    assert.equal(fraction(attached(a, b, 99), head, tail), 0.5)
    const timed = point(4, 3)
    assert.equal(fraction(attached(a, timed, 6), head, tail), 0.75)
})
