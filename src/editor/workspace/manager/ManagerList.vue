<script setup lang="ts" generic="T extends number">
import {
    computed,
    nextTick,
    onMounted,
    onUnmounted,
    shallowRef,
    useId,
    useTemplateRef,
    watch,
} from 'vue'
import {
    entriesInTreeOrder,
    type FolderId,
    type FolderTreeItem,
    type FolderTreeRef,
} from '../../../chart/folders'
import { i18n } from '../../../i18n'
import { modals, showModal } from '../../../modals'
import ConfirmModal from '../../../modals/ConfirmModal.vue'
import { interpolateRaw } from '../../../utils/interpolate'
import CopyIcon from '../../commands/copy/CopyIcon.vue'
import SelectIcon from '../../commands/select/SelectIcon.vue'
import ResetIcon from '../../commands/reset/ResetIcon.vue'
import CloseIcon from '../CloseIcon.vue'
import OverlayScrollbar from '../OverlayScrollbar.vue'
import { workspaceSize } from '..'
import { hasScrollMemory, useScrollMemory } from '../useScrollMemory'
import { isFolderExpanded, setFolderExpanded, type EntryPlace } from './folders'
import AddIcon from './icons/AddIcon.vue'
import FolderIcon from './icons/FolderIcon.vue'
import FolderOpenIcon from './icons/FolderOpenIcon.vue'
import FolderPlusIcon from './icons/FolderPlusIcon.vue'
import HiddenIcon from './icons/HiddenIcon.vue'
import ManagerAddButton from './ManagerAddButton.vue'
import MoreIcon from './icons/MoreIcon.vue'
import MoveDownIcon from './icons/MoveDownIcon.vue'
import MoveHereIcon from './icons/MoveHereIcon.vue'
import MoveUpIcon from './icons/MoveUpIcon.vue'
import PropertiesIcon from './icons/PropertiesIcon.vue'
import RenameIcon from './icons/RenameIcon.vue'
import SelectMultipleIcon from './icons/SelectMultipleIcon.vue'
import VisibleIcon from './icons/VisibleIcon.vue'
import ManagerMenu, { type ManagerMenuItem } from './ManagerMenu.vue'
import type { ManagerModel, ManagerRowAction, SelectModifiers } from './model'
import {
    canMoveSelectionTo,
    hasVisibleOwned,
    moveSelectionTo,
    ownedCounts,
    selectOwned,
} from './objects'
import ManagerRow from './ManagerRow.vue'

const props = defineProps<{
    model: ManagerModel<T>
    /** Remembers the list's scroll position across remounts under this key. */
    scrollKey?: string
}>()

const root = useTemplateRef<HTMLDivElement>('root')
const list = useTemplateRef<HTMLUListElement>('list')
useScrollMemory(() => props.scrollKey, list)
const uid = useId()

const entries = computed(() => props.model.entries())
const names = computed(() => new Map(entries.value.map(({ id, name }) => [id, name])))
const folders = computed(() => props.model.folders)
const tree = computed(() => folders.value.tree())
const strings = computed(() => props.model.strings())
const scope = computed(() => props.model.scope)
const focused = computed(() => props.model.focused())
const counts = computed(() => ownedCounts(props.model.owner))

const allShown = computed(() => scope.value.shownCount.value === scope.value.totalCount.value)

const label = (template: string, ...values: string[]) => interpolateRaw(template, ...values)

// Rows: entries and folders, told apart by kind.

type RowKey = { type: 'entry'; id: T } | { type: 'folder'; id: FolderId }
type FolderItem = Extract<FolderTreeItem<T>, { type: 'folder' }>

const rowKey = (key: RowKey) => `${key.type === 'entry' ? 'e' : 'f'}${String(key.id)}`
/** A menu's subject: a row, or the selection. */
type MenuKey = RowKey | { type: 'selection'; id?: undefined }

const sameKey = (a: MenuKey | undefined, b: MenuKey) => a?.type === b.type && a.id === b.id

const folderItems = computed(
    () => new Map(tree.value.flatMap((item) => (item.type === 'folder' ? [[item.id, item]] : []))),
)
const folderOfEntry = computed(() => {
    const map = new Map<T, FolderId>()
    for (const item of folderItems.value.values())
        for (const id of item.members) map.set(id, item.id)
    return map
})
const folderName = (id: FolderId) => folders.value.name(id)
const folderCount = (item: FolderItem) =>
    item.members.reduce((sum, id) => sum + (counts.value.get(id) ?? 0), 0)
const shownMembers = (item: FolderItem) => item.members.filter((id) => scope.value.isShown(id))
const membersId = (id: FolderId) => `${uid}-folder-${String(id)}`

/** The name a row shows, with its folder when another entry shares it. */
const entryTitle = (id: T, name: string) => {
    const folder = folderOfEntry.value.get(id)
    return folder === undefined
        ? name
        : label(i18n.value.workspace.folders.path, folderName(folder), name)
}

const rowOf = (key: RowKey) =>
    list.value?.querySelector<HTMLElement>(`[data-row="${rowKey(key)}"]`) ?? undefined

const focusIn = (key: RowKey, selector: string) => {
    rowOf(key)?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
}

/** Focuses a row's control, or its collapsed folder's. */
const focusShown = (key: RowKey, selector: string) => {
    const folder = key.type === 'entry' && !rowOf(key) ? folderOfEntry.value.get(key.id) : undefined
    focusIn(folder === undefined ? key : { type: 'folder', id: folder }, selector)
}

/**
 * Scrolls only the list, never the page or the panel around it, so the row
 * clears the list padding and the sticky Add item.
 */
const reveal = (key: RowKey) => {
    const row = rowOf(key)
    if (row) revealRow(row)
}

const revealRow = (row: HTMLElement) => {
    const container = list.value
    if (!container) return
    const bounds = container.getBoundingClientRect()
    const style = getComputedStyle(container)
    // A floating Add is covered by the list's bottom padding, and a member by
    // its folder's row, which stays at the top while members scroll by.
    const head =
        row.dataset.rowFolder === undefined
            ? undefined
            : row.closest('.manager-folder')?.querySelector<HTMLElement>('.manager-folder-head')
    const top =
        bounds.top +
        parseFloat(style.paddingTop) +
        (head ? parseFloat(getComputedStyle(head).top) + head.offsetHeight : 0)
    const bottom = bounds.bottom - parseFloat(style.paddingBottom)
    const rect = row.getBoundingClientRect()
    if (rect.top < top) container.scrollTop -= top - rect.top
    else if (rect.bottom > bottom) container.scrollTop += rect.bottom - bottom
}

// The band's toggle outlasts the selection bar.
const focusMode = () =>
    root.value
        ?.querySelector<HTMLElement>('.manager-all .manager-mode')
        ?.focus({ preventScroll: true })

/** Done; by keyboard, focus moves on from the bar it leaves. */
const onDone = async (event: MouseEvent) => {
    stopSelecting()
    if (event.detail > 0) return
    await nextTick()
    focusMode()
}

const keyOfRow = (element: Element | null | undefined) =>
    parseRowKey(element?.closest<HTMLElement>('[data-row]')?.dataset.row)

/** Escape and Delete while selecting. */
const onSelectingKeydown = async (event: KeyboardEvent, target: HTMLElement) => {
    if (event.key === 'Escape') {
        // Also keeps a surrounding dialog open.
        event.preventDefault()
        const row = target.closest<HTMLElement>('[data-row]')?.dataset.row
        stopSelecting()
        await nextTick()
        if (target.isConnected) return
        if (row)
            list.value
                ?.querySelector<HTMLElement>(`[data-row="${row}"] .manager-name`)
                ?.focus({ preventScroll: true })
        else focusMode()
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        await onBulkDelete(true)
    }
}

// A key that changes the rows, e.g. Ctrl+Z, may remove or re-create the focused
// row; focus then returns to it, or to the row now in its place.
const rowControls = ['manager-name', 'manager-more', 'manager-check', 'manager-eye']
let keyFocus: { key: RowKey; control: string; index: number } | undefined
let keyFocusTimer = 0

const noteKeyFocus = (target: HTMLElement) => {
    const key = keyOfRow(target)
    if (!key) return
    const control = rowControls.find((name) => target.classList.contains(name)) ?? 'manager-name'
    keyFocus = { key, control: `.${control}`, index: rowIndex(key) }
    clearTimeout(keyFocusTimer)
    keyFocusTimer = window.setTimeout(() => (keyFocus = undefined))
}

const focusFirst = (...elements: (HTMLElement | null | undefined)[]) =>
    elements.some((element) => {
        element?.focus({ preventScroll: true })
        return !!element && document.activeElement === element
    })

