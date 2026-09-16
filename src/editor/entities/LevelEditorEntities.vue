<script lang="ts">
const layers = {
    timeScale: 0,
    bpm: 1,

    cameraEventConnection: 10,
    cameraEventJoint: 11,

    stageMaskEventConnection: 12,
    stageMaskEventJoint: 13,

    stagePivotEventConnection: 14,
    stagePivotEventJoint: 15,

    stageStyleEventConnection: 16,
    stageStyleEventJoint: 17,

    stageTransformEventConnection: 18,
    stageTransformEventJoint: 19,

    connector: {
        under: {
            active: 20,
            damage: 21,
            guide: 22,
        },
        bottom: {
            active: 23,
            damage: 24,
            guide: 25,
        },
        top: {
            active: 26,
            damage: 27,
            guide: 28,
        },
        over: {
            active: 40,
            damage: 41,
            guide: 42,
        },
    },

    note: 30,
}

const getLayer = (entity: Entity) => {
    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
        case 'stageMaskEventJoint':
        case 'stageMaskEventConnection':
        case 'stagePivotEventJoint':
        case 'stagePivotEventConnection':
        case 'stageStyleEventJoint':
        case 'stageStyleEventConnection':
        case 'stageTransformEventJoint':
        case 'stageTransformEventConnection':
        case 'timeScale':
        case 'note':
            return layers[entity.type]
        case 'connector':
            return layers.connector[entity.head.connectorLayer][entity.head.connectorType]
    }
}

const isEntityVisibleByGroup = (entity: Entity) => {
    if (view.groupId === undefined) return true

    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
        case 'stageMaskEventJoint':
        case 'stageMaskEventConnection':
        case 'stagePivotEventJoint':
        case 'stagePivotEventConnection':
        case 'stageStyleEventJoint':
        case 'stageStyleEventConnection':
        case 'stageTransformEventJoint':
        case 'stageTransformEventConnection':
            return true
        case 'timeScale':
        case 'note':
            return entity.groupId === view.groupId
        case 'connector':
            return (
                entity.attachHead.groupId === view.groupId ||
                entity.attachTail.groupId === view.groupId
            )
    }
}

const isEntityVisibleByStage = (entity: Entity) => {
    if (view.stageId === undefined) return true

    switch (entity.type) {
        case 'bpm':
        case 'cameraEventJoint':
        case 'cameraEventConnection':
        case 'timeScale':
            return true
        case 'note':
        case 'stageMaskEventJoint':
        case 'stagePivotEventJoint':
        case 'stageStyleEventJoint':
        case 'stageTransformEventJoint':
            return entity.stageId === view.stageId
        case 'stageMaskEventConnection':
        case 'stagePivotEventConnection':
        case 'stageStyleEventConnection':
        case 'stageTransformEventConnection':
            return entity.min.stageId === view.stageId
        case 'connector':
            return (
                entity.attachHead.stageId === view.stageId ||
                entity.attachTail.stageId === view.stageId
            )
    }
}

const infinities = [
    ['cameraEventConnection', LevelEditorCameraEventInfinity] as const,
    ['stageMaskEventConnection', LevelEditorStageMaskEventInfinities] as const,
    ['stagePivotEventConnection', LevelEditorStagePivotEventInfinities] as const,
    ['stageStyleEventConnection', LevelEditorStageStyleEventInfinities] as const,
    ['stageTransformEventConnection', LevelEditorStageTransformEventInfinities] as const,
]
</script>

<script setup lang="ts">
import { computed } from 'vue'
import { entityComponents } from '.'
import { settings } from '../../settings'
import type { Entity } from '../../state/entities'
import { hoveredEntities, view } from '../view'
import LevelEditorCameraEventInfinity from './events/camera/LevelEditorCameraEventInfinity.vue'
import LevelEditorStageMaskEventInfinities from './events/stage/mask/LevelEditorStageMaskEventInfinities.vue'
import LevelEditorStagePivotEventInfinities from './events/stage/pivot/LevelEditorStagePivotEventInfinities.vue'
import LevelEditorStageStyleEventInfinities from './events/stage/style/LevelEditorStageStyleEventInfinities.vue'
import LevelEditorStageTransformEventInfinities from './events/stage/transform/LevelEditorStageTransformEventInfinities.vue'
import { selectedEntitySet, visibleEntities } from './visible'

const sortedInfinities = computed(() =>
    infinities.sort(([a], [b]) => +view.visibilities[a] - +view.visibilities[b]),
)

const hoveredEntitySet = computed(() => new Set(hoveredEntities.value))

const visibleEntityInfos = computed(() => {
    const selected = selectedEntitySet.value
    let entities = visibleEntities.value.map((entity) => ({
        entity,
        isSelected: selected.has(entity),
        isVisibleByGroup: isEntityVisibleByGroup(entity),
        isVisibleByStage: isEntityVisibleByStage(entity),
        isVisibleByType: view.visibilities[entity.type],
        layer: getLayer(entity),
    }))

    if (!settings.showOtherGroups) {
        entities = entities.filter((entity) => entity.isVisibleByGroup)
    }

    if (!settings.showOtherStages) {
        entities = entities.filter((entity) => entity.isVisibleByStage)
    }

    if (!settings.showOtherObjects) {
        entities = entities.filter((entity) => entity.isVisibleByType)
    }

    return entities.sort(
        (a, b) =>
            +a.isSelected - +b.isSelected ||
            +(a.isVisibleByGroup && a.isVisibleByStage && a.isVisibleByType) -
                +(b.isVisibleByGroup && b.isVisibleByStage && b.isVisibleByType) ||
            a.layer - b.layer ||
            b.entity.beat - a.entity.beat,
    )
})
</script>

<template>
    <component :is="component" v-for="[type, component] in sortedInfinities" :key="type" />

    <component
        :is="entityComponents[entity.type]"
        v-for="{
            entity,
            isSelected,
            isVisibleByGroup,
            isVisibleByStage,
            isVisibleByType,
        } in visibleEntityInfos"
        :key="entity as never"
        :entity="entity as never"
        :is-highlighted="isSelected || hoveredEntitySet.has(entity)"
        :opacity="isVisibleByGroup && isVisibleByStage && isVisibleByType ? 1 : 0.25"
    />
</template>
