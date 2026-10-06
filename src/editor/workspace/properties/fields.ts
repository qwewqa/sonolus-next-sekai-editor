import { easeFunctionOf, easeMode, easeTypeOf, mergeEases, type Ease } from '../../../ease'
import type { i18n } from '../../../i18n'
import type { EntityType } from '../../../state/entities'
import type { EditableObject } from '../../../state/operations/editable'
import type { BrushProperties } from '../../tools/brush'
import type { Aggregate } from '../../utils/aggregate'
import type { NoteFields } from '../../utils/noteFields'

type Localization = (typeof i18n)['value']

export type PropertyKey = keyof EditableObject

/** Where a field sits in the Selection section. */
export type PropertySection = 'position' | 'values' | 'connector' | 'organization' | 'advanced'

/** The kind of object a property belongs to, as the brush groups them. */
export type PropertyKind =
    | 'general'
    | 'note'
    | 'connector'
    | 'timeScale'
    | 'camera'
    | 'mask'
    | 'pivot'
    | 'style'
    | 'transform'
    | 'event'

export const propertyKinds: readonly PropertyKind[] = [
    'general',
    'note',
    'connector',
    'timeScale',
    'camera',
    'mask',
    'pivot',
    'style',
    'transform',
    'event',
]

/** Kinds that only exist with dynamic stages. */
export const stageKinds: ReadonlySet<PropertyKind> = new Set([
    'camera',
    'mask',
    'pivot',
    'style',
    'transform',
    'event',
])

export type SelectionContext = {
    types: Partial<Record<EntityType, boolean>>
    noteFields: Partial<NoteFields>
    count: number
    isDynamicStages: boolean
}

export type PropertyField = {
    key: PropertyKey
    section: PropertySection
    kind: PropertyKind
    label: (t: Localization) => string
    /** The label naming the object kind, for selections of several kinds. */
    qualifiedLabel?: (t: Localization) => string
    /** Shown in Selection for this selection. */
    show: (context: SelectionContext) => boolean
    /** Value labels for the collapsed connector summary and enum toggles. */
    valueLabel?: (t: Localization, value: never) => string
    ease?: boolean
    /** Only exists with dynamic stages. */
    dynamicStages?: boolean
    /** Brushable properties with the value an added brush row starts from. */
    brush?: { initial: unknown }
}

const note =
    (key: keyof NoteFields) =>
    ({ types, noteFields }: SelectionContext) =>
        !!types.note && noteFields[key] !== false

const type =
    (...types: EntityType[]) =>
    (context: SelectionContext) =>
        types.some((type) => context.types[type])

const eventJoints: EntityType[] = [
    'cameraEventJoint',
    'stageMaskEventJoint',
    'stagePivotEventJoint',
    'stageStyleEventJoint',
    'stageTransformEventJoint',
]

export const easeLabel = (t: Localization, ease: Ease) => {
    const mode = easeMode(ease)
    const name = easeFunctionOf(ease)
    return mode && name
        ? `${t.modals.form.ease[name]} ${t.modals.form.ease[mode]}`
        : t.modals.form.ease[easeTypeOf(ease)]
}

const styleLabel = (t: Localization, style: string) =>
    style === 'default'
        ? t.modals.form.noteStyle.default
        : ((t.modals.form.colors as Record<string, string>)[style] ?? style)

const optionLabel =
    (get: (t: Localization) => Record<string, string>) => (t: Localization, value: string) =>
        get(t)[value] ?? value