watch(
    tree,
    () => {
        const last = keyFocus
        if (!last || !root.value?.isConnected) return
        if (document.activeElement && document.activeElement !== document.body) return
        if (exists(last.key)) {
            focusShown(last.key, last.control)
            if (root.value.contains(document.activeElement)) return
        }
        const rows = [...(list.value?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
        const row = rows[Math.min(last.index, rows.length - 1)]
        focusFirst(
            row?.querySelector<HTMLElement>(last.control),
            row?.querySelector<HTMLElement>('.manager-name'),
            root.value.querySelector<HTMLElement>('.manager-add'),
            root.value.querySelector<HTMLElement>('.manager-all .manager-name'),
        )
    },
    { flush: 'post' },
)

/**
 * Up and Down step between the rows' names, from the band's row down, and Home
 * and End reach the ends, as in a tree; Tab still visits every control. With
 * Shift they select the rows passed.
 */
const onKeydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (target instanceof HTMLInputElement) return
    noteKeyFocus(target)
    if (selecting.value && ['Escape', 'Delete', 'Backspace'].includes(event.key)) {
        void onSelectingKeydown(event, target)
        return
    }
    if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'a' &&
        target.classList.contains('manager-name')
    ) {
        event.preventDefault()
        setSelection(allIds.value, allFolderIds.value, anchor)
        return
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (!target.classList.contains('manager-name')) return
    event.preventDefault()
    const names = [...(root.value?.querySelectorAll<HTMLElement>('.manager-name') ?? [])]
    const index = names.indexOf(target)
    let next =
        event.key === 'Home'
            ? names[0]
            : event.key === 'End'
              ? names.at(-1)
              : names[index + (event.key === 'ArrowUp' ? -1 : 1)]
    // Ranges stop at the first row, short of the band.
    if (event.shiftKey && next && !keyOfRow(next)) next = names.find((name) => keyOfRow(name))
    if (!next) return
    next.focus({ preventScroll: true })
    const row = next.closest<HTMLElement>('[data-row]')
    if (row) revealRow(row)
    if (!event.shiftKey) return
    const to = keyOfRow(next)
    const start = keyOfRow(target) ?? to
    if ((!selecting.value || anchor === undefined) && start) {
        if (selecting.value) setSelection(selected.value, selectedFolders.value, start)
        else setSelection([], [], start)
        selectRange(start)
    }
    if (to) selectRange(to)
}

// Inline actions need room beside a useful share of the name. With a mouse
// they appear on the row in use; touch has no hover, so only on the target.
const width = shallowRef(0)
const coarse = matchMedia('(pointer: coarse)')
const isCoarse = shallowRef(coarse.matches)
const onPointerChange = () => {
    isCoarse.value = coarse.matches
}
coarse.addEventListener('change', onPointerChange)
const listHeight = shallowRef(0)
// Opening reveals the target once the list knows its size and whether Add floats.
let revealOnMeasure = false
const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
        if (entry.target === root.value) width.value = entry.contentRect.width
        // The whole box: the floating Add's room below the rows is padding,
        // which must not decide whether Add floats.
        else listHeight.value = entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height
    }
    if (dialog.value?.open && listHeight.value > 0) {
        const chrome = dialog.value.getBoundingClientRect().height - listHeight.value
        if (chrome > 0) dialogChrome.value = chrome
    }
    onListScroll()
    if (revealOnMeasure && listHeight.value > 0) {
        revealOnMeasure = false
        void revealTarget()
    }
})
// Classic scrollbars, kept in forced colors, reserve a gutter at the right (see
// the styles below). The rows' own 6px inset gives way to it, so they stay as
// centered as they can.
const gutterPadding = shallowRef<string>()
const measureGutter = () => {
    const element = list.value
    if (!element) return
    const gutter = element.offsetWidth - element.clientWidth
    gutterPadding.value = gutter > 0 ? `${Math.max(0, 6 - gutter)}px` : undefined
}
// The gutter comes and goes with forced colors.
const forcedColors = matchMedia('(forced-colors: active)')
forcedColors.addEventListener('change', measureGutter)
watch(list, (element, previous) => {
    if (previous) observer.unobserve(previous)
    if (!element) return
    observer.observe(element)
    measureGutter()
})
// The Add item follows the rows; it floats in reach at the bottom of long
// lists, unless the list is too short to show it beside at least two rows.
// In a dialog the list's height follows Add's place, so the dialog's room decides.
const dialog = shallowRef<HTMLDialogElement | null>(null)
const dialogChrome = shallowRef(160)
// Dialogs are at most 1rem shorter than the viewport.
const dialogRoom = computed(() => workspaceSize.value.height - 16 - dialogChrome.value)
const stickyAdd = computed(
    () => (dialog.value ? dialogRoom.value : listHeight.value) >= (isCoarse.value ? 176 : 156),
)
watch(root, (element, previous) => {
    if (previous) observer.unobserve(previous)
    if (element) observer.observe(element)
    dialog.value = element?.closest('dialog') ?? null
})
onUnmounted(() => {
    observer.disconnect()
    coarse.removeEventListener('change', onPointerChange)
    forcedColors.removeEventListener('change', measureGutter)
})
const inlineMode = computed(() =>
    width.value < (isCoarse.value ? 320 : 256)
        ? undefined
        : isCoarse.value
          ? ('current' as const)
          : ('hover' as const),
)
/** Touch drag handles, where names keep enough room beside them. */
const hasGrip = computed(() => width.value >= 300)

/** Whether a row offers its inline actions, which the menu then leaves out. */
const hasInline = (id: T) =>
    inlineMode.value === 'hover' || (inlineMode.value === 'current' && focused.value === id)

// The target's folder opens, so the target always shows.
watch(
    () => {
        const id = focused.value
        return id === undefined ? undefined : folderOfEntry.value.get(id)
    },
    (folder) => {
        if (folder !== undefined && !isFolderExpanded(folder)) setFolderExpanded(folder, true)
    },
    { immediate: true },
)

// The target's row comes into view when the target changes, e.g. by Next Group,
// and on opening unless the list remembers where it was.
const revealTarget = async () => {
    await nextTick()
    const id = focused.value
    if (id !== undefined) reveal({ type: 'entry', id })
}
watch(focused, revealTarget)
onMounted(() => {
    revealOnMeasure = !hasScrollMemory(props.scrollKey)
})

// Selection and visibility

const onSelectAll = () => {
    if (focused.value !== undefined) scope.value.focus(undefined)
}

const onToggleAll = () => {
    scope.value.setAllShown(!allShown.value)
}

const onSelect = (id: T) => {
    // Selecting the current target again changes nothing unless it is hidden.
    if (focused.value === id && scope.value.isShown(id)) return
    scope.value.focus(id)
}

/** Whether exactly these entries are shown. */
const isOnlyShown = (ids: readonly T[]) =>
    ids.length > 0 &&
    scope.value.shownCount.value === ids.length &&
    ids.every((id) => scope.value.isShown(id))

/** Shows only these entries, or everything again when they already are alone. */
const solo = (ids: readonly T[]) => {
    if (isOnlyShown(ids)) scope.value.setAllShown(true)
    else scope.value.showOnly(ids)
}

const onToggle = (id: T, soloed: boolean) => {
    if (soloed) solo([id])
    else scope.value.setShown(id, !scope.value.isShown(id))
}

/** A folder's eye shows every member when any is hidden, else hides them all. */
const onToggleFolder = (item: FolderItem, soloed: boolean) => {
    if (!item.members.length) return
    if (soloed) solo(item.members)
    else scope.value.setSomeShown(item.members, shownMembers(item).length < item.members.length)
}

// Selecting entries and folders for bulk actions: view state of this list only.
// A selected folder is a unit with all its members, so deselecting any member
// deselects it; selecting every member leaves it out.

const selecting = shallowRef(false)
const selected = shallowRef<ReadonlySet<T>>(new Set())
const selectedFolders = shallowRef<ReadonlySet<FolderId>>(new Set())
/** Where ranges start, and the selection they add to. */
let anchor: RowKey | undefined
let rangeBase: { entries: ReadonlySet<T>; folders: ReadonlySet<FolderId> } = {
    entries: new Set(),
    folders: new Set(),
}

const allIds = computed(() => entriesInTreeOrder(tree.value))
const allFolderIds = computed(() => [...folderItems.value.keys()])
/** Entries on screen, in order: members of collapsed folders are left out. */
const visibleIds = computed(() =>
    tree.value.flatMap((item) =>
        item.type === 'entry' ? [item.id] : isFolderExpanded(item.id) ? item.members : [],
    ),
)
const selectedIds = computed(() => allIds.value.filter((id) => selected.value.has(id)))
const selectedFolderIds = computed(() =>
    allFolderIds.value.filter((id) => selectedFolders.value.has(id)),
)
/** Selected entries outside selected folders: those copied beside themselves. */
const looseSelectedIds = computed(() =>
    selectedIds.value.filter((id) => {
        const folder = folderOfEntry.value.get(id)
        return folder === undefined || !selectedFolders.value.has(folder)
    }),
)
const selectionSize = computed(() => selectedIds.value.length + selectedFolderIds.value.length)

/** The folders that are units of these entries: every member among them. */
const unitsOf = (ids: Iterable<FolderId>, entries: ReadonlySet<T>) =>
    new Set(
        [...ids].filter(
            (id) =>
                folderItems.value.get(id)?.members.every((member) => entries.has(member)) ?? false,
        ),
    )

const setSelection = (ids: Iterable<T>, folderIds: Iterable<FolderId> = [], from?: RowKey) => {
    selecting.value = true
    selected.value = new Set(ids)
    selectedFolders.value = unitsOf(folderIds, selected.value)
    anchor = from
    rangeBase = { entries: selected.value, folders: selectedFolders.value }
}

const startSelecting = (ids: readonly T[] = [], folderIds: readonly FolderId[] = []) => {
    closeMenu(false)
    renaming.value = undefined
    const folder = folderIds.at(-1)
    const id = ids.at(-1)
    setSelection(
        ids,
        folderIds,
        folder !== undefined
            ? { type: 'folder', id: folder }
            : id === undefined
              ? undefined
              : { type: 'entry', id },
    )
}

const stopSelecting = () => {
    closeMenu(false)
    selecting.value = false
    selected.value = new Set()
    selectedFolders.value = new Set()
    anchor = undefined
    rangeBase = { entries: new Set(), folders: new Set() }
}

const toggleSelected = (id: T) => {
    const next = new Set(selected.value)
    if (!next.delete(id)) next.add(id)
    setSelection(next, selectedFolders.value, { type: 'entry', id })
}

/** Selects a folder with its members, or deselects them all. */
const toggleFolder = (item: FolderItem) => {
    const add = !selectedFolders.value.has(item.id)
    const next = new Set(selected.value)
    const folders = new Set(selectedFolders.value)
    for (const id of item.members) {
        if (add) next.add(id)
        else next.delete(id)
    }
    if (add) folders.add(item.id)
    else folders.delete(item.id)
    setSelection(next, folders, { type: 'folder', id: item.id })
}

/** Each row's place on screen; members of a collapsed folder share its row. */
const rowPlaces = computed(() => {
    const places = new Map<string, number>()
    let place = 0
    for (const item of tree.value) {
        if (item.type === 'entry') {
            places.set(rowKey(item), place++)
            continue
        }
        const row = place++
        places.set(rowKey(item), row)
        const open = isFolderExpanded(item.id)
        for (const id of item.members)
            places.set(rowKey({ type: 'entry', id }), open ? place++ : row)
    }
    return places
})

