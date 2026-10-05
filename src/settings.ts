import Type from 'typebox'
import Value from 'typebox/value'
import { shallowRef, watch } from 'vue'
import { noteStyles, noteStyleSchema } from './chart/noteStyle'
import { easeEdits, type Ease, type EaseEdit } from './ease'
import { isCommandName, type CommandName } from './editor/commands'
import { migrateToolbar } from './editor/toolbar/migrate'
import { isPanelId, panelIds, type PanelId } from './editor/workspace/layout'
import { defaultLocale } from './i18n/locale'
import { localizations } from './i18n/localizations'
import { previewAspectRatios, previewNoteSpeed, previewRenderScale } from './preview/options'
import { storageGet, storageRemove, storageSet } from './storage'
import { clamp } from './utils/math'

const number = (def: number, min: number, max: number) =>
    Type.Codec(Type.Number({ default: def }))
        .Decode((value) => clamp(value, min, max))
        .Encode((value) => value)

const defaultNoteSlidePropertiesSchema = Type.Intersect([
    Type.Partial(
        Type.Object({
            elevation: Type.Number(),
            noteStyle: noteStyleSchema,
            connectorStyle: noteStyleSchema,
            noteType: Type.Union([
                Type.Literal('default'),
                Type.Literal('trace'),
                Type.Literal('anchor'),
                Type.Literal('damage'),
                Type.Literal('forceTick'),
                Type.Literal('forceNonTick'),
            ]),
            isAttached: Type.Boolean(),
            isCritical: Type.Boolean(),
            flickDirection: Type.Union([
                Type.Literal('none'),
                Type.Literal('up'),
                Type.Literal('upLeft'),
                Type.Literal('upRight'),
                Type.Literal('down'),
                Type.Literal('downLeft'),
                Type.Literal('downRight'),
            ]),
            isFake: Type.Boolean(),
            sfx: Type.Union([
                Type.Literal('default'),
                Type.Literal('none'),
                Type.Literal('normalTap'),
                Type.Literal('criticalTap'),
                Type.Literal('normalFlick'),
                Type.Literal('criticalFlick'),
                Type.Literal('normalTrace'),
                Type.Literal('criticalTrace'),
                Type.Literal('normalTick'),
                Type.Literal('criticalTick'),
                Type.Literal('damage'),
            ]),
            isConnectorSeparator: Type.Boolean(),
            connectorType: Type.Union([
                Type.Literal('active'),
                Type.Literal('guide'),
                Type.Literal('damage'),
            ]),
            connectorEase: Type.Unsafe<EaseEdit>(
                Type.Union(easeEdits.map((value) => Type.Literal(value))),
            ),
            connectorIsFake: Type.Boolean(),
            connectorActiveIsCritical: Type.Boolean(),
            connectorGuideAlpha: Type.Number(),
            connectorLayer: Type.Union([
                Type.Literal('top'),
                Type.Literal('bottom'),
                Type.Literal('under'),
                Type.Literal('over'),
            ]),
            connectorIsPassThrough: Type.Boolean(),
            connectorPresentation: Type.Union([
                Type.Literal('default'),
                Type.Literal('fullscreen'),
            ]),
        }),
    ),
    Type.Object({
        copyProperties: Type.Boolean({ default: true }),
    }),
])

export type DefaultNoteSlideProperties = Type.Static<typeof defaultNoteSlidePropertiesSchema>

const panelPosition = Type.Union([
    Type.Literal('auto'),
    Type.Literal('left'),
    Type.Literal('right'),
    Type.Literal('top'),
    Type.Literal('disabled'),
])

export const propertiesSections = ['selection', 'tool', 'view'] as const
export type PropertiesSection = (typeof propertiesSections)[number]

