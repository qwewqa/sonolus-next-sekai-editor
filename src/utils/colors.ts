import type { NoteStyle } from '../chart/noteStyle'
export const activeColors = {
    normal: '#7fffd3',
    critical: '#fbffdc',
}

export const guideColors = {
    neutral: '#ededed',
    red: '#d6737b',
    green: '#73d69d',
    blue: '#737bd6',
    yellow: '#d6b362',
    purple: '#d673cd',
    cyan: '#73acd6',
    black: '#000000',
}

export const damageColor = '#ff80ff'

/** A styled active or damage connector's base; black stays clear of the grid and damage. */
export const connectorStyleColor = (style: Exclude<NoteStyle, 'default'>) =>
    style === 'black' ? '#555555' : guideColors[style]

// Editor colors are independent of preview skin availability.
export const noteStyleColors = {
    neutral: ['#cccccc', '#ffffff', '#999999'],
    red: ['#fec3dc', '#ffedf5', '#ec7cb4'],
    green: ['#81f8cf', '#dafdf1', '#5ce29d'],
    blue: ['#99aaff', '#e6edff', '#6677ee'],
    yellow: ['#fed983', '#fffccc', '#ffc633'],
    purple: ['#dfaaff', '#f6e5ff', '#bd66ee'],
    cyan: ['#83e5ff', '#dffaff', '#44bbdd'],
    black: ['#555555', '#999999', '#222222'],
} as const

export const noteStyleVariables = (style: NoteStyle = 'default') => {
    if (style === 'default') return undefined
    const [outer, inner, accent] = noteStyleColors[style]
    return { '--note-outer': outer, '--note-inner': inner, '--note-accent': accent }
}
