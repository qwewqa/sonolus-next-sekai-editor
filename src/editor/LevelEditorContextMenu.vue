<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { replaceState, state } from '../history'
import { selectedEntities } from '../history/selectedEntities'
import { i18n } from '../i18n'
import { settings } from '../settings'
import { isEditableEntity } from '../state/operations/editable'
import { canMakeVertical } from '../state/operations/makeVerticalValues'
import { canScaleSelection } from '../state/operations/scaleValues'
import { getSplitHoldNotes } from '../state/operations/splitHold'
import { vScrollEdges } from '../directives/scrollEdges'
import { interpolate } from '../utils/interpolate'
import { holdsCharacter, menuKeyIndex } from '../utils/menuKeys'
import { commands, isCommandName, type Command, type CommandName } from './commands'
import {
    formatShortcut,
    isApplePlatform,
    isPunctuationShortcut,
    matchBindings,
} from './controls/bindings'
import DeleteIcon from './commands/reset/ResetIcon.vue'
import { closeContextMenu, contextMenu } from './contextMenu'
import SelectSlideNotesIcon from './contextMenu/SelectSlideNotesIcon.vue'
import { pasteAtContextPosition } from './contextMenuPaste'
import { canEditSelectionProperties, editSelectionProperties } from './editSelectionProperties'
import { openElevationEditor } from './elevation/state'
import PropertiesIcon from './commands/properties/PropertiesIcon.vue'
import { isCoarsePointer } from './workspace'
import { editorNavigation } from './navigation'
import { notify } from './notification'
import { isEntityInScope, scopeLookup } from './scope'
import { toolName } from './tools'
import { canRemove, remove } from './tools/eraser'
import { hitAllEntitiesAtPoint, modifyEntities } from './tools/utils'
import { view, yToValidBeat } from './view'

type ActionName = CommandName | 'delete' | 'selectSlideNotes' | 'editElevations' | 'editProperties'
type Action = {
    name: ActionName
    title: string
    icon: Command['icon']
    shortcut: string | undefined
}

const menu = useTemplateRef<HTMLDivElement>('menu')
const position = ref({ left: 0, top: 0 })
const canDelete = computed(() =>
    selectedEntities.value.some((entity) => isEditableEntity(entity) && canRemove(entity)),
)
let returnFocus: HTMLElement | null = null
// A menu opened by pointer focuses itself, so no item starts out highlighted;
// one opened from the keyboard focuses its first item.
let pointerInput = false
const onInput = (event: Event) => {
    pointerInput = event.type === 'pointerdown'
}

