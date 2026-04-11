import SimplePage from "@/components/SimplePage";

export default function KeyboardShortcuts() {
  return (
    <SimplePage title="Keyboard Shortcuts">
      <p>interleaf keeps shortcuts focused on combinations that work more reliably in the browser.</p>
      <ul class="m-0 pl-5">
        <li><code>Ctrl/Cmd+N</code>: create a new note</li>
        <li><code>Ctrl/Cmd+K</code>: open search</li>
        <li><code>Ctrl/Cmd+W</code>: close the active tab</li>
        <li><code>Ctrl+PageDown</code>: switch to the next open tab</li>
        <li><code>Ctrl+PageUp</code>: switch to the previous open tab</li>
        <li><code>Alt+]</code>: switch to the next open tab</li>
        <li><code>Alt+[</code>: switch to the previous open tab</li>
        <li><code>Escape</code>: close search, menus, or dialogs</li>
      </ul>
      <p><code>Ctrl+Tab</code> and <code>Ctrl+Shift+Tab</code> are intentionally not supported because browsers commonly reserve them for browser tab switching.</p>
      <p>Use <code>Ctrl+PageDown</code> and <code>Ctrl+PageUp</code>, or <code>Alt+[</code> and <code>Alt+]</code>, as the in-app alternatives.</p>
    </SimplePage>
  );
}
