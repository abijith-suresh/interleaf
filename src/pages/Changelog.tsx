import SimplePage from "@/components/SimplePage";
import { appMeta } from "@/utils/meta";

export default function Changelog() {
  return (
    <SimplePage title="Changelog">
      <p>All notable changes to this project are documented in the root CHANGELOG.md.</p>
      <p>Current baseline release: v{appMeta.version}.</p>
      <p>v0.1.0 establishes the initial interleaf baseline with the local-first notes app shell, standalone documentation pages, and static multi-page Vite setup.</p>
    </SimplePage>
  );
}
