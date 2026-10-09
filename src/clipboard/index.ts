import type { LevelDataEntity } from '@sonolus/core'
import { computed, markRaw, ref } from 'vue'
import type { Chart } from '../chart'
import type { NoteObject } from '../chart/note'
import { parseLevelDataChart } from '../chart/parse/levelData'
import { parseClipboardData } from './data/parse'
import type { ClipboardData } from './data/schema'

type ClipboardEntry = {
    name: string
    text: string
    data?: {
        lane: number
        beat: number
        chart: Chart
        source?: ClipboardData['source']
        /** Anchor index in the parsed, flattened note list. */
        anchor?: number
    }
}

export const clipboardEntries = ref<ClipboardEntry[]>([])

export const clipboardEntry = computed(() => clipboardEntries.value[0])

let isUpdating = false

export const updateClipboard = async () => {
    if (isUpdating) return

    isUpdating = true
    try {
        const text = await navigator.clipboard.readText()
        if (!text) return

        updateClipboardEntries(text)
    } catch {
        return
    } finally {
        isUpdating = false
    }
}

export const setClipboardData = (data: ClipboardData) => {
    const text = JSON.stringify(data)
    updateClipboardEntries(text)

    void writeClipboardText(text)
}

export const setClipboardEntry = (entry: ClipboardEntry) => {
    clipboardEntries.value.splice(clipboardEntries.value.indexOf(entry), 1)
    clipboardEntries.value.unshift(markRaw(entry))

    void writeClipboardText(entry.text)
}

const writeClipboardText = async (text: string) => {
    try {
        await navigator.clipboard.writeText(text)
    } catch {
        return
    }
}

const updateClipboardEntries = (text: string) => {
    const entry = clipboardEntries.value.find((entry) => entry.text === text)
    if (entry) {
        clipboardEntries.value.splice(clipboardEntries.value.indexOf(entry), 1)
        clipboardEntries.value.unshift(markRaw(entry))
        return
    }

    clipboardEntries.value.unshift(markRaw(getClipboardEntry(text)))
    if (clipboardEntries.value.length > 10) clipboardEntries.value.pop()
}

let i = 0

const getClipboardEntry = (text: string): ClipboardEntry => {
    try {
        const data = parseClipboardData(JSON.parse(text))
        const anchorEntity = data.anchor === undefined ? undefined : data.entities[data.anchor]
        const noteSources = anchorEntity ? new Map<NoteObject, LevelDataEntity>() : undefined
        const chart = parseLevelDataChart(data.entities, data.defaultGuideColors, noteSources)
        const anchor = noteSources
            ? chart.slides.flat().findIndex((note) => noteSources.get(note) === anchorEntity)
            : -1

        return {
            name: `#${++i} (${
                chart.cameraEvents.length +
                chart.stageMaskEvents.length +
                chart.stagePivotEvents.length +
                chart.stageStyleEvents.length +
                chart.stageTransformEvents.length +
                chart.timeScales.length +
                chart.slides.reduce((sum, slide) => sum + slide.length, 0)
            })`,
            text,
            data: {
                lane: data.lane,
                beat: data.beat,
                chart,
                source: data.source,
                anchor: anchor >= 0 ? anchor : undefined,
            },
        }
    } catch {
        return {
            name: `${Math.random()}`,
            text,
        }
    }
}
