<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { replaceState, state } from '../history'
import { selectedEntities } from '../history/selectedEntities'
import { i18n } from '../i18n'
import { settings } from '../settings'
import { isEditableEntity } from '../state/operations/editable'
import { formatShortcut } from '../utils/format'
import { commands, isCommandName, type CommandName } from './commands'
import { closeContextMenu, contextMenu } from './contextMenu'
import { pasteAtContextPosition } from './contextMenuPaste'
import { openElevationEditor } from './elevation/state'
import { editorNavigation } from './navigation'
import { toolName } from './tools'
import { canRemove, remove } from './tools/eraser'
import { hitAllEntitiesAtPoint, modifyEntities } from './tools/utils'
import { view, yToValidBeat } from './view'

type ActionName = CommandName | 'delete' | 'selectSlideNotes' | 'editElevations'

const menu = useTemplateRef<HTMLDivElement>('menu')
const position = ref({ left: 0, top: 0 })
const canDelete = computed(() =>
    selectedEntities.value.some((entity) => isEditableEntity(entity) && canRemove(entity)),
)
let returnFocus: HTMLElement | null = null

const actions = computed(() => {
    const selection = selectedEntities.value
    const groups: ActionName[][] = []
    const editable = selection.some(isEditableEntity)
    const point = contextMenu.value
    const canEditElevations =
        point &&
        (selection.some((entity) => entity.type === 'note') ||
            !hitAllEntitiesAtPoint(point.x, point.y).length)
    if (
        selection.some(
            (entity) =>
                entity.type === 'note' &&
                state.value.store.slides.note
                    .get(entity.slideId)
                    ?.some((note) => !selection.includes(note)),
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
        if (
            new Set(selection.flatMap((entity) => (entity.type === 'note' ? [entity.slideId] : [])))
                .size > 1
        )
            transforms.push('combineNotes')
    }
    if (transforms.length) groups.push(transforms)
    if (canEditElevations) groups.push(['editElevations'])
    if (canDelete.value) groups.push(['delete'])
    return groups.map((names) =>
        names.map((name) => {
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
                    icon: commands.slide.icon,
                    shortcut: undefined,
                }
            if (name === 'delete')
                return {
                    name,
                    title: i18n.value.contextMenu.delete,
                    icon: commands.eraser.icon,
                    shortcut: undefined,
                }
            return {
                name,
                title: name === 'paste' ? i18n.value.contextMenu.paste : commands[name].title(),
                icon: commands[name].icon,
                shortcut:
                    name === 'paste' ? undefined : formatShortcut(settings.keyboardShortcuts[name]),
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
            const note = hitAllEntitiesAtPoint(point.x, point.y).find(
                (entity) => entity.type === 'note' && selectedEntities.value.includes(entity),
            )
            openElevationEditor(
                note?.beat ??
                    editorNavigation.value?.positionAtPoint(point.x, point.y).beat ??
                    yToValidBeat(point.y),
            )
        }
    } else if (name === 'delete') remove(selectedEntities.value)
    else if (name === 'selectSlideNotes')
        replaceState({
            ...state.value,
            selectedEntities: modifyEntities(selectedEntities.value, { ctrl: false, shift: true }),
        })
    else if (name === 'paste') {
        if (point) void pasteAtContextPosition(point.x, point.y, { ctrl: false, shift: false })
    } else void commands[name].execute()
}

watch(contextMenu, async (point) => {
    if (!point) return
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    position.value = { left: point.x, top: point.y }
    await nextTick()
    if (contextMenu.value !== point || !menu.value) return
    const rect = menu.value.getBoundingClientRect()
    position.value = {
        left: Math.max(4, Math.min(point.x, innerWidth - rect.width - 4)),
        top: Math.max(4, Math.min(point.y, innerHeight - rect.height - 4)),
    }
    menu.value.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
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
        () => view.groupId,
        () => view.stageId,
        () => view.visibilities,
        () => view.snapping,
    ],
    () => {
        dismiss()
    },
    { flush: 'sync' },
)

const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
        event.preventDefault()
        dismiss(true)
    } else if (event.key === 'Tab') {
        dismiss(true)
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const index = buttons.findIndex((button) => button === document.activeElement)
        const next =
            event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
    } else {
        const action = actions.value
            .flat()
            .find(
                ({ name }) =>
                    name !== 'paste' &&
                    isCommandName(name) &&
                    settings.keyboardShortcuts[name] === event.key,
            )
        if (action) {
            event.preventDefault()
            execute(action.name)
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
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
})
onUnmounted(() => {
    window.removeEventListener('pointerdown', outside, true)
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
            ref="menu"
            role="menu"
            :aria-label="i18n.contextMenu.title"
            class="fixed z-50 flex max-h-[calc(100dvh-0.5rem)] w-max min-w-[min(12rem,calc(100vw-0.5rem))] max-w-[calc(100vw-0.5rem)] flex-col overflow-y-auto rounded-lg bg-modal p-1 text-sm text-fg shadow-xl"
            :style="{ left: `${position.left}px`, top: `${position.top}px` }"
            @keydown.stop="onKeydown"
            @contextmenu.prevent
        >
            <div
                v-for="(group, index) in actions"
                :key="index"
                role="none"
                :class="{ 'mt-1 border-t border-fg/20 pt-1': index > 0 }"
            >
                <button
                    v-for="{ name, title, icon, shortcut } in group"
                    :key="name"
                    type="button"
                    role="menuitem"
                    tabindex="-1"
                    class="flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-button focus:bg-button focus:outline-none active:bg-accent active:text-on-accent"
                    @click="execute(name)"
                >
                    <component
                        :is="icon.is"
                        v-bind="icon.props"
                        class="size-4 shrink-0 fill-current"
                        aria-hidden="true"
                    />
                    <span class="flex-1">{{ title }}</span>
                    <span v-if="shortcut" class="text-xs opacity-60" aria-hidden="true">{{
                        shortcut
                    }}</span>
                </button>
            </div>
        </div>
    </Teleport>
</template>
