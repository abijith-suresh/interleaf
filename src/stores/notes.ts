import { createStore } from "solid-js/store";

import {
  createNote as createNoteRecord,
  deleteNote as deleteNoteRecord,
  getAllNotes,
  updateNote as updateNoteRecord,
} from "@/db";
import type { NoteRecord, NoteUpdate } from "@/types/note";
import { toLocalDayKey } from "@/utils/dayKey";

const STORAGE_UNAVAILABLE_MESSAGE =
  "Notes cannot be saved in this browser session. Storage is unavailable.";

type NotesState = {
  items: NoteRecord[];
  isLoaded: boolean;
  isLoading: boolean;
  storageError: string | null;
};

const [notesState, setNotesState] = createStore<NotesState>({
  items: [],
  isLoaded: false,
  isLoading: false,
  storageError: null,
});

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortByUpdatedAt(notes: NoteRecord[]) {
  return [...notes].sort((left, right) => right.updatedAt - left.updatedAt);
}

function setStorageUnavailable() {
  setNotesState({
    isLoaded: true,
    isLoading: false,
    storageError: STORAGE_UNAVAILABLE_MESSAGE,
  });
}

function createLocalNote(body = "") {
  const createdAt = Date.now();

  return {
    id: createId(),
    body,
    createdAt,
    updatedAt: createdAt,
    dayKey: toLocalDayKey(createdAt),
  } satisfies NoteRecord;
}

function replaceNote(note: NoteRecord) {
  const nextItems = sortByUpdatedAt([
    note,
    ...notesState.items.filter((item) => item.id !== note.id),
  ]);

  setNotesState("items", nextItems);

  return note;
}

export function useNotes() {
  return notesState;
}

export async function refreshNotes() {
  setNotesState({ isLoading: true });

  try {
    const notes = await getAllNotes();
    setNotesState({
      items: notes,
      isLoaded: true,
      isLoading: false,
      storageError: null,
    });

    return notes;
  } catch (error) {
    void error;
    setStorageUnavailable();

    return notesState.items;
  }
}

export async function createStoredNote(body = "") {
  try {
    const note = await createNoteRecord({ body });
    setNotesState({ isLoaded: true, storageError: null });

    return replaceNote(note);
  } catch (error) {
    void error;

    const note = createLocalNote(body);

    setStorageUnavailable();

    return replaceNote(note);
  }
}

export async function upsertStoredNote(id: string, update: NoteUpdate) {
  try {
    const note = await updateNoteRecord(id, update);

    if (!note) {
      return undefined;
    }

    setNotesState({ isLoaded: true, storageError: null });

    return replaceNote(note);
  } catch (error) {
    void error;

    const existingNote = notesState.items.find((item) => item.id === id);

    if (!existingNote) {
      return undefined;
    }

    const updatedAt = update.updatedAt ?? Date.now();
    const note: NoteRecord = {
      ...existingNote,
      ...update,
      updatedAt,
      dayKey: toLocalDayKey(updatedAt),
    };

    setStorageUnavailable();

    return replaceNote(note);
  }
}

export async function removeStoredNote(id: string) {
  try {
    await deleteNoteRecord(id);
    setNotesState("storageError", null);
  } catch (error) {
    void error;
    setStorageUnavailable();
  }

  setNotesState(
    "items",
    notesState.items.filter((note) => note.id !== id),
  );
}
