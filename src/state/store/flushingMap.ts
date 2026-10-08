type MethodCache = Map<PropertyKey, { method: unknown; wrapper: (...args: unknown[]) => unknown }>

const flushingIterator = <T>(iterator: Iterator<T>, flush: () => void) => {
    const methods: MethodCache = new Map()
    const self = () => view
    const view = new Proxy(iterator, {
        get(target, property) {
            if (property === Symbol.iterator) return self
            const method: unknown = Reflect.get(target, property, target)
            if (typeof method !== 'function' || property === 'constructor') return method
            const cached = methods.get(property)
            if (cached?.method === method) return cached.wrapper

            const wrapper = (...args: unknown[]) => {
                if (property === 'next') {
                    flush()
                    return Reflect.apply(method, target, args) as unknown
                }
                // Iterator helpers consume the wrapped next(), so staged writes
                // remain visible even while a helper is processing the iterator.
                return Reflect.apply(method, view, args) as unknown
            }
            methods.set(property, { method, wrapper })
            return wrapper
        },
    })
    return view
}

/** A transaction view; published states keep the underlying native Map. */
export const createFlushingMap = <K, V>(map: Map<K, V>, flush: () => void): Map<K, V> => {
    const methods: MethodCache = new Map()
    const view = new Proxy(map, {
        get(target, property) {
            if (property === 'size') {
                flush()
                return target.size
            }
            const method: unknown = Reflect.get(target, property, target)
            if (typeof method !== 'function' || property === 'constructor') return method
            const cached = methods.get(property)
            if (cached?.method === method) return cached.wrapper

            const wrapper = (...args: unknown[]) => {
                flush()
                if (property === 'forEach') {
                    const [callback, thisArg] = args
                    if (typeof callback !== 'function')
                        return Reflect.apply(method, target, args) as unknown
                    return Reflect.apply(method, target, [
                        (value: V, key: K) => {
                            try {
                                Reflect.apply(callback, thisArg, [value, key, view])
                            } finally {
                                // A callback may stage edits to entries that the
                                // native live traversal has not visited yet.
                                flush()
                            }
                        },
                    ]) as unknown
                }

                const result: unknown = Reflect.apply(method, target, args)
                if (
                    property === Symbol.iterator ||
                    property === 'entries' ||
                    property === 'keys' ||
                    property === 'values'
                )
                    return flushingIterator(result as Iterator<unknown>, flush)
                return result === target ? view : result
            }
            methods.set(property, { method, wrapper })
            return wrapper
        },
    })
    return view
}
