import type { CommandName } from '../commands'

/** Always last: a group of its own. */
const fixedGroup: CommandName[] = ['fullscreen', 'settings', 'openContextMenu', 'help']

/** The toolbar's groups, each shown as one tool, limited to `available` if given. */
export const toolbarGroups = (groups: CommandName[][], available?: CommandName[]) => [
    ...groups
        .map((group) => (available ? group.filter((name) => available.includes(name)) : group))
        .filter((group) => group.length),
    fixedGroup,
]

// Tools wrap into as few rows as the smallest size allows, balanced so no
// row is left with a few orphans. On touch they then grow, up to 40px, into
// the room those rows leave (36px in short panes, such as a phone held
// sideways, where height is scarce), and a row may be wider to fit them;
// mouse pointers keep 32px in rows up to 36rem.
export const minToolSize = 32
export const maxCoarseToolSize = 40
export const maxShortCoarseToolSize = 36
export const shortPaneHeight = 480

// The pane's inline padding is half the width beyond a row of tools, in rem,
// kept within these bounds.
const rowWidth = { fine: 36, coarse: 45 }
const padding = { min: 0.75, max: 8 }

/** The pane's inline padding, in CSS. */
export const toolbarPadding = (coarse: boolean) =>
    `clamp(${padding.min}rem, calc((100% - ${coarse ? rowWidth.coarse : rowWidth.fine}rem) / 2), ${padding.max}rem)`

/**
 * The narrowest pane that keeps `count` tools on one row at their smallest
 * size. The room inside the padding stops growing at the row width until the
 * padding reaches its maximum.
 */
export const oneRowToolbarWidth = (count: number, rem: number, coarse: boolean) => {
    const need = count * minToolSize
    const row = (coarse ? rowWidth.coarse : rowWidth.fine) * rem
    return Math.ceil(need + 2 * (need <= row ? padding.min : padding.max) * rem)
}
