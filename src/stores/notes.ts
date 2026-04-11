import { createStore } from "solid-js/store";

import {
  createNote as createNoteRecord,
  deleteNote as deleteNoteRecord,
  getAllNotes,
  updateNote as updateNoteRecord
} from "@/db";
import type { NoteRecord, NoteUpdate } from "@/types/note";

type NotesState = {
  items: NoteRecord[];
  isLoaded: boolean;
  isLoading: boolean;
};

const [notesState, setNotesState] = createStore<NotesState>({
  items: [],
  isLoaded: false,
  isLoading: false
});

function sortByUpdatedAt(notes: NoteRecord[]) {
  return [...notes].sort((left, right) => right.updatedAt - left.updatedAt);
}

function replaceNote(note: NoteRecord) {
  const nextItems = sortByUpdatedAt([
    note,
    ...notesState.items.filter((item) => item.id !== note.id)
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
    setNotesState({ items: notes, isLoaded: true, isLoading: false });

    return notes;
  } catch (error) {
    setNotesState("isLoading", false);
    throw error;
  }
}

export async function createStoredNote(body = "") {
  const note = await createNoteRecord({ body });
  setNotesState("isLoaded", true);

  return replaceNote(note);
}

export async function upsertStoredNote(id: string, update: NoteUpdate) {
  const note = await updateNoteRecord(id, update);

  if (!note) {
    return undefined;
  }

  setNotesState("isLoaded", true);

  return replaceNote(note);
}

export async function removeStoredNote(id: string) {
  await deleteNoteRecord(id);
  setNotesState("items", notesState.items.filter((note) => note.id !== id));
}