const settingsProperties = {
    previewPosition: panelPosition,
    groupsPosition: panelPosition,
    stagesPosition: panelPosition,
    propertiesPosition: panelPosition,

    showPreview: Type.Boolean({ default: true }),
    // Properties retains the open state saved by the former sidebar.
    showSidebar: Type.Boolean({ default: true }),
    showGroups: Type.Boolean(),
    showStages: Type.Boolean(),

    panelRecency: Type.Codec(
        Type.Array(Type.String(), {
            default: ['preview', 'properties', 'groups', 'stages'] satisfies PanelId[],
        }),
    )
        .Decode((values) => [...new Set([...values.filter(isPanelId), ...panelIds])])
        .Encode((values) => values),

    leftDockWidth: Type.Number({ minimum: 0 }),
    rightDockWidth: Type.Number({ minimum: 0 }),
    topDockHeight: Type.Number({ minimum: 0 }),

    // Collapsed docks keep their panels' open states for one-click restoring.
    leftDockCollapsed: Type.Boolean(),
    rightDockCollapsed: Type.Boolean(),
    topDockCollapsed: Type.Boolean(),

    panelWeights: Type.Codec(Type.Record(Type.String(), Type.Number()))
        .Decode(
            (value) =>
                Object.fromEntries(
                    Object.entries(value).filter(
                        ([key, weight]) => isPanelId(key) && Number.isFinite(weight) && weight > 0,
                    ),
                ) as Partial<Record<PanelId, number>>,
        )
        .Encode((value) => value),

    propertiesSection: Type.Union([
        Type.Literal('selection'),
        Type.Literal('tool'),
        Type.Literal('view'),
    ]),
    propertiesCollapsed: Type.Codec(Type.Array(Type.String()))
        .Decode((values) =>
            [...new Set(values)].filter((value): value is PropertiesSection =>
                propertiesSections.includes(value as PropertiesSection),
            ),
        )
        .Encode((values) => values),

    previewControls: Type.Union([
        Type.Literal('auto'),
        Type.Literal('expanded'),
        Type.Literal('collapsed'),
    ]),

    previewNoteSpeed: number(previewNoteSpeed.default, previewNoteSpeed.min, previewNoteSpeed.max),
    previewRenderScale: number(
        previewRenderScale.default,
        previewRenderScale.min,
        previewRenderScale.max,
    ),
    previewShowEffects: Type.Boolean({ default: true }),
    previewShowTime: Type.Boolean({ default: true }),
    // Step size of the compact preview stepper, in ms.
    previewStepSize: Type.Union([Type.Literal(1), Type.Literal(10), Type.Literal(100)], {
        default: 10,
    }),
    previewHighlightSelection: Type.Boolean({ default: true }),
    previewShowHitboxes: Type.Boolean(),
    previewAntialias: Type.Boolean({ default: true }),
    previewAspectRatio: Type.Union([
        Type.Literal(previewAspectRatios[0][1]),
        Type.Literal(previewAspectRatios[1][1]),
        Type.Literal(previewAspectRatios[2][1]),
    ]),

    width: number(16, 16, 100),

    maxLane: Type.Number({ default: 0, minimum: 0 }),
    customMaxLane: Type.Number({ default: 6, exclusiveMinimum: 0 }),

    pps: number(1000, 100, 10000),

    beatDisplay: Type.Union([Type.Literal('beat'), Type.Literal('measure'), Type.Literal('both')], {
        default: 'measure',
    }),

    elevationEditorWidth: number(50, 20, 80),

    elevationSnap: Type.Union(
        [0, 1, 2, 4, 8, 16, 32, 64].map((value) => Type.Literal(value)),
        { default: 8 },
    ),
    elevationEditorSideBySide: Type.Union(
        [Type.Literal('auto'), Type.Literal('allow'), Type.Literal('disallow')],
        { default: 'auto' },
    ),

    locale: Type.Union(
        Object.keys(localizations).map((locale) => Type.Literal(locale)),
        { default: defaultLocale },
    ) as never as Type.TString,

    autoSave: Type.Boolean({ default: true }),

    autoSaveDelay: number(1, 0, 5),

    waveform: Type.Union([Type.Literal('volume'), Type.Literal('fft'), Type.Literal('off')]),

    maxScrollX: Type.Number({ minimum: 0 }),

    dragToPanY: Type.Boolean({ default: true }),

    dragToPanX: Type.Boolean(),

    autoAddGroup: Type.Boolean({ default: true }),

    showGroupName: Type.Boolean({ default: true }),

    showOtherGroups: Type.Boolean({ default: true }),

    showStageName: Type.Boolean({ default: true }),

    showOtherStages: Type.Boolean({ default: true }),

    showOtherObjects: Type.Boolean({ default: true }),

    deselectSwitchesToSelect: Type.Boolean({ default: true }),

    toolbar: Type.Codec(
        Type.Array(
            Type.Codec(Type.Array(Type.String()))
                .Decode((values) => values.filter(isCommandName))
                .Encode((values) => values),
            {
                default: [
                    ['utilities', 'properties', 'reset', 'save', 'open'],
                    [
                        'offset',
                        'bgm',
                        'toggleSfxVolume',
                        'toggleBgmVolume',
                        'speedUp',
                        'speedDown',
                        'stop',
                        'play',
                    ],
                    ['paste', 'cut', 'copy', 'redo', 'undo'],
                    [
                        'increaseNoteSize',
                        'decreaseNoteSize',
                        'brush',
                        'eraser',
                        'deselect',
                        'select',
                    ],
                    [
                        'elevation',
                        'scaleWidth',
                        'scaleElevation',
                        'scaleBeat',
                        'makeVertical',
                        'combineNotes',
                        'splitHold',
                        'flipVertical',
                        'flip',
                    ],
                    ['note3', 'note2', 'note1', 'note0', 'note'],
                    [
                        'generateSlideNotes',
                        'slide4',
                        'slide3',
                        'slide2',
                        'slide1',
                        'slide0',
                        'slide',
                    ],
                    ['timeScale', 'bpm'],
                    ['groupPrev', 'groupNext', 'groupAll', 'manageGroups'],
                    [
                        'stageTransformEvent',
                        'stageStyleEvent',
                        'stagePivotEvent',
                        'stageMaskEvent',
                        'cameraEvent',
                        'event',
                    ],
                    ['stagePrev', 'stageNext', 'stageAll', 'manageStages'],
                    [
                        'scrollLeft',
                        'scrollRight',
                        'jumpUp',
                        'scrollPageUp',
                        'scrollUp',
                        'scrollDown',
                        'scrollPageDown',
                        'jumpDown',
                    ],
                    [
                        'bpmVisibility',
                        'timeScaleVisibility',
                        'stageTransformEventVisibility',
                        'stageStyleEventVisibility',
                        'stagePivotEventVisibility',
                        'stageMaskEventVisibility',
                        'cameraEventVisibility',
                        'noteVisibility',
                        'cycleVisibilities',
                    ],
                    [
                        'snapping',
                        'divisionCustom',
                        'division16',
                        'division12',
                        'division8',
                        'division6',
                        'division4',
                        'division3',
                        'division2',
                        'division1',
                    ],
                    [
                        'laneSnapping',
                        'laneDivisionCustom',
                        'laneDivision16',
                        'laneDivision12',
                        'laneDivision8',
                        'laneDivision6',
                        'laneDivision4',
                        'laneDivision3',
                        'laneDivision2',
                        'laneDivision1',
                    ],
                    ['laneLimitCustom', 'laneLimitSix', 'laneLimitNone'],
                    ['zoomXIn', 'zoomXOut', 'zoomYIn', 'zoomYOut'],
                ] satisfies CommandName[][],
            },
        ),
    )
        .Decode((values) => values.filter((value) => value.length))
        .Encode((values) => values),

    playBgmVolume: number(100, 0, 100),

    playSfxVolume: number(100, 0, 100),

    playStartPosition: Type.Union([Type.Literal('view'), Type.Literal('cursor')]),

    playFollow: Type.Boolean({ default: true }),

    playFollowPosition: number(25, 0, 100),

    playPreviewDuration: number(500, 0, 1000),

    mouseSecondaryTool: Type.Union(
        [Type.Literal('eraser'), Type.Literal('select'), Type.Literal('selectContextMenu')],
        { default: 'selectContextMenu' },
    ),

    mouseSmoothScrolling: Type.Boolean({ default: true }),

    touchQuickScrollZone: number(25, 0, 50),

    touchScrollInertia: Type.Boolean({ default: true }),

    touchLongPressContextMenu: Type.Boolean({ default: true }),

    keyboardShortcuts: Type.Codec(
        Type.Record(Type.String(), Type.String(), {
            default: {
                open: 'o',
                save: 'p',
                reset: 'n',
                utilities: '.',
                play: ' ',
                stop: 'Backspace',
                bgm: 'm',
                speedUp: "'",
                speedDown: ';',
                select: 'f',
                elevation: 't',
                deselect: 'Escape',
                eraser: 'g',
                brush: 'b',
                flip: 'u',
                flipVertical: 'U',
                combineNotes: 'k',
                cut: 'x',
                copy: 'c',
                paste: 'v',
                undo: 'z',
                redo: 'y',
                note: 'a',
                slide: 's',
                generateSlideNotes: 'j',
                bpm: 'q',
                timeScale: 'w',
                manageGroups: 'e',
                event: 'd',
                manageStages: 'r',
                scrollLeft: 'ArrowLeft',
                scrollRight: 'ArrowRight',
                scrollUp: 'ArrowUp',
                scrollDown: 'ArrowDown',
                scrollPageUp: 'PageUp',
                scrollPageDown: 'PageDown',
                jumpUp: 'End',
                jumpDown: 'Home',
                cycleVisibilities: '/',
                division1: '1',
                division2: '2',
                division3: '3',
                division4: '4',
                division6: '6',
                division8: '8',
                division12: '9',
                division16: '0',
                divisionCustom: '`',
                snapping: 'i',
                zoomXIn: ']',
                zoomXOut: '[',
                zoomYIn: '=',
                zoomYOut: '-',
                help: 'h',
                settings: ',',
            } satisfies Partial<Record<CommandName, string>>,
        }),
    )
        .Decode(
            (value) =>
                Object.fromEntries(
                    Object.entries(value).filter(([key]) => isCommandName(key)),
                ) as Partial<Record<CommandName, string>>,
        )
        .Encode((values) => values),

    defaultNotePropertiesPresets: Type.Array(defaultNoteSlidePropertiesSchema, {
        minItems: 4,
        maxItems: 4,
        default: [
            {
                copyProperties: true,
            },
            {
                isCritical: true,
                copyProperties: true,
            },
            {
                flickDirection: 'up',
                copyProperties: true,
            },
            {
                noteType: 'trace',
                copyProperties: true,
            },
        ] satisfies DefaultNoteSlideProperties[],
    }),

    defaultSlidePropertiesPresets: Type.Array(defaultNoteSlidePropertiesSchema, {
        minItems: 5,
        maxItems: 5,
        default: [
            {
                connectorEase: 'linear',
                copyProperties: true,
            },
            {
                isCritical: true,
                copyProperties: true,
            },
            {
                flickDirection: 'up',
                copyProperties: true,
            },
            {
                noteType: 'trace',
                copyProperties: true,
            },
            {
                noteType: 'anchor',
                copyProperties: true,
            },
        ] satisfies DefaultNoteSlideProperties[],
    }),
}

