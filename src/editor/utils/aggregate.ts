/** How a property's values spread over the selected objects that have it. */
export type ValueUsage = {
    /** Distinct values among the objects the property applies to, with counts. */
    values: ReadonlyMap<unknown, number>
    /** Objects the property applies to. */
    covered: number
    /** Objects that carry the property, whether or not it applies to them. */
    total: number
}

export type Aggregate = {
    /** Each property's value where every object it applies to agrees. */
    model: Record<string, unknown>
    usage: ReadonlyMap<string, ValueUsage>
}

export const aggregateValues = <T extends object>(
    objects: Iterable<T>,
    appliesTo: (object: T) => (key: string) => boolean,
): Aggregate => {
    const usage = new Map<
        string,
        { values: Map<unknown, number>; covered: number; total: number }
    >()

    for (const object of objects) {
        const applies = appliesTo(object)
        for (const [key, value] of Object.entries(object)) {
            let entry = usage.get(key)
            if (!entry) {
                entry = { values: new Map(), covered: 0, total: 0 }
                usage.set(key, entry)
            }
            entry.total++
            if (!applies(key)) continue
            entry.covered++
            entry.values.set(value, (entry.values.get(value) ?? 0) + 1)
        }
    }

    const model: Record<string, unknown> = {}
    for (const [key, { values }] of usage) {
        if (values.size === 1) model[key] = values.keys().next().value
    }
    return { model, usage }
}

/** Smallest and largest number in use, or undefined without numbers. */
export const valueRange = (usage: ValueUsage | undefined, map = (value: number) => value) => {
    let min = Infinity
    let max = -Infinity
    for (const value of usage?.values.keys() ?? []) {
        if (typeof value !== 'number') continue
        const mapped = map(value)
        min = Math.min(min, mapped)
        max = Math.max(max, mapped)
    }
    return min <= max ? ([min, max] as const) : undefined
}

/** Counts the objects whose value matches each option, keeping option order. */
export const countOptions = <T>(
    usage: ValueUsage | undefined,
    options: readonly T[],
    matches: (value: unknown, option: T) => boolean = (value, option) => value === option,
) =>
    options.map((option) => {
        let count = 0
        for (const [value, n] of usage?.values ?? []) {
            if (matches(value, option)) count += n
        }
        return count
    })
