export const bisect = <K extends PropertyKey>(
    array: Record<K, number>[],
    key: K,
    value: number,
) => {
    let lo = 0
    let hi = array.length

    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2)

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        if (array[mid]![key] < value) {
            lo = mid + 1
        } else {
            hi = mid
        }
    }

    return lo
}
