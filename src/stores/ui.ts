import { createStore } from "solid-js/store";

const THEME_STORAGE_KEY = "interleaf-theme";

export type ThemeName = "light" | "dark";

type OverlayState = {
  commandPalette: boolean;
  settings: boolean;
  search: boolean;
  exportAll: boolean;
};

type ContextState = {
  noteId: string | null;
  x: number;
  y: number;
  open: boolean;
  exportOpen: boolean;
};

type DeleteState = {
  noteId: string | null;
  open: boolean;
};

type UiState = {
  activeNoteId: string | null;
  openTabs: string[];
  theme: ThemeName;
  overlays: OverlayState;
  contextMenu: ContextState;
  deleteModal: DeleteState;
};

const [uiState, setUiState] = createStore<UiState>({
  activeNoteId: null,
  openTabs: [],
  theme: "light",
  overlays: {
    commandPalette: false,
    settings: false,
    search: false,
    exportAll: false
  },
  contextMenu: {
    noteId: null,
    x: 0,
    y: 0,
    open: false,
    exportOpen: false
  },
  deleteModal: {
    noteId: null,
    open: false
  }
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

  if (noteId) {
    setUiState("openTabs", (tabs) => (tabs.includes(noteId) ? tabs : [...tabs, noteId]));
  }
}

export function openTab(noteId: string) {
  setUiState("openTabs", (tabs) => (tabs.includes(noteId) ? tabs : [...tabs, noteId]));
}

export function closeTab(noteId: string) {
  const currentTabs = uiState.openTabs;
  const tabIndex = currentTabs.indexOf(noteId);
  const nextTabs = uiState.openTabs.filter((tabId) => tabId !== noteId);

  setUiState("openTabs", nextTabs);

  if (uiState.activeNoteId === noteId) {
    const nextTab = (tabIndex > 0 ? currentTabs[tabIndex - 1] : currentTabs[tabIndex + 1]) ?? null;
    setUiState("activeNoteId", nextTab);
  }
}

export function cycleTabs(direction: 1 | -1) {
  const tabs = uiState.openTabs;

  if (tabs.length === 0) {
    return null;
  }

  const activeIndex = uiState.activeNoteId ? tabs.indexOf(uiState.activeNoteId) : -1;
  const startIndex = activeIndex >= 0 ? activeIndex : direction > 0 ? -1 : 0;
  const nextIndex = (startIndex + direction + tabs.length) % tabs.length;
  const nextTab = tabs[nextIndex] ?? null;

  setUiState("activeNoteId", nextTab);

  return nextTab;
}

export function setOverlay(name: keyof OverlayState, open: boolean) {
  setUiState("overlays", name, open);
}

export function openContextMenu(noteId: string | null, x: number, y: number) {
  setUiState("contextMenu", {
    noteId,
    x,
    y,
    open: true,
    exportOpen: false
  });
}

export function setContextMenuExportOpen(open: boolean) {
  setUiState("contextMenu", "exportOpen", open);
}

export function closeContextMenu() {
  setUiState("contextMenu", {
    noteId: null,
    x: 0,
    y: 0,
    open: false,
    exportOpen: false
  });
}

export function openDeleteModal(noteId: string) {
  setUiState("deleteModal", {
    noteId,
    open: true
  });
}

export function closeDeleteModal() {
  setUiState("deleteModal", {
    noteId: null,
    open: false
  });
}

export function closeTransientUi() {
  closeContextMenu();
  closeDeleteModal();
  setOverlay("search", false);
  setOverlay("exportAll", false);
}
