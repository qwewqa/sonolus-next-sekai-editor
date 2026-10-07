import { name } from '../package.json'

/** The localStorage key the app stores a key under. */
export const storageKey = (key: string) => `${name}.${key}`

export const storageGet = (key: string, defaultValue: unknown): unknown => {
    try {
        const value = localStorage.getItem(storageKey(key))
        if (value === null) return defaultValue

        return JSON.parse(value)
    } catch {
        return defaultValue
    }
}

export const storageSet = (key: string, value: unknown) => {
    localStorage.setItem(storageKey(key), JSON.stringify(value))
}

export const storageRemove = (key: string) => {
    localStorage.removeItem(storageKey(key))
}

/** The stored text as written, even when it is not valid JSON. */
export const storageGetText = (key: string): string | undefined => {
    try {
        return localStorage.getItem(storageKey(key)) ?? undefined
    } catch {
        return
    }
}

export const storageSetText = (key: string, value: string) => {
    localStorage.setItem(storageKey(key), value)
}
