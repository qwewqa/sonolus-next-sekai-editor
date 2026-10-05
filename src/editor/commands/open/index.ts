import { ungzip } from 'pako'
import type { Command } from '..'
import { parseLevelDataChart } from '../../../chart/parse/levelData'
import { parseSusChart } from '../../../chart/parse/sus'
import { parseUscChart } from '../../../chart/parse/usc'
import { validateChart } from '../../../chart/validate'
import { chcyToUsc, isChcyLevelData } from '../../../chcy/convert'
import { checkState, resetState } from '../../../history'
import { i18n } from '../../../i18n'
import { parseLevelData } from '../../../levelData/parse'
import { showModal } from '../../../modals'
import LoadingModal from '../../../modals/LoadingModal.vue'
import { parseSus } from '../../../sus/parse'
import { parseUsc } from '../../../usc/parse'
import { getFilename, pickFileForOpen } from '../../../utils/file'
import { timeout } from '../../../utils/promise'
import { notify } from '../../notification'
import { changeBgm } from '../bgm/index.ts'
import OpenIcon from './OpenIcon.vue'

export const open: Command = {
    title: () => i18n.value.commands.open.title,
    icon: {
        is: OpenIcon,
    },

    async execute() {
        if (!(await checkState())) return

        const { file, handle } = await pickFileForOpen('levelData')
        if (!file) return

        if (file.type.startsWith('audio/')) {
            void changeBgm(file)
            return
        }

        await showModal(LoadingModal, {
            title: () => i18n.value.commands.open.title,
            async *task(signal: AbortSignal) {
                yield () => i18n.value.commands.open.loading

                const buffer = await file.arrayBuffer()
                signal.throwIfAborted()

                yield () => i18n.value.commands.open.importing
                await timeout(50)
                signal.throwIfAborted()

                const [type, data] = tryImport(buffer)
                switch (type) {
                    case 'chcy': {
                        const { offset, objects } = chcyToUsc(parseLevelData(data))

                        const chart = parseUscChart(objects)
                        validateChart(chart)

                        resetState(false, chart, offset, getFilename(file))
                        break
                    }
                    case 'levelData': {
                        const levelData = parseLevelData(data)

                        const chart = parseLevelDataChart(levelData.entities)
                        validateChart(chart)

                        resetState(false, chart, levelData.bgmOffset, getFilename(file), handle)
                        break
                    }
                    case 'usc': {
                        const { usc } = parseUsc(data)

                        const chart = parseUscChart(usc.objects)
                        validateChart(chart)

                        resetState(false, chart, usc.offset, getFilename(file))
                        break
                    }
                    case 'sus': {
                        const sus = parseSus(data)

                        const chart = parseSusChart(sus)
                        validateChart(chart)

                        resetState(false, chart, sus.offset, getFilename(file))
                        break
                    }
                }

                notify(() => i18n.value.commands.open[openedMessages[type]])
            },
        })
    },
}

const openedMessages = {
    levelData: 'opened',
    chcy: 'importedChcy',
    usc: 'importedUsc',
    sus: 'importedSus',
} as const

/**
 * Detects the format from the content: level data (gzipped, as Sonolus serves
 * it, or plain JSON), which is Chart Cyanvas level data when it has the
 * format's `TimeScaleGroup` entities; a USC chart; or a SUS chart.
 */
const tryImport = (buffer: ArrayBuffer) => {
    const json = tryParseJson(buffer)
    if (isLevelDataLike(json)) {
        return isChcyLevelData(json) ? (['chcy', json] as const) : (['levelData', json] as const)
    }
    if (json !== undefined) return ['usc', json] as const

    const sus = tryImportSus(buffer)
    if (sus) return ['sus', sus] as const

    throw new UnsupportedFileError()
}

class UnsupportedFileError extends Error {
    constructor() {
        super(i18n.value.commands.open.unsupported)
    }

    // The loading dialog shows errors as text; this one is already a sentence.
    override toString() {
        return this.message
    }
}

const isLevelDataLike = (data: unknown) =>
    typeof data === 'object' && data !== null && 'entities' in data

const tryParseJson = (buffer: ArrayBuffer): unknown => {
    const bytes = new Uint8Array(buffer)
    const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b
    try {
        return JSON.parse(new TextDecoder().decode(isGzip ? ungzip(bytes) : bytes))
    } catch {
        return
    }
}

const tryImportSus = (buffer: ArrayBuffer) => {
    try {
        const data = new TextDecoder().decode(buffer).split('\n')
        if (data.filter((line) => line.startsWith('#')).length < 10) return

        return data
    } catch {
        return
    }
}
