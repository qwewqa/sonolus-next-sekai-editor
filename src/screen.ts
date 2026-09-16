import { computed, ref } from 'vue'

export const screenWidth = ref(document.documentElement.clientWidth)

export const screenSm = computed(() => screenWidth.value >= 640)

const updateScreenWidth = () => {
    screenWidth.value = document.documentElement.clientWidth
}

window.addEventListener('resize', updateScreenWidth)
window.visualViewport?.addEventListener('resize', updateScreenWidth)

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        window.removeEventListener('resize', updateScreenWidth)
        window.visualViewport?.removeEventListener('resize', updateScreenWidth)
    })
}
