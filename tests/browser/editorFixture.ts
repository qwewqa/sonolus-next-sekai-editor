import type { Chart } from '../../src/chart'
import type { GroupId } from '../../src/chart/groups'
import type { NoteObject } from '../../src/chart/note'
import type { StageId } from '../../src/chart/stages'
import type { Entity } from '../../src/state/entities'

type BriefEntity = { type: string; beat: number; left?: number; size?: number }

declare global {
    interface Window {
        editorFrames: { chart: number; overlay: number }
        editorTest: {
            history: typeof import('../../src/history')
            store: typeof import('../../src/history/store')
            settings: (typeof import('../../src/settings'))['settings']
            view: (typeof import('../../src/editor/view'))['view']
            nextTick: (typeof import('vue'))['nextTick']
            fixtures: { interaction: Chart; notes: Chart; connectors: Chart; events: Chart }
            show: (chart: Chart, time?: number) => void
            addWaveform: () => Promise<void>
            point: (lane: number, beat: number) => { x: number; y: number }
            snapshot: () => {
                notes: BriefEntity[]
                selected: BriefEntity[]
                hovered: BriefEntity[]
                creating: BriefEntity[]
            }
        }
    }
}

// Count actual on-screen clears without adding any application test hooks or
// readbacks, which can change Chromium's deferred Canvas rendering behavior.
export const installCanvasCounters = () => {
    // The Vite app loads more modules than the browser's default 250-entry
    // resource timing buffer. Retain their URLs for fixtures that must import
    // the same reactive module instances, including any HMR timestamps.
    performance.setResourceTimingBufferSize(5000)
    window.editorFrames = { chart: 0, overlay: 0 }
    const count = (ctx: CanvasRenderingContext2D) => {
        if (!(ctx.canvas instanceof HTMLCanvasElement)) return
        if (ctx.canvas.classList.contains('editor-chart')) window.editorFrames.chart++
        if (ctx.canvas.classList.contains('editor-overlay')) window.editorFrames.overlay++
    }
    const clearRect = CanvasRenderingContext2D.prototype.clearRect
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        count(this)
        return clearRect.apply(this, args)
    }
    const fillRect = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.globalCompositeOperation === 'copy') count(this)
        return fillRect.apply(this, args)
    }
    for (const setting of ['showPreview', 'showSidebar', 'autoSave']) {
        localStorage.setItem(`sonolus-next-sekai-editor.${setting}`, 'false')
    }
}

