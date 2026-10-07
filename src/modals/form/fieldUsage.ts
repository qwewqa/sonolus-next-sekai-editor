import { inject, type InjectionKey, type Ref } from 'vue'
import { countOptions, valueRange, type ValueUsage } from '../../editor/utils/aggregate'

/** What the selected objects hold for one field, provided around the field. */
export type FieldUsage = {
    usage: ValueUsage | undefined
    /** Maps a stored value to the field's own value, such as a displayed beat. */
    map?: (value: unknown) => unknown
    /** Whether a stored value counts for an option, such as an ease for its mode. */
    matches?: (value: unknown, option: unknown) => boolean
    /** Names a stored value for fields that cannot, such as toggles. */
    label?: (value: unknown) => string | undefined
    /** Narrows the selection to the objects whose value passes. */
    narrow?: (predicate: (value: unknown) => boolean) => void
}

/** A value in use by part of a mixed selection. */
export type MixedValue = {
    label: string
    count: number
    narrow?: () => void
    /** The option it counts, when it is one. */
    option?: unknown
}

export const fieldUsageKey: InjectionKey<Ref<FieldUsage | undefined>> = Symbol('field usage')

export const useFieldUsage = () => inject(fieldUsageKey, undefined)

const matcher = ({ map, matches }: FieldUsage) =>
    matches ?? ((value: unknown, option: unknown) => (map ? map(value) : value) === option)

/** A value no option names, such as one from a newer or damaged chart. */
export const isUnknownValue = (value: unknown, options: readonly (readonly [string, unknown])[]) =>
    value !== undefined && !options.some(([, option]) => option === value)

/** The name of the option holding a value. */
export const optionName = (value: unknown, options: readonly (readonly [string, unknown])[]) =>
    options.find(([, option]) => option === value)?.[0]

/** No selected object holds a value, as for a BPM change without a meter. */
export const isUnset = (field: FieldUsage | undefined) => field?.usage?.values.size === 0

// Typed like the number inputs show them, with a plain minus.
export const formatNumber = (value: number) => `${+value.toFixed(4)}`

/** The range a mixed number field spans, as "-4 … 6". */
export const mixedRange = (field: FieldUsage | undefined) => {
    if (!field?.usage || field.usage.values.size < 2) return
    const range = valueRange(field.usage, (value) =>
        field.map ? (field.map(value) as number) : value,
    )
    return range && `${formatNumber(range[0])} … ${formatNumber(range[1])}`
}

/** Counts the objects behind each option; all zero when nothing is mixed. */
const optionCounts = (field: FieldUsage | undefined, options: readonly unknown[]) =>
    field?.usage ? countOptions(field.usage, options, matcher(field)) : options.map(() => 0)

export const mixedOptions = (
    field: FieldUsage | undefined,
    options: readonly (readonly [string, unknown])[],
): MixedValue[] => {
    if (!field) return []
    const counts = optionCounts(
        field,
        options.map(([, value]) => value),
    )
    const matches = matcher(field)
    return options.flatMap(([label, option], index) => {
        const count = counts[index] ?? 0
        return count
            ? [
                  {
                      label,
                      count,
                      narrow: () => field.narrow?.((value) => matches(value, option)),
                      option,
                  },
              ]
            : []
    })
}

/** Values of a mixed field whose control cannot name them, such as a toggle. */
export const mixedValues = (
    field: FieldUsage | undefined,
    fallback: (value: unknown) => string | undefined,
): MixedValue[] => {
    if (!field?.usage || field.usage.values.size < 2) return []
    const values: MixedValue[] = []
    for (const [value, count] of field.usage.values) {
        const mapped = field.map ? field.map(value) : value
        const label = field.label?.(value) ?? fallback(mapped)
        if (label === undefined) return []
        values.push({ label, count, narrow: () => field.narrow?.((other) => other === value) })
    }
    return values.sort((a, b) => b.count - a.count)
}
