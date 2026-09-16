const deceleration = 800

export const integrateScrollInertia = (velocity: number, delta: number) => {
    const speed = Math.abs(velocity)
    const direction = Math.sign(velocity)
    // A delayed frame can outlast the remaining motion. Integrate only until
    // the stop, otherwise a brief flick can jump far after a busy/background frame.
    const elapsed = Math.min(delta, speed / deceleration)
    const remaining = Math.max(0, speed - deceleration * elapsed)
    return {
        distance: (direction * (speed + remaining) * elapsed) / 2,
        velocity: direction * remaining,
    }
}
