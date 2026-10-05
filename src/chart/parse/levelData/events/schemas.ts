import Type from 'typebox'
import { easeLevelDataValues } from '../../../../ease'

export const eventEaseSchema = Type.Union(easeLevelDataValues.map((value) => Type.Literal(value)))