const placeOf = (key: RowKey) => rowPlaces.value.get(rowKey(key))

/**
 * Adds the rows from the anchor to this one, a new range replacing the last.
 * A folder joins when its row and its shown members all lie in the range.
 */
const selectRange = (key: RowKey) => {
    const target = focused.value
    const start = anchor ?? (target === undefined ? key : { type: 'entry', id: target })
    const from = placeOf(start)
    const to = placeOf(key)
    if (from === undefined || to === undefined) {
        const item = key.type === 'folder' ? folderItems.value.get(key.id) : undefined
        if (key.type === 'entry') toggleSelected(key.id)
        else if (item) toggleFolder(item)
        return
    }
    const low = Math.min(from, to)
    const high = Math.max(from, to)
    const within = (place: number | undefined) =>
        place !== undefined && place >= low && place <= high
    const folders = [...folderItems.value.values()].filter((item) => {
        const last = item.members.at(-1)
        return (
            within(placeOf(item)) &&
            within(last === undefined ? placeOf(item) : placeOf({ type: 'entry', id: last }))
        )
    })
    selecting.value = true
    anchor = start
    selected.value = new Set([
        ...rangeBase.entries,
        ...visibleIds.value.filter((id) => within(placeOf({ type: 'entry', id }))),
        // A collapsed folder brings its members along.
        ...folders.flatMap((item) => item.members),
    ])
    selectedFolders.value = unitsOf(
        [...rangeBase.folders, ...folders.map((item) => item.id)],
        selected.value,
    )
}

/** A folder's check: its own selection, or mixed while only members are. */
const folderChecked = (item: FolderItem) =>
    selectedFolders.value.has(item.id)
        ? true
        : item.members.some((id) => selected.value.has(id))
          ? ('mixed' as const)
          : false

const allChecked = computed(() =>
    selectionSize.value === 0
        ? false
        : selectionSize.value === allIds.value.length + allFolderIds.value.length
          ? true
          : ('mixed' as const),
)

/** Selects every entry and folder, or none when all already are. */
const toggleAll = () => {
    if (allChecked.value === true) setSelection([], [], anchor)
    else setSelection(allIds.value, allFolderIds.value, anchor)
}

// Rows that disappear, e.g. after an undo, leave the selection, and folders
// that gain unselected members stop being units.
watch(tree, () => {
    const ids = new Set(allIds.value)
    const entries = new Set([...selected.value].filter((id) => ids.has(id)))
    const folders = unitsOf(selectedFolders.value, entries)
    if (anchor && !exists(anchor)) anchor = undefined
    if (entries.size === selected.value.size && folders.size === selectedFolders.value.size) return
    selected.value = entries
    selectedFolders.value = folders
    const base = new Set([...rangeBase.entries].filter((id) => ids.has(id)))
    rangeBase = { entries: base, folders: unitsOf(rangeBase.folders, base) }
})

const onEntrySelect = (id: T, { range, toggle }: SelectModifiers) => {
    if (range) selectRange({ type: 'entry', id })
    else if (toggle || selecting.value) toggleSelected(id)
    else onSelect(id)
}

const onFolderSelect = (item: FolderItem, { toggle }: SelectModifiers) => {
    if (toggle) toggleFolder(item)
    else void onExpand(item.id, !isFolderExpanded(item.id))
}

const onBandSelect = () => {
    if (selecting.value) toggleAll()
    else onSelectAll()
}

const onMode = () => {
    if (selecting.value) stopSelecting()
    else startSelecting()
}

const onBulkVisibility = () => {
    const ids = selectedIds.value
    scope.value.setSomeShown(
        ids,
        ids.some((id) => !scope.value.isShown(id)),
    )
}

const selectionCount = computed(() =>
    label(i18n.value.workspace.manager.selecting, `${selectionSize.value}`),
)

// The selection bar shortens its count to the number, then drops its visibility
// button (still in More); without the button, the label returns if it fits.
const bar = useTemplateRef<HTMLElement>('bar')
const barLabel = shallowRef(true)
const barVisibility = shallowRef(true)
let barContext: CanvasRenderingContext2D | null | undefined
const measureBar = () => {
    const element = bar.value
    const count = element?.querySelector<HTMLElement>('.manager-selection-count')
    const round = element?.querySelector<HTMLElement>('.manager-bulk-move')
    const done = count?.parentElement
    if (!element || !count || !round || !done) return
    barContext ??= document.createElement('canvas').getContext('2d')
    if (!barContext) return
    const style = getComputedStyle(count)
    barContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const text = Math.ceil(barContext.measureText(selectionCount.value).width)
    const number = Math.ceil(barContext.measureText(`${selectionSize.value}`).width)
    const barStyle = getComputedStyle(element)
    const button = round.getBoundingClientRect().width + parseFloat(barStyle.columnGap)
    // Beside Move, Delete and More, less the Done button's own chrome.
    const room =
        element.clientWidth -
        parseFloat(barStyle.paddingLeft) -
        parseFloat(barStyle.paddingRight) -
        (done.getBoundingClientRect().width - count.clientWidth) -
        parseFloat(style.paddingLeft) -
        3 * button
    barVisibility.value = number + button <= room
    barLabel.value = text + (barVisibility.value ? button : 0) <= room
}
watch([bar, width, isCoarse, selectionCount], measureBar, { flush: 'post' })
onMounted(() => void document.fonts.ready.then(measureBar))

const bulkHidden = computed(() => selectedIds.value.some((id) => !scope.value.isShown(id)))