const actions = computed(() => {
    const selection = selectedEntities.value
    const groups: ActionName[][] = []
    const editable = selection.some(isEditableEntity)
    const point = contextMenu.value
    // Elevations belong to notes: offer the editor for notes or empty space.
    const canEditElevations =
        point && (selection.some((entity) => entity.type === 'note') || !selection.length)
    if (
        selection.some(
            (entity) =>
                entity.type === 'note' &&
                state.value.store.slides.note
                    .get(entity.slideId)
                    // Selection never extends into hidden or dimmed groups/stages.
                    ?.some((note) => !selection.includes(note) && isEntityInScope(note)),
        )
    )
        groups.push(['selectSlideNotes'])
    const clipboard: ActionName[] = []
    if (canDelete.value) clipboard.push('cut')
    if (editable) clipboard.push('copy')
    clipboard.push('paste')
    groups.push(clipboard)
    const transforms: CommandName[] = []
    if (editable) {
        if (selection.some((entity) => isEditableEntity(entity) && entity.type !== 'bpm'))
            transforms.push('flip')
        if (new Set(selection.filter(isEditableEntity).map((entity) => entity.beat)).size > 1)
            transforms.push('flipVertical')
        if (canScaleSelection(selection, 'width', state.value)) transforms.push('scaleWidth')
        if (canScaleSelection(selection, 'beat')) transforms.push('scaleBeat')
        if (canScaleSelection(selection, 'elevation', state.value))
            transforms.push('scaleElevation')
        if (canMakeVertical(selection, state.value)) transforms.push('makeVertical')
        if (
            new Set(selection.flatMap((entity) => (entity.type === 'note' ? [entity.slideId] : [])))
                .size > 1
        )
            transforms.push('combineNotes')
        if (getSplitHoldNotes(state.value, selection).length) transforms.push('splitHold')
    }
    if (transforms.length) groups.push(transforms)
    const editors: ActionName[] = []
    if (canEditSelectionProperties.value) editors.push('editProperties')
    if (canEditElevations) editors.push('editElevations')
    if (editors.length) groups.push(editors)
    if (canDelete.value) groups.push(['delete'])
    return groups.map((names) =>
        names.map((name): Action => {
            if (name === 'editProperties')
                return {
                    name,
                    title: i18n.value.contextMenu.editProperties,
                    icon: { is: PropertiesIcon },
                    shortcut: undefined,
                }
            if (name === 'editElevations')
                return {
                    name,
                    title: i18n.value.elevation.edit,
                    icon: commands.elevation.icon,
                    shortcut: undefined,
                }
            if (name === 'selectSlideNotes')
                return {
                    name,
                    title: i18n.value.contextMenu.selectSlideNotes,
                    icon: { is: SelectSlideNotesIcon },
                    shortcut: undefined,
                }
            if (name === 'delete')
                return {
                    name,
                    title: i18n.value.contextMenu.delete,
                    icon: { is: DeleteIcon },
                    shortcut: undefined,
                }
            return {
                name,
                title: name === 'paste' ? i18n.value.contextMenu.paste : commands[name].title(),
                icon: commands[name].icon,
                // Keyboard hints are noise on touch screens.
                shortcut:
                    name === 'paste' || isCoarsePointer.value
                        ? undefined
                        : formatShortcut(settings.keyboardShortcuts[name]),
            }
        }),
    )
})

const dismiss = (restoreFocus = false) => {
    closeContextMenu()
    if (restoreFocus) returnFocus?.focus({ preventScroll: true })
}

const execute = (name: ActionName) => {
    const point = contextMenu.value
    dismiss(true)
    if (name === 'editElevations') {
        if (point) {
            const note = (
                point.selection ? selectedEntities.value : hitAllEntitiesAtPoint(point.x, point.y)
            ).find((entity) => entity.type === 'note' && selectedEntities.value.includes(entity))
            openElevationEditor(
                note?.beat ??
                    editorNavigation.value?.positionAtPoint(point.x, point.y).beat ??
                    yToValidBeat(point.y),
            )
        }
    } else if (name === 'editProperties') editSelectionProperties()
    else if (name === 'delete') remove(selectedEntities.value)
    else if (name === 'selectSlideNotes') {
        const targets = modifyEntities(selectedEntities.value, { ctrl: false, shift: true })
        replaceState({
            ...state.value,
            selectedEntities: targets,
        })
        notify(interpolate(() => i18n.value.tools.select.selected, `${targets.length}`))
    } else if (name === 'paste') {
        if (point) void pasteAtContextPosition(point.x, point.y, { ctrl: false, shift: false })
    } else void commands[name].execute()
}

watch(contextMenu, async (point) => {
    if (!point) return
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    position.value = { left: point.x, top: point.y }
    await nextTick()
    if (contextMenu.value !== point || !menu.value) return
    // 8px from the screen edges, as every other menu and dialog keeps.
    const rect = menu.value.getBoundingClientRect()
    position.value = {
        left: Math.max(8, Math.min(point.x, innerWidth - rect.width - 8)),
        top: Math.max(8, Math.min(point.y, innerHeight - rect.height - 8)),
    }
    ;(pointerInput ? menu.value : menu.value.querySelector<HTMLButtonElement>('button'))?.focus({
        preventScroll: true,
    })
})
watch(
    [
        state,
        toolName,
        () => settings.mouseSecondaryTool,
        () => view.time,
        () => view.lane,
        () => view.x,
        () => view.y,
        () => view.w,
        () => view.h,
        () => settings.width,
        () => settings.pps,
        () => view.division,
        // Focus, visibility overrides and their settings.
        scopeLookup,
        () => view.visibilities,
        () => view.snapping,
        () => view.laneDivision,
        () => view.laneSnapping,
    ],
    () => {
        dismiss()
    },
    { flush: 'sync' },
)