// Eases before the easing families were quadratic, and steps were 'none'.
const legacyEases: Partial<Record<string, Ease>> = {
    in: 'inQuad',
    out: 'outQuad',
    inOut: 'inOutQuad',
    outIn: 'outInQuad',
    none: 'inStep',
}

// Older presets stored guide and active/damage colors separately. Preserve the
// color that applied to an explicit guide preset; otherwise prefer an explicit
// connector color, falling back to a guide-only color preset when necessary.
const migratePreset = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const { connectorGuideColor, ...preset } = value as Record<string, unknown>
    if (typeof preset.connectorEase === 'string')
        preset.connectorEase = legacyEases[preset.connectorEase] ?? preset.connectorEase
    if (
        noteStyles.some((style) => style !== 'default' && style === connectorGuideColor) &&
        (preset.connectorType === 'guide' ||
            (preset.connectorType === undefined &&
                (preset.connectorStyle === undefined || preset.connectorStyle === 'default')))
    )
        preset.connectorStyle = connectorGuideColor
    return preset
}

// Dock sizes replaced the panel-specific sizes of the former preview and sidebar.
const legacyKeys: Partial<Record<string, string>> = {
    leftDockWidth: 'previewWidth',
    rightDockWidth: 'sidebarWidth',
    topDockHeight: 'previewHeight',
}