/** Deletes the selection; keyboard focus moves to the row taking the first deleted row's place. */
const onBulkDelete = async (keyboard = false) => {
    const ids = new Set(selectedIds.value)
    const folderIds = new Set(selectedFolderIds.value)
    if (!ids.size && !folderIds.size) return
    const objects = [...ids].reduce((sum, id) => sum + (counts.value.get(id) ?? 0), 0)
    // Empty folders go without asking, as from their own menus.
    const confirmed =
        !ids.size ||
        (await showModal(ConfirmModal, {
            title: () =>
                folderIds.size
                    ? label(strings.value.deleteSelectedFoldersTitle, `${folderIds.size}`)
                    : strings.value.deleteSelectedTitle,
            message: () =>
                folderIds.size
                    ? label(
                          strings.value.deleteSelectedFoldersMessage,
                          `${folderIds.size}`,
                          `${ids.size}`,
                          `${objects}`,
                      )
                    : label(strings.value.deleteSelectedMessage, `${ids.size}`, `${objects}`),
            confirm: () => i18n.value.modals.confirm.delete,
            destructive: true,
        }))
    if (!confirmed) return
    const index = [...(list.value?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].findIndex(
        (element) => {
            const key = keyOfRow(element)
            return key?.type === 'entry' ? ids.has(key.id) : !!key && folderIds.has(key.id)
        },
    )
    props.model.removeMany(ids, folderIds)
    stopSelecting()
    if (!keyboard) return
    await nextTick()
    if (!root.value?.contains(document.activeElement)) focusAfterDelete(index, '.manager-name')
}

/**
 * Moves every selected entry, selected folders' members too, since folders don't
 * nest; the folders stay put, and stay selected, emptied. By keyboard from a
 * row's menu, focus returns to that row's name.
 */
const onBulkFolder = async (choice: string, from?: RowKey) => {
    const ids = new Set(selectedIds.value)
    if (!ids.size) return
    if (choice === 'new') {
        stopSelecting()
        await onNewFolder(ids)
        return
    }
    folders.value.placeEntries(ids, choice === 'none' ? undefined : (Number(choice) as FolderId))
    await nextTick()
    const first = selectedIds.value[0]
    if (first !== undefined) reveal({ type: 'entry', id: first })
    if (from) focusShown(from, '.manager-name')
}

const onExpand = async (id: FolderId, expanded: boolean, keyboard = false) => {
    setFolderExpanded(id, expanded)
    if (!keyboard) return
    await nextTick()
    focusIn({ type: 'folder', id }, '.manager-name')
}

const onParent = (id: T) => {
    const folder = folderOfEntry.value.get(id)
    if (folder !== undefined) focusIn({ type: 'folder', id: folder }, '.manager-name')
}

// Rows scrolled under the band get a separator and fade out at its edge; rows
// hidden below fade out behind the floating Add.
const scrolled = shallowRef(false)
const hiddenBelow = shallowRef(false)
const onListScroll = () => {
    const element = list.value
    scrolled.value = (element?.scrollTop ?? 0) > 0
    hiddenBelow.value =
        !!element && element.scrollTop + element.clientHeight < element.scrollHeight - 1
}

const onAdd = async (event: MouseEvent) => {
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur()
    await addEntry()
}

/** Adds an entry, at the end or of an opened folder, and names it right away. */
const addEntry = async (folder?: FolderId) => {
    const id = props.model.add(folder)
    if (folder !== undefined) setFolderExpanded(folder, true)
    await nextTick()
    reveal({ type: 'entry', id })
    // Name the new entry right away: Enter or leaving keeps the typed name,
    // Escape keeps the generated one. The authoring target stays put.
    startRename({ type: 'entry', id })
}

/** Adds a folder, holding entries if given, and names it right away. */
const onNewFolder = async (held?: ReadonlySet<T>, event?: MouseEvent) => {
    if (event && event.detail > 0) (event.currentTarget as HTMLElement).blur()
    const id = folders.value.create(held)
    setFolderExpanded(id, true)
    await nextTick()
    reveal({ type: 'folder', id })
    startRename({ type: 'folder', id })
}

// Renaming

const renaming = shallowRef<RowKey>()

const startRename = (key: RowKey) => {
    closeMenu(false)
    renaming.value = key
}

const endRename = async (key: RowKey, value: string | undefined, keyboard: boolean) => {
    if (!sameKey(renaming.value, key)) return
    renaming.value = undefined
    if (value !== undefined) {
        if (key.type === 'entry') props.model.rename(key.id, value)
        else folders.value.rename(key.id, value)
    }
    if (!keyboard) return
    await nextTick()
    focusIn(key, '.manager-name')
}

const exists = (key: RowKey) =>
    key.type === 'entry' ? names.value.has(key.id) : folderItems.value.has(key.id)

// Rows added or removed change what lies below.
watch(tree, () => void nextTick(onListScroll), { flush: 'post' })

// Stop renaming a row that disappears, e.g. after an undo.
watch(tree, () => {
    if (renaming.value && !exists(renaming.value)) renaming.value = undefined
})

// Reordering by keyboard and drag

const reorder = async (key: RowKey, offset: -1 | 1) => {
    if (key.type === 'entry') props.model.move(key.id, offset)
    else folders.value.stepFolder(key.id, offset)
    await nextTick()
    reveal(key)
    focusIn(key, '.manager-name')
}

type RowInfo = {
    key: RowKey
    /** The folder holding an entry row. */
    folder?: FolderId
    top: number
    height: number
}

type Drag = {
    key: RowKey
    pointerId: number
    startY: number
    startScroll: number
    /** The furthest the rows scroll; the held row's offset must not extend it. */
    scrollLimit: number
    /** Rows in list content coordinates, untransformed, when last measured. */
    rows: RowInfo[]
    /** The dragged rows: the entry, or the folder with its shown members. */
    dragged: Set<string>
    gap: number
    offset: number
    /** Where the drop goes: into a folder, or before a remaining row (or at the end). */
    target: { into: FolderId } | { gap: number; end?: FolderId }
    started: boolean
}

const drag = shallowRef<Drag>()
const dragThreshold = 5
const rowGap = 4

const measureRows = (container: HTMLElement, translate: (key: string) => number) => {
    // Folder rows measure where they lie, not where they stick.
    container.classList.add('manager-entries-measuring')
    const bounds = container.getBoundingClientRect()
    const rows = [...container.querySelectorAll<HTMLElement>('[data-row]')].flatMap((element) => {
        const key = parseRowKey(element.dataset.row)
        if (!key) return []
        const rect = element.getBoundingClientRect()
        const folder = element.dataset.rowFolder
        return [
            {
                key,
                folder: folder === undefined ? undefined : (Number(folder) as FolderId),
                top:
                    rect.top -
                    bounds.top +
                    container.scrollTop -
                    translate(element.dataset.row ?? ''),
                height: rect.height,
            },
        ]
    })
    container.classList.remove('manager-entries-measuring')
    return rows
}

/** Every shown row's key by its `data-row` value. */
const rowKeys = computed(() => {
    const keys = new Map<string, RowKey>()
    const add = (key: RowKey) => keys.set(rowKey(key), key)
    for (const item of tree.value) {
        add(
            item.type === 'entry'
                ? { type: 'entry', id: item.id }
                : { type: 'folder', id: item.id },
        )
        if (item.type === 'folder') for (const id of item.members) add({ type: 'entry', id })
    }
    return keys
})

const parseRowKey = (value: string | undefined) =>
    value === undefined ? undefined : rowKeys.value.get(value)

const remaining = (current: Drag) =>
    current.rows.filter((row) => !current.dragged.has(rowKey(row.key)))
const draggedRows = (current: Drag) =>
    current.rows.filter((row) => current.dragged.has(rowKey(row.key)))

/** Top and height of the dragged block where it started. */
const blockOf = (current: Drag) => {
    const rows = draggedRows(current)
    const first = rows[0]
    const last = rows.at(-1)
    if (!first || !last) return { top: 0, height: 0 }
    return { top: first.top, height: last.top + last.height - first.top }
}

/** Translations that open a gap for the block, or close its old place. */
const translations = computed(() => {
    const current = drag.value
    const result = new Map<string, number>()
    if (!current?.started) return result
    const rows = remaining(current)
    const block = blockOf(current)
    let y = current.rows[0]?.top ?? 0
    rows.forEach((row, index) => {
        if ('gap' in current.target && current.target.gap === index) y += block.height + rowGap
        result.set(rowKey(row.key), y - row.top)
        y += row.height + rowGap
    })
    for (const key of current.dragged) result.set(key, current.offset)
    return result
})

// A row pushed down to open a slot also says by how much, so a member's guide
// line can reach back across the slot to the one above.
const rowStyle = (key: RowKey) => {
    const value = translations.value.get(rowKey(key))
    return value
        ? { transform: `translateY(${value}px)`, '--row-shift': `${Math.max(0, value)}px` }
        : undefined
}

const isTopLevel = (row: RowInfo | undefined) => row?.folder === undefined

/** The drop target for the block's current position. */
const targetOf = (current: Drag): Drag['target'] => {
    const rows = remaining(current)
    // Where the held row is, not the block: a folder's members trail below it.
    const held = current.rows.find((row) => sameKey(row.key, current.key))
    const center = (held ? held.top + held.height / 2 : 0) + current.offset

    // An entry over the middle of a folder row joins that folder.
    if (current.key.type === 'entry') {
        const over = rows.find(
            (row) =>
                row.key.type === 'folder' &&
                center > row.top + row.height / 4 &&
                center < row.top + (row.height * 3) / 4,
        )
        if (over) return { into: over.key.id as FolderId }
    }

    const gap = rows.filter((row) => row.top + row.height / 2 < center).length
    if (current.key.type === 'entry') {
        // Just below a folder's last member, the upper half joins it at its end.
        const last = rows[gap - 1]
        if (
            last?.folder !== undefined &&
            rows[gap]?.folder !== last.folder &&
            center < last.top + last.height + rowGap / 2
        )
            return { gap, end: last.folder }
        return { gap }
    }

    // A folder only lands between top-level items.
    let below = gap
    while (!isTopLevel(rows[below])) below++
    let above = gap
    while (above > 0 && !isTopLevel(rows[above])) above--
    return { gap: gap - above < below - gap ? above : below }
}

const onDragStart = (key: RowKey, event: PointerEvent) => {
    const container = list.value
    if (event.button !== 0 || renaming.value !== undefined || !container) return
    const rows = measureRows(container, () => 0)
    if (rows.length < 2) return
    const dragged = new Set([rowKey(key)])
    if (key.type === 'folder')
        for (const row of rows) if (row.folder === key.id) dragged.add(rowKey(row.key))
    drag.value = {
        key,
        pointerId: event.pointerId,
        startY: event.clientY,
        startScroll: container.scrollTop,
        scrollLimit: container.scrollHeight - container.clientHeight,
        rows,
        dragged,
        gap: rowGap,
        offset: 0,
        target: { gap: -1 },
        started: false,
    }
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('pointercancel', onDragCancel)
    window.addEventListener('keydown', onDragKeydown, true)
}

/**
 * Rows snap to their new places on drop. Clearing the offsets would otherwise
 * glide them back, leaving rows briefly away from where they are, under the
 * pointer's next press. Run after the update, which starts those glides.
 */
const settleRows = () => {
    for (const row of list.value?.querySelectorAll<HTMLElement>('[data-row]') ?? [])
        for (const animation of row.getAnimations()) animation.cancel()
}

const stopDragListeners = () => {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragCancel)
    window.removeEventListener('keydown', onDragKeydown, true)
    clearTimeout(expandTimer)
    cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
}

// Holding a dragged entry over a collapsed folder opens it.
let expandTimer = 0
let expandFolder: FolderId | undefined
const expandDelay = 600

const scheduleExpand = (folder: FolderId | undefined) => {
    if (folder === expandFolder) return
    clearTimeout(expandTimer)
    expandFolder = folder
    if (folder === undefined || isFolderExpanded(folder)) return
    expandTimer = window.setTimeout(async () => {
        setFolderExpanded(folder, true)
        await nextTick()
        const current = drag.value
        const container = list.value
        if (!current || !container) return
        // Rows moved; measure again without the transforms in place.
        const shift = translations.value
        const rows = measureRows(container, (key) => shift.get(key) ?? 0)
        // A held row below the folder moved down with it; keep it under the pointer.
        const topOf = (list: RowInfo[]) =>
            list.find((row) => sameKey(row.key, current.key))?.top ?? 0
        const moved = topOf(rows) - topOf(current.rows)
        const bottom = (list: RowInfo[]) => Math.max(...list.map((row) => row.top + row.height))
        const next = {
            ...current,
            rows,
            startY: current.startY + moved,
            offset: current.offset - moved,
            scrollLimit: current.scrollLimit + bottom(rows) - bottom(current.rows),
        }
        next.target = targetOf(next)
        drag.value = next
    }, expandDelay)
}

const onDragMove = (event: PointerEvent) => {
    const current = drag.value
    const container = list.value
    if (!current || !container || event.pointerId !== current.pointerId) return
    if (!current.started) {
        if (Math.abs(event.clientY - current.startY) < dragThreshold) return
        closeMenu(false)
    }
    event.preventDefault()
    pointerY = event.clientY
    follow()
    if (!scrollFrame) edgeScroll()
}

/** Moves the held block to the pointer and finds its drop target. */
const follow = () => {
    const current = drag.value
    const container = list.value
    if (!current || !container) return
    const offset = pointerY - current.startY + container.scrollTop - current.startScroll
    const next = { ...current, offset, started: true }
    next.target = targetOf(next)
    drag.value = next
    scheduleExpand('into' in next.target ? next.target.into : undefined)
}

// Scroll the list while the pointer rests near its edges.
let pointerY = 0
let scrollFrame = 0

const edgeScroll = () => {
    scrollFrame = 0
    const container = list.value
    const current = drag.value
    if (!current?.started || !container) return
    const bounds = container.getBoundingClientRect()
    const step = pointerY < bounds.top + 24 ? -8 : pointerY > bounds.bottom - 24 ? 8 : 0
    const before = container.scrollTop
    container.scrollTop = Math.max(0, Math.min(before + step, current.scrollLimit))
    if (container.scrollTop === before) return
    follow()
    scrollFrame = requestAnimationFrame(edgeScroll)
}

// A drag ends with a click on whatever is under the pointer; swallow it so
// dropping on a name does not also select that entry.
const swallowClick = (event: MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
}

const refOf = (row: RowInfo | undefined): FolderTreeRef<T> | undefined =>
    row &&
    (row.key.type === 'entry'
        ? { type: 'entry', id: row.key.id }
        : { type: 'folder', id: row.key.id })

