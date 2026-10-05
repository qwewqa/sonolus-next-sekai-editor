import type { Component } from 'vue'
import MultiAnchorField from '../../../modals/form/MultiAnchorField.vue'
import MultiBeatField from '../../../modals/form/MultiBeatField.vue'
import MultiBpmField from '../../../modals/form/MultiBpmField.vue'
import MultiCameraLeftField from '../../../modals/form/MultiCameraLeftField.vue'
import MultiCameraRotationField from '../../../modals/form/MultiCameraRotationField.vue'
import MultiCameraSizeField from '../../../modals/form/MultiCameraSizeField.vue'
import MultiCameraStageTiltField from '../../../modals/form/MultiCameraStageTiltField.vue'
import MultiCameraZoomField from '../../../modals/form/MultiCameraZoomField.vue'
import MultiCameraZoomTargetLaneField from '../../../modals/form/MultiCameraZoomTargetLaneField.vue'
import MultiCameraZoomTargetYField from '../../../modals/form/MultiCameraZoomTargetYField.vue'
import MultiCameraZoomVerticalAlignField from '../../../modals/form/MultiCameraZoomVerticalAlignField.vue'
import MultiConnectorActiveIsCriticalField from '../../../modals/form/MultiConnectorActiveIsCriticalField.vue'
import MultiConnectorEaseField from '../../../modals/form/MultiConnectorEaseField.vue'
import MultiConnectorGuideAlphaField from '../../../modals/form/MultiConnectorGuideAlphaField.vue'
import MultiConnectorIsFakeField from '../../../modals/form/MultiConnectorIsFakeField.vue'
import MultiConnectorIsPassThroughField from '../../../modals/form/MultiConnectorIsPassThroughField.vue'
import MultiConnectorLayerField from '../../../modals/form/MultiConnectorLayerField.vue'
import MultiConnectorPresentationField from '../../../modals/form/MultiConnectorPresentationField.vue'
import MultiConnectorStyleField from '../../../modals/form/MultiConnectorStyleField.vue'
import MultiConnectorTypeField from '../../../modals/form/MultiConnectorTypeField.vue'
import MultiDivisionLineAlphaField from '../../../modals/form/MultiDivisionLineAlphaField.vue'
import MultiDivisionParityField from '../../../modals/form/MultiDivisionParityField.vue'
import MultiDivisionSizeField from '../../../modals/form/MultiDivisionSizeField.vue'
import MultiEditorLaneField from '../../../modals/form/MultiEditorLaneField.vue'
import MultiElevationField from '../../../modals/form/MultiElevationField.vue'
import MultiEventEaseField from '../../../modals/form/MultiEventEaseField.vue'
import MultiFlickDirectionField from '../../../modals/form/MultiFlickDirectionField.vue'
import MultiGroupField from '../../../modals/form/MultiGroupField.vue'
import MultiHideNotesField from '../../../modals/form/MultiHideNotesField.vue'
import MultiIsAttachedField from '../../../modals/form/MultiIsAttachedField.vue'
import MultiIsConnectorSeparatorField from '../../../modals/form/MultiIsConnectorSeparatorField.vue'
import MultiIsCriticalField from '../../../modals/form/MultiIsCriticalField.vue'
import MultiIsFakeField from '../../../modals/form/MultiIsFakeField.vue'
import MultiIsFullWidthField from '../../../modals/form/MultiIsFullWidthField.vue'
import MultiIsMaskNotesField from '../../../modals/form/MultiIsMaskNotesField.vue'
import MultiJudgmentLineAlphaField from '../../../modals/form/MultiJudgmentLineAlphaField.vue'
import MultiJudgmentLineColorField from '../../../modals/form/MultiJudgmentLineColorField.vue'
import MultiJudgmentLineStyleField from '../../../modals/form/MultiJudgmentLineStyleField.vue'
import MultiLaneAlphaField from '../../../modals/form/MultiLaneAlphaField.vue'
import MultiLeftBorderStyleField from '../../../modals/form/MultiLeftBorderStyleField.vue'
import MultiLeftField from '../../../modals/form/MultiLeftField.vue'
import MultiMaskLeftField from '../../../modals/form/MultiMaskLeftField.vue'
import MultiMaskSizeField from '../../../modals/form/MultiMaskSizeField.vue'
import MultiMeterField from '../../../modals/form/MultiMeterField.vue'
import MultiNoteAlphaField from '../../../modals/form/MultiNoteAlphaField.vue'
import MultiNoteStyleField from '../../../modals/form/MultiNoteStyleField.vue'
import MultiNoteTypeField from '../../../modals/form/MultiNoteTypeField.vue'
import MultiPivotLaneField from '../../../modals/form/MultiPivotLaneField.vue'
import MultiRightBorderStyleField from '../../../modals/form/MultiRightBorderStyleField.vue'
import MultiRotationField from '../../../modals/form/MultiRotationField.vue'
import MultiSfxField from '../../../modals/form/MultiSfxField.vue'
import MultiSizeField from '../../../modals/form/MultiSizeField.vue'
import MultiSkipField from '../../../modals/form/MultiSkipField.vue'
import MultiStageField from '../../../modals/form/MultiStageField.vue'
import MultiTimeScaleEaseField from '../../../modals/form/MultiTimeScaleEaseField.vue'
import MultiTimeScaleField from '../../../modals/form/MultiTimeScaleField.vue'
import MultiTimeScaleTransitionField from '../../../modals/form/MultiTimeScaleTransitionField.vue'
import MultiXTranslationField from '../../../modals/form/MultiXTranslationField.vue'
import MultiYOffsetBeatField from '../../../modals/form/MultiYOffsetBeatField.vue'
import MultiYOffsetField from '../../../modals/form/MultiYOffsetField.vue'
import MultiYTranslationField from '../../../modals/form/MultiYTranslationField.vue'
import OptionalAnchorField from '../../../modals/form/OptionalAnchorField.vue'
import OptionalCameraRotationField from '../../../modals/form/OptionalCameraRotationField.vue'
import OptionalCameraSizeField from '../../../modals/form/OptionalCameraSizeField.vue'
import OptionalCameraStageTiltField from '../../../modals/form/OptionalCameraStageTiltField.vue'
import OptionalCameraZoomField from '../../../modals/form/OptionalCameraZoomField.vue'
import OptionalCameraZoomTargetLaneField from '../../../modals/form/OptionalCameraZoomTargetLaneField.vue'
import OptionalCameraZoomTargetYField from '../../../modals/form/OptionalCameraZoomTargetYField.vue'
import OptionalCameraZoomVerticalAlignField from '../../../modals/form/OptionalCameraZoomVerticalAlignField.vue'
import OptionalConnectorActiveIsCriticalField from '../../../modals/form/OptionalConnectorActiveIsCriticalField.vue'
import OptionalConnectorEaseField from '../../../modals/form/OptionalConnectorEaseField.vue'
import OptionalConnectorGuideAlphaField from '../../../modals/form/OptionalConnectorGuideAlphaField.vue'
import OptionalConnectorIsFakeField from '../../../modals/form/OptionalConnectorIsFakeField.vue'
import OptionalConnectorIsPassThroughField from '../../../modals/form/OptionalConnectorIsPassThroughField.vue'
import OptionalConnectorLayerField from '../../../modals/form/OptionalConnectorLayerField.vue'
import OptionalConnectorPresentationField from '../../../modals/form/OptionalConnectorPresentationField.vue'
import OptionalConnectorStyleField from '../../../modals/form/OptionalConnectorStyleField.vue'
import OptionalConnectorTypeField from '../../../modals/form/OptionalConnectorTypeField.vue'
import OptionalDivisionLineAlphaField from '../../../modals/form/OptionalDivisionLineAlphaField.vue'
import OptionalDivisionParityField from '../../../modals/form/OptionalDivisionParityField.vue'
import OptionalDivisionSizeField from '../../../modals/form/OptionalDivisionSizeField.vue'
import OptionalElevationField from '../../../modals/form/OptionalElevationField.vue'
import OptionalEventEaseField from '../../../modals/form/OptionalEventEaseField.vue'
import OptionalFlickDirectionField from '../../../modals/form/OptionalFlickDirectionField.vue'
import OptionalGroupField from '../../../modals/form/OptionalGroupField.vue'
import OptionalHideNotesField from '../../../modals/form/OptionalHideNotesField.vue'
import OptionalIsAttachedField from '../../../modals/form/OptionalIsAttachedField.vue'
import OptionalIsConnectorSeparatorField from '../../../modals/form/OptionalIsConnectorSeparatorField.vue'
import OptionalIsCriticalField from '../../../modals/form/OptionalIsCriticalField.vue'
import OptionalIsFakeField from '../../../modals/form/OptionalIsFakeField.vue'
import OptionalIsFullWidthField from '../../../modals/form/OptionalIsFullWidthField.vue'
import OptionalIsMaskNotesField from '../../../modals/form/OptionalIsMaskNotesField.vue'
import OptionalJudgmentLineAlphaField from '../../../modals/form/OptionalJudgmentLineAlphaField.vue'
import OptionalJudgmentLineColorField from '../../../modals/form/OptionalJudgmentLineColorField.vue'
import OptionalJudgmentLineStyleField from '../../../modals/form/OptionalJudgmentLineStyleField.vue'
import OptionalLaneAlphaField from '../../../modals/form/OptionalLaneAlphaField.vue'
import OptionalLeftBorderStyleField from '../../../modals/form/OptionalLeftBorderStyleField.vue'
import OptionalMaskSizeField from '../../../modals/form/OptionalMaskSizeField.vue'
import OptionalNoteAlphaField from '../../../modals/form/OptionalNoteAlphaField.vue'
import OptionalNoteStyleField from '../../../modals/form/OptionalNoteStyleField.vue'
import OptionalNoteTypeField from '../../../modals/form/OptionalNoteTypeField.vue'
import OptionalRightBorderStyleField from '../../../modals/form/OptionalRightBorderStyleField.vue'
import OptionalRotationField from '../../../modals/form/OptionalRotationField.vue'
import OptionalSfxField from '../../../modals/form/OptionalSfxField.vue'
import OptionalSizeField from '../../../modals/form/OptionalSizeField.vue'
import OptionalSkipField from '../../../modals/form/OptionalSkipField.vue'
import OptionalStageField from '../../../modals/form/OptionalStageField.vue'
import OptionalTimeScaleEaseField from '../../../modals/form/OptionalTimeScaleEaseField.vue'
import OptionalTimeScaleField from '../../../modals/form/OptionalTimeScaleField.vue'
import OptionalTimeScaleTransitionField from '../../../modals/form/OptionalTimeScaleTransitionField.vue'
import OptionalYOffsetBeatField from '../../../modals/form/OptionalYOffsetBeatField.vue'
import OptionalYOffsetField from '../../../modals/form/OptionalYOffsetField.vue'
import OptionalYTranslationField from '../../../modals/form/OptionalYTranslationField.vue'
import type { BrushKey, PropertyKey } from './fields'

