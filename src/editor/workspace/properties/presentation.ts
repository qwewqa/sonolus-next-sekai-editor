import type { PropertiesSection } from '../../../settings'

/**
 * Below this height a stack of expandable sections leaves too little room to
 * reach Tool and View without scrolling through the selection form, so the
 * panel switches to one section at a time behind a fixed tab strip. Portrait
 * phone and tablet top docks (at most 420px by default), landscape phone side
 * docks and side tiles shared with another panel all fall below it; a desktop
 * side dock comfortably exceeds it.
 */
export const compactPropertiesHeight = 520

/** Narrower than this, stacked labels make every section too long to scan. */
export const compactPropertiesWidth = 240

/**
 * Once chosen, a presentation is kept until the panel moves this far past the
 * threshold, so dragging a dock edge across it does not flip back and forth.
 */
export const propertiesPresentationHysteresis = { height: 30, width: 15 }

export type PropertiesPresentation = 'sections' | 'tabs'

export const propertiesPresentation = (
    width: number,
    height: number,
    previous?: PropertiesPresentation,
): PropertiesPresentation => {
    // Leaving the current presentation requires crossing the far side of the band.
    const bias = previous === 'tabs' ? 1 : previous === 'sections' ? -1 : 0
    const minHeight = compactPropertiesHeight + bias * propertiesPresentationHysteresis.height
    const minWidth = compactPropertiesWidth + bias * propertiesPresentationHysteresis.width
    return height < minHeight || width < minWidth ? 'tabs' : 'sections'
}

/** Arrow, Home and End navigation within the section tab strip. */
export const nextPropertiesSection = (
    sections: readonly PropertiesSection[],
    current: PropertiesSection,
    key: string,
): PropertiesSection | undefined => {
    const index = sections.indexOf(current)
    switch (key) {
        case 'ArrowLeft':
            return sections[(index - 1 + sections.length) % sections.length]
        case 'ArrowRight':
            return sections[(index + 1) % sections.length]
        case 'Home':
            return sections[0]
        case 'End':
            return sections[sections.length - 1]
    }
}