const isApple = isApplePlatform()

const onKeydown = (event: KeyboardEvent) => {
    const { names } = matchBindings(settings.keyboardShortcuts, event, isApple)
    if (event.key === 'Escape' || names.includes('openContextMenu')) {
        event.preventDefault()
        dismiss(true)
    } else if (event.key === 'Tab') {
        dismiss(true)
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const index = buttons.findIndex((button) => button === document.activeElement)
        const next = menuKeyIndex(event.key, index, buttons.length)
        if (next !== undefined) buttons[next]?.focus()
    } else {
        const action = actions.value
            .flat()
            .find(({ name }) => name !== 'paste' && isCommandName(name) && names.includes(name))
        if (action) {
            event.preventDefault()
            execute(action.name)
        } else if (
            ((event.ctrlKey || event.metaKey) && /^[a-z]$/i.test(event.key)) ||
            holdsCharacter(event)
        ) {
            // Nor do other chords or characters reach the browser, such as Ctrl+S saving the page.
            event.preventDefault()
        }
    }
}

const outside = (event: PointerEvent) => {
    if (contextMenu.value && !menu.value?.contains(event.target as Node)) dismiss()
}
const close = () => {
    dismiss()
}
const onScroll = (event: Event) => {
    if (event.target instanceof Node && menu.value?.contains(event.target)) return
    dismiss()
}
onMounted(() => {
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('pointerdown', onInput, true)
    window.addEventListener('keydown', onInput, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
})
onUnmounted(() => {
    window.removeEventListener('pointerdown', outside, true)
    window.removeEventListener('pointerdown', onInput, true)
    window.removeEventListener('keydown', onInput, true)
    window.removeEventListener('blur', close)
    window.removeEventListener('resize', close)
    window.removeEventListener('scroll', onScroll, true)
    closeContextMenu()
})
</script>

<template>
    <Teleport to="body">
        <div
            v-if="contextMenu"
            class="fixed inset-0 z-40 bg-black/30 sm:hidden"
            aria-hidden="true"
            @pointerdown.prevent.stop="dismiss()"
        />
        <div
            v-if="contextMenu"
            ref="menu"
            role="menu"
            tabindex="-1"
            :aria-label="i18n.contextMenu.title"
            class="context-menu popup-surface popup-sheet fixed z-50 max-h-[calc(var(--viewport-height)-1rem)]"
            :style="{ left: `${position.left}px`, top: `${position.top}px` }"
            @keydown.stop="onKeydown"
            @contextmenu.prevent
        >
            <!-- The fade marks more items; the menu's own chrome stays crisp. -->
            <div v-scroll-edges role="none" class="popup-scroller">
                <template v-for="(group, index) in actions" :key="index">
                    <div v-if="index > 0" role="separator" class="popup-separator" />
                    <div role="none">
                        <button
                            v-for="{ name, title, icon, shortcut } in group"
                            :key="name"
                            type="button"
                            role="menuitem"
                            tabindex="-1"
                            class="popup-item"
                            :class="{ 'text-danger': name === 'delete' }"
                            @click="execute(name)"
                        >
                            <component
                                :is="icon.is"
                                v-bind="icon.props"
                                class="size-4 shrink-0 fill-current"
                                aria-hidden="true"
                            />
                            <span class="flex-1">{{ title }}</span>
                            <span
                                v-if="shortcut"
                                :class="
                                    isPunctuationShortcut(shortcut)
                                        ? 'text-sm font-bold leading-4'
                                        : 'text-xs text-fg/80'
                                "
                                aria-hidden="true"
                                >{{ shortcut }}</span
                            >
                        </button>
                    </div>
                </template>
            </div>
        </div>
    </Teleport>
</template>
