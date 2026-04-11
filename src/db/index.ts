import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { NoteInput, NoteRecord, NoteUpdate } from "@/types/note";
import { toLocalDayKey } from "@/utils/dayKey";

const DB_NAME = "interleaf-db";
const DB_VERSION = 1;
const NOTES_STORE = "notes";

interface InterleafDatabase extends DBSchema {
  notes: {
    key: string;
    value: NoteRecord;
    indexes: {
      dayKey: string;
      updatedAt: number;
    };
  };
}

let databasePromise: Promise<IDBPDatabase<InterleafDatabase>> | undefined;

function createId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getDatabase() {
  databasePromise ??= openDB<InterleafDatabase>(DB_NAME, DB_VERSION, {
    upgrade(database, _oldVersion, _newVersion, transaction) {
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        const notesStore = database.createObjectStore(NOTES_STORE, {
          keyPath: "id",
        });

        notesStore.createIndex("dayKey", "dayKey");
        notesStore.createIndex("updatedAt", "updatedAt");
        return;
      }

      if (!transaction) {
        return;
      }

      const notesStore = transaction.objectStore(NOTES_STORE);

      if (!notesStore.indexNames.contains("dayKey")) {
        notesStore.createIndex("dayKey", "dayKey");
      }

      if (!notesStore.indexNames.contains("updatedAt")) {
        notesStore.createIndex("updatedAt", "updatedAt");
      }
    },
  });

  return databasePromise;
}

function sortByUpdatedAt(notes: NoteRecord[]) {
  return [...notes].sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function createNote(input: NoteInput = { body: "" }) {
  const database = await getDatabase();
  const createdAt = input.createdAt ?? Date.now();
  const updatedAt = input.updatedAt ?? createdAt;
  const note: NoteRecord = {
    id: input.id ?? createId(),
    createdAt,
    updatedAt,
    body: input.body,
    dayKey: toLocalDayKey(updatedAt),
  };

  await database.put(NOTES_STORE, note);

  return note;
}

export async function getNote(id: string) {
  const database = await getDatabase();

  return database.get(NOTES_STORE, id);
}

export async function getAllNotes() {
  const database = await getDatabase();
  const notes = await database.getAll(NOTES_STORE);

  return sortByUpdatedAt(notes);
}

export async function updateNote(id: string, update: NoteUpdate) {
  const database = await getDatabase();
  const existingNote = await database.get(NOTES_STORE, id);

  if (!existingNote) {
    return undefined;
  }

  const updatedAt = update.updatedAt ?? Date.now();
  const nextNote: NoteRecord = {
    ...existingNote,
    ...update,
    updatedAt,
    dayKey: toLocalDayKey(updatedAt),
  };

  await database.put(NOTES_STORE, nextNote);

  return nextNote;
}

export async function deleteNote(id: string) {
  const database = await getDatabase();

  await database.delete(NOTES_STORE, id);
}

export async function getNotesByDayKey(dayKey: string) {
  const database = await getDatabase();
  const notes = await database.getAllFromIndex(NOTES_STORE, "dayKey", dayKey);

  return sortByUpdatedAt(notes);
}
