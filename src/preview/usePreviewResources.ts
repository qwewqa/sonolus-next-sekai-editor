import { onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { loadParticleFromScp, type LoadedParticle } from './particle'
import { loadPreviewResource } from './resource'
import { loadSkinFromScp, type LoadedSkin } from './skin'

declare const __APP_VERSION__: string

export const usePreviewResources = () => {
    const skin = shallowRef<LoadedSkin>()
    const particle = shallowRef<LoadedParticle>()
    const status = ref<'loading' | 'missing' | 'error' | 'ready'>('loading')
    const errorDetail = ref('')
    const loadVersion = ref(0)

    let loadController: AbortController | undefined

    const releaseResources = () => {
        skin.value?.texture.close()
        particle.value?.texture.close()
        skin.value = undefined
        particle.value = undefined
    }

    const loadSkin = async () => {
        loadController?.abort()
        loadController = new AbortController()
        const { signal } = loadController
        const isAborted = () => signal.aborted
        status.value = 'loading'
        errorDetail.value = ''
        loadVersion.value++
        releaseResources()

        try {
            const loadedSkin = await loadPreviewResource(
                `${import.meta.env.BASE_URL}resource/skin.scp?v=${encodeURIComponent(__APP_VERSION__)}`,
                loadSkinFromScp,
                signal,
            )
            if (isAborted()) {
                loadedSkin?.texture.close()
                return
            }
            if (!loadedSkin) {
                status.value = 'missing'
                return
            }

            skin.value = loadedSkin
            status.value = 'ready'
        } catch (error) {
            if (isAborted()) return
            console.error('Failed to load preview skin:', error)
            errorDetail.value = error instanceof Error ? error.message : String(error)
            status.value = 'missing'
            return
        }

        try {
            const loadedParticle = await loadPreviewResource(
                `${import.meta.env.BASE_URL}resource/particle.scp?v=${encodeURIComponent(__APP_VERSION__)}`,
                loadParticleFromScp,
                signal,
            )
            if (isAborted()) {
                loadedParticle?.texture.close()
                return
            }
            particle.value = loadedParticle
        } catch (error) {
            if (isAborted()) return
            console.error('Failed to load preview particle:', error)
        }
    }

    onMounted(() => void loadSkin())
    onUnmounted(() => {
        loadController?.abort()
        releaseResources()
    })
    return { skin, particle, status, errorDetail, loadVersion, loadSkin }
}
