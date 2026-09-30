// Decoding cannot be aborted, so release a bitmap that finishes after its
// preview has closed or a newer resource load has replaced it.
export const loadPreviewResource = async <T extends { texture: ImageBitmap }>(
    url: string,
    decode: (buffer: ArrayBuffer) => Promise<T>,
    signal: AbortSignal,
): Promise<T | undefined> => {
    const isAborted = () => signal.aborted
    if (isAborted()) return

    const response = await fetch(url, { cache: 'no-store', signal })
    if (isAborted() || response.status === 404) return
    if (!response.ok) throw new Error(`Resource download failed: HTTP ${response.status}`)

    const buffer = await response.arrayBuffer()
    if (isAborted()) return

    const resource = await decode(buffer)
    if (!isAborted()) return resource

    resource.texture.close()
}
