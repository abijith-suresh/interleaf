<!-- Entries below this line were manually maintained prior to automated release management -->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.2](https://github.com/abijith-suresh/interleaf/compare/v0.6.1...v0.6.2) (2026-05-22)


### Features

* rebrand from Quire to Interleaf ([#136](https://github.com/abijith-suresh/interleaf/issues/136)) ([85c6e6f](https://github.com/abijith-suresh/interleaf/commit/85c6e6f0b590cb1c50e7eb51bcf84779815ca6d4))

## [Unreleased]

## [0.6.1] - 2026-04-29

### Changed

- Reworked the editor's PDF backend to cache documents per source file, keeping mixed-PDF thumbnail rendering stable across upload, add, and rotate flows.
- Pulled page-state mutations into a controller helper and deduplicated PDF build/extract internals to keep editor workflow logic easier to evolve and test.

### Fixed

- Removed the legacy `pdf-loaded` viewer path and hardened the unit/E2E regression coverage around encrypted-PDF workflows and editor session state.

## [0.6.0] - 2026-03-28

### Added

- Quire branding and release polish across the landing page, metadata, assets, and editor-facing copy.

### Changed

- Renamed Pasta to Quire across the editor, site copy, metadata, and output filenames.
- Prepared the mature editor workflow for a real public launch without using `1.0.0` yet.

## [0.5.0] - 2026-02-27

### Added

- Pasta's mature browser editor phase with the Solid.js `/app` migration, unit tests for services and utilities, and a cleaner open-source site structure.

### Changed

- Removed the blog, reorganized footer/navigation, and polished assets for the last major pre-rebrand product line.

## [0.4.1] - 2026-02-20

### Changed

- Improved drag-and-drop responsiveness with DOM-only reordering, insertion cues, and lighter rendering work.

### Fixed

- Render race conditions, accessibility violations, memory leaks, encrypted-PDF cleanup, and pre-release copy and CI issues.

## [0.4.0] - 2026-02-19

### Added

- Encrypted PDF handling, SEO meta and OG image generation, and Pasta's first blog and changelog content collections.

### Changed

- Expanded the publishable web presence with feature, about, blog, and legal pages plus stronger release-ready metadata.

## [0.3.0] - 2026-02-19

### Added

- The V6 hybrid Swiss design, shared navigation/footer, and SPA-like transitions that turned Pasta into a more polished editor and marketing site.

### Changed

- Redesigned both the landing experience and the editor UI for a stronger product identity.

## [0.2.0] - 2026-02-17

### Added

- The first true single-page PDF editor with merge, extract, reorder, rotate, and delete operations.
- Shared infrastructure and clean-architecture organization for the editor workflow.

## [0.1.0] - 2026-02-16

### Added

- Pasta's first usable baseline with PDF upload, viewing, rendering services, and drag-and-drop intake.

[unreleased]: https://github.com/abijith-suresh/interleaf/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/abijith-suresh/interleaf/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/abijith-suresh/interleaf/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/abijith-suresh/interleaf/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/abijith-suresh/interleaf/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/abijith-suresh/interleaf/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/abijith-suresh/interleaf/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/abijith-suresh/interleaf/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/abijith-suresh/interleaf/releases/tag/v0.1.0
