import type { NoteSfx, NoteType } from '../../chart/note'

/** A note pictogram in the editor's default note colours, or a muted speaker. */
export type NoteShape =
    'tap' | 'flick' | 'trace' | 'tick' | 'nonTick' | 'damage' | 'anchor' | 'mute'

/** Each note type's pictogram; Default is a plain tap. */
export const noteTypeShapes = {
    default: 'tap',
    trace: 'trace',
    anchor: 'anchor',
    damage: 'damage',
    forceTick: 'tick',
    forceNonTick: 'nonTick',
} as const satisfies Record<NoteType, NoteShape>

/** The note whose sound each SFX plays, and whether it's critical; Default has none. */
export const sfxShapes = {
    default: null,
    none: ['mute', false],
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
