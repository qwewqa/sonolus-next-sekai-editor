import assert from 'node:assert/strict'
import test from 'node:test'
import {
    connectorBaseKind,
    connectorKindValue,
    connectorStyle,
    noteStyles,
} from '../../src/chart/noteStyle'
import { getStyledParticle, resolveParticle, type ParticleEffect } from '../../src/preview/particle'
import { getStyledSkin, resolveSkin, type Sprite } from '../../src/preview/skin'

const sprite = (): Sprite => ({ u0: 0, v0: 0, u1: 1, v1: 1 })

test('all colored connector families retain their behavior and wire values', () => {
    for (const fake of [false, true]) {
        for (const [type, critical, base] of [
            ['active', false, 1],
            ['active', true, 2],
            ['damage', false, 3],
        ] as const) {
            for (const [index, style] of noteStyles.entries()) {
                const kind = connectorKindValue({
                    connectorType: type,
                    connectorIsFake: fake,
                    connectorActiveIsCritical: critical,
                    connectorGuideColor: 'green',
                    connectorStyle: style,
                })
                assert.equal(kind, (fake ? 50 : 0) + (index ? base * 10 + index : base))
                assert.equal(connectorBaseKind(kind), (fake ? 50 : 0) + base)
                assert.equal(connectorStyle(kind), style)
            }
        }
    }
    for (const [index, color] of noteStyles.slice(1).entries()) {
        const kind = connectorKindValue({
            connectorType: 'guide',
            connectorIsFake: true,
            connectorActiveIsCritical: true,
            connectorGuideColor: color as Exclude<typeof color, 'default'>,
            connectorStyle: 'black',
        })
        assert.equal(kind, 101 + index)
        assert.equal(connectorBaseKind(kind), kind)
        assert.equal(connectorStyle(kind), 'default')
    }
})

test('colored bodies, arrows and connections require complete sets; independent sprites fall back individually', () => {
    const sprites = new Map<string, Sprite>()
    const add = (name: string) => {
        const value = sprite()
        sprites.set(name, value)
        return value
    }
    const base = add('Sekai Normal Note Middle')
    const middle = add('Sekai Normal Note Middle Blue')
    const slot = add('Sekai Slot Normal Blue')
    const glow = add('Sekai Normal Slide Slot Glow Blue')
    const connection = add('Sekai Normal Active Slide Connection Normal')
    const coloredConnection = add('Sekai Normal Active Slide Connection Normal Blue')
    add('Sekai Flick Arrow Up 1 Blue')
    let skin = resolveSkin((name) => sprites.get(name))
    let blue = getStyledSkin(skin, 'blue')
    assert.equal(blue.normalNote.body.middle, base)
    assert.equal(blue.normalNote.slot, slot)
    assert.equal(blue.activeSlideConnector.normal, connection)
    assert.equal(blue.activeSlideConnectorSlotGlow, glow)
    assert.equal(blue.flickNote.arrow, skin.flickNote.arrow)
    add('Sekai Normal Note Left Blue')
    add('Sekai Normal Note Right Blue')
    add('Sekai Normal Active Slide Connection Active Blue')
    for (const direction of ['Up', 'Up Left', 'Down', 'Down Left']) {
        for (let width = 1; width <= 6; width++) add(`Sekai Flick Arrow ${direction} ${width} Blue`)
    }
    skin = resolveSkin((name) => sprites.get(name))
    blue = getStyledSkin(skin, 'blue')
    assert.equal(blue.normalNote.body.middle, middle)
    assert.equal(blue.activeSlideConnector.normal, coloredConnection)
    assert.equal(
        blue.flickNote.arrow.downLeft[5],
        sprites.get('Sekai Flick Arrow Down Left 6 Blue'),
    )
    assert.equal(blue.traceDownFlickNote.arrow.downLeft[5], blue.flickNote.arrow.downLeft[5])
    assert.equal(getStyledSkin(skin, 'red').normalNote.body.middle, base)
    assert.equal(getStyledSkin(skin), skin)
})

test('colored damage bodies preserve the fallback skin body geometry', () => {
    const sprites = new Map<string, Sprite>([['Sekai Trace Note Purple Middle', sprite()]])
    for (const part of ['Left', 'Middle', 'Right'])
        sprites.set(`Sekai Damage Note ${part} Red`, sprite())
    const skin = resolveSkin((name) => sprites.get(name))
    assert.equal(getStyledSkin(skin, 'red').damageNote.body.renderType, 'slim')
})

test('colored effects fall back per effect and trace flicks share directional and lane colors', () => {
    const names = [
        'Sekai Flick Note Circular',
        'Sekai Flick Note Circular Red',
        'Sekai Flick Note Linear',
        'Sekai Flick Note Directional Red',
        'Sekai Flick Lane Linear Red',
        'Sekai Normal Trace Note Circular Red',
        'Sekai Normal Slide Connector Trail Linear Red',
    ]
    const effects = new Map(names.map((name) => [name, { groups: [] } satisfies ParticleEffect]))
    const particle = resolveParticle((name) => effects.get(name))
    const red = getStyledParticle(particle, 'red')
    assert.equal(red.flickNote.circular, effects.get(names[1]!))
    assert.equal(red.flickNote.linear, particle.flickNote.linear)
    assert.equal(red.traceFlickNote.directional, red.flickNote.directional)
    assert.equal(red.traceFlickNote.lane, red.flickNote.lane)
    assert.equal(red.traceNote.tick, effects.get('Sekai Normal Trace Note Circular Red'))
    assert.equal(
        red.normalSlideConnector.trailLinear,
        effects.get('Sekai Normal Slide Connector Trail Linear Red'),
    )
    assert.equal(
        getStyledParticle(particle, 'blue').flickNote.circular,
        particle.flickNote.circular,
    )
})
