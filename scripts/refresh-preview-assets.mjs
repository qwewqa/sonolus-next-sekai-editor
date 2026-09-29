import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { refreshPreviewAssetLock } from './release-assets.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lock = await refreshPreviewAssetLock(root)
console.log(`Locked preview assets: ${lock.skin.item.title}, ${lock.particle.item.title}`)
