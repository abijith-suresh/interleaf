import JSZip from "jszip";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import AboutOverlay from "@/components/AboutOverlay";
import ContextMenu from "@/components/ContextMenu";
import DeleteModal from "@/components/DeleteModal";
import Editor from "@/components/Editor";
import ExportAllMenu from "@/components/ExportAllMenu";
import SearchOverlay from "@/components/SearchOverlay";
import Sidebar, { groupNotesByDay } from "@/components/Sidebar";
import TabBar from "@/components/TabBar";
import { createStoredNote, refreshNotes, removeStoredNote, upsertStoredNote, useNotes } from "@/stores/notes";
import {
  closeContextMenu,
  closeTransientUi,
  closeDeleteModal,
  closeTab,
  cycleTabs,
  openContextMenu,
  openDeleteModal,
  setActiveNote,
  setContextMenuExportOpen,
  setOverlay,
  toggleTheme,
  useUi
} from "@/stores/ui";
import { type NoteExportFormat, exportNote, formatDateStamp, getDedupedExportFilename } from "@/utils/exportNote";
import { deriveTitle } from "@/utils/deriveTitle";

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
  const contextNote = createMemo(() => {
    const noteId = ui.contextMenu.noteId;

    return noteId ? notesById().get(noteId) : undefined;
  });
  const deleteNote = createMemo(() => {
    const noteId = ui.deleteModal.noteId;

    return noteId ? notesById().get(noteId) : undefined;
  });
  const hasModalOverlay = createMemo(() => ui.deleteModal.open || ui.overlays.about || ui.overlays.search || ui.overlays.exportAll);

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

  function closeOverlay(name: "about" | "search" | "exportAll") {
    setOverlay(name, false);
    requestEditorFocus();
  }

  function openSearch() {
    if (isBootstrapping()) {
      return;
    }

    closeContextMenu();
    closeDeleteModal();
    setOverlay("about", false);
    setOverlay("exportAll", false);
    setOverlay("search", true);
  }

  function openExportAllMenu() {
    if (isBootstrapping()) {
      return;
    }

    closeContextMenu();
    closeDeleteModal();
    setOverlay("about", false);
    setOverlay("search", false);
    setOverlay("exportAll", true);
  }

  function openAbout() {
    closeContextMenu();
    closeDeleteModal();
    setOverlay("search", false);
    setOverlay("exportAll", false);
    setOverlay("about", true);
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

  function handleNoteContextMenu(noteId: string, event: MouseEvent) {
    if (isBootstrapping()) {
      return;
    }

    event.preventDefault();
    const menuWidth = 168;
    const menuHeight = 132;
    const x = Math.min(event.clientX + 8, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY + 8, window.innerHeight - menuHeight - 8);

    openContextMenu(noteId, Math.max(8, x), Math.max(8, y));
  }

  function handleExport(format: NoteExportFormat) {
    const note = contextNote();

    if (!note) {
      return;
    }

    exportNote(note, format);
    closeContextMenu();
  }

  function handleDeleteRequest() {
    const note = contextNote();

    if (!note) {
      return;
    }

    openDeleteModal(note.id);
    closeContextMenu();
  }

  async function handleDeleteConfirm() {
    const note = deleteNote();

    if (!note) {
      return;
    }

    await removeStoredNote(note.id);

    if (ui.openTabs.includes(note.id)) {
      handleCloseTab(note.id);
    }

    closeDeleteModal();
    requestEditorFocus();
  }

  function handleOverlayBackdropClick(event: MouseEvent) {
    if (event.target !== event.currentTarget) {
      return;
    }

    closeTransientUi();
    requestEditorFocus();
  }

  async function handleExportAll(format: NoteExportFormat) {
    const zip = new JSZip();
    const usedFilenames = new Set<string>();

    for (const note of notes.items) {
      zip.file(getDedupedExportFilename(note, format, usedFilenames), note.body);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = formatDateStamp(Date.now());

    link.href = url;
    link.download = `brev-export-${today}.zip`;
    document.body.append(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);

    closeOverlay("exportAll");
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
      const hasTransientUi =
        ui.contextMenu.open ||
        ui.deleteModal.open ||
        ui.overlays.about ||
        ui.overlays.search ||
        ui.overlays.exportAll;
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;
      const canSwitchTabs = hasPrimaryModifier && !event.metaKey;
      const hasFallbackTabModifier = event.altKey && !event.ctrlKey && !event.metaKey;

      if (event.key === "Escape") {
        if (ui.contextMenu.open || ui.deleteModal.open || ui.overlays.about || ui.overlays.search || ui.overlays.exportAll) {
          event.preventDefault();
          closeTransientUi();
          requestEditorFocus();
        }

        return;
      }

      if (hasPrimaryModifier && event.key.toLowerCase() === "k") {
        event.preventDefault();

        if (!ui.overlays.search) {
          openSearch();
        }

        return;
      }

      if (hasTransientUi) {
        return;
      }

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
      <div class={`flex min-h-screen bg-bg text-text-primary ${notes.storageError ? "pt-[49px]" : ""}`}>
      <Show when={notes.storageError}>
        {(message) => (
          <div
            class="fixed inset-x-0 top-0 z-50 border-b border-danger bg-surface px-4 py-3 text-sm text-danger"
            role="alert"
            aria-live="assertive"
          >
            <div class="mx-auto max-w-[1200px]">{message()}</div>
          </div>
        )}
      </Show>

      <div class="flex min-h-screen flex-1" aria-hidden={hasModalOverlay() ? "true" : undefined}>
        <Sidebar
          groups={noteGroups()}
          activeNoteId={ui.activeNoteId}
          theme={ui.theme}
          isLoading={notes.isLoading}
          isBootstrapping={isBootstrapping()}
          onCreateNote={() => void handleCreateNote()}
          onSelectNote={openNote}
          onNoteContextMenu={handleNoteContextMenu}
          onOpenSearch={openSearch}
          onToggleTheme={toggleTheme}
          onExportAll={openExportAllMenu}
          onOpenAbout={openAbout}
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

      <Show when={ui.contextMenu.open || ui.deleteModal.open || ui.overlays.about || ui.overlays.search || ui.overlays.exportAll}>
        <div class="fixed inset-0 z-20 bg-overlay" role="presentation" onMouseDown={handleOverlayBackdropClick} />
      </Show>

      <SearchOverlay
        open={ui.overlays.search}
        notes={notes.items}
        onClose={() => closeOverlay("search")}
        onOpenNote={openNote}
      />

      <ContextMenu
        open={ui.contextMenu.open}
        x={ui.contextMenu.x}
        y={ui.contextMenu.y}
        exportOpen={ui.contextMenu.exportOpen}
        noteTitle={deriveTitle(contextNote()?.body ?? "")}
        onClose={() => {
          closeContextMenu();
          requestEditorFocus();
        }}
        onToggleExport={() => setContextMenuExportOpen(!ui.contextMenu.exportOpen)}
        onExport={handleExport}
        onDelete={handleDeleteRequest}
      />

      <DeleteModal
        open={ui.deleteModal.open}
        noteTitle={deriveTitle(deleteNote()?.body ?? "")}
        onCancel={() => {
          closeDeleteModal();
          requestEditorFocus();
        }}
        onConfirm={() => void handleDeleteConfirm()}
      />

      <AboutOverlay open={ui.overlays.about} onClose={() => closeOverlay("about")} />

      <div class="pointer-events-none fixed bottom-0 left-0 z-30 w-[240px] px-2 pb-14">
        <div class="pointer-events-auto relative">
          <ExportAllMenu open={ui.overlays.exportAll} onExport={(format) => void handleExportAll(format)} />
        </div>
      </div>
    </div>
  );
}
