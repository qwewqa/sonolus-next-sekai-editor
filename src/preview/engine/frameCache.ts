// Retain only this frame and the preceding frame, within one shared capacity.
// Both generations are protected during a frame: overflowing seeds are computed
// directly rather than evicting retained seeds that have not been visited yet.
export const createFrameCache = <T extends object>(
    capacity: number,
    create: (key: number) => T,
) => {
    let current = new Map<number, T>()
    let previous = new Map<number, T>()

    return {
        get size() {
            return current.size + previous.size
        },

        beginFrame() {
            previous.clear()
            const oldCurrent = current
            current = previous
            previous = oldCurrent
        },

        get(key: number): T {
            const retained = current.get(key)
            if (retained) return retained

            const reusable = previous.get(key)
            if (reusable) {
                previous.delete(key)
                current.set(key, reusable)
                return reusable
            }

            const value = create(key)
            if (current.size + previous.size >= capacity) return value
            current.set(key, value)
            return value
        },
    }
}