/** Where a dragged entry lands. */
const entryPlace = (current: Drag): EntryPlace<T> => {
    const { target } = current
    if ('into' in target) return { folder: target.into }
    if (target.end !== undefined) return { folder: target.end }
    const next = remaining(current)[target.gap]
    // Before a member: into its folder there. Otherwise loose, before the row.
    return next?.folder !== undefined && next.key.type === 'entry'
        ? { folder: next.folder, before: next.key.id }
        : { before: refOf(next) }
}

const onDragEnd = (event: PointerEvent) => {
    const current = drag.value
    if (current?.pointerId !== event.pointerId) return
    stopDragListeners()
    expandFolder = undefined
    drag.value = undefined
    void nextTick(settleRows)
    if (!current.started) return
    window.addEventListener('click', swallowClick, { capture: true, once: true })
    setTimeout(() => {
        window.removeEventListener('click', swallowClick, true)
    }, 0)

    const { key, target } = current
    if (key.type === 'folder') {
        if (!('gap' in target)) return
        const next = remaining(current)[target.gap]
        folders.value.placeFolder(key.id, refOf(next))
        return
    }
    folders.value.placeEntry(key.id, entryPlace(current))
}

const onDragCancel = () => {
    stopDragListeners()
    expandFolder = undefined
    drag.value = undefined
    void nextTick(settleRows)
}

const onDragKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !drag.value?.started) return
    event.preventDefault()
    event.stopPropagation()
    onDragCancel()
}

onUnmounted(stopDragListeners)

// Cancel a drag whose rows change underneath it, e.g. after an undo.
watch(tree, () => {
    if (drag.value) onDragCancel()
})

const isDragged = (key: RowKey) => !!drag.value?.started && drag.value.dragged.has(rowKey(key))
const isDroppingInto = computed(() => {
    const target = drag.value?.started ? drag.value.target : undefined
    return !!target && 'into' in target
})
/** A held entry between rows takes the indent of where it lands. */
const heldIndented = computed(() => {
    const current = drag.value
    if (!current?.started || current.key.type !== 'entry' || 'into' in current.target) return
    return entryPlace(current).folder !== undefined
})
const isDropTarget = (id: FolderId) => {
    const target = drag.value?.started ? drag.value.target : undefined
    return !!target && 'into' in target && target.into === id
}

// Actions and the menu

const menu = shallowRef<{
    key: MenuKey
    anchor: HTMLElement
    modals: number
    /** The menu's own actions, or the folder choice for an entry. */
    mode: 'main' | 'folders'
    /** Opened by a long press, so its first item takes no keyboard highlight. */
    touch?: boolean
}>()

/** Common actions are one click away on panels with room for them. */
// One array for every row, so unrelated renders leave rows alone.
const inlineActions = computed((): ManagerRowAction[] => [
    { key: 'properties', label: strings.value.properties, icon: PropertiesIcon },
])
const noActions: ManagerRowAction[] = []

const entryMenuItems = (id: T): ManagerMenuItem[] => {
    const manager = i18n.value.workspace.manager
    // Actions offered inline are not repeated here.
    const items: ManagerMenuItem[] = [
        { key: 'rename', label: manager.rename, icon: RenameIcon },
        ...(hasInline(id)
            ? []
            : [{ key: 'properties', label: strings.value.properties, icon: PropertiesIcon }]),
        { key: 'duplicate', label: manager.duplicate, icon: CopyIcon },
        {
            key: 'solo',
            label: isOnlyShown([id]) ? strings.value.showAll : manager.solo,
            icon: VisibleIcon,
            separated: true,
        },
        {
            key: 'select',
            label: manager.select,
            icon: SelectIcon,
            disabled: !hasVisibleOwned(props.model.owner, id),
        },
        { key: 'selectMultiple', label: manager.selectMultiple, icon: SelectMultipleIcon },
    ]
    if (canMoveSelectionTo(props.model.owner, id))
        items.push({ key: 'moveSelection', label: manager.moveSelection, icon: MoveHereIcon })
    items.push(
        {
            key: 'moveUp',
            label: strings.value.moveUp,
            icon: MoveUpIcon,
            disabled: !folders.value.canStepEntry(id, -1),
            separated: true,
        },
        {
            key: 'moveDown',
            label: strings.value.moveDown,
            icon: MoveDownIcon,
            disabled: !folders.value.canStepEntry(id, 1),
        },
        { key: 'moveToFolder', label: i18n.value.workspace.folders.moveTo, icon: FolderIcon },
        { key: 'delete', label: strings.value.delete, icon: ResetIcon, destructive: true },
    )
    return items
}

const folderChoiceItems = (id: T): ManagerMenuItem[] => {
    const current = folderOfEntry.value.get(id)
    return [
        {
            key: 'folder:none',
            label: i18n.value.workspace.folders.none,
            checked: current === undefined,
        },
        ...[...folderItems.value.keys()].map((folder) => ({
            key: `folder:${String(folder)}`,
            label: folderName(folder),
            title: folderName(folder),
            checked: current === folder,
        })),
        {
            key: 'folder:new',
            label: i18n.value.workspace.folders.newWith,
            icon: FolderPlusIcon,
            separated: true,
        },
    ]
}

const folderMenuItems = (item: FolderItem): ManagerMenuItem[] => {
    const manager = i18n.value.workspace.manager
    const folderStrings = i18n.value.workspace.folders
    return [
        { key: 'add', label: strings.value.add, icon: AddIcon },
        { key: 'rename', label: manager.rename, icon: RenameIcon },
        { key: 'duplicate', label: manager.duplicate, icon: CopyIcon },
        {
            key: 'solo',
            label: isOnlyShown(item.members) ? strings.value.showAll : manager.solo,
            icon: VisibleIcon,
            separated: true,
            disabled: !item.members.length,
        },
        {
            key: 'select',
            label: manager.select,
            icon: SelectIcon,
            disabled: !hasVisibleOwned(props.model.owner, new Set(item.members)),
        },
        { key: 'selectMultiple', label: manager.selectMultiple, icon: SelectMultipleIcon },
        {
            key: 'moveUp',
            label: folderStrings.moveUp,
            icon: MoveUpIcon,
            disabled: !folders.value.canStepFolder(item.id, -1),
            separated: true,
        },
        {
            key: 'moveDown',
            label: folderStrings.moveDown,
            icon: MoveDownIcon,
            disabled: !folders.value.canStepFolder(item.id, 1),
        },
        { key: 'ungroup', label: folderStrings.ungroup, icon: FolderOpenIcon },
        {
            key: 'delete',
            label: strings.value.deleteFolder,
            icon: ResetIcon,
            destructive: true,
        },
    ]
}

/** Actions on the selection; the bar offers the common ones too. */
const bulkMenuItems = (): ManagerMenuItem[] => {
    const manager = i18n.value.workspace.manager
    const ids = selectedIds.value
    const none = !selectionSize.value
    return [
        {
            key: 'visibility',
            label: bulkHidden.value ? manager.showSelected : manager.hideSelected,
            icon: bulkHidden.value ? VisibleIcon : HiddenIcon,
            disabled: !ids.length,
        },
        {
            key: 'solo',
            label: isOnlyShown(ids) ? strings.value.showAll : manager.soloSelected,
            icon: VisibleIcon,
            disabled: !ids.length,
        },
        {
            key: 'select',
            label: manager.select,
            icon: SelectIcon,
            disabled: !hasVisibleOwned(props.model.owner, new Set(ids)),
        },
        {
            key: 'moveToFolder',
            label: i18n.value.workspace.folders.moveTo,
            icon: FolderIcon,
            disabled: !selectedIds.value.length,
            separated: true,
        },
        { key: 'duplicate', label: manager.duplicateSelected, icon: CopyIcon, disabled: none },
        allChecked.value === true
            ? { key: 'selectNone', label: manager.selectNone, icon: SelectMultipleIcon }
            : { key: 'selectAll', label: manager.selectAll, icon: SelectMultipleIcon },
        {
            key: 'delete',
            label: manager.deleteSelected,
            icon: ResetIcon,
            destructive: true,
            disabled: none,
        },
    ]
}

/** Folders for the selection, checked when all of it is in one already. */
const bulkFolderItems = (): ManagerMenuItem[] => {
    const holders = new Set(selectedIds.value.map((id) => folderOfEntry.value.get(id)))
    const only = holders.size === 1 ? { folder: [...holders][0] } : undefined
    return [
        {
            key: 'folder:none',
            label: i18n.value.workspace.folders.none,
            checked: !!only && only.folder === undefined,
        },
        ...[...folderItems.value.keys()].map((folder) => ({
            key: `folder:${String(folder)}`,
            label: folderName(folder),
            title: folderName(folder),
            checked: only?.folder === folder,
        })),
        {
            key: 'folder:new',
            label: i18n.value.workspace.folders.newWith,
            icon: FolderPlusIcon,
            separated: true,
        },
    ]
}

const menuItems = computed((): ManagerMenuItem[] => {
    const current = menu.value
    if (!current) return []
    const { key } = current
    if (key.type === 'selection')
        return current.mode === 'folders' ? bulkFolderItems() : bulkMenuItems()
    if (key.type === 'folder') {
        const item = folderItems.value.get(key.id)
        return item ? folderMenuItems(item) : []
    }
    return current.mode === 'folders' ? folderChoiceItems(key.id) : entryMenuItems(key.id)
})

const menuLabel = computed(() => {
    const current = menu.value
    if (!current) return ''
    if (current.mode === 'folders') return i18n.value.workspace.folders.moveTo
    if (current.key.type === 'selection') return i18n.value.workspace.manager.selectionActions
    const name =
        current.key.type === 'entry'
            ? (names.value.get(current.key.id) ?? '')
            : folderName(current.key.id)
    return label(i18n.value.workspace.manager.actions, name)
})

const onMenu = (key: RowKey, anchor: HTMLElement, touch = false) => {
    if (menu.value && sameKey(menu.value.key, key)) closeMenu(false)
    else menu.value = { key, anchor, modals: modals.length, mode: 'main', touch }
}

