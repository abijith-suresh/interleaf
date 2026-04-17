import { createStore } from "solid-js/store";

const THEME_STORAGE_KEY = "interleaf-theme";

export type ThemeName = "light" | "dark";

type OverlayState = {
  commandPalette: boolean;
  settings: boolean;
  search: boolean;
  exportAll: boolean;
  noteActions: boolean;
};

type NoteActionsState = {
  noteId: string | null;
  open: boolean;
};

type DeleteState = {
  noteId: string | null;
  open: boolean;
};

type UiState = {
  activeNoteId: string | null;
  sidebarOpen: boolean;
  theme: ThemeName;
  overlays: OverlayState;
  noteActionsMenu: NoteActionsState;
  deleteModal: DeleteState;
};

const [uiState, setUiState] = createStore<UiState>({
  activeNoteId: null,
  sidebarOpen: false,
  theme: "light",
  overlays: {
    commandPalette: false,
    settings: false,
    search: false,
    exportAll: false,
    noteActions: false,
  },
  noteActionsMenu: {
    noteId: null,
    open: false,
  },
  deleteModal: {
    noteId: null,
    open: false,
  },
});

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute("data-theme", theme);
}

function readStoredTheme() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredTheme(theme: ThemeName) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable in constrained browser sessions.
  }
}

export function initializeTheme() {
  const storedTheme = readStoredTheme();
  const theme: ThemeName = storedTheme === "dark" ? "dark" : "light";

  setUiState("theme", theme);
  applyTheme(theme);

  return theme;
}

export function useUi() {
  return uiState;
}

export function setTheme(theme: ThemeName) {
  setUiState("theme", theme);
  applyTheme(theme);
  writeStoredTheme(theme);
}

export function toggleTheme() {
  setTheme(uiState.theme === "light" ? "dark" : "light");
}

export function setActiveNote(noteId: string | null) {
  setUiState("activeNoteId", noteId);
}

export function openSidebar() {
  setUiState("sidebarOpen", true);
}

export function closeSidebar() {
  setUiState("sidebarOpen", false);
}

export function toggleSidebar() {
  setUiState("sidebarOpen", (v) => !v);
}

export function setOverlay(name: keyof OverlayState, open: boolean) {
  setUiState("overlays", name, open);
}

export function openNoteActionsMenu(noteId: string) {
  setUiState("noteActionsMenu", {
    noteId,
    open: true,
  });
}

export function closeNoteActionsMenu() {
  setUiState("noteActionsMenu", {
    noteId: null,
    open: false,
  });
}

export function openDeleteModal(noteId: string) {
  setUiState("deleteModal", {
    noteId,
    open: true,
  });
}

export function closeDeleteModal() {
  setUiState("deleteModal", {
    noteId: null,
    open: false,
  });
}

export function closeTransientUi() {
  closeNoteActionsMenu();
  closeDeleteModal();
  setOverlay("search", false);
  setOverlay("exportAll", false);
  closeSidebar();
}