export const multiFieldComponents: Record<PropertyKey, Component> = {
    beat: MultiBeatField,
    editorLane: MultiEditorLaneField,
    left: MultiLeftField,
    size: MultiSizeField,
    cameraLeft: MultiCameraLeftField,
    cameraSize: MultiCameraSizeField,
    maskLeft: MultiMaskLeftField,
    maskSize: MultiMaskSizeField,
    pivotLane: MultiPivotLaneField,
    xTranslation: MultiXTranslationField,
    yTranslation: MultiYTranslationField,
    bpm: MultiBpmField,
    meter: MultiMeterField,
    timeScale: MultiTimeScaleField,
    skip: MultiSkipField,
    timeScaleEase: MultiTimeScaleEaseField,
    timeScaleTransition: MultiTimeScaleTransitionField,
    hideNotes: MultiHideNotesField,
    cameraZoom: MultiCameraZoomField,
    cameraZoomTargetLane: MultiCameraZoomTargetLaneField,
    cameraZoomTargetY: MultiCameraZoomTargetYField,
    cameraZoomVerticalAlign: MultiCameraZoomVerticalAlignField,
    cameraRotation: MultiCameraRotationField,
    cameraStageTilt: MultiCameraStageTiltField,
    isMaskNotes: MultiIsMaskNotesField,
    divisionSize: MultiDivisionSizeField,
    divisionParity: MultiDivisionParityField,
    yOffset: MultiYOffsetField,
    yOffsetBeat: MultiYOffsetBeatField,
    judgmentLineColor: MultiJudgmentLineColorField,
    judgmentLineStyle: MultiJudgmentLineStyleField,
    leftBorderStyle: MultiLeftBorderStyleField,
    rightBorderStyle: MultiRightBorderStyleField,
    isFullWidth: MultiIsFullWidthField,
    noteAlpha: MultiNoteAlphaField,
    laneAlpha: MultiLaneAlphaField,
    judgmentLineAlpha: MultiJudgmentLineAlphaField,
    divisionLineAlpha: MultiDivisionLineAlphaField,
    rotation: MultiRotationField,
    anchor: MultiAnchorField,
    eventEase: MultiEventEaseField,
    noteType: MultiNoteTypeField,
    isCritical: MultiIsCriticalField,
    flickDirection: MultiFlickDirectionField,
    isAttached: MultiIsAttachedField,
    noteStyle: MultiNoteStyleField,
    isFake: MultiIsFakeField,
    sfx: MultiSfxField,
    isConnectorSeparator: MultiIsConnectorSeparatorField,
    connectorType: MultiConnectorTypeField,
    connectorStyle: MultiConnectorStyleField,
    connectorEase: MultiConnectorEaseField,
    connectorIsFake: MultiConnectorIsFakeField,
    connectorActiveIsCritical: MultiConnectorActiveIsCriticalField,
    connectorGuideAlpha: MultiConnectorGuideAlphaField,
    connectorLayer: MultiConnectorLayerField,
    connectorIsPassThrough: MultiConnectorIsPassThroughField,
    connectorPresentation: MultiConnectorPresentationField,
    groupId: MultiGroupField,
    stageId: MultiStageField,
    elevation: MultiElevationField,
}

