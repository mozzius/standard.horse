/**
 * Reducer for the post editor's mutable form state. Consolidates what used to be
 * a dozen `useState`s into one object with named transitions — notably the
 * seed/restore/revert flows that each used to be five-or-more `setState` calls.
 *
 * Refs (CodeMirror view, uploaded-image map, seeding guards) stay outside this:
 * they're imperative handles, not render state.
 */

import type { PostDraft } from "../lib/drafts.ts"
import { DEFAULT_PATH_TEMPLATE } from "../lib/repo.ts"

/** The text inputs, seeded together from a record or a draft. */
export interface EditorFields {
  title: string
  description: string
  tags: string
  pathTemplate: string
  body: string
}

export interface EditorState extends EditorFields {
  /** A freshly-picked cover file to upload, or null. */
  coverFile: File | null
  /** Drop the existing cover image on save. */
  coverRemoved: boolean
  /** For a new post, the user-chosen target publication (rkey). */
  selectedPubRkey: string | null
  /** For a new post, the user-chosen richtext format. */
  selectedProviderId: string | null
  /** Synchronous form-validation error (save/delete errors come from mutations). */
  formError: string | null
  /** epoch ms the working state was last persisted locally; null when clean. */
  savedAt: number | null
  /** non-null shows the "restored a local draft" banner. */
  restoredAt: number | null
  /** the server record changed since the restored draft was based on it. */
  stale: boolean
  /**
   * Whether the initial seed/restore has run. Draft persistence stays paused
   * until this flips true, so the empty initial form (while the record is still
   * loading) can't be mistaken for "clean" and wipe a saved draft before it's
   * had a chance to restore.
   */
  hydrated: boolean
}

export type EditorAction =
  | { type: "set"; field: keyof EditorFields; value: string }
  | { type: "selectPublication"; rkey: string }
  | { type: "selectProvider"; id: string }
  | { type: "setFormError"; message: string | null }
  | { type: "pickCover"; file: File | null }
  | { type: "removeCover" }
  // After a save: keep the (now-committed) cover, drop the pending edit.
  | { type: "clearCover" }
  // Initial seed/restore has run — draft persistence may begin.
  | { type: "hydrated" }
  // Seed text inputs from the server record (no draft restored).
  | { type: "seed"; fields: EditorFields }
  // Adopt a richer body when a list-cache placeholder upgrades to the full load.
  | { type: "adoptBody"; body: string }
  // Append text to the body (used when an image is inserted with no live editor).
  | { type: "appendBody"; text: string }
  // Restore a local draft over the server values.
  | { type: "restoreDraft"; draft: PostDraft; stale: boolean }
  // Revert the inputs (to server values or empty) and forget the draft status.
  | { type: "revert"; fields: EditorFields }
  | { type: "markSaved"; at: number }
  | { type: "markClean" }
  // The post was written to / removed from the PDS; clear all draft status.
  | { type: "draftCleared" }

export function initEditorState(selectedPubRkey: string | null): EditorState {
  return {
    title: "",
    description: "",
    tags: "",
    pathTemplate: DEFAULT_PATH_TEMPLATE,
    body: "",
    coverFile: null,
    coverRemoved: false,
    selectedPubRkey,
    selectedProviderId: null,
    formError: null,
    savedAt: null,
    restoredAt: null,
    stale: false,
    hydrated: false,
  }
}

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState {
  switch (action.type) {
    case "set":
      return { ...state, [action.field]: action.value }
    case "selectPublication":
      return { ...state, selectedPubRkey: action.rkey }
    case "selectProvider":
      return { ...state, selectedProviderId: action.id }
    case "setFormError":
      return { ...state, formError: action.message }
    case "pickCover":
      return { ...state, coverFile: action.file, coverRemoved: false }
    case "removeCover":
      return { ...state, coverFile: null, coverRemoved: true }
    case "clearCover":
      return { ...state, coverFile: null, coverRemoved: false }
    case "hydrated":
      return state.hydrated ? state : { ...state, hydrated: true }
    case "seed":
      return { ...state, ...action.fields }
    case "adoptBody":
      return { ...state, body: action.body }
    case "appendBody":
      return {
        ...state,
        body: state.body ? `${state.body}\n\n${action.text}` : action.text,
      }
    case "restoreDraft": {
      const d = action.draft
      return {
        ...state,
        title: d.title,
        description: d.description,
        tags: d.tags,
        pathTemplate: d.pathTemplate,
        body: d.body,
        selectedProviderId: d.providerId ?? state.selectedProviderId,
        savedAt: d.savedAt,
        restoredAt: d.savedAt,
        stale: action.stale,
      }
    }
    case "revert":
      return {
        ...state,
        ...action.fields,
        savedAt: null,
        restoredAt: null,
        stale: false,
      }
    case "markSaved":
      return { ...state, savedAt: action.at }
    case "markClean":
      return state.savedAt === null ? state : { ...state, savedAt: null }
    case "draftCleared":
      return { ...state, savedAt: null, restoredAt: null, stale: false }
  }
}
