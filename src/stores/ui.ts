import { createStore } from "solid-js/store";

const THEME_STORAGE_KEY = "brev-theme";

export type ThemeName = "light" | "dark";

type OverlayState = {
  commandPalette: boolean;
  settings: boolean;
};

type ContextState = {
  noteId: string | null;
  x: number;
  y: number;
  open: boolean;
};

type UiState = {
  activeNoteId: string | null;
  openTabs: string[];
  theme: ThemeName;
  overlays: OverlayState;
  contextMenu: ContextState;
};

const [uiState, setUiState] = createStore<UiState>({
  activeNoteId: null,
  openTabs: [],
  theme: "light",
  overlays: {
    commandPalette: false,
    settings: false
  },
  contextMenu: {
    noteId: null,
    x: 0,
    y: 0,
    open: false
  }
});

function applyTheme(theme: ThemeName) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function initializeTheme() {
  if (typeof window === "undefined") {
    return uiState.theme;
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
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

  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
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
  const nextTabs = uiState.openTabs.filter((tabId) => tabId !== noteId);

  setUiState("openTabs", nextTabs);

  if (uiState.activeNoteId === noteId) {
    const nextTab = nextTabs[0] ?? null;
    setUiState("activeNoteId", nextTab);
  }
}

export function setOverlay(name: keyof OverlayState, open: boolean) {
  setUiState("overlays", name, open);
}

export function openContextMenu(noteId: string | null, x: number, y: number) {
  setUiState("contextMenu", {
    noteId,
    x,
    y,
    open: true
  });
}

export function closeContextMenu() {
  setUiState("contextMenu", "open", false);
}
