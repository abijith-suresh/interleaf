import JSZip from "jszip";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  HiOutlineBars3,
  HiOutlinePlus,
  HiOutlineSun,
  HiOutlineMoon,
  HiOutlineMagnifyingGlass,
  HiOutlineArrowDownOnSquare,
} from "solid-icons/hi";

import DeleteModal from "@/components/DeleteModal";
import Editor from "@/components/Editor";
import ExportAllModal from "@/components/ExportAllModal";
import NoteActionsMenu from "@/components/NoteActionsMenu";
import SearchOverlay from "@/components/SearchOverlay";
import Sidebar, { groupNotesByDay } from "@/components/Sidebar";
import {
  createStoredNote,
  refreshNotes,
  removeStoredNote,
  upsertStoredNote,
  useNotes,
} from "@/stores/notes";
import {
  closeNoteActionsMenu,
  closeDeleteModal,
  closeSidebar,
  closeTransientUi,
  openNoteActionsMenu,
  openDeleteModal,
  setActiveNote,
  setOverlay,
  toggleSidebar,
  toggleTheme,
  useUi,
} from "@/stores/ui";
import {
  type NoteExportFormat,
  exportNote,
  formatDateStamp,
  getDedupedExportFilename,
} from "@/utils/exportNote";

export default function AppShell() {
  const notes = useNotes();
  const ui = useUi();
  const [focusToken, setFocusToken] = createSignal(0);
  const [isBootstrapping, setIsBootstrapping] = createSignal(true);

  const notesById = createMemo(
    () => new Map(notes.items.map((note) => [note.id, note])),
  );
  const noteGroups = createMemo(() => groupNotesByDay(notes.items));
  const activeNote = createMemo(() => {
    const activeNoteId = ui.activeNoteId;
    return activeNoteId ? notesById().get(activeNoteId) : undefined;
  });
  const actionsNote = createMemo(() => {
    const noteId = ui.noteActionsMenu.noteId;
    return noteId ? notesById().get(noteId) : undefined;
  });
  const deleteNote = createMemo(() => {
    const noteId = ui.deleteModal.noteId;
    return noteId ? notesById().get(noteId) : undefined;
  });
  const hasModalOverlay = createMemo(
    () => ui.deleteModal.open || ui.overlays.search || ui.overlays.exportAll,
  );

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

  function closeOverlay(name: "search" | "exportAll") {
    setOverlay(name, false);
    requestEditorFocus();
  }

  function openSearch() {
    if (isBootstrapping()) {
      return;
    }
    closeNoteActionsMenu();
    closeDeleteModal();
    setOverlay("exportAll", false);
    setOverlay("search", true);
  }

  function openExportAllMenu() {
    if (isBootstrapping()) {
      return;
    }
    closeSidebar();
    closeNoteActionsMenu();
    closeDeleteModal();
    setOverlay("search", false);
    setOverlay("exportAll", true);
  }

  /** Open the export dropdown for a specific note. */
  function openNoteActions(noteId: string) {
    if (isBootstrapping()) {
      return;
    }
    closeDeleteModal();
    setOverlay("search", false);
    setOverlay("exportAll", false);
    openNoteActionsMenu(noteId);
  }

  /** Open the export dropdown for the active note. */
  function openActiveNoteActions() {
    const note = activeNote();
    if (!note || isBootstrapping()) {
      return;
    }
    openNoteActions(note.id);
  }

  async function handleCreateNote() {
    if (isBootstrapping()) {
      return;
    }

    // If the current note is already empty, just focus it
    if (activeNote()?.body.trim() === "") {
      requestEditorFocus();
      return;
    }

    // Look for any existing empty note and reuse it
    const emptyNote = notes.items.find((n) => n.body.trim() === "");
    if (emptyNote) {
      activateNote(emptyNote.id);
      return;
    }

    // No empty note exists — create a fresh one
    const note = await createStoredNote();
    activateNote(note.id);
  }

  async function handleSave(noteId: string, body: string) {
    await upsertStoredNote(noteId, { body });
  }

  /** Handle export triggered from the NoteActionsMenu (sidebar or topbar). */
  function handleExportNote(format: NoteExportFormat) {
    const note = actionsNote() ?? activeNote();
    if (!note) {
      return;
    }
    exportNote(note, format);
    closeNoteActionsMenu();
  }

  /** Triggered by the sidebar trash icon: close sidebar, then open delete modal. */
  function handleDeleteNoteRequest(noteId: string) {
    closeSidebar();
    openDeleteModal(noteId);
  }

  /** Triggered by the sidebar export icon: close sidebar, then open NoteActionsMenu. */
  function handleSidebarExportNote(noteId: string) {
    closeSidebar();
    openNoteActions(noteId);
  }

  async function handleDeleteConfirm() {
    const note = deleteNote();
    if (!note) {
      return;
    }
    await removeStoredNote(note.id);
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
      zip.file(
        getDedupedExportFilename(note, format, usedFilenames),
        note.body,
      );
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const today = formatDateStamp(Date.now());

    link.href = url;
    link.download = `interleaf-export-${today}.zip`;
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

        // Reuse an existing empty note if one exists — avoid creating a new
        // untitled note every time a tab is opened.
        const emptyNote = loadedNotes.find((n) => n.body.trim() === "");
        if (emptyNote) {
          activateNote(emptyNote.id);
        } else {
          const note = await createStoredNote();
          activateNote(note.id);
        }
      } finally {
        setIsBootstrapping(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const hasTransientUi =
        ui.noteActionsMenu.open ||
        ui.deleteModal.open ||
        ui.overlays.search ||
        ui.overlays.exportAll;
      const hasPrimaryModifier = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        if (ui.sidebarOpen) {
          event.preventDefault();
          closeSidebar();
          return;
        }
        if (
          ui.noteActionsMenu.open ||
          ui.deleteModal.open ||
          ui.overlays.search ||
          ui.overlays.exportAll
        ) {
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

      if (isBootstrapping()) {
        return;
      }
    };

    void handleInitialLoad();
    window.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  return (
    <div
      class={`flex min-h-screen bg-bg text-text-primary ${notes.storageError ? "pt-[49px]" : ""}`}
    >
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

      <Sidebar
        open={ui.sidebarOpen}
        onClose={closeSidebar}
        groups={noteGroups()}
        activeNoteId={ui.activeNoteId}
        isLoading={notes.isLoading}
        isBootstrapping={isBootstrapping()}
        onCreateNote={() => void handleCreateNote()}
        onSelectNote={openNote}
        onDeleteNote={handleDeleteNoteRequest}
        onExportNote={handleSidebarExportNote}
        onExportAll={openExportAllMenu}
      />

      <div
        class="flex min-h-screen flex-1"
        aria-hidden={hasModalOverlay() ? "true" : undefined}
      >
        <main class="flex min-w-0 flex-1 flex-col bg-bg">
          {/* Top bar */}
          <header class="relative flex h-10 shrink-0 items-center border-b border-border bg-surface px-4">
            {/* Left: sidebar toggle */}
            <button
              type="button"
              aria-label="Toggle sidebar"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-all duration-150 hover:text-text-primary active:scale-95"
              onClick={() => toggleSidebar()}
            >
              <HiOutlineBars3 size={18} />
            </button>

            {/* Center: wordmark — absolutely centered */}
            <div class="absolute left-1/2 -translate-x-1/2">
              <a
                href="/"
                class="font-serif text-lg italic font-normal text-text-primary"
              >
                interleaf
              </a>
            </div>

            {/* Right: action cluster */}
            <div class="ml-auto flex items-center gap-1">
              {/* Search */}
              <button
                type="button"
                aria-label="Search notes (Cmd+K)"
                disabled={isBootstrapping()}
                class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-all duration-150 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
                onClick={() => openSearch()}
              >
                <HiOutlineMagnifyingGlass size={16} />
              </button>

              {/* Export current note (only when a note is active) */}
              <Show when={activeNote()}>
                <button
                  type="button"
                  aria-label="Export current note"
                  class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-all duration-150 hover:text-text-primary active:scale-95"
                  onClick={() => openActiveNoteActions()}
                >
                  <HiOutlineArrowDownOnSquare size={16} />
                </button>
              </Show>

              {/* New note */}
              <button
                type="button"
                aria-label="New note"
                disabled={isBootstrapping()}
                class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-all duration-150 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 active:scale-95"
                onClick={() => void handleCreateNote()}
              >
                <HiOutlinePlus size={16} />
              </button>

              {/* Theme toggle */}
              <button
                type="button"
                aria-label={`Switch to ${ui.theme === "light" ? "dark" : "light"} theme`}
                class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-all duration-150 hover:text-text-primary active:scale-95"
                onClick={() => toggleTheme()}
              >
                {ui.theme === "light" ? (
                  <span class="animate-icon-in inline-flex">
                    <HiOutlineMoon size={16} />
                  </span>
                ) : (
                  <span class="animate-icon-in inline-flex">
                    <HiOutlineSun size={16} />
                  </span>
                )}
              </button>
            </div>
          </header>

          <Editor
            note={activeNote()}
            focusToken={focusToken()}
            onSave={handleSave}
          />
        </main>
      </div>

      {/* Global overlay backdrop — always rendered so it can fade out as well as in */}
      <div
        class={`fixed inset-0 z-20 bg-overlay transition-opacity duration-200 ${
          ui.noteActionsMenu.open ||
          ui.deleteModal.open ||
          ui.overlays.search ||
          ui.overlays.exportAll
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        role="presentation"
        onMouseDown={handleOverlayBackdropClick}
      />

      <SearchOverlay
        open={ui.overlays.search}
        notes={notes.items}
        onClose={() => closeOverlay("search")}
        onOpenNote={openNote}
      />

      {/* Note export menu — for both topbar and sidebar hover */}
      <NoteActionsMenu
        open={ui.noteActionsMenu.open}
        onClose={() => {
          closeNoteActionsMenu();
          requestEditorFocus();
        }}
        onExport={handleExportNote}
      />

      <DeleteModal
        open={ui.deleteModal.open}
        noteTitle={
          deleteNote()
            ? deleteNote()!.body.trim().split(/\r?\n/)[0]?.slice(0, 40) ||
              "Untitled note"
            : "Untitled note"
        }
        onCancel={() => {
          closeDeleteModal();
          requestEditorFocus();
        }}
        onConfirm={() => void handleDeleteConfirm()}
      />

      <ExportAllModal
        open={ui.overlays.exportAll}
        onClose={() => closeOverlay("exportAll")}
        onExport={(format) => void handleExportAll(format)}
      />
    </div>
  );
}
