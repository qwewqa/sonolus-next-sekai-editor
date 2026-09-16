<script setup lang="ts">
import LevelEditorHitbox from './entities/LevelEditorHitbox.vue'
import { visibleSelectedEntities } from './entities/visible'
</script>

<template>
    <template v-for="entity in visibleSelectedEntities" :key="entity">
        <LevelEditorHitbox v-if="entity.hitbox" :hitbox="entity.hitbox" stroke-opacity="0.5" />
    </template>
</template>
