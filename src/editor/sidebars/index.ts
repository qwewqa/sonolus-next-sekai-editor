import { computed } from 'vue'
import { settings, type PropertiesSection } from '../../settings'
import { isPanelVisible } from '../workspace'

/**
 * Whether the Properties panel is on screen. Commands and tools edit in it
 * only then; otherwise they open a properties dialog, so nothing switches tabs
 * or uncovers a panel as a side effect.
 */
export const isSidebarVisible = computed(() => isPanelVisible('properties'))

/**
 * Shows a section of the visible Properties panel for a command that asks for
 * it explicitly. Selection changes and tool switches must not call this: they
 * leave the user's chosen section alone.
 */
export const revealPropertiesSection = (section: PropertiesSection) => {
    settings.propertiesSection = section
    if (settings.propertiesCollapsed.includes(section))
        settings.propertiesCollapsed = settings.propertiesCollapsed.filter(
            (value) => value !== section,
        )
}
