export type Gradient = {
    id: string
    color: string
    headAlpha: number
    tailAlpha: number
}

export type ConnectorFill = {
    fill: {
        fill: string
        'fill-opacity': number
    }
    gradient?: Gradient
}

export const getGuideFill = (
    id: string,
    color: string,
    headAlpha: number,
    tailAlpha: number,
): ConnectorFill => {
    // A constant-alpha guide has exactly the same fill without a paint server.
    if (headAlpha === tailAlpha) {
        return {
            fill: {
                fill: color,
                'fill-opacity': headAlpha,
            },
        }
    }

    return {
        fill: {
            fill: `url(#${id})`,
            'fill-opacity': 1,
        },
        gradient: { id, color, headAlpha, tailAlpha },
    }
}
