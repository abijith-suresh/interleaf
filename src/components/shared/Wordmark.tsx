// The surrounding link supplies the accessible name.
export default function Wordmark() {
  return (
    <span class="brand-wordmark" aria-hidden="true" translate="no">
      <img
        class="brand-tile"
        src={`${import.meta.env.BASE_URL}mark.svg`}
        width="28"
        height="28"
        alt=""
        aria-hidden="true"
      />
      <span>interleaf</span>
    </span>
  );
}