const fields: PropertyField[] = [
    // Position: where the objects sit on the chart.
    {
        key: 'beat',
        section: 'position',
        kind: 'general',
        label: (t) => t.modals.form.beat.label,
        show: ({ count, types }) => count === 1 || (!types.bpm && !types.timeScale),
    },
    {
        key: 'editorLane',
        section: 'position',
        kind: 'timeScale',
        label: (t) => t.modals.form.editorLane.label,
        show: type('timeScale', 'stageStyleEventJoint'),
    },
    {
        key: 'left',
        section: 'position',
        kind: 'note',
        label: (t) => t.modals.form.left.label,
        show: note('left'),
    },
    {
        key: 'size',
        section: 'position',
        kind: 'note',
        label: (t) => t.modals.form.size.label,
        show: note('size'),
        brush: { initial: 3 },
    },
    {
        key: 'cameraLeft',
        section: 'position',
        kind: 'camera',
        label: (t) => t.modals.form.cameraLeft.label,
        qualifiedLabel: (t) => t.modals.form.cameraLeft.qualified,
        show: type('cameraEventJoint'),
    },
    {
        key: 'cameraSize',
        section: 'position',
        kind: 'camera',
        label: (t) => t.modals.form.cameraSize.label,
        qualifiedLabel: (t) => t.modals.form.cameraSize.qualified,
        show: type('cameraEventJoint'),
        brush: { initial: 12 },
    },
    {
        key: 'maskLeft',
        section: 'position',
        kind: 'mask',
        label: (t) => t.modals.form.maskLeft.label,
        show: type('stageMaskEventJoint'),
    },
    {
        key: 'maskSize',
        section: 'position',
        kind: 'mask',
        label: (t) => t.modals.form.maskSize.label,
        show: type('stageMaskEventJoint'),
        brush: { initial: 12 },
    },
    {
        key: 'pivotLane',
        section: 'position',
        kind: 'pivot',
        label: (t) => t.modals.form.pivotLane.label,
        show: type('stagePivotEventJoint'),
    },
    {
        key: 'xTranslation',
        section: 'position',
        kind: 'transform',
        label: (t) => t.modals.form.xTranslation.label,
        show: type('stageTransformEventJoint'),
    },
    {
        key: 'yTranslation',
        section: 'position',
        kind: 'transform',
        label: (t) => t.modals.form.yTranslation.label,
        show: type('stageTransformEventJoint'),
        brush: { initial: 0 },
    },

    // Values specific to each object type.
    {
        key: 'bpm',
        section: 'values',
        kind: 'general',
        label: (t) => t.modals.form.bpm.label,
        show: type('bpm'),
    },
    {
        key: 'meter',
        section: 'values',
        kind: 'general',
        label: (t) => t.modals.form.meter.label,
        show: type('bpm'),
    },
    {
        key: 'timeScale',
        section: 'values',
        kind: 'timeScale',
        label: (t) => t.modals.form.timeScale.label,
        show: type('timeScale'),
        brush: { initial: 1 },
    },
    {
        key: 'skip',
        section: 'values',
        kind: 'timeScale',
        label: (t) => t.modals.form.skip.label,
        show: type('timeScale'),
        brush: { initial: 0 },
    },
    {
        key: 'timeScaleEase',
        section: 'values',
        kind: 'timeScale',
        label: (t) => t.modals.form.timeScaleEase.label,
        qualifiedLabel: (t) => t.modals.form.timeScaleEase.qualified,
        show: type('timeScale'),
        valueLabel: easeLabel,
        ease: true,
        brush: { initial: 'none' },
    },
    {
        key: 'timeScaleTransition',
        section: 'values',
        kind: 'timeScale',
        label: (t) => t.modals.form.timeScaleTransition.label,
        qualifiedLabel: (t) => t.modals.form.timeScaleTransition.qualified,
        show: type('timeScale'),
        valueLabel: optionLabel((t) => t.modals.form.timeScaleTransition),
        brush: { initial: 'timeScale' },
    },
    {
        key: 'hideNotes',
        section: 'values',
        kind: 'timeScale',
        label: (t) => t.modals.form.hideNotes.label,
        show: type('timeScale'),
        brush: { initial: false },
    },
    {
        key: 'cameraZoom',
        section: 'values',
        kind: 'camera',
        label: (t) => t.modals.form.cameraZoom.label,
        qualifiedLabel: (t) => t.modals.form.cameraZoom.qualified,
        show: type('cameraEventJoint'),
        brush: { initial: 1 },
    },
    {
        key: 'cameraZoomTargetLane',
        section: 'values',
        kind: 'camera',
        label: (t) => t.modals.form.cameraZoomTargetLane.label,
        qualifiedLabel: (t) => t.modals.form.cameraZoomTargetLane.qualified,
        show: type('cameraEventJoint'),
        brush: { initial: 0 },
    },
    {
        key: 'cameraZoomTargetY',
        section: 'values',
        kind: 'camera',
        label: (t) => t.modals.form.cameraZoomTargetY.label,
        qualifiedLabel: (t) => t.modals.form.cameraZoomTargetY.qualified,
        show: type('cameraEventJoint'),
        brush: { initial: 0 },
    },
    {
        key: 'cameraZoomVerticalAlign',
        section: 'values',
        kind: 'camera',
        label: (t) => t.modals.form.cameraZoomVerticalAlign.label,
        qualifiedLabel: (t) => t.modals.form.cameraZoomVerticalAlign.qualified,
        show: type('cameraEventJoint'),
        valueLabel: optionLabel((t) => t.modals.form.cameraZoomVerticalAlign),
        brush: { initial: 'default' },
    },
    {
        key: 'cameraRotation',
        section: 'values',
        kind: 'camera',
        label: (t) => t.modals.form.cameraRotation.label,
        qualifiedLabel: (t) => t.modals.form.cameraRotation.qualified,
        show: type('cameraEventJoint'),
        brush: { initial: 0 },
    },
    {
        key: 'cameraStageTilt',
        section: 'values',
        kind: 'camera',
        label: (t) => t.modals.form.cameraStageTilt.label,
        qualifiedLabel: (t) => t.modals.form.cameraStageTilt.qualified,
        show: type('cameraEventJoint'),
        brush: { initial: 1 },
    },
    {
        key: 'isMaskNotes',
        section: 'values',
        kind: 'mask',
        label: (t) => t.modals.form.isMaskNotes.label,
        show: type('stageMaskEventJoint'),
        brush: { initial: false },
    },
    {
        key: 'divisionSize',
        section: 'values',
        kind: 'pivot',
        label: (t) => t.modals.form.divisionSize.label,
        show: type('stagePivotEventJoint'),
        brush: { initial: 2 },
    },
    {
        key: 'divisionParity',
        section: 'values',
        kind: 'pivot',
        label: (t) => t.modals.form.divisionParity.label,
        show: type('stagePivotEventJoint'),
        valueLabel: optionLabel((t) => t.modals.form.divisionParity),
        brush: { initial: 'even' },
    },
    {
        key: 'yOffset',
        section: 'values',
        kind: 'pivot',
        label: (t) => t.modals.form.yOffset.label,
        show: type('stagePivotEventJoint'),
        brush: { initial: 0 },
    },
    {
        key: 'yOffsetBeat',
        section: 'values',
        kind: 'pivot',
        label: (t) => t.modals.form.yOffsetBeat.label,
        show: type('stagePivotEventJoint'),
        brush: { initial: 0 },
    },
    {
        key: 'judgmentLineColor',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.judgmentLineColor.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: 'purple' },
    },
    {
        key: 'judgmentLineStyle',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.judgmentLineStyle.label,
        show: type('stageStyleEventJoint'),
        valueLabel: optionLabel((t) => t.modals.form.judgmentLineStyle),
        brush: { initial: 'default' },
    },
    {
        key: 'leftBorderStyle',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.leftBorderStyle.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: 'default' },
    },
    {
        key: 'rightBorderStyle',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.rightBorderStyle.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: 'default' },
    },
    {
        key: 'isFullWidth',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.isFullWidth.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: false },
    },
    {
        key: 'noteAlpha',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.noteAlpha.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: 1 },
    },
    {
        key: 'laneAlpha',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.laneAlpha.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: 1 },
    },
    {
        key: 'judgmentLineAlpha',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.judgmentLineAlpha.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: 1 },
    },
    {
        key: 'divisionLineAlpha',
        section: 'values',
        kind: 'style',
        label: (t) => t.modals.form.divisionLineAlpha.label,
        show: type('stageStyleEventJoint'),
        brush: { initial: 1 },
    },
    {
        key: 'rotation',
        section: 'values',
        kind: 'transform',
        label: (t) => t.modals.form.rotation.label,
        show: type('stageTransformEventJoint'),
        brush: { initial: 0 },
    },
    {
        key: 'anchor',
        section: 'values',
        kind: 'transform',
        label: (t) => t.modals.form.anchor.label,
        show: type('stageTransformEventJoint'),
        valueLabel: optionLabel((t) => t.modals.form.anchor),
        brush: { initial: 'default' },
    },
    {
        key: 'eventEase',
        section: 'values',
        kind: 'event',
        label: (t) => t.modals.form.eventEase.label,
        qualifiedLabel: (t) => t.modals.form.eventEase.qualified,
        show: type(...eventJoints),
        valueLabel: easeLabel,
        ease: true,
        brush: { initial: 'linear' },
    },
    {
        key: 'noteType',
        section: 'values',
        kind: 'note',
        label: (t) => t.modals.form.noteType.label,
        show: type('note'),
        brush: { initial: 'default' },
    },
    {
        key: 'isCritical',
        section: 'values',
        kind: 'note',
        label: (t) => t.modals.form.isCritical.label,
        show: note('isCritical'),
        brush: { initial: false },
    },
    {
        key: 'flickDirection',
        section: 'values',
        kind: 'note',
        label: (t) => t.modals.form.flickDirection.label,
        show: note('flickDirection'),
        brush: { initial: 'none' },
    },
    {
        key: 'isAttached',
        section: 'values',
        kind: 'note',
        label: (t) => t.modals.form.isAttached.label,
        show: note('isAttached'),
        brush: { initial: false },
    },
    {
        key: 'noteStyle',
        section: 'values',
        kind: 'note',
        label: (t) => t.modals.form.noteStyle.label,
        show: note('noteStyle'),
        brush: { initial: 'default' },
    },
    {
        key: 'isFake',
        section: 'values',
        kind: 'note',
        label: (t) => t.modals.form.isFake.label,
        show: note('isFake'),
        brush: { initial: false },
    },
    {
        key: 'sfx',
        section: 'values',
        kind: 'note',
        label: (t) => t.modals.form.sfx.label,
        show: note('sfx'),
        brush: { initial: 'default' },
    },

    // The connector leaving each note.
    {
        key: 'isConnectorSeparator',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.isConnectorSeparator.label,
        qualifiedLabel: (t) => t.modals.form.isConnectorSeparator.qualified,
        show: note('isConnectorSeparator'),
        brush: { initial: false },
    },
    {
        key: 'connectorType',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorType.label,
        qualifiedLabel: (t) => t.modals.form.connectorType.qualified,
        show: note('connectorType'),
        valueLabel: optionLabel((t) => t.modals.form.connectorType),
        brush: { initial: 'active' },
    },
    {
        key: 'connectorStyle',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorStyle.label,
        qualifiedLabel: (t) => t.modals.form.connectorStyle.qualified,
        show: note('connectorStyle'),
        valueLabel: styleLabel,
        brush: { initial: 'default' },
    },
    {
        key: 'connectorEase',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorEase.label,
        qualifiedLabel: (t) => t.modals.form.connectorEase.qualified,
        show: note('connectorEase'),
        valueLabel: easeLabel,
        ease: true,
        brush: { initial: 'linear' },
    },
    {
        key: 'connectorIsFake',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorIsFake.label,
        show: note('connectorIsFake'),
        brush: { initial: false },
    },
    {
        key: 'connectorActiveIsCritical',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorActiveIsCritical.label,
        show: note('connectorActiveIsCritical'),
        brush: { initial: false },
    },
    {
        key: 'connectorGuideAlpha',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorGuideAlpha.label,
        show: note('connectorGuideAlpha'),
        brush: { initial: 1 },
    },
    {
        key: 'connectorLayer',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorLayer.label,
        qualifiedLabel: (t) => t.modals.form.connectorLayer.qualified,
        show: note('connectorLayer'),
        valueLabel: optionLabel((t) => t.modals.form.connectorLayer),
        brush: { initial: 'top' },
    },
    {
        key: 'connectorIsPassThrough',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorIsPassThrough.label,
        qualifiedLabel: (t) => t.modals.form.connectorIsPassThrough.qualified,
        show: note('connectorIsPassThrough'),
        brush: { initial: false },
    },
    {
        key: 'connectorPresentation',
        section: 'connector',
        kind: 'connector',
        label: (t) => t.modals.form.connectorPresentation.label,
        qualifiedLabel: (t) => t.modals.form.connectorPresentation.qualified,
        show: note('connectorPresentation'),
        valueLabel: optionLabel((t) => t.modals.form.connectorPresentation),
        brush: { initial: 'default' },
    },

    // Organization: which group and stage own the objects.
    {
        key: 'groupId',
        section: 'organization',
        kind: 'general',
        label: (t) => t.modals.form.group.label,
        show: type('timeScale', 'note'),
        // The current group, filled in when added.
        brush: { initial: undefined },
    },
    {
        key: 'stageId',
        section: 'organization',
        kind: 'general',
        dynamicStages: true,
        label: (t) => t.modals.form.stage.label,
        show: (context) =>
            context.isDynamicStages &&
            type(
                'note',
                'stageMaskEventJoint',
                'stagePivotEventJoint',
                'stageStyleEventJoint',
                'stageTransformEventJoint',
            )(context),
        brush: { initial: undefined },
    },

    // Elevation, kept last as an advanced placement value.
    {
        key: 'elevation',
        section: 'advanced',
        kind: 'general',
        label: (t) => t.modals.form.elevation.label,
        show: (context) => !!context.types.stageTransformEventJoint || note('elevation')(context),
        brush: { initial: 0 },
    },
]

