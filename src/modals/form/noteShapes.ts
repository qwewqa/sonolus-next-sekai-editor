import type { NoteSfx, NoteType } from '../../chart/note'

/** A note pictogram, drawn in the editor's default note colours. */
export type NoteShape = 'tap' | 'flick' | 'trace' | 'tick' | 'nonTick' | 'damage' | 'anchor'

/** Each note type's pictogram; Default has none. */
export const noteTypeShapes = {
    default: null,
    trace: 'trace',
    anchor: 'anchor',
    damage: 'damage',
    forceTick: 'tick',
    forceNonTick: 'nonTick',
} as const satisfies Record<NoteType, NoteShape | null>

/** The note whose sound each SFX plays, and whether it's critical; Default and None have none. */
export const sfxShapes = {
    default: null,
    none: null,
    normalTap: ['tap', false],
    criticalTap: ['tap', true],
    normalFlick: ['flick', false],
    criticalFlick: ['flick', true],
    normalTrace: ['trace', false],
    criticalTrace: ['trace', true],
    normalTick: ['tick', false],
    criticalTick: ['tick', true],
    damage: ['damage', false],
} as const satisfies Record<NoteSfx, readonly [NoteShape, boolean] | null>
