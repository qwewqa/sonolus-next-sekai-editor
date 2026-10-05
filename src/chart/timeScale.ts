import type { TimeScaleEase } from '../ease'
import type { GroupId } from './groups'

export type { TimeScaleEase }

export type TimeScaleTransition = 'timeScale' | 'scroll'

export type TimeScaleObject = {
    groupId: GroupId
    beat: number
    editorLane: number
    timeScale: number
    skip: number
    timeScaleEase: TimeScaleEase
    timeScaleTransition: TimeScaleTransition
    hideNotes: boolean
}
