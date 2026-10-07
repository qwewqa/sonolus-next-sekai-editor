import assert from 'node:assert/strict'
import test from 'node:test'
import { cancelFit, queueFit } from '../../src/modals/form/fitBatch'

test('queued fits run each stage together, so layout is forced once per stage', async () => {
    const log: string[] = []
    const fit = (name: string, stop?: number) =>
        [0, 1, 2].map((stage) => () => {
            log.push(`${name}${stage}`)
            if (stage === stop) return false
        })
    const a = {}
    const b = {}
    const c = {}
    queueFit(a, fit('a'))
    queueFit(b, fit('b', 0))
    queueFit(c, fit('c'))
    // The latest fit of an owner replaces its earlier one; a cancelled fit doesn't run.
    queueFit(a, fit('A'))
    cancelFit(c)
    assert.deepEqual(log, [])
    await Promise.resolve()
    assert.deepEqual(log, ['A0', 'b0', 'A1', 'A2'])
})