export const optionalFieldComponents: Record<BrushKey, Component> = {
    size: OptionalSizeField,
    cameraSize: OptionalCameraSizeField,
    maskSize: OptionalMaskSizeField,
    yTranslation: OptionalYTranslationField,
    timeScale: OptionalTimeScaleField,
    skip: OptionalSkipField,
    timeScaleEase: OptionalTimeScaleEaseField,
    timeScaleTransition: OptionalTimeScaleTransitionField,
    hideNotes: OptionalHideNotesField,
    cameraZoom: OptionalCameraZoomField,
    cameraZoomTargetLane: OptionalCameraZoomTargetLaneField,
    cameraZoomTargetY: OptionalCameraZoomTargetYField,
    cameraZoomVerticalAlign: OptionalCameraZoomVerticalAlignField,
    cameraRotation: OptionalCameraRotationField,
    cameraStageTilt: OptionalCameraStageTiltField,
    isMaskNotes: OptionalIsMaskNotesField,
    divisionSize: OptionalDivisionSizeField,
    divisionParity: OptionalDivisionParityField,
    yOffset: OptionalYOffsetField,
    yOffsetBeat: OptionalYOffsetBeatField,
    judgmentLineColor: OptionalJudgmentLineColorField,
    judgmentLineStyle: OptionalJudgmentLineStyleField,
    leftBorderStyle: OptionalLeftBorderStyleField,
    rightBorderStyle: OptionalRightBorderStyleField,
    isFullWidth: OptionalIsFullWidthField,
    noteAlpha: OptionalNoteAlphaField,
    laneAlpha: OptionalLaneAlphaField,
    judgmentLineAlpha: OptionalJudgmentLineAlphaField,
    divisionLineAlpha: OptionalDivisionLineAlphaField,
    rotation: OptionalRotationField,
    anchor: OptionalAnchorField,
    eventEase: OptionalEventEaseField,
    noteType: OptionalNoteTypeField,
    isCritical: OptionalIsCriticalField,
    flickDirection: OptionalFlickDirectionField,
    isAttached: OptionalIsAttachedField,
    noteStyle: OptionalNoteStyleField,
    isFake: OptionalIsFakeField,
    sfx: OptionalSfxField,
    isConnectorSeparator: OptionalIsConnectorSeparatorField,
    connectorType: OptionalConnectorTypeField,
    connectorStyle: OptionalConnectorStyleField,
    connectorEase: OptionalConnectorEaseField,
    connectorIsFake: OptionalConnectorIsFakeField,
    connectorActiveIsCritical: OptionalConnectorActiveIsCriticalField,
    connectorGuideAlpha: OptionalConnectorGuideAlphaField,
    connectorLayer: OptionalConnectorLayerField,
    connectorIsPassThrough: OptionalConnectorIsPassThroughField,
    connectorPresentation: OptionalConnectorPresentationField,
    groupId: OptionalGroupField,
    stageId: OptionalStageField,
    elevation: OptionalElevationField,
}