export const propertyFields: readonly PropertyField[] = fields

export const fieldLabel = (field: PropertyField, t: Localization, qualified: boolean) =>
    (qualified ? field.qualifiedLabel?.(t) : undefined) ?? field.label(t)

export const propertyField = new Map(fields.map((field) => [field.key, field]))

export const propertySections: readonly PropertySection[] = [
    'position',
    'values',
    'connector',
    'organization',
    'advanced',
]

type Sections = Record<PropertySection, PropertyField[]>

/** Fields of a selection's block: one kind's, or the General ones every kind shares. */
export type FieldBlock = { kind?: EntityType; sections: Sections }

/** Fields of several kinds, which close a selection of several kinds under General. */
export const generalKeys: ReadonlySet<PropertyKey> = new Set([
    'beat',
    'groupId',
    'stageId',
    'elevation',
])

/** Fields each kind shows that General also shows once for all kinds having them. */
export const sharedKeys: ReadonlySet<PropertyKey> = new Set(['eventEase', 'editorLane'])

const emptySections = () =>
    Object.fromEntries(propertySections.map((section) => [section, []])) as unknown as Sections

/** Groups the fields a selection shows by the kind they belong to. */
export const layoutFields = (
    kinds: readonly EntityType[],
    kindContext: (kind: EntityType) => SelectionContext,
    context: SelectionContext,
): FieldBlock[] => {
    if (kinds.length < 2) {
        const sections = emptySections()
        for (const field of fields) if (field.show(context)) sections[field.section].push(field)
        return [{ kind: kinds[0], sections }]
    }
    const blocks: FieldBlock[] = kinds.map((kind) => ({ kind, sections: emptySections() }))
    const general = emptySections()
    for (const field of fields) {
        if (generalKeys.has(field.key)) {
            if (field.show(context)) general[field.section].push(field)
            continue
        }
        let owners = 0
        for (const block of blocks) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            if (!field.show(kindContext(block.kind!))) continue
            block.sections[field.section].push(field)
            owners++
        }
        if (owners > 1 && sharedKeys.has(field.key)) general[field.section].push(field)
    }
    if (propertySections.some((section) => general[section].length))
        blocks.push({ sections: general })
    return blocks
}

export type BrushKey = keyof BrushProperties

export const brushFields = fields.filter(
    (field): field is PropertyField & { key: BrushKey } => !!field.brush,
)

/** The connector values summarized while the connector fields are collapsed. */
export const connectorSummaryKeys: readonly PropertyKey[] = [
    'connectorType',
    'connectorStyle',
    'connectorEase',
    'connectorLayer',
]

/** Whether the brush may offer a field in this chart mode. */
export const isBrushAvailable = (field: PropertyField, isDynamicStages: boolean) =>
    isDynamicStages || (!stageKinds.has(field.kind) && !field.dynamicStages)

/** A brush matching the selection: every brushable value it agrees on. */
export const pickBrush = ({ model, usage }: Aggregate, isDynamicStages: boolean) => {
    const brush: Record<string, unknown> = {}
    for (const field of brushFields) {
        if (!isBrushAvailable(field, isDynamicStages)) continue
        // Eases keep the half the selection agrees on.
        const value = field.ease
            ? mergeEases((usage.get(field.key)?.values.keys() ?? []) as Iterable<Ease>)
            : model[field.key]
        if (value !== undefined) brush[field.key] = value
    }
    return brush as BrushProperties
}
