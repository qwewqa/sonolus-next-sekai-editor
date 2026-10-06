export const formatIntegerTime = (time: number) =>
    `${`${Math.floor(time / 60)}`.padStart(2, '0')}:${`${time % 60}`.padStart(2, '0')}`

// Rounds to the shown millisecond first, so 59.9996 carries to 01:00.000.
export const formatTime = (time: number) => {
    const ms = Math.round(time * 1000)
    return `${`${Math.floor(ms / 60000)}`.padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}

export const formatBpm = (value: number) => `${value}`

export const formatTimeScale = (value: number, skip: number) => {
    let text = `${value}x`

    if (skip) {
        if (skip > 0) text += '+'
        text += `${skip}`
    }

    return text
}
