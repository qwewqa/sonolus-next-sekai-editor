// Shown to users: the message alone, without the "Error: " prefix.
export const errorMessage = (error: unknown) =>
    error instanceof Error && error.message ? error.message : String(error)
