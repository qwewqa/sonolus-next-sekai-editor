<script setup lang="ts">
import { vScrollEdges } from '../../../directives/scrollEdges'
import { nextTick, useTemplateRef } from 'vue'
import { checkDynamicStages, isDynamicStages } from '../../../history/dynamicStages'
import { i18n } from '../../../i18n'
import OverlayScrollbar from '../OverlayScrollbar.vue'
import ManagerList from './ManagerList.vue'
import ManagerRow from './ManagerRow.vue'
import { stageManager } from './stages'

defineProps<{
    scrollKey?: string
}>()

const root = useTemplateRef<HTMLDivElement>('root')
const disabledBody = useTemplateRef<HTMLDivElement>('disabledBody')

const onEnable = async (event: MouseEvent) => {
    const keyboard = event.detail === 0
    if (!keyboard) (event.currentTarget as HTMLElement).blur()
    // The ordinary workflow asks for confirmation and records history, so
    // cancelling leaves the level static and undo disables stages again.
    if (!(await checkDynamicStages()) || !keyboard) return
    await nextTick()
    root.value?.querySelector<HTMLElement>('.manager-name')?.focus({ preventScroll: true })
}
</script>

<template>
    <div ref="root" class="flex min-h-0 flex-col">
        <ManagerList
            v-if="isDynamicStages"
            class="min-h-0 flex-1"
            :model="stageManager"
            :scroll-key
        />
        <div v-else class="manager-disabled relative flex min-h-0 flex-1 flex-col text-fg">
            <!-- The band stays so the panel keeps its shape, muted while unavailable. -->
            <div
                class="manager-band shrink-0 bg-header px-1.5 py-1 [@media(pointer:coarse)]:py-0.5"
            >
                <ManagerRow
                    class="manager-all"
                    heading
                    disabled
                    muted
                    shown
                    :current="false"
                    :name="i18n.workspace.stages.all"
                    :name-title="i18n.workspace.stages.disabled"
                    :eye-label="i18n.workspace.stages.showAll"
                />
            </div>
            <div
                ref="disabledBody"
                v-scroll-edges
                class="overlay-scroller flex min-h-0 flex-col items-start gap-3 overflow-y-auto p-4"
            >
                <p class="text-fg/80">{{ i18n.workspace.stages.disabled }}</p>
                <button
                    type="button"
                    class="manager-enable flex min-h-9 max-w-full items-center rounded-full bg-button px-4 py-1.5 text-center shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg active:bg-accent active:text-on-accent [@media(hover:hover)]:hover:shadow-accent [@media(pointer:coarse)]:min-h-11"
                    :title="i18n.workspace.stages.enable"
                    @click="onEnable"
                >
                    <!-- Long translations wrap inside the pill rather than truncate. -->
                    <span class="min-w-0">{{ i18n.workspace.stages.enable }}</span>
                </button>
            </div>
            <OverlayScrollbar :target="disabledBody" />
        </div>
    </div>
</template>
