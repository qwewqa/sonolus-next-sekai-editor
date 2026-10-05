import type { Chart } from '../..'
import { settings } from '../../../settings.js'
import type { Sus } from '../../../sus/parse.js'
import { addToGroups, type Groups } from '../../groups.js'
import type { NoteObject } from '../../note.js'
import { addDefaultStageToStages, type Stages } from '../../stages.js'

export const parseSusChart = (sus: Sus) => {
    const groups: Groups = new Map()
    const [groupId] = addToGroups(groups)
    if (settings.autoAddGroup) addToGroups(groups)

    const stages: Stages = new Map()
    const [stageId] = addDefaultStageToStages(stages)

    const chart: Chart = {
        initialLife: 1000,
        isDynamicStages: false,
        bpms: [],
        groups,
        stages,
        cameraEvents: [],
        stageMaskEvents: [],
        stagePivotEvents: [],
        stageStyleEvents: [],
        stageTransformEvents: [],
        timeScales: [],
        slides: [],
    }

    const flickMods = new Map<string, 'left' | 'up' | 'right'>()
    const traceMods = new Set<string>()
    const criticalMods = new Set<string>()
    const tickRemoveMods = new Set<string>()
    const slideStartEndRemoveMods = new Set<string>()
    const easeMods = new Map<string, 'inQuad' | 'outQuad'>()

    const preventSingles = new Set<string>()
    const dedupeSingles = new Set<string>()
    const dedupeSlides = new Map<string, NoteObject[]>()

    for (const slide of sus.slides) {
        if (slide.type !== 3) continue

        for (const note of slide.notes) {
            const key = getKey(note)
            switch (note.type) {
                case 1:
                case 2:
                case 3:
                case 5:
                    preventSingles.add(key)
                    break
            }
        }
    }
    for (const note of sus.directionalNotes) {
        const key = getKey(note)
        switch (note.type) {
            case 1:
                flickMods.set(key, 'up')
                break
            case 3:
                flickMods.set(key, 'left')
                break
            case 4:
                flickMods.set(key, 'right')
                break
            case 2:
                easeMods.set(key, 'inQuad')
                break
            case 5:
            case 6:
                easeMods.set(key, 'outQuad')
                break
        }
    }
    for (const note of sus.tapNotes) {
        const key = getKey(note)
        switch (note.type) {
            case 2:
                criticalMods.add(key)
                break
            case 5:
                traceMods.add(key)
                break
            case 6:
                traceMods.add(key)
                criticalMods.add(key)
                break
            case 3:
                tickRemoveMods.add(key)
                break
            case 7:
                slideStartEndRemoveMods.add(key)
                break
            case 8:
                criticalMods.add(key)
                slideStartEndRemoveMods.add(key)
                break
        }
    }

    for (const timeScaleChange of sus.timeScaleChanges) {
        chart.timeScales.push({
            groupId,
            beat: timeScaleChange.tick / sus.ticksPerBeat,
            editorLane: -6,
            timeScale: timeScaleChange.timeScale,
            skip: 0,
            timeScaleEase: 'inStep',
            timeScaleTransition: 'timeScale',
            hideNotes: false,
        })
    }

    const bpmChanges = new Map(sus.bpmChanges.map((change) => [change.tick, change.bpm]))
    const meterChanges = new Map(
        (sus.meterChanges ?? []).map((change) => [change.tick, change.meter]),
    )
    let bpm = 60
    let meter = 4
    for (const tick of [...new Set([...bpmChanges.keys(), ...meterChanges.keys()])].sort(
        (a, b) => a - b,
    )) {
        bpm = bpmChanges.get(tick) ?? bpm
        meter = meterChanges.get(tick) ?? meter
        chart.bpms.push({ beat: tick / sus.ticksPerBeat, bpm, meter })
    }

    for (const note of sus.tapNotes) {
        if (note.lane <= 1 || note.lane >= 14) continue
        if (note.type !== 1 && note.type !== 2 && note.type !== 5 && note.type !== 6) continue

        const key = getKey(note)
        if (preventSingles.has(key)) continue

        if (dedupeSingles.has(key)) continue
        dedupeSingles.add(key)

        const isCritical = note.type === 2 || note.type === 6

        chart.slides.push([
            {
                groupId,
                stageId,
                beat: note.tick / sus.ticksPerBeat,
                noteStyle: 'default',
                connectorStyle: 'default',
                noteType: note.type === 5 || note.type === 6 ? 'trace' : 'default',
                isAttached: false,
                left: note.lane - 8,
                size: note.width,
                isCritical,
                flickDirection: flickDirections[flickMods.get(key) ?? 'none'],
                isFake: false,
                sfx: 'default',
                isConnectorSeparator: false,
                connectorType: 'active',
                connectorEase: 'linear',
                connectorIsFake: false,
                connectorActiveIsCritical: isCritical,
                connectorGuideAlpha: 1,
                connectorLayer: 'top',
                connectorIsPassThrough: false,
                connectorPresentation: 'default',
            },
        ])
    }

    for (const slide of sus.slides) {
        const startNote = slide.notes.find(({ type }) => type === 1 || type === 2)
        if (!startNote) continue

        const slideCriticalMod = criticalMods.has(getKey(startNote))

        const isFake = false
        const sfx = 'default'
        const connectorType = slide.type === 3 ? 'active' : 'guide'
        const isConnectorSeparator = connectorType === 'guide'
        const connectorIsFake = false
        const connectorActiveIsCritical = connectorType === 'active' && slideCriticalMod
        const connectorColor = connectorType === 'guide' && slideCriticalMod ? 'yellow' : 'green'
        const connectorStyle = connectorType === 'guide' ? connectorColor : 'default'
        const connectorLayer = connectorType === 'guide' ? 'bottom' : 'top'
        const connectorIsPassThrough = false
        const connectorPresentation = 'default'

        const objects: NoteObject[] = []

        for (const [i, note] of slide.notes.entries()) {
            const key = getKey(note)

            const beat = note.tick / sus.ticksPerBeat
            const left = note.lane - 8
            const size = note.width
            const isCritical =
                connectorType === 'active' && (slideCriticalMod || criticalMods.has(key))
            const connectorEase = easeMods.get(key) ?? 'linear'
            const connectorGuideAlpha =
                connectorType === 'guide'
                    ? ((slide.notes.length - 1 - i) / (slide.notes.length - 1)) * 1 +
                      (i / (slide.notes.length - 1)) * 0.2
                    : 1

            switch (note.type) {
                case 1: {
                    if (connectorType === 'guide' || slideStartEndRemoveMods.has(key)) {
                        objects.push({
                            groupId,
                            stageId,
                            beat,
                            noteStyle: 'default',
                            connectorStyle,
                            noteType: 'anchor',
                            isAttached: false,
                            left,
                            size,
                            isCritical,
                            flickDirection: 'none',
                            isFake,
                            sfx,
                            isConnectorSeparator,
                            connectorType,
                            connectorEase,
                            connectorIsFake,
                            connectorActiveIsCritical,
                            connectorGuideAlpha,
                            connectorLayer,
                            connectorIsPassThrough,
                            connectorPresentation,
                        })
                    } else {
                        objects.push({
                            groupId,
                            stageId,
                            beat,
                            noteStyle: 'default',
                            connectorStyle,
                            noteType: traceMods.has(key) ? 'trace' : 'default',
                            isAttached: false,
                            left,
                            size,
                            isCritical,
                            flickDirection: 'none',
                            isFake,
                            sfx,
                            isConnectorSeparator,
                            connectorType,
                            connectorEase,
                            connectorIsFake,
                            connectorActiveIsCritical,
                            connectorGuideAlpha,
                            connectorLayer,
                            connectorIsPassThrough,
                            connectorPresentation,
                        })
                    }
                    break
                }
                case 2: {
                    if (connectorType === 'guide' || slideStartEndRemoveMods.has(key)) {
                        objects.push({
                            groupId,
                            stageId,
                            beat,
                            noteStyle: 'default',
                            connectorStyle,
                            noteType: 'anchor',
                            isAttached: false,
                            left,
                            size,
                            isCritical,
                            flickDirection: 'none',
                            isFake,
                            sfx,
                            isConnectorSeparator,
                            connectorType,
                            connectorEase,
                            connectorIsFake,
                            connectorActiveIsCritical,
                            connectorGuideAlpha,
                            connectorLayer,
                            connectorIsPassThrough,
                            connectorPresentation,
                        })
                    } else {
                        objects.push({
                            groupId,
                            stageId,
                            beat,
                            noteStyle: 'default',
                            connectorStyle,
                            noteType: traceMods.has(key) ? 'trace' : 'default',
                            isAttached: false,
                            left,
                            size,
                            isCritical,
                            flickDirection: flickDirections[flickMods.get(key) ?? 'none'],
                            isFake,
                            sfx,
                            isConnectorSeparator,
                            connectorType,
                            connectorEase,
                            connectorIsFake,
                            connectorActiveIsCritical,
                            connectorGuideAlpha,
                            connectorLayer,
                            connectorIsPassThrough,
                            connectorPresentation,
                        })
                    }
                    break
                }
                case 3: {
                    if (tickRemoveMods.has(key)) {
                        objects.push({
                            groupId,
                            stageId,
                            beat,
                            noteStyle: 'default',
                            connectorStyle,
                            noteType: 'default',
                            isAttached: true,
                            left,
                            size,
                            isCritical,
                            flickDirection: 'none',
                            isFake,
                            sfx,
                            isConnectorSeparator,
                            connectorType,
                            connectorEase,
                            connectorIsFake,
                            connectorActiveIsCritical,
                            connectorGuideAlpha,
                            connectorLayer,
                            connectorIsPassThrough,
                            connectorPresentation,
                        })
                    } else {
                        objects.push({
                            groupId,
                            stageId,
                            beat,
                            noteStyle: 'default',
                            connectorStyle,
                            noteType: traceMods.has(key) ? 'trace' : 'default',
                            isAttached: tickRemoveMods.has(key),
                            left,
                            size,
                            isCritical,
                            flickDirection: 'none',
                            isFake,
                            sfx,
                            isConnectorSeparator,
                            connectorType,
                            connectorEase,
                            connectorIsFake,
                            connectorActiveIsCritical,
                            connectorGuideAlpha,
                            connectorLayer,
                            connectorIsPassThrough,
                            connectorPresentation,
                        })
                    }
                    break
                }
                case 5: {
                    if (tickRemoveMods.has(key)) break

                    objects.push({
                        groupId,
                        stageId,
                        beat,
                        noteStyle: 'default',
                        connectorStyle,
                        noteType: 'anchor',
                        isAttached: false,
                        left,
                        size,
                        isCritical,
                        flickDirection: 'none',
                        isFake,
                        sfx,
                        isConnectorSeparator,
                        connectorType,
                        connectorEase,
                        connectorIsFake,
                        connectorActiveIsCritical,
                        connectorGuideAlpha,
                        connectorLayer,
                        connectorIsPassThrough,
                        connectorPresentation,
                    })
                    break
                }
            }
        }

        chart.slides.push(objects)

        if (connectorType === 'guide') continue

        const key = getKey(startNote)
        const dupe = dedupeSlides.get(key)
        if (dupe) chart.slides.splice(chart.slides.indexOf(dupe), 1)

        dedupeSlides.set(key, objects)
    }

    return chart
}

const getKey = (note: { tick: number; lane: number }) => `${note.lane}-${note.tick}`

const flickDirections = {
    up: 'up',
    left: 'upLeft',
    right: 'upRight',
    none: 'none',
} as const
