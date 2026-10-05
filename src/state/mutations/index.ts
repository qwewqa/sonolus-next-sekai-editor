import type { Entity } from '../entities'
import type { Transaction } from '../transaction'

export type AddMutation<T> = (transaction: Transaction, object: T) => Entity[]

export type RemoveMutation<T> = (transaction: Transaction, entity: T) => void

/** Swaps an object for an edited one in the same place, as if edited in place. */
export type ReplaceMutation<T, U> = (transaction: Transaction, entity: T, object: U) => Entity[]
