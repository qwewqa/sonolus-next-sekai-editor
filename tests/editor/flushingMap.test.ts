import assert from 'node:assert/strict'
import test from 'node:test'
import { createFlushingMap } from '../../src/state/store/flushingMap'

const fixture = () => {
    const map = new Map([
        ['a', 1],
        ['b', 2],
        ['c', 3],
    ])
    const pending: (() => void)[] = []
    const flush = () => {
        for (const apply of pending.splice(0)) apply()
    }
    const view = createFlushingMap(map, flush)
    return {
        map,
        view,
        stage(key: string, value: number) {
            pending.push(() => map.set(key, value))
        },
        remove(key: string) {
            pending.push(() => map.delete(key))
        },
    }
}

test('retained Map references flush staged reads and keep native Map identity', () => {
    const { map, view, stage, remove } = fixture()
    assert.ok(view instanceof Map)
    assert.equal(view.constructor, Map)
    assert.equal(Object.prototype.toString.call(view), '[object Map]')
    assert.equal(view.get, view.get)
    assert.equal(view.set, view.set)
    assert.equal(view[Symbol.iterator], view[Symbol.iterator])
    stage('a', 10)
    assert.equal(map.get('a'), 1)
    assert.equal(view.get('a'), 10)
    remove('b')
    assert.equal(view.has('b'), false)
    stage('d', 4)
    assert.equal(view.size, 3)
    assert.equal(view.get('d'), 4)
})

test('mutations apply staged writes first and set chains retain the flushing view', () => {
    const { map, view, stage } = fixture()
    stage('d', 4)
    assert.equal(view.delete('d'), true)
    stage('e', 5)
    view.clear()
    assert.equal(map.size, 0)
    stage('a', 10)
    assert.equal(view.set('b', 20).set('a', 30), view)
    assert.deepEqual(
        [...map],
        [
            ['a', 30],
            ['b', 20],
        ],
    )
})

for (const method of ['entries', 'keys', 'values', Symbol.iterator] as const)
    test(`${String(method)} iterators see writes staged after iteration begins`, () => {
        const { view, stage, remove } = fixture()
        const iterator = view[method]()
        assert.equal(iterator.next, iterator.next)
        assert.equal(iterator[Symbol.iterator](), iterator)
        assert.equal(iterator[Symbol.iterator], iterator[Symbol.iterator])
        const item = (key: string, value: number) =>
            method === 'keys' ? key : method === 'values' ? value : [key, value]
        assert.deepEqual(iterator.next(), { value: item('a', 1), done: false })
        stage('b', 20)
        remove('c')
        stage('d', 4)
        assert.deepEqual(iterator.next(), { value: item('b', 20), done: false })
        assert.deepEqual(iterator.next(), { value: item('d', 4), done: false })
        assert.deepEqual(iterator.next(), { value: undefined, done: true })
    })

test('forEach callbacks see live staged edits, the view argument and their thisArg', () => {
    const { map, view, stage, remove } = fixture()
    const receiver = { visited: [] as [string, number][] }
    stage('a', 10)
    view.forEach(function (this: typeof receiver, value, key, callbackMap) {
        assert.equal(this, receiver)
        assert.equal(callbackMap, view)
        this.visited.push([key, value])
        if (key !== 'a') return
        stage('b', 20)
        remove('c')
        stage('d', 4)
    }, receiver)
    assert.deepEqual(receiver.visited, [
        ['a', 10],
        ['b', 20],
        ['d', 4],
    ])
    assert.deepEqual([...map], receiver.visited)
})

test('forEach preserves callback errors after applying their staged edits', () => {
    const { map, view, stage } = fixture()
    const error = new Error('callback stopped')
    assert.throws(
        () =>
            view.forEach(() => {
                stage('b', 20)
                throw error
            }),
        error,
    )
    assert.equal(map.get('b'), 20)
    view.clear()
    assert.throws(() => Reflect.apply(view.forEach, view, [undefined]), TypeError)
})

test('iterator helpers consume the flushing next rather than the raw iterator', (t) => {
    const { view, stage } = fixture()
    const iterator = view.values()
    const map: unknown = Reflect.get(iterator, 'map')
    if (typeof map !== 'function') {
        t.skip('Iterator helpers are unavailable in this runtime')
        return
    }
    const mapped = Reflect.apply(map, iterator, [(value: number) => value * 2]) as Iterator<number>
    assert.deepEqual(mapped.next(), { value: 2, done: false })
    stage('b', 20)
    assert.deepEqual(mapped.next(), { value: 40, done: false })
})
