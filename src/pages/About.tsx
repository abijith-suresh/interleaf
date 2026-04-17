import SimplePage from "@/components/SimplePage";

export default function About() {
  return (
    <SimplePage title="About">
      <div class="divide-y divide-border-subtle">
        <section class="scroll-mt-8 pb-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            What is interleaf
          </h2>
          <p>
            interleaf is a calm scratchpad for short-lived work notes. It opens
            directly into writing — no dashboard, no onboarding, no empty state
            asking you to create your first project. Just a cursor and a blank
            page.
          </p>
          <p class="mt-4">
            Notes live in your browser. There are no accounts to create, no
            cloud to sync to, and no AI features to dismiss. interleaf does one
            thing and tries to stay out of your way while doing it.
          </p>
        </section>

        <section class="scroll-mt-8 py-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            Why it exists
          </h2>
          <p>
            Most note-taking apps want to be your "second brain." They offer
            databases, backlinks, templates, and collaboration. That's fine for
            long-lived knowledge. But most of what you actually write day-to-day
            is temporary — a phone number, a meeting outline, a draft email, a
            list of things to buy on the way home.
          </p>
          <p class="mt-4">
            Those notes don't need a folder hierarchy. They don't need to be
            shared. They need to be written quickly, found easily, and discarded
            when they're no longer useful. interleaf is built for that kind of
            writing.
          </p>
        </section>

        <section class="scroll-mt-8 py-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            Local-first philosophy
          </h2>
          <p>
            Your notes are stored in this browser using IndexedDB. Nothing
            leaves your device. There is no server component, no API, no
            database running somewhere else. When you close the tab, your notes
            are still here. When you come back tomorrow, they're waiting.
          </p>
          <p class="mt-4">
            This means interleaf works offline. Once the app is loaded, it
            doesn't need a network connection. You can install it as a PWA and
            treat it like any other application on your device.
          </p>
          <p class="mt-4">
            The trade-off is intentional: notes live in one browser on one
            device. If you clear your browser storage, notes go with it. Export
            is the intended backup path — plain text, Markdown, or a ZIP archive
            of everything.
          </p>
        </section>

        <section class="scroll-mt-8 pt-8">
          <h2 class="mb-4 font-sans text-[11px] font-medium uppercase tracking-[0.12em] text-text-tertiary">
            Open source
          </h2>
          <p>
            interleaf is open-source and designed to be deployed as a static
            site. You can run it yourself, audit the code, or adapt it to your
            own needs. No part of the application depends on a paid service or a
            proprietary backend.
          </p>
          <p class="mt-4">
            The source code is available on{" "}
            <a
              href="https://github.com/abijith-suresh/interleaf"
              target="_blank"
              rel="noopener noreferrer"
              class="text-accent underline decoration-accent/30 underline-offset-2 transition-colors duration-150 hover:decoration-accent"
            >
              GitHub
            </a>
            . Contributions, issues, and ideas are welcome.
          </p>
        </section>
      </div>
    </SimplePage>
  );
}
