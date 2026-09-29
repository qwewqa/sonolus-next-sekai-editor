import { computed } from 'vue'
import { noteStyles, type NoteStyle } from '../../chart/noteStyle'
import { i18n } from '../../i18n'

export const noteStyleOptions = computed<[string, NoteStyle][]>(() =>
    noteStyles.map((style) => [
        style === 'default'
            ? i18n.value.modals.form.noteStyle.default
            : i18n.value.modals.form.connectorGuideColor[style],
        style,
    ]),
)
