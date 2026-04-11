import SimplePage from "@/components/SimplePage";

export default function Privacy() {
  return (
    <SimplePage title="Privacy">
      <p>interleaf does not require an account and does not send notes to a server.</p>
      <p>Notes are intended to live only in this browser using local storage mechanisms such as IndexedDB.</p>
      <p>Clearing browser storage can remove notes, so exports are the intended backup path.</p>
    </SimplePage>
  );
}