/** Whether the selection's menu is open from the bar button with this class. */
const bulkMenuFrom = (name: string) =>
    menu.value?.key.type === 'selection' && menu.value.anchor.classList.contains(name)

const openBulkMenu = (anchor: HTMLElement, mode: 'main' | 'folders', touch = false) => {
    menu.value = { key: { type: 'selection' }, anchor, modals: modals.length, mode, touch }
}

const onBulkMenu = (anchor: HTMLElement, mode: 'main' | 'folders', touch = false) => {
    const current = menu.value
    if (current?.key.type === 'selection' && current.anchor === anchor && current.mode === mode)
        closeMenu(false)
    else openBulkMenu(anchor, mode, touch)
}

/** A row's own menu while selecting acts on the selection, joined by that row. */
const onRowBulkMenu = (key: RowKey, button: HTMLElement, touch: boolean) => {
    if (key.type === 'entry') {
        if (!selected.value.has(key.id))
            setSelection([...selected.value, key.id], selectedFolders.value, key)
    } else if (!selectedFolders.value.has(key.id)) {
        const item = folderItems.value.get(key.id)
        if (item) toggleFolder(item)
    }
    // Opening never toggles, as on rows not selecting.
    if (menu.value?.key.type !== 'selection' || menu.value.anchor !== button)
        openBulkMenu(button, 'main', touch)
}

function closeMenu(restoreFocus: boolean) {
    const current = menu.value
    if (!current) return
    menu.value = undefined
    // Never take focus from a dialog that opened meanwhile.
    if (!restoreFocus || modals.length > current.modals || !current.anchor.isConnected) return
    focusableOf(current.anchor)?.focus({ preventScroll: true })
}

/** A button anchor, or for a row anchor while selecting, its name or check. */
const focusableOf = (anchor: HTMLElement) =>
    [
        anchor,
        anchor.querySelector<HTMLElement>('.manager-name'),
        anchor.querySelector<HTMLElement>('.manager-check'),
    ].find(
        (element): element is HTMLElement =>
            element instanceof HTMLButtonElement && !element.disabled,
    )

// Close when the anchor row disappears, e.g. after an undo.
watch(tree, () => {
    const key = menu.value?.key
    if (key && key.type !== 'selection' && !exists(key)) closeMenu(false)
})

const focusAfterDelete = (index: number, selector = '.manager-more') => {
    const rows = [...(list.value?.querySelectorAll<HTMLElement>('[data-row]') ?? [])]
    const row = rows[Math.min(index, rows.length - 1)]
    const target =
        row?.querySelector<HTMLElement>(selector) ??
        root.value?.querySelector<HTMLElement>('.manager-name')
    target?.focus({ preventScroll: true })
}

const rowIndex = (key: RowKey) =>
    [...(list.value?.querySelectorAll<HTMLElement>('[data-row]') ?? [])].findIndex(
        (element) => element.dataset.row === rowKey(key),
    )

const onMenuSelect = (key: string, keyboard: boolean) => {
    const current = menu.value
    if (!current) return
    // The folder choice replaces the menu's items in place.
    if (key === 'moveToFolder') {
        menu.value = { ...current, mode: 'folders' }
        return
    }
    closeMenu(keyboard)
    if (current.key.type === 'selection')
        void runBulk(key, keyboard, keyboard ? keyOfRow(current.anchor) : undefined)
    else void run(current.key, key, keyboard, current.anchor)
}

const onInlineAction = (id: T, key: string, button: HTMLElement, keyboard: boolean) => {
    closeMenu(false)
    void run({ type: 'entry', id }, key, keyboard, button)
}

const runBulk = async (action: string, keyboard: boolean, from?: RowKey) => {
    if (action.startsWith('folder:')) {
        await onBulkFolder(action.slice('folder:'.length), from)
        return
    }
    switch (action) {
        case 'visibility':
            onBulkVisibility()
            return
        case 'solo':
            solo(selectedIds.value)
            return
        case 'select':
            selectOwned(props.model.owner, new Set(selectedIds.value))
            return
        case 'duplicate': {
            // The copies become the selection, ready to move together; a
            // selected folder is copied whole.
            const copies = folders.value.duplicateMany(
                looseSelectedIds.value,
                selectedFolderIds.value,
            )
            const [folder] = copies.folders
            const [entry] = copies.entries
            if (folder === undefined && entry === undefined) return
            setSelection(copies.entries, copies.folders)
            await nextTick()
            if (folder !== undefined) reveal({ type: 'folder', id: folder })
            else if (entry !== undefined) reveal({ type: 'entry', id: entry })
            return
        }
        case 'selectAll':
            setSelection(allIds.value, allFolderIds.value, anchor)
            return
        case 'selectNone':
            setSelection([])
            return
        case 'delete':
            await onBulkDelete(keyboard)
            return
    }
}

/** Runs an action; keyboard users keep focus on `anchor` where it remains. */
const run = async (key: RowKey, action: string, keyboard: boolean, anchor: HTMLElement) => {
    const index = rowIndex(key)
    if (action.startsWith('folder:') && key.type === 'entry') {
        await chooseFolder(key.id, action.slice('folder:'.length), keyboard)
        return
    }
    switch (action) {
        case 'add':
            if (key.type === 'folder') await addEntry(key.id)
            return
        case 'rename':
            startRename(key)
            return
        case 'selectMultiple':
            if (key.type === 'entry') startSelecting([key.id])
            else startSelecting(folderItems.value.get(key.id)?.members ?? [], [key.id])
            // The row trades its ••• for a check.
            if (!keyboard) return
            await nextTick()
            focusIn(key, '.manager-check')
            return
        case 'properties':
            if (key.type === 'entry') props.model.openProperties(key.id)
            return
        case 'duplicate':
            await duplicateRow(key)
            return
        case 'solo':
            solo(key.type === 'entry' ? [key.id] : (folderItems.value.get(key.id)?.members ?? []))
            return
        case 'select':
            selectOwned(
                props.model.owner,
                key.type === 'entry'
                    ? key.id
                    : new Set(folderItems.value.get(key.id)?.members ?? []),
            )
            return
        case 'moveSelection':
            if (key.type === 'entry') await moveSelectionTo(props.model.owner, key.id)
            return
        case 'moveUp':
        case 'moveDown': {
            const offset = action === 'moveUp' ? -1 : 1
            if (key.type === 'entry') props.model.move(key.id, offset)
            else folders.value.stepFolder(key.id, offset)
            await nextTick()
            reveal(key)
            // Reordering may move the focused button within the document, and a
            // move to either end disables that direction's button.
            if (keyboard) {
                const target =
                    anchor.isConnected && !(anchor as HTMLButtonElement).disabled
                        ? anchor
                        : rowOf(key)?.querySelector<HTMLElement>('.manager-more')
                if (target && document.activeElement !== target)
                    target.focus({ preventScroll: true })
            }
            return
        }
        case 'ungroup':
            if (key.type === 'folder') folders.value.ungroup(key.id)
            if (!keyboard) return
            await nextTick()
            focusAfterDelete(index)
            return
        case 'delete':
            if (key.type === 'entry') props.model.remove(key.id)
            else await folders.value.remove(key.id)
            if (!keyboard) return
            await nextTick()
            focusAfterDelete(index)
            return
    }
}

/** Duplicates a row and names the copy right away, as Add does. */
const duplicateRow = async (key: RowKey) => {
    let copy: RowKey | undefined
    if (key.type === 'entry') {
        const [id] = folders.value.duplicate(new Set([key.id]))
        if (id !== undefined) copy = { type: 'entry', id }
    } else {
        const id = folders.value.duplicateFolder(key.id)
        if (id !== undefined) {
            setFolderExpanded(id, true)
            copy = { type: 'folder', id }
        }
    }
    if (!copy) return
    await nextTick()
    reveal(copy)
    startRename(copy)
}

/** Moves an entry; by keyboard, focus stays on its •••, as for Move Up and Down. */
const chooseFolder = async (id: T, choice: string, keyboard: boolean) => {
    if (choice === 'new') {
        await onNewFolder(new Set([id]))
        return
    }
    if (choice === 'none') {
        const folder = folderOfEntry.value.get(id)
        if (folder === undefined) return
        // Out of the folder, just below it.
        const at = tree.value.findIndex((item) => item.type === 'folder' && item.id === folder)
        const after = tree.value[at + 1]
        folders.value.placeEntry(id, {
            before: after && ({ type: after.type, id: after.id } as FolderTreeRef<T>),
        })
    } else {
        const folder = Number(choice) as FolderId
        // Its own folder is already checked.
        if (folderOfEntry.value.get(id) === folder) return
        folders.value.placeEntry(id, { folder })
    }
    await nextTick()
    reveal({ type: 'entry', id })
    if (keyboard) focusShown({ type: 'entry', id }, '.manager-more')
}

// Row bindings shared by loose entries and folder members.

/** While selecting, rows trade their eye for a check and set their other actions aside. */
const selectingProps = (checked: boolean | 'mixed', name: string) =>
    selecting.value
        ? {
              selecting: true,
              checked,
              checkLabel: label(i18n.value.workspace.manager.selectItem, name),
              actions: noActions,
              menuLabel: undefined,
              renameLabel: undefined,
              dragLabel: undefined,
              gripSpace: hasGrip.value,
          }
        : {}

const entryProps = (id: T, name: string) => ({
    name,
    nameTitle:
        focused.value === id
            ? label(i18n.value.workspace.manager.target, entryTitle(id, name))
            : entryTitle(id, name),
    current: focused.value === id,
    shown: scope.value.isShown(id),
    muted: !scope.value.isShown(id),
    eyeLabel: label(
        scope.value.isShown(id)
            ? i18n.value.workspace.manager.hide
            : i18n.value.workspace.manager.show,
        name,
    ),
    eyeTitle: `${label(
        scope.value.isShown(id)
            ? i18n.value.workspace.manager.hide
            : i18n.value.workspace.manager.show,
        name,
    )}\n${i18n.value.workspace.manager.soloHint}`,
    meta: `${counts.value.get(id) ?? 0}`,
    metaTitle: label(i18n.value.workspace.manager.objects, `${counts.value.get(id) ?? 0}`),
    actions: inlineActions.value,
    inline: inlineMode.value,
    menuLabel: label(i18n.value.workspace.manager.actions, name),
    menuOpen: sameKey(menu.value?.key, { type: 'entry', id }),
    renaming: sameKey(renaming.value, { type: 'entry', id }),
    renameLabel: i18n.value.modals.form.name.label,
    dragLabel: label(i18n.value.workspace.manager.drag, name),
    dragging: isDragged({ type: 'entry', id }),
    noGrip: !hasGrip.value,
    indented:
        (isDragged({ type: 'entry', id }) ? heldIndented.value : undefined) ??
        folderOfEntry.value.has(id),
    ...selectingProps(selected.value.has(id), name),
})

