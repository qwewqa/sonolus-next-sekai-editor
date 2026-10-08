import en from '../i18n/en/index.json'
import { interpolateRaw } from '../utils/interpolate'

export type RefusalReason = keyof typeof en.commands.open.refusals

/** A file the editor refuses; Open shows its reason translated. */
export class ImportRefusal extends Error {
    readonly reason: RefusalReason
    readonly params: string[]

    constructor(reason: RefusalReason, ...params: (string | number)[]) {
        const shown = params.map(String)
        // English for the console.
        super(interpolateRaw(en.commands.open.refusals[reason], ...shown))
        this.reason = reason
        this.params = shown
    }
}
