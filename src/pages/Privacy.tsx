import SimplePage from "@/components/SimplePage";

export default function Privacy() {
  return (
    <SimplePage title="Privacy">
      <div class="divide-y divide-border-subtle">
        <section class="scroll-mt-8 pb-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            No accounts, no servers
          </h2>
          <p>
            interleaf does not require an account. There is no sign-up form, no
            email verification, no password to remember. The app loads in your
            browser and starts working immediately.
          </p>
          <p class="mt-4">
            Because there is no server component, there is nothing to breach, no
            database to compromise, and no credentials to steal. The application
            is a static site — HTML, CSS, and JavaScript served from a CDN.
          </p>
        </section>

        <section class="scroll-mt-8 py-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            Your data stays in this browser
          </h2>
          <p>
            Notes are stored locally using IndexedDB, a browser-native storage
            mechanism. No note content is ever transmitted over the network. The
            app does not make API calls, open WebSockets, or communicate with
            any backend.
          </p>
          <p class="mt-4">
            What you write stays on your device until you decide to export it or
            clear your browser data.
          </p>
        </section>

        <section class="scroll-mt-8 py-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            Export is your backup
          </h2>
          <p>
            Because notes live only in browser storage, clearing your browsing
            data can remove them. interleaf treats export as the primary backup
            path — not as an afterthought.
          </p>
          <p class="mt-4">
            You can export any note as plain text or Markdown. You can also
            export all notes at once as a ZIP archive. These files are standard
            formats that any text editor can open. Your words are never locked
            in.
          </p>
        </section>

        <section class="scroll-mt-8 pt-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            What we don't do
          </h2>
          <ul class="m-0 list-none space-y-5 pl-0">
            <li class="flex gap-3">
              <span class="mt-0.5 font-normal leading-none text-accent">—</span>
              <div>
                <span class="text-text-primary">No tracking or analytics.</span>
                <p class="mt-1 text-sm text-text-secondary">
                  interleaf does not use Google Analytics or any third-party
                  tracking. There are no page views counted, no events recorded,
                  no user behavior profiled.
                </p>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="mt-0.5 font-normal leading-none text-accent">—</span>
              <div>
                <span class="text-text-primary">No cookies.</span>
                <p class="mt-1 text-sm text-text-secondary">
                  The app stores a single preference (your theme choice) in
                  localStorage. No cookies are set, read, or shared.
                </p>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="mt-0.5 font-normal leading-none text-accent">—</span>
              <div>
                <span class="text-text-primary">No third-party services.</span>
                <p class="mt-1 text-sm text-text-secondary">
                  interleaf does not embed third-party scripts, fonts fetched
                  from external CDNs, or remote dependencies at runtime.
                  Everything needed to run the app is bundled at build time.
                </p>
              </div>
            </li>
            <li class="flex gap-3">
              <span class="mt-0.5 font-normal leading-none text-accent">—</span>
              <div>
                <span class="text-text-primary">No AI features.</span>
                <p class="mt-1 text-sm text-text-secondary">
                  There are no autocomplete suggestions, AI summaries, or
                  generated content. What you write is what you get.
                </p>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </SimplePage>
  );
}