const entryHandlers = (id: T) => {
    const key: RowKey = { type: 'entry', id }
    return {
        select: (modifiers: SelectModifiers) => {
            onEntrySelect(id, modifiers)
        },
        toggle: (soloed: boolean) => {
            onToggle(id, soloed)
        },
        check: (range: boolean) => {
            if (range) selectRange(key)
            else toggleSelected(id)
        },
        action: (action: string, button: HTMLElement, keyboard: boolean) => {
            onInlineAction(id, action, button, keyboard)
        },
        menu: (anchor: HTMLElement, touch: boolean) => {
            if (selecting.value) onRowBulkMenu(key, anchor, touch)
            else onMenu(key, anchor, touch)
        },
        renameStart: () => {
            startRename(key)
        },
        renameEnd: (value: string | undefined, keyboard: boolean) =>
            endRename(key, value, keyboard),
        dragStart: (event: PointerEvent) => {
            onDragStart(key, event)
        },
        reorder: (offset: -1 | 1) => reorder(key, offset),
        parent: () => {
            onParent(id)
        },
    }
}

/**
 * A collapsed folder holding the target stands in for it with the target's
 * pill, as outline views do, so the target never drops out of sight.
 */
/** Whether the authoring target is one of a folder's members. */
const containsTarget = (item: FolderItem) =>
    focused.value !== undefined && item.members.includes(focused.value)

/** A collapsed folder stands in for the target it hides. */
const holdsTarget = (item: FolderItem) => !isFolderExpanded(item.id) && containsTarget(item)

/** Names the target a folder holds, for its tooltip and screen readers. */
const targetDescription = (item: FolderItem) => {
    const id = focused.value
    if (!containsTarget(item) || id === undefined) return
    return label(i18n.value.workspace.manager.target, entryTitle(id, names.value.get(id) ?? ''))
}

const folderTitle = (item: FolderItem) => {
    const toggle = label(
        isFolderExpanded(item.id)
            ? i18n.value.workspace.folders.collapse
            : i18n.value.workspace.folders.expand,
        folderName(item.id),
    )
    const description = targetDescription(item)
    return description === undefined
        ? toggle
        : `${toggle}
${description}`
}

const folderEyeLabel = (item: FolderItem) =>
    label(
        !item.members.length
            ? i18n.value.workspace.folders.empty
            : shownMembers(item).length < item.members.length
              ? i18n.value.workspace.manager.show
              : i18n.value.workspace.manager.hide,
        folderName(item.id),
    )
</script>

<template>
    <div
        ref="root"
        class="manager-list flex min-h-0 flex-col text-fg"
        :class="{ 'manager-list-selecting': selecting }"
        @keydown="onKeydown"
    >
        <div
            class="manager-band relative z-10 shrink-0 bg-header px-1.5 py-1 [@media(pointer:coarse)]:py-0.5"
            :class="{ 'manager-band-raised': scrolled }"
            :style="{ paddingRight: gutterPadding }"
        >
            <ManagerRow
                class="manager-all"
                heading
                :name="strings.all"
                :name-title="strings.all"
                :current="focused === undefined"
                :shown="scope.shownCount.value > 0"
                :partial="scope.shownCount.value > 0 && !allShown"
                :grip-space="hasGrip"
                :muted="false"
                :eye-label="allShown ? strings.hideAll : strings.showAll"
                :meta="allShown ? undefined : `${scope.shownCount.value}/${scope.totalCount.value}`"
                :mode-label="i18n.workspace.manager.selectMultiple"
                :mode-active="selecting"
                :selecting
                :checked="allChecked"
                :check-label="i18n.workspace.manager.selectAll"
                @select="onBandSelect"
                @toggle="onToggleAll"
                @check="toggleAll"
                @mode="onMode"
            />
        </div>
        <div class="relative flex min-h-0 flex-1 flex-col">
            <ul
                ref="list"
                class="manager-entries overlay-scroller relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-1.5 pt-1.5"
                :class="{
                    'manager-entries-dragging': drag?.started,
                    'manager-entries-scrolled': scrolled,
                    'manager-entries-more':
                        (stickyAdd || selecting) && hiddenBelow && !drag?.started,
                    'manager-entries-floating': stickyAdd || selecting,
                }"
                :style="{ paddingRight: gutterPadding }"
                @scroll.passive="onListScroll"
            >
                <template v-for="item in tree" :key="`${item.type}${item.id}`">
                    <li
                        v-if="item.type === 'entry'"
                        :data-row="`e${item.id}`"
                        :data-entry-id="item.id"
                        :class="{
                            'manager-dragged relative z-20': isDragged(item),
                            'manager-dragged-over': isDragged(item) && isDroppingInto,
                            'manager-dragged-in': isDragged(item) && heldIndented,
                        }"
                        :style="rowStyle(item)"
                    >
                        <ManagerRow
                            class="manager-entry"
                            v-bind="entryProps(item.id, names.get(item.id) ?? '')"
                            v-on="entryHandlers(item.id)"
                        />
                    </li>
                    <li
                        v-else
                        class="manager-folder flex flex-col gap-1"
                        :class="{ 'manager-dragged relative z-20': isDragged(item) }"
                    >
                        <div
                            class="manager-folder-head"
                            :data-row="`f${item.id}`"
                            :data-folder-id="item.id"
                            :style="rowStyle(item)"
                        >
                            <ManagerRow
                                class="manager-folder-row"
                                :name="folderName(item.id)"
                                :name-title="folderTitle(item)"
                                :current="holdsTarget(item)"
                                :description="targetDescription(item)"
                                folder
                                :expanded="isFolderExpanded(item.id)"
                                :controls="item.members.length ? membersId(item.id) : undefined"
                                :shown="shownMembers(item).length > 0 || !item.members.length"
                                :partial="
                                    shownMembers(item).length > 0 &&
                                    shownMembers(item).length < item.members.length
                                "
                                :muted="item.members.length > 0 && !shownMembers(item).length"
                                :eye-label="folderEyeLabel(item)"
                                :eye-title="
                                    item.members.length
                                        ? `${folderEyeLabel(item)}\n${i18n.workspace.manager.soloHint}`
                                        : folderEyeLabel(item)
                                "
                                :eye-disabled="!item.members.length"
                                :meta="`${folderCount(item)}`"
                                :meta-title="
                                    label(i18n.workspace.manager.objects, `${folderCount(item)}`)
                                "
                                :menu-label="
                                    label(i18n.workspace.manager.actions, folderName(item.id))
                                "
                                :menu-open="sameKey(menu?.key, item)"
                                :renaming="sameKey(renaming, item)"
                                :rename-label="i18n.modals.form.name.label"
                                :drag-label="
                                    label(i18n.workspace.manager.drag, folderName(item.id))
                                "
                                :dragging="isDragged(item)"
                                :drop-target="isDropTarget(item.id)"
                                :no-grip="!hasGrip"
                                v-bind="selectingProps(folderChecked(item), folderName(item.id))"
                                @select="onFolderSelect(item, $event)"
                                @toggle="onToggleFolder(item, $event)"
                                @check="toggleFolder(item)"
                                @menu="
                                    (anchor, touch) =>
                                        selecting
                                            ? onRowBulkMenu(item, anchor, touch)
                                            : onMenu(item, anchor, touch)
                                "
                                @rename-start="startRename(item)"
                                @rename-end="(value, keyboard) => endRename(item, value, keyboard)"
                                @drag-start="onDragStart(item, $event)"
                                @reorder="reorder(item, $event)"
                                @expand="onExpand(item.id, $event, true)"
                            />
                        </div>
                        <ul
                            v-if="isFolderExpanded(item.id) && item.members.length"
                            :id="membersId(item.id)"
                            class="manager-members relative flex flex-col gap-1"
                            :aria-label="folderName(item.id)"
                        >
                            <li
                                v-for="id in item.members"
                                :key="id"
                                :data-row="`e${id}`"
                                :data-row-folder="item.id"
                                :data-entry-id="id"
                                :class="{
                                    'manager-dragged z-20': isDragged({ type: 'entry', id }),
                                    'manager-dragged-over':
                                        isDragged({ type: 'entry', id }) && isDroppingInto,
                                    'manager-dragged-in':
                                        isDragged({ type: 'entry', id }) && heldIndented,
                                }"
                                :style="rowStyle({ type: 'entry', id })"
                            >
                                <ManagerRow
                                    class="manager-entry"
                                    v-bind="entryProps(id, names.get(id) ?? '')"
                                    v-on="entryHandlers(id)"
                                />
                            </li>
                        </ul>
                    </li>
                </template>
                <!-- In a short panel Add follows the rows. -->
                <li
                    v-if="!stickyAdd && !selecting"
                    class="manager-footer pointer-events-none -mx-1.5 flex items-center gap-1.5 px-1.5 pb-2 pt-3"
                    :style="{ marginRight: gutterPadding && `-${gutterPadding}` }"
                >
                    <ManagerAddButton :label="strings.add" @click="onAdd" />
                    <button
                        type="button"
                        class="manager-new-folder"
                        :aria-label="i18n.workspace.folders.new"
                        :title="i18n.workspace.folders.new"
                        @click="onNewFolder(undefined, $event)"
                    >
                        <FolderPlusIcon class="manager-new-folder-icon" aria-hidden="true" />
                    </button>
                </li>
            </ul>
            <OverlayScrollbar :target="list" />
            <!-- Otherwise it floats in reach over the list, which leaves room below
        its last row and fades rows out behind it only while more lie below.
        The buttons are the only things drawn here. -->
            <!-- While selecting, the selection's actions take its place, pinned in reach. -->
            <div
                v-if="selecting"
                ref="bar"
                class="manager-footer manager-footer-floating manager-selection-bar pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex items-center gap-1.5 px-1.5 pb-2"
            >
                <button
                    type="button"
                    class="manager-selection-done pointer-events-auto flex min-w-0 items-center rounded-full bg-button p-0.5 pr-4 shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:shadow-accent"
                    :aria-label="selectionCount"
                    :title="i18n.workspace.manager.stopSelecting"
                    @click="onDone"
                >
                    <span
                        class="flex size-9 shrink-0 items-center justify-center [@media(pointer:coarse)]:size-11"
                    >
                        <CloseIcon class="size-3.5 [@media(pointer:coarse)]:size-4" />
                    </span>
                    <span
                        class="manager-selection-count truncate pl-1 tabular-nums"
                        :title="barLabel ? undefined : selectionCount"
                        aria-hidden="true"
                        >{{ barLabel ? selectionCount : selectionSize }}</span
                    >
                </button>
                <span class="sr-only" role="status">{{ selectionCount }}</span>
                <button
                    v-if="barVisibility"
                    type="button"
                    class="manager-round manager-bulk-visibility"
                    :disabled="!selectedIds.length"
                    :aria-label="
                        bulkHidden
                            ? i18n.workspace.manager.showSelected
                            : i18n.workspace.manager.hideSelected
                    "
                    :title="
                        bulkHidden
                            ? i18n.workspace.manager.showSelected
                            : i18n.workspace.manager.hideSelected
                    "
                    @click="onBulkVisibility"
                >
                    <component
                        :is="bulkHidden ? VisibleIcon : HiddenIcon"
                        class="manager-new-folder-icon"
                        aria-hidden="true"
                    />
                </button>
                <button
                    type="button"
                    class="manager-round manager-bulk-move"
                    :disabled="!selectedIds.length"
                    :aria-label="i18n.workspace.folders.moveTo"
                    :title="i18n.workspace.folders.moveTo"
                    aria-haspopup="menu"
                    :aria-expanded="bulkMenuFrom('manager-bulk-move') ? 'true' : 'false'"
                    @click="onBulkMenu($event.currentTarget as HTMLElement, 'folders')"
                >
                    <FolderIcon class="manager-new-folder-icon" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    class="manager-round manager-bulk-delete"
                    :disabled="!selectionSize"
                    :aria-label="i18n.workspace.manager.deleteSelected"
                    :title="i18n.workspace.manager.deleteSelected"
                    @click="onBulkDelete($event.detail === 0)"
                >
                    <ResetIcon class="manager-new-folder-icon" aria-hidden="true" />
                </button>
                <button
                    type="button"
                    class="manager-round manager-bulk-more"
                    :aria-label="i18n.workspace.manager.selectionActions"
                    :title="i18n.workspace.manager.selectionActions"
                    aria-haspopup="menu"
                    :aria-expanded="bulkMenuFrom('manager-bulk-more') ? 'true' : 'false'"
                    @click="onBulkMenu($event.currentTarget as HTMLElement, 'main')"
                >
                    <MoreIcon class="manager-new-folder-icon" aria-hidden="true" />
                </button>
            </div>
            <div
                v-else-if="stickyAdd"
                class="manager-footer manager-footer-floating pointer-events-none absolute bottom-0 left-0 z-10 flex items-center gap-1.5 px-1.5 pb-2"
                :class="{ 'manager-footer-dragging': drag?.started }"
            >
                <ManagerAddButton :label="strings.add" @click="onAdd" />
                <button
                    type="button"
                    class="manager-new-folder"
                    :aria-label="i18n.workspace.folders.new"
                    :title="i18n.workspace.folders.new"
                    @click="onNewFolder(undefined, $event)"
                >
                    <FolderPlusIcon class="manager-new-folder-icon" aria-hidden="true" />
                </button>
            </div>
        </div>
        <ManagerMenu
            v-if="menu"
            :key="`${menu.key.type === 'selection' ? 'selection' : rowKey(menu.key)}-${menu.mode}`"
            :anchor="menu.anchor"
            :touch="menu.touch"
            :label="menuLabel"
            :items="menuItems"
            @select="onMenuSelect"
            @close="closeMenu"
        />
    </div>
