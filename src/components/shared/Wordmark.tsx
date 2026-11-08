// The surrounding link supplies the accessible name.
export default function Wordmark() {
  return (
    <span class="brand-wordmark" aria-hidden="true" translate="no">
      <img
        class="brand-tile"
        src={`${import.meta.env.BASE_URL}favicon.svg`}
        width="22"
        height="22"
        alt=""
        aria-hidden="true"
      />
      <span>interleaf</span>
    </span>
  );
}
