import { computed, onMounted, ref, shallowRef } from 'vue'
import { errorMessage } from '../utils/error'
import { loadParticleFromScp, type LoadedParticle } from './particle'
import { loadPreviewResource } from './resource'
import { loadSkinFromScp, type LoadedSkin } from './skin'

declare const __APP_VERSION__: string

const resourceUrl = (name: string) =>
    `${import.meta.env.BASE_URL}resource/${name}.scp?v=${encodeURIComponent(__APP_VERSION__)}`

// Decoded skin and particle atlases are shared by every preview mount for the
// lifetime of the page. Closing, covering, moving, or recreating a preview's
// WebGL context re-uploads these bitmaps instead of downloading and decoding
// them again. Only successful loads are cached; failures retry on next use.
const skin = shallowRef<LoadedSkin>()
const particle = shallowRef<LoadedParticle>()
const skinStatus = ref<'idle' | 'loading' | 'missing' | 'ready'>('idle')
const skinError = ref('')
let particleStatus: 'idle' | 'loading' | 'done' = 'idle'
let loadController: AbortController | undefined

const loadParticle = async (signal: AbortSignal) => {
    if (particleStatus !== 'idle') return
    particleStatus = 'loading'
    try {
        const loaded = await loadPreviewResource(
            resourceUrl('particle'),
            loadParticleFromScp,
            signal,
        )
        if (signal.aborted) return
        particle.value = loaded
        // A missing particle package is a valid configuration; effects are skipped.
        particleStatus = 'done'
    } catch (error) {
        if (signal.aborted) return
        console.error('Failed to load preview particle:', error)
    } finally {
        if (!signal.aborted && particleStatus === 'loading') particleStatus = 'idle'
    }
}

const load = async (signal: AbortSignal) => {
    if (!skin.value) {
        skinStatus.value = 'loading'
        skinError.value = ''
        try {
            const loaded = await loadPreviewResource(resourceUrl('skin'), loadSkinFromScp, signal)
            if (signal.aborted) return
            if (!loaded) {
                skinStatus.value = 'missing'
                return
            }
            skin.value = loaded
        } catch (error) {
            if (signal.aborted) return
            console.error('Failed to load preview skin:', error)
            skinError.value = errorMessage(error)
            skinStatus.value = 'missing'
            return
        }
    }
    skinStatus.value = 'ready'
    await loadParticle(signal)
}

/** Starts loading anything not yet cached. Concurrent callers share one load. */
export const ensurePreviewResources = () => {
    if (skinStatus.value === 'loading') return
    if (skin.value) {
        skinStatus.value = 'ready'
        if (particleStatus !== 'idle') return
    }
    loadController = new AbortController()
    void load(loadController.signal)
}

/** Discards failed state and retries the downloads. Cached atlases are kept. */
export const reloadPreviewResources = () => {
    loadController?.abort()
    if (particleStatus === 'loading') particleStatus = 'idle'
    skinStatus.value = 'idle'
    ensurePreviewResources()
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        loadController?.abort()
        skin.value?.texture.close()
        particle.value?.texture.close()
    })
}

export const usePreviewResources = () => {
    // Graphics failures belong to one preview's canvas and never poison the cache.
    const graphicsError = ref<string>()
    const loadVersion = ref(0)

    const status = computed<'loading' | 'missing' | 'error' | 'ready'>(() => {
        if (skinStatus.value === 'missing') return 'missing'
        if (skinStatus.value !== 'ready') return 'loading'
        return graphicsError.value === undefined ? 'ready' : 'error'
    })
    const errorDetail = computed(() =>
        status.value === 'error' ? (graphicsError.value ?? '') : skinError.value,
    )

    const setGraphicsError = (error: unknown) => {
        graphicsError.value = errorMessage(error)
    }
    const clearGraphicsError = () => {
        graphicsError.value = undefined
    }

    const reload = () => {
        if (status.value === 'error') {
            // A new canvas gets a new context; the cached atlases are re-uploaded.
            clearGraphicsError()
            loadVersion.value++
            return
        }
        reloadPreviewResources()
    }

    onMounted(ensurePreviewResources)

    return {
        skin,
        particle,
        status,
        errorDetail,
        loadVersion,
        reload,
        setGraphicsError,
        clearGraphicsError,
    }
}