const loadSetting = (key: string, defaultValue: unknown) => {
    const legacyKey = legacyKeys[key]
    const legacy = legacyKey === undefined ? undefined : storageGet(legacyKey, undefined)
    if (legacyKey !== undefined && legacy !== undefined) {
        if (storageGet(key, undefined) === undefined) storageSet(key, legacy)
        storageRemove(legacyKey)
    }
    return storageGet(key, defaultValue)
}

const migrateSetting = (key: string, value: unknown) => {
    // An unreleased layout briefly saved a single preview side.
    if (key === 'previewPosition' && value === 'side') return 'left'
    if (key === 'toolbar' && Array.isArray(value) && value.every(Array.isArray))
        return migrateToolbar(value)
    return (key === 'defaultNotePropertiesPresets' || key === 'defaultSlidePropertiesPresets') &&
        Array.isArray(value)
        ? value.map(migratePreset)
        : value
}

const normalize = <T extends Type.TSchema>(schema: T, value: unknown) =>
    Value.Decode(schema, Value.Repair(schema, value))

export const settings = Object.defineProperties(
    {},
    Object.fromEntries(
        Object.entries(settingsProperties).map(([key, schema]) => {
            const defaultValue = Value.Create(schema)
            const prop = shallowRef(
                normalize(schema, migrateSetting(key, loadSetting(key, defaultValue))),
            )
            watch(
                prop,
                (value) => {
                    if (Value.Equal(value, defaultValue)) {
                        storageRemove(key)
                    } else {
                        storageSet(key, value)
                    }
                },
                { flush: 'sync' },
            )

            return [
                key,
                {
                    enumerable: true,
                    get: () => prop.value,
                    set: (value: unknown) =>
                        (prop.value = normalize(schema, migrateSetting(key, value))),
                },
            ]
        }),
    ),
) as {
    [K in keyof typeof settingsProperties]: Type.StaticDecode<(typeof settingsProperties)[K]>
}

export const resetSettings = () => {
    for (const [key, schema] of Object.entries(settingsProperties)) {
        if (key === 'keyboardShortcuts') continue
        Reflect.set(settings, key, Value.Create(schema))
    }
}

export const resetKeybinds = () => {
    settings.keyboardShortcuts = normalize(
        settingsProperties.keyboardShortcuts,
        Value.Create(settingsProperties.keyboardShortcuts),
    )
}
