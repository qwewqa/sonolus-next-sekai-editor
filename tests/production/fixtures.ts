// A real imported USC chart keeps this smoke independent of app modules or
// test-only state hooks. BPM 60 places its note at 250 ms for simple mouse input.
export const chart = Buffer.from(
    JSON.stringify({
        version: 2,
        usc: {
            offset: 0,
            objects: [
                { type: 'bpm', beat: 0, bpm: 60 },
                {
                    type: 'single',
                    beat: 0.25,
                    timeScaleGroup: 0,
                    lane: 0,
                    size: 1.5,
                    critical: false,
                    trace: false,
                },
            ],
        },
    }),
)

export const stereoWav = () => {
    const sampleRate = 48000
    const length = sampleRate * 2
    const data = Buffer.alloc(44 + length * 4)
    data.write('RIFF', 0)
    data.writeUInt32LE(data.length - 8, 4)
    data.write('WAVEfmt ', 8)
    data.writeUInt32LE(16, 16)
    data.writeUInt16LE(1, 20)
    data.writeUInt16LE(2, 22)
    data.writeUInt32LE(sampleRate, 24)
    data.writeUInt32LE(sampleRate * 4, 28)
    data.writeUInt16LE(4, 32)
    data.writeUInt16LE(16, 34)
    data.write('data', 36)
    data.writeUInt32LE(length * 4, 40)
    for (let i = 0; i < length; i++) {
        const t = i / sampleRate
        const sample = t % 0.5 < 0.1 ? Math.round(Math.sin(t * Math.PI * 2 * 1500) * 12000) : 0
        data.writeInt16LE(sample, 44 + i * 4)
        data.writeInt16LE(-sample, 46 + i * 4)
    }
    return data
}

declare global {
    interface Window {
        productionSmoke: {
            preview: number
            chart: number
            overlay: number
            uploads: number
            fftTiles: number
            fftDraws: number
        }
    }
}

// Observe browser drawing APIs without importing source modules or changing
// application state. Only file-picker availability is overridden, to exercise
// the supported download fallback consistently in headless Chromium.
export const instrumentRendering = () => {
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: undefined })
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined })
    window.productionSmoke = {
        preview: 0,
        chart: 0,
        overlay: 0,
        uploads: 0,
        fftTiles: 0,
        fftDraws: 0,
    }
    const clear = WebGLRenderingContext.prototype.clear
    WebGLRenderingContext.prototype.clear = function (...args) {
        window.productionSmoke.preview++
        return clear.apply(this, args)
    }
    const upload = WebGLRenderingContext.prototype.texImage2D
    WebGLRenderingContext.prototype.texImage2D = function (...args) {
        if (args.some((arg) => arg instanceof ImageBitmap)) window.productionSmoke.uploads++
        return Reflect.apply(upload, this, args)
    }
    const fill = CanvasRenderingContext2D.prototype.fillRect
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.globalCompositeOperation === 'copy' && this.canvas instanceof HTMLCanvasElement) {
            if (this.canvas.classList.contains('editor-chart')) window.productionSmoke.chart++
            if (this.canvas.classList.contains('editor-overlay')) window.productionSmoke.overlay++
        }
        return fill.apply(this, args)
    }
    const put = CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData = function (...args) {
        if (this.canvas.width === 128 && this.canvas.height === 2000)
            window.productionSmoke.fftTiles++
        return Reflect.apply(put, this, args)
    }
    const draw = CanvasRenderingContext2D.prototype.drawImage
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        if (
            this.canvas instanceof HTMLCanvasElement &&
            this.canvas.classList.contains('editor-chart') &&
            args[0] instanceof HTMLImageElement &&
            args[0].naturalWidth === 128 &&
            args[0].naturalHeight === 2000
        )
            window.productionSmoke.fftDraws++
        return Reflect.apply(draw, this, args)
    }
}