</template>

<style scoped>
/* While the list scrolls, its rows and the band over them end clear of the
   overlay scrollbar's 10px strip and any dock inset beside it, so their buttons
   never sit under the thumb. Only widths change, so overflow never toggles. */
.manager-list:has(.manager-entries[data-scrollable]) .manager-band,
.manager-entries[data-scrollable] {
    padding-right: calc(0.625rem + var(--overlay-scrollbar-inset, 0px));
}

/* Room below the last row for the floating Add: the pill, its 8px inset and
   an 8px gap, so every row can scroll fully clear of it. */
.manager-entries-floating {
    padding-bottom: 3.5rem;
}

@media (pointer: coarse) {
    .manager-entries-floating {
        padding-bottom: 4rem;
    }
}

/* A round companion to the Add pill, raised the same way. */
.manager-new-folder,
.manager-round {
    @apply pointer-events-auto flex size-10 shrink-0 items-center justify-center rounded-full bg-button shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:shadow-accent [@media(pointer:coarse)]:size-12;
}

.manager-round {
    @apply disabled:pointer-events-none disabled:opacity-40 forced-colors:disabled:opacity-100;
}

.manager-new-folder-icon {
    @apply size-4 fill-current [@media(pointer:coarse)]:size-5;
}

/*
 * While its members scroll by, a folder's row stays at the top of the list so
 * they keep their context; it sticks at the list's edge, over the top padding,
 * and covers the members passing under it. A drag works with the rows where
 * they lie.
 */
.manager-folder-head {
    @apply sticky -top-1.5 z-[1] bg-modal;
}

.manager-entries-dragging .manager-folder-head,
.manager-entries-measuring .manager-folder-head {
    position: relative;
    top: 0;
}

/* Out of the way of a row being dragged over it, which the fade then spares too. */
.manager-footer-floating {
    transition: opacity 150ms;
}

.manager-footer-dragging {
    opacity: 0;
}

/*
 * Members hang under their folder: a guide line runs down the indent, centered
 * under the folder's chevron (row inset + eye + name padding + half the
 * chevron, less half the line), costing no height. Each member draws its
 * stretch, bridging the gap above it, so the line follows rows that glide
 * aside during a drag.
 */
.manager-entries {
    --guide-x: calc(0.125rem + 2.25rem + 0.5rem + 0.375rem - 1px);
}

.manager-members > li {
    position: relative;
}

.manager-members > li::before {
    content: '';
    left: var(--guide-x);
    top: calc(-0.25rem - var(--row-shift, 0px));
    @apply pointer-events-none absolute bottom-0 w-0.5 bg-fg/30;
}

.manager-members > li:first-child::before {
    top: calc(0.25rem - var(--row-shift, 0px));
    @apply rounded-t-full;
}

.manager-members > li:last-child::before {
    @apply bottom-1 rounded-b-full;
}

/*
 * The target's pill covers its stretch of the line, so a short stretch inside
 * the pill, clear of its edges, marks the target as in the folder.
 */
.manager-members > li:has(> .manager-row-current)::after,
.manager-members > li:has(> .manager-row-selected)::after {
    content: '';
    left: var(--guide-x);
    @apply pointer-events-none absolute inset-y-2 w-0.5 rounded-full bg-fg/30;
}

/* A member being dragged leaves its stretch behind. */
.manager-members > li.manager-dragged::before,
.manager-members > li.manager-dragged::after {
    display: none;
}

/* A held row landing in a folder marks the line inside its pill, as the target does. */
.manager-entries li.manager-dragged-in::after {
    content: '';
    display: block;
    left: var(--guide-x);
    @apply pointer-events-none absolute inset-y-2 w-0.5 rounded-full bg-fg/30;
}

@media (pointer: coarse) {
    .manager-entries {
        --guide-x: calc(0.125rem + 2.75rem + 0.625rem + 0.375rem - 1px);
    }
}

/* Over a folder it would join, the held row shrinks so the marked folder shows around it. */
.manager-dragged .manager-row {
    transition: scale 100ms ease;
}

.manager-dragged-over .manager-row {
    scale: 0.88;
}

/* Rows scrolled under the band: a hairline, a soft shadow and a short fade. */
.manager-band {
    overflow: hidden;
    transition: box-shadow 150ms;
}

/*
 * The overlay bar takes no room. Forced colors keep classic scrollbars, which
 * take their room whether or not the list overflows, and the band reserves the
 * same gutter, so adding a row never shifts the columns and the band's count
 * lines up with the rows' counts.
 */
@media (forced-colors: active) {
    .manager-entries,
    .manager-band {
        scrollbar-gutter: stable;
        scrollbar-width: thin;
    }
}

.manager-band-raised {
    @apply shadow-band;
}

.manager-entries-scrolled {
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 0.375rem);
    mask-image: linear-gradient(to bottom, transparent, #000 0.375rem);
}

/* Rows hidden below dissolve toward the floating Add, gone by its middle. */
.manager-entries-more {
    -webkit-mask-image: linear-gradient(
        to bottom,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
    mask-image: linear-gradient(
        to bottom,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
}

.manager-entries-scrolled.manager-entries-more {
    -webkit-mask-image: linear-gradient(
        to bottom,
        transparent,
        #000 0.375rem,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
    mask-image: linear-gradient(
        to bottom,
        transparent,
        #000 0.375rem,
        #000 calc(100% - 4.5rem),
        transparent calc(100% - 1.5rem)
    );
}

/* Neighbors glide aside while a row is dragged. */
.manager-entries-dragging [data-row] {
    transition: transform 150ms ease;
}

.manager-entries-dragging .manager-dragged [data-row],
.manager-entries-dragging [data-row].manager-dragged {
    transition: none;
}
</style>
