import JSZip from "jszip";
import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  HiOutlineBars3,
  HiOutlinePlus,
  HiOutlineSun,
  HiOutlineMoon,
} from "solid-icons/hi";

import ContextMenu from "@/components/ContextMenu";
import DeleteModal from "@/components/DeleteModal";
import Editor from "@/components/Editor";
import ExportAllMenu from "@/components/ExportAllMenu";
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
  closeContextMenu,
  closeTransientUi,
  closeDeleteModal,
  closeSidebar,
  openContextMenu,
  openDeleteModal,
  setActiveNote,
  setContextMenuExportOpen,
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
import { deriveTitle } from "@/utils/deriveTitle";

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
  const contextNote = createMemo(() => {
    const noteId = ui.contextMenu.noteId;

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

    closeContextMenu();
    closeDeleteModal();
    setOverlay("exportAll", false);
    setOverlay("search", true);
  }

  function openExportAllMenu() {
    if (isBootstrapping()) {
      return;
    }

    closeContextMenu();
    closeDeleteModal();
    setOverlay("search", false);
    setOverlay("exportAll", true);
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
        await refreshNotes();
        const note = await createStoredNote();
        activateNote(note.id);
      } finally {
        setIsBootstrapping(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const hasTransientUi =
        ui.contextMenu.open ||
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
          ui.contextMenu.open ||
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
        theme={ui.theme}
        isLoading={notes.isLoading}
        isBootstrapping={isBootstrapping()}
        onCreateNote={() => void handleCreateNote()}
        onSelectNote={openNote}
        onNoteContextMenu={handleNoteContextMenu}
        onOpenSearch={openSearch}
        onToggleTheme={toggleTheme}
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
              class="mr-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:text-text-primary"
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

            {/* Right: new note + theme toggle */}
            <button
              type="button"
              aria-label="New note"
              disabled={isBootstrapping()}
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleCreateNote()}
            >
              <HiOutlinePlus size={16} />
            </button>
            <button
              type="button"
              aria-label={`Switch to ${ui.theme === "light" ? "dark" : "light"} theme`}
              class="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors duration-150 hover:text-text-primary"
              onClick={() => toggleTheme()}
            >
              {ui.theme === "light" ? (
                <HiOutlineMoon size={16} />
              ) : (
                <HiOutlineSun size={16} />
              )}
            </button>
          </header>

          <Editor
            note={activeNote()}
            focusToken={focusToken()}
            onSave={handleSave}
          />
        </main>
      </div>

      <Show
        when={
          ui.contextMenu.open ||
          ui.deleteModal.open ||
          ui.overlays.search ||
          ui.overlays.exportAll
        }
      >
        <div
          class="fixed inset-0 z-20 bg-overlay"
          role="presentation"
          onMouseDown={handleOverlayBackdropClick}
        />
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
        onToggleExport={() =>
          setContextMenuExportOpen(!ui.contextMenu.exportOpen)
        }
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

      <div class="pointer-events-none fixed bottom-0 left-0 z-30 w-[232px] px-2 pb-14">
        <div class="pointer-events-auto relative">
          <ExportAllMenu
            open={ui.overlays.exportAll}
            onExport={(format) => void handleExportAll(format)}
          />
        </div>
      </div>
    </div>
  );
}
