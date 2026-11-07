// The wordmark from src/components/shared/Wordmark.astro, for the editor.
// The link around it carries the accessible name.
export default function EditorWordmark() {
  return (
    <span class="brand-wordmark" aria-hidden="true" translate="no">
      <span class="brand-i">
        ı
        <svg class="brand-leaf" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 9A6.9 6.9 0 0 1 9 1A6.9 6.9 0 0 1 1 9z" />
        </svg>
      </span>
      nterleaf
    </span>
  );
}
