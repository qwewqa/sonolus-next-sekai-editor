import { shallowRef } from 'vue'
import { i18n } from '../i18n'
import { interpolate } from '../utils/interpolate'

declare const __APP_VERSION__: string

let id = 0

export const notification = shallowRef<{ id: number; message?: () => string }>({
    id: id++,
    message: interpolate(() => i18n.value.notification.title, __APP_VERSION__),
})

export const notify = (message: () => string) => {
    notification.value = {
        id: id++,
        message,
    }
}

/** Removes a notice that no longer holds, such as one for a drag that changed nothing. */
export const clearNotification = () => {
    notification.value = { id: notification.value.id }
}
