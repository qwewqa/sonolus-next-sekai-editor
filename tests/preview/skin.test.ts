import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSkin, type Sprite } from '../../src/preview/skin'

const sprite = (u0: number): Sprite => ({ u0, v0: 0, u1: 1, v1: 1 })

test('single judgment lines prefer the dedicated sprite for every color', () => {
    const colors = ['Neutral', 'Red', 'Green', 'Blue', 'Yellow', 'Purple', 'Cyan', 'Black']
    const sprites = new Map<string, Sprite>()
    for (const [index, color] of colors.entries()) {
        sprites.set(`Sekai Judgment Single Line ${color}`, sprite(index))
        sprites.set(`Sekai Judgment Edge ${color}`, sprite(index + 8))
    }
    const skin = resolveSkin((name) => sprites.get(name))

    for (const [index, color] of colors.entries()) {
        assert.equal(
            skin.judgments[index]?.singleLine,
            sprites.get(`Sekai Judgment Single Line ${color}`),
        )
        assert.equal(skin.judgments[index]?.edge, sprites.get(`Sekai Judgment Edge ${color}`))
    }
})

test('older skins retain judgment edge fallback without borrowing another color', () => {
    const edge = sprite(0)
    const skin = resolveSkin((name) => (name === 'Sekai Judgment Edge Neutral' ? edge : undefined))

    assert.equal(skin.judgments[0]?.singleLine, edge)
    assert.equal(skin.judgments[1]?.singleLine, undefined)
})