// This function is evaluated inside the page. Seed charts through the existing
// model API; subsequent edit tests use real mouse and keyboard events.
export const installEditorFixture = async () => {
    const moduleUrls = new Map(
        performance
            .getEntriesByType('resource')
            .map((entry) => [new URL(entry.name).pathname, entry.name]),
    )
    // Reuse the live Vite URL, including any HMR timestamp, to avoid importing a
    // second copy of a module that owns reactive state.
    const appImport = <T>(pathname: string): Promise<T> =>
        import(moduleUrls.get(pathname) ?? pathname)
    const history = await appImport<typeof import('../../src/history')>('/src/history/index.ts')
    const store = await appImport<typeof import('../../src/history/store')>('/src/history/store.ts')
    const { settings } = await appImport<typeof import('../../src/settings')>('/src/settings.ts')
    const { view } = await appImport<typeof import('../../src/editor/view')>('/src/editor/view.ts')
    const { nextTick } = await appImport<typeof import('vue')>('/node_modules/.vite/deps/vue.js')
    const { createWaveform } =
        await appImport<typeof import('../../src/waveform')>('/src/waveform.ts')
    settings.mouseSmoothScrolling = false
    settings.dragToPanX = false
    settings.dragToPanY = false
    settings.width = 20
    settings.pps = 120
    settings.showStageName = true
    settings.showGroupName = true
    settings.showOtherGroups = true
    settings.showOtherStages = true
    settings.showOtherObjects = true

    const note = (beat: number, overrides: Partial<NoteObject> = {}): NoteObject => ({
        groupId: 1 as GroupId,
        stageId: 1 as StageId,
        beat,
        noteType: 'default',
        isAttached: false,
        left: -2,
        size: 2,
        isCritical: false,
        flickDirection: 'none',
        isFake: false,
        sfx: 'default',
        isConnectorSeparator: false,
        connectorType: 'active',
        connectorEase: 'linear',
        connectorIsFake: false,
        connectorActiveIsCritical: false,
        connectorGuideColor: 'neutral',
        connectorGuideAlpha: 1,
        connectorLayer: 'top',
        connectorIsPassThrough: false,
        connectorPresentation: 'default',
        ...overrides,
    })
    const blank = (): Chart => ({
        initialLife: 1000,
        isDynamicStages: true,
        bpms: [{ beat: 0, bpm: 120 }],
        groups: new Map([
            [1 as GroupId, { name: 'Default' }],
            [2 as GroupId, { name: 'Other group' }],
        ]),
        stages: new Map(
            ([1, 2] as const).map((id) => [
                id as StageId,
                {
                    name: id === 1 ? 'Center' : 'Side stage',
                    isFromStart: true,
                    isUntilEnd: true,
                    generateSimLines: 'global',
                },
            ]),
        ),
        cameraEvents: [],
        stageMaskEvents: [],
        stagePivotEvents: [],
        stageStyleEvents: [],
        stageTransformEvents: [],
        timeScales: [],
        slides: [],
    })
    const interaction = blank()
    interaction.isDynamicStages = false
    interaction.slides = [
        [note(3, { left: -4 })],
        [note(5, { left: 0 })],
        [note(7, { left: 3 })],
        [note(9)],
    ]

    const notes = blank()
    const noteTypes = ['default', 'trace', 'anchor', 'damage', 'forceTick', 'forceNonTick'] as const
    const directions = ['none', 'up', 'upLeft', 'upRight', 'down', 'downLeft', 'downRight'] as const
    for (const [row, flickDirection] of directions.entries()) {
        for (const [column, noteType] of noteTypes.entries()) {
            notes.slides.push([
                note(2 + row * 2.5, {
                    noteType,
                    flickDirection,
                    left: -10 + column * 3.6,
                    size: column === 2 ? 0.8 : 2.4,
                    isCritical: row % 2 === 1,
                    isFake: row % 3 === 1,
                    sfx: row === 6 ? 'damage' : 'default',
                    groupId: ((column % 2) + 1) as GroupId,
                    stageId: ((column % 2) + 1) as StageId,
                }),
            ])
        }
    }

    const connectors = blank()
    const eases = ['none', 'linear', 'in', 'out', 'inOut', 'outIn'] as const
    for (const [i, connectorEase] of eases.entries()) {
        const left = -10 + i * 3.4
        const props: Partial<NoteObject> = {
            left,
            size: 1.8,
            connectorEase,
            connectorIsFake: i % 2 === 0,
            connectorActiveIsCritical: i % 2 === 1,
        }
        connectors.slides.push([
            note(1, props),
            note(3, { ...props, left: left + 1, noteType: i % 2 === 0 ? 'default' : 'trace' }),
            note(6, { ...props, left: left - 0.5, flickDirection: i % 2 ? 'upLeft' : 'downRight' }),
        ])
        const guide: Partial<NoteObject> = {
            ...props,
            noteType: 'anchor',
            connectorType: 'guide',
            connectorLayer: (['under', 'bottom', 'top', 'over'] as const)[i % 4],
            connectorGuideColor: (['red', 'green', 'blue', 'yellow', 'purple', 'cyan'] as const)[i],
            connectorGuideAlpha: [0, 0.25, 0.5, 0.75, 1, 0.4][i],
        }
        connectors.slides.push([
            note(8, guide),
            note(14, {
                ...guide,
                left: left + 1,
                size: 2.5,
                connectorGuideAlpha: i % 2 ? 1 : guide.connectorGuideAlpha,
            }),
            note(18, { ...guide, left: left - 0.5, size: 0.8 }),
        ])
        connectors.slides.push([
            note(13, { ...props, groupId: 2 as GroupId, connectorType: 'damage', size: 0.8 }),
            note(19, {
                ...props,
                groupId: 2 as GroupId,
                connectorType: 'damage',
                left: left + 1,
                size: 0.8,
            }),
        ])
    }

    const events = blank()
    events.bpms.push({ beat: 12, bpm: 180 })
    for (const [i, eventEase] of (['linear', 'in', 'outIn', 'none'] as const).entries()) {
        const beat = 2 + i * 5
        const stageId = 1 as StageId
        events.cameraEvents.push({
            beat,
            cameraLeft: -6 + i / 2,
            cameraSize: 12 - i,
            cameraZoom: 1,
            cameraZoomTargetLane: i - 1,
            cameraZoomTargetY: 0,
            cameraZoomVerticalAlign: 'default',
            cameraRotation: 0,
            cameraStageTilt: 0,
            eventEase,
        })
        events.stageMaskEvents.push({
            stageId,
            beat: beat + 0.5,
            maskLeft: -5 + i,
            maskSize: 10 - i,
            isMaskNotes: i % 2 === 0,
            eventEase,
        })
        events.stagePivotEvents.push({
            stageId,
            beat: beat + 1,
            pivotLane: -3 + i * 2,
            divisionSize: i + 1,
            divisionParity: i % 2 ? 'odd' : 'even',
            yOffset: i,
            yOffsetBeat: 0,
            eventEase,
        })
        events.stageStyleEvents.push({
            stageId,
            beat: beat + 1.5,
            editorLane: -8 + i,
            judgmentLineColor: 'cyan',
            judgmentLineStyle: 'singleLine',
            leftBorderStyle: 'light',
            rightBorderStyle: 'medium',
            isFullWidth: false,
            noteAlpha: 1,
            laneAlpha: 0.5,
            judgmentLineAlpha: 1,
            divisionLineAlpha: 1,
            eventEase,
        })
        events.stageTransformEvents.push({
            stageId,
            beat: beat + 2,
            rotation: 0,
            xTranslation: 7 - i,
            yTranslation: 0,
            elevation: 0,
            anchor: 'default',
            eventEase,
        })
        events.timeScales.push({
            groupId: ((i % 2) + 1) as GroupId,
            beat: beat + 2.5,
            editorLane: 8 - i,
            timeScale: [1, 0, -1, 2][i],
            skip: i % 2 ? 2 : 0,
            timeScaleEase: (['linear', 'inQuad', 'outInQuad', 'none'] as const)[i],
            timeScaleTransition: i % 2 ? 'scroll' : 'timeScale',
            hideNotes: i === 2,
        })
    }
    events.slides = [
        [note(4, { left: -2, size: 4 })],
        [note(8, { left: 1, isCritical: true, flickDirection: 'up' })],
    ]

    const show = (chart: Chart, time = 5) => {
        history.resetState(false, chart, 0, 'browser-regression.json')
        Object.assign(view, {
            time,
            lane: 0,
            cursorTime: 100,
            hoverTime: 100,
            groupId: undefined,
            stageId: undefined,
            selection: undefined,
            lastActive: -100,
            entities: { hovered: [], creating: [] },
        })
    }
    const brief = (entity: Entity): BriefEntity => ({
        type: entity.type,
        beat: entity.beat,
        ...('left' in entity ? { left: entity.left, size: entity.size } : {}),
    })
    window.editorTest = {
        history,
        store,
        settings,
        view,
        nextTick,
        fixtures: { interaction, notes, connectors, events },
        show,
        async addWaveform() {
            settings.waveform = 'volume'
            const buffer = new AudioBuffer({
                length: 12 * 8000,
                sampleRate: 8000,
                numberOfChannels: 1,
            })
            const samples = buffer.getChannelData(0)
            for (let i = 0; i < samples.length; i++)
                samples[i] = Math.sin(i / 8) * (0.3 + 0.7 * Math.sin(i / 7000) ** 2)
            const waveform = await createWaveform(buffer, 'volume')
            history.replaceState({
                ...history.state.value,
                bgm: { offset: 0.25, buffer, waveform },
            })
        },
        point: (lane, beat) => ({
            x: view.x + view.w * (0.5 + (lane - view.lane) / settings.width),
            y: view.y + view.h / 2 - (beat / 2 - view.time) * settings.pps,
        }),
        snapshot: () => ({
            notes: [...store.getAllEntities()]
                .filter((entity) => entity.type === 'note')
                .map(brief)
                .sort((a, b) => a.beat - b.beat),
            selected: history.state.value.selectedEntities.map(brief),
            hovered: view.entities.hovered.map(brief),
            creating: view.entities.creating.map(brief),
        }),
    }
    show(interaction, 3)
    view.cursorTime = 3
    view.noteSize = 2
    view.division = 4
    view.snapping = 'absolute'
    await nextTick()
}
