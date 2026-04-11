import { createMemo, createSignal, onCleanup, onMount } from "solid-js";

import Editor from "@/components/Editor";
import Sidebar, { groupNotesByDay } from "@/components/Sidebar";
import TabBar from "@/components/TabBar";
import { createStoredNote, refreshNotes, upsertStoredNote, useNotes } from "@/stores/notes";
import { closeTab, cycleTabs, setActiveNote, useUi } from "@/stores/ui";

export default function AppShell() {
  const notes = useNotes();
  const ui = useUi();
  const [focusToken, setFocusToken] = createSignal(0);
  const [isBootstrapping, setIsBootstrapping] = createSignal(true);

  const notesById = createMemo(() => new Map(notes.items.map((note) => [note.id, note])));
  const noteGroups = createMemo(() => groupNotesByDay(notes.items));
  const openTabs = createMemo(() =>
    ui.openTabs
      .map((noteId) => notesById().get(noteId))
      .filter((note): note is NonNullable<typeof note> => note !== undefined)
  );
  const activeNote = createMemo(() => {
    const activeNoteId = ui.activeNoteId;

    return activeNoteId ? notesById().get(activeNoteId) : undefined;
  });

  function requestEditorFocus() {
    setFocusToken((value) => value + 1);
  }

  function activateNote(noteId: string) {
    setActiveNote(noteId);
    requestEditorFocus();
  }

  function openNote(noteId: string) {
    if (isBootstrapping()) {
      return;
    }

    activateNote(noteId);
  }

  async function handleCreateNote() {
    if (isBootstrapping()) {
      return;
    }

    const note = await createStoredNote();
    activateNote(note.id);
  }

  async function handleSave(noteId: string, body: string) {
    await upsertStoredNote(noteId, { body });
  }

  function handleCloseTab(noteId: string) {
    closeTab(noteId);
    requestEditorFocus();
  }

  onMount(() => {
    const handleInitialLoad = async () => {
      try {
        const loadedNotes = await refreshNotes();

        if (loadedNotes.length === 0) {
          const note = await createStoredNote();
          activateNote(note.id);
          return;
        }

        activateNote(loadedNotes[0].id);
      } finally {
        setIsBootstrapping(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;
      const canSwitchTabs = hasPrimaryModifier && !event.metaKey;
      const hasFallbackTabModifier = event.altKey && !event.ctrlKey && !event.metaKey;

      if (hasPrimaryModifier && event.key.toLowerCase() === "n") {
        event.preventDefault();

        if (!isBootstrapping()) {
          void handleCreateNote();
        }

        return;
      }

      if (hasPrimaryModifier && event.key.toLowerCase() === "w") {
        event.preventDefault();

        if (ui.activeNoteId) {
          handleCloseTab(ui.activeNoteId);
        }

        return;
      }

      if (isBootstrapping()) {
        return;
      }

      if (canSwitchTabs && event.key === "Tab") {
        event.preventDefault();
        const nextTab = cycleTabs(event.shiftKey ? -1 : 1);

        if (nextTab) {
          requestEditorFocus();
        }

        return;
      }

      if (canSwitchTabs && (event.key === "PageDown" || event.key === "PageUp")) {
        event.preventDefault();
        const nextTab = cycleTabs(event.key === "PageUp" ? -1 : 1);

        if (nextTab) {
          requestEditorFocus();
        }

        return;
      }

      if (hasFallbackTabModifier && (event.key === "]" || event.key === "[")) {
        event.preventDefault();
        const nextTab = cycleTabs(event.key === "[" ? -1 : 1);

        if (nextTab) {
          requestEditorFocus();
        }
      }
    };

    void handleInitialLoad();
    window.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <div class="flex min-h-screen bg-bg text-text-primary">
        <Sidebar
          groups={noteGroups()}
          activeNoteId={ui.activeNoteId}
          isLoading={notes.isLoading}
          isBootstrapping={isBootstrapping()}
          onCreateNote={() => void handleCreateNote()}
          onSelectNote={openNote}
        />

      <main class="flex min-w-0 flex-1 flex-col bg-bg">
        <TabBar
          tabs={openTabs()}
          activeNoteId={ui.activeNoteId}
          isBootstrapping={isBootstrapping()}
          onCreateNote={() => void handleCreateNote()}
          onSelectTab={openNote}
          onCloseTab={handleCloseTab}
        />

        <Editor note={activeNote()} focusToken={focusToken()} onSave={handleSave} />
      </main>
    </div>
  );
}
