// A trailing parenthetical, with the space before it, if any.
const unitPattern = /^(.*?)(\s?)([(（][^()（）]*[)）])$/su

/**
 * A label's trailing parenthetical, as "Offset (ms)" or "音量（%）", split so it
 * can be kept whole: `nowrap` holds it, with the character before it where no
 * space separates them, so it never wraps alone.
 */
export const splitUnit = (label: string) => {
    const match = unitPattern.exec(label)
    if (!match) return { text: label, nowrap: '' }
    const [, lead = '', space = '', unit = ''] = match
    if (space) return { text: lead + space, nowrap: unit }
    const [, text = '', last = ''] = /^(.*?)(.?)$/su.exec(lead) ?? []
    return { text, nowrap: last + unit }
}

/** A label without its trailing parenthetical, as "Skip" for "Skip (beats)". */
export const withoutUnit = (label: string) => unitPattern.exec(label)?.[1] ?? label
