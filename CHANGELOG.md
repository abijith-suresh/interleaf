# Changelog

## [0.0.15](https://github.com/abijith-suresh/interleaf/compare/v0.0.14...v0.0.15) (2026-11-11)


### Features

* add motion to editor controls ([#389](https://github.com/abijith-suresh/interleaf/issues/389)) ([585d89a](https://github.com/abijith-suresh/interleaf/commit/585d89a3c6e937f8647c26d2edcc4ce5969d15d4))
* add motion to marketing pages ([#390](https://github.com/abijith-suresh/interleaf/issues/390)) ([fa304d7](https://github.com/abijith-suresh/interleaf/commit/fa304d789b9b5663c2dfaca67975ad8779200789))
* group features into cards ([#385](https://github.com/abijith-suresh/interleaf/issues/385)) ([76329ac](https://github.com/abijith-suresh/interleaf/commit/76329accd741ba87f2ec6ee1d9e435b0de1aaecc))


### Bug Fixes

* keep focus on draft controls when clicked ([#391](https://github.com/abijith-suresh/interleaf/issues/391)) ([e6d1933](https://github.com/abijith-suresh/interleaf/commit/e6d1933ed64b676dda20b5a6c59e3076eb6ec767))
* stop page action drags from reordering pages ([#393](https://github.com/abijith-suresh/interleaf/issues/393)) ([fb9e430](https://github.com/abijith-suresh/interleaf/commit/fb9e430707a9baa7a8cd2b40ac4e87986aa20a9e))
* unify editor selection states ([#383](https://github.com/abijith-suresh/interleaf/issues/383)) ([49f528c](https://github.com/abijith-suresh/interleaf/commit/49f528cd62a8f023f5dd359c95e9574c846b771f))

## [0.0.14](https://github.com/abijith-suresh/interleaf/compare/v0.0.13...v0.0.14) (2026-11-08)


### Features

* **brand:** add the leaf accent and readable icon lockup ([#369](https://github.com/abijith-suresh/interleaf/issues/369)) ([2cd79dc](https://github.com/abijith-suresh/interleaf/commit/2cd79dc435770fec967c91b49b9e6b1ce05807d7))
* reorganise editor actions into a toolbar and selection bar ([#372](https://github.com/abijith-suresh/interleaf/issues/372)) ([99d5e06](https://github.com/abijith-suresh/interleaf/commit/99d5e0683c3d610d7137ecf4bbc4fd99b0bbe980))
* show the editor at work in the homepage hero ([#367](https://github.com/abijith-suresh/interleaf/issues/367)) ([a20753e](https://github.com/abijith-suresh/interleaf/commit/a20753ed5db6cce661eeb5fed5bef47f4d4ba5d7))


### Bug Fixes

* **editor:** fix file handling in open, compress, and export ([#368](https://github.com/abijith-suresh/interleaf/issues/368)) ([54511c1](https://github.com/abijith-suresh/interleaf/commit/54511c1a8e97b2476c541dc70edc7c16e2d2354c))
* **editor:** keep page grid selection, labels, and focus predictable ([#370](https://github.com/abijith-suresh/interleaf/issues/370)) ([e18662c](https://github.com/abijith-suresh/interleaf/commit/e18662ca7480d69dcd39da624a3db5f4fae5a3d0))
* **editor:** tidy Document view fields, targets, and tool state ([#364](https://github.com/abijith-suresh/interleaf/issues/364)) ([3929e87](https://github.com/abijith-suresh/interleaf/commit/3929e875a180c065fc05da27eb7ae33d6d9afd67))
* stop the editor from silently losing unsaved work ([#366](https://github.com/abijith-suresh/interleaf/issues/366)) ([4e857e1](https://github.com/abijith-suresh/interleaf/commit/4e857e12f5c404971878f5487523174a2f513461))

## [0.0.13](https://github.com/abijith-suresh/interleaf/compare/0.0.12...v0.0.13) (2026-11-06)


### Features

* add content security policy and security headers ([#345](https://github.com/abijith-suresh/interleaf/issues/345)) ([fbbc8ff](https://github.com/abijith-suresh/interleaf/commit/fbbc8ffda7ee57a6acbc042197b8272f13079108))


### Bug Fixes

* **a11y:** address accessibility audit findings ([#352](https://github.com/abijith-suresh/interleaf/issues/352)) ([4af5060](https://github.com/abijith-suresh/interleaf/commit/4af5060091f678387d655de67692acafe7acb069))
* allow form filling when OpenAction is a destination or GoTo ([#341](https://github.com/abijith-suresh/interleaf/issues/341)) ([4c77157](https://github.com/abijith-suresh/interleaf/commit/4c77157c4bc5906902a34e6a63e401bf53c3108b))
* block undo and redo while a Document draft is open ([#353](https://github.com/abijith-suresh/interleaf/issues/353)) ([32f0c95](https://github.com/abijith-suresh/interleaf/commit/32f0c955faef0b89a6db8170ab5b7fc7073fff82))
* cap canvas pixel sizes for PNG export and thumbnails ([#355](https://github.com/abijith-suresh/interleaf/issues/355)) ([2219c98](https://github.com/abijith-suresh/interleaf/commit/2219c9883992c6851c2d6f808c6f737a3ab11f28))
* copy export pages in batches to share resources ([#351](https://github.com/abijith-suresh/interleaf/issues/351)) ([413a153](https://github.com/abijith-suresh/interleaf/commit/413a153a800086bfa49eff34edff371b0df78841))
* **editor:** harden insecure contexts, no-op saves, stuck cleanup ([#346](https://github.com/abijith-suresh/interleaf/issues/346)) ([f091b64](https://github.com/abijith-suresh/interleaf/commit/f091b64b7ce84c28e5833cfe8bebafbb7afb876d))
* evict history only where it frees inactive source size ([#342](https://github.com/abijith-suresh/interleaf/issues/342)) ([a652b0e](https://github.com/abijith-suresh/interleaf/commit/a652b0e323771762eda8c78041d348ba1e5e272d))
* export password-protected PDFs from a qpdf-decrypted copy ([#349](https://github.com/abijith-suresh/interleaf/issues/349)) ([767b5d4](https://github.com/abijith-suresh/interleaf/commit/767b5d466d1394eadac729931c54989e0682609d))
* orient EXIF transpose and transverse JPEGs correctly ([#340](https://github.com/abijith-suresh/interleaf/issues/340)) ([01ce428](https://github.com/abijith-suresh/interleaf/commit/01ce428d073b76279f50b918f3eae48f9c5543d8))
* reuse pdf.js workers and edited-page builds ([#357](https://github.com/abijith-suresh/interleaf/issues/357)) ([4c86329](https://github.com/abijith-suresh/interleaf/commit/4c86329174f0ad8567eabd232750649783ba7d1c))
* treat missing PDF references as null during export ([#343](https://github.com/abijith-suresh/interleaf/issues/343)) ([3c63aa7](https://github.com/abijith-suresh/interleaf/commit/3c63aa7aea404353a32c902a7027a0f651eadcb0))


### Performance Improvements

* make marketing page navigation instant ([#360](https://github.com/abijith-suresh/interleaf/issues/360)) ([4433385](https://github.com/abijith-suresh/interleaf/commit/443338574e3cbd51e51af16fc6f318ccc9eb2706))

## [0.0.12](https://github.com/abijith-suresh/interleaf/compare/0.0.11...0.0.12) (2026-10-21)


### Features

* add editable text to document pages ([#324](https://github.com/abijith-suresh/interleaf/issues/324)) ([da0ecc3](https://github.com/abijith-suresh/interleaf/commit/da0ecc35cbc596eedbb8182cf9c04a21bb2b69cd))
* add manual checkmarks for flat PDF forms ([#325](https://github.com/abijith-suresh/interleaf/issues/325)) ([7341e1f](https://github.com/abijith-suresh/interleaf/commit/7341e1fb329c9896f1975fabdcfff0aa4d2c4249))
* add session page organization undo and redo ([#322](https://github.com/abijith-suresh/interleaf/issues/322)) ([f45af99](https://github.com/abijith-suresh/interleaf/commit/f45af99f4fecdb511ff4e62b33fff2b9d14275b1))
* duplicate pages in the workspace ([#320](https://github.com/abijith-suresh/interleaf/issues/320)) ([a09fcbd](https://github.com/abijith-suresh/interleaf/commit/a09fcbd1a078b610efb6fca9defa7add1c09c3f0))
* **editor:** add read-only preview zoom and pan ([#314](https://github.com/abijith-suresh/interleaf/issues/314)) ([d689ce2](https://github.com/abijith-suresh/interleaf/commit/d689ce276d6450d1d384ec65ec01e97f77e5fd39))
* **editor:** unify Pages and Document workspace views ([#315](https://github.com/abijith-suresh/interleaf/issues/315)) ([25085ba](https://github.com/abijith-suresh/interleaf/commit/25085baa612b96478cf8161039201ca8e80657ef))
* extend session history to source changes ([#323](https://github.com/abijith-suresh/interleaf/issues/323)) ([64edee4](https://github.com/abijith-suresh/interleaf/commit/64edee4b991e73c3b8a73f64ec421a3607047d3f))
* fill supported embedded PDF text fields ([#327](https://github.com/abijith-suresh/interleaf/issues/327)) ([e6b9784](https://github.com/abijith-suresh/interleaf/commit/e6b978404fc2cafda6e4844b79fb213457e4bea0))


### Bug Fixes

* center hero secondary column and cap about title width ([#297](https://github.com/abijith-suresh/interleaf/issues/297)) ([e2e473d](https://github.com/abijith-suresh/interleaf/commit/e2e473ddd2cf7a7bc228abedd670bba4f3d5c1b9))
* defer lazy PDF file release until execution ([#330](https://github.com/abijith-suresh/interleaf/issues/330)) ([fe0703c](https://github.com/abijith-suresh/interleaf/commit/fe0703c08b64bd79d3b334d9de2842e769b3cb65))
* **editor:** fit previews independently of bitmap budget ([#313](https://github.com/abijith-suresh/interleaf/issues/313)) ([5464248](https://github.com/abijith-suresh/interleaf/commit/5464248a356a151558f7967c64704e683a7325c8))
* **editor:** release offscreen PDF thumbnails ([#310](https://github.com/abijith-suresh/interleaf/issues/310)) ([f536414](https://github.com/abijith-suresh/interleaf/commit/f5364144c50ff18c2216ce3e45c6f46790b63af6))
* exclude omitted page data from PDF exports ([#326](https://github.com/abijith-suresh/interleaf/issues/326)) ([58e20ea](https://github.com/abijith-suresh/interleaf/commit/58e20eafeaa1b2fc24960dedcc09de9c6731cdd7))
* **marketing:** align FAQ intro and animate disclosure items ([#298](https://github.com/abijith-suresh/interleaf/issues/298)) ([04c7a12](https://github.com/abijith-suresh/interleaf/commit/04c7a1281269f3feb6861adddd4724d2e12a7bf2))
* prevent manual addition saves during exports ([#329](https://github.com/abijith-suresh/interleaf/issues/329)) ([b7e93ca](https://github.com/abijith-suresh/interleaf/commit/b7e93cab85d0177208df1731ca9656c195d65312))
* retain page focus after keyboard reorder ([#321](https://github.com/abijith-suresh/interleaf/issues/321)) ([f9bb9ab](https://github.com/abijith-suresh/interleaf/commit/f9bb9ab60e0634ba9766502134091b2f773562f3))
* unify feature section rows ([#300](https://github.com/abijith-suresh/interleaf/issues/300)) ([aa66082](https://github.com/abijith-suresh/interleaf/commit/aa660826c628372bf76afb3ea099229099b26004))

## [0.0.11](https://github.com/abijith-suresh/interleaf/compare/0.0.10...0.0.11) (2026-10-07)


### Bug Fixes

* align social previews with current branding ([#291](https://github.com/abijith-suresh/interleaf/issues/291)) ([ba3ffc8](https://github.com/abijith-suresh/interleaf/commit/ba3ffc8512c23598d04513a4d67ba975285fffb4))
* end the hard-refresh font swap flash ([#301](https://github.com/abijith-suresh/interleaf/issues/301)) ([c1b64f3](https://github.com/abijith-suresh/interleaf/commit/c1b64f3384690b9b34e84b73b720444da2ec07e1))
* **nav:** simplify mobile menu and quiet desktop CTA ([#299](https://github.com/abijith-suresh/interleaf/issues/299)) ([8a030dd](https://github.com/abijith-suresh/interleaf/commit/8a030dd2421aea3876d64873b74a4e3c51b4508b))
* update production domain and restore social previews ([#289](https://github.com/abijith-suresh/interleaf/issues/289)) ([8576c68](https://github.com/abijith-suresh/interleaf/commit/8576c68464539d4b049532bc90ef04c6e9556a79))

## [0.0.10](https://github.com/abijith-suresh/interleaf/compare/0.0.9...0.0.10) (2026-10-01)


### Features

* **editor:** compact the workspace action bar and page tiles ([#280](https://github.com/abijith-suresh/interleaf/issues/280)) ([8073646](https://github.com/abijith-suresh/interleaf/commit/8073646f67509c6b4fa0192c968c3a93021c7421))
* **editor:** manage workspace files with per-file removal ([#282](https://github.com/abijith-suresh/interleaf/issues/282)) ([826a88e](https://github.com/abijith-suresh/interleaf/commit/826a88e8043bef3b269e4926e695c925846d1152))
* **editor:** open page review as a focused lightbox ([#281](https://github.com/abijith-suresh/interleaf/issues/281)) ([656768b](https://github.com/abijith-suresh/interleaf/commit/656768bf2882c88cedd56349a015b9e08076d2d8))
* **editor:** reorder pages with long-press touch drag ([#279](https://github.com/abijith-suresh/interleaf/issues/279)) ([69555c2](https://github.com/abijith-suresh/interleaf/commit/69555c2aedba7886ddfcf4d7b62e9fdb498fea3d))


### Bug Fixes

* **pdf:** serialize page access per page to stop cleanup races ([#278](https://github.com/abijith-suresh/interleaf/issues/278)) ([85f12af](https://github.com/abijith-suresh/interleaf/commit/85f12af9453d7cd04ba6079fe5d6784d020b34b2))

## [0.0.9](https://github.com/abijith-suresh/interleaf/compare/0.0.8...0.0.9) (2026-09-29)


### Bug Fixes

* **ci:** pin qpdf port library link order ([#269](https://github.com/abijith-suresh/interleaf/issues/269)) ([3f6f3bc](https://github.com/abijith-suresh/interleaf/commit/3f6f3bc78477296aa2c4c29cd85c8e7c8dd225c1))
* **pdf:** bound page acquisition with render permits ([#265](https://github.com/abijith-suresh/interleaf/issues/265)) ([6a998f8](https://github.com/abijith-suresh/interleaf/commit/6a998f828dfcee4007e6381a029500aaada444d3))
* **pdf:** retry failed support imports and surface cache cleanup errors ([#275](https://github.com/abijith-suresh/interleaf/issues/275)) ([bd90148](https://github.com/abijith-suresh/interleaf/commit/bd9014819c6df526dd6b9cf65b66339cc9a7fbb6))

## [0.0.8](https://github.com/abijith-suresh/interleaf/compare/0.0.7...0.0.8) (2026-09-21)


### Bug Fixes

* **pdf:** release PDF.js page resources after use ([#257](https://github.com/abijith-suresh/interleaf/issues/257)) ([c4edba9](https://github.com/abijith-suresh/interleaf/commit/c4edba9fdd84bc7324823fa2fb83dc10ea77183c))
* **pdf:** stop renders before document cleanup ([#264](https://github.com/abijith-suresh/interleaf/issues/264)) ([ac721af](https://github.com/abijith-suresh/interleaf/commit/ac721af36786add76fdc19123015abd40287c1ab))

## [0.0.7](https://github.com/abijith-suresh/interleaf/compare/0.0.6...0.0.7) (2026-09-21)


### Features

* **editor:** accept mixed PDF and image uploads ([#248](https://github.com/abijith-suresh/interleaf/issues/248)) ([a8126d3](https://github.com/abijith-suresh/interleaf/commit/a8126d382e5cf03a4d9778db26f076ac29e13cb5))
* **editor:** rework page viewer into review workspace ([#245](https://github.com/abijith-suresh/interleaf/issues/245)) ([c258de3](https://github.com/abijith-suresh/interleaf/commit/c258de3d351f2c66c88f29ca900ad0fb51ef02c6))


### Bug Fixes

* **editor:** handle thumbnail render lifecycle failures ([#250](https://github.com/abijith-suresh/interleaf/issues/250)) ([46bdaab](https://github.com/abijith-suresh/interleaf/commit/46bdaab82e21efd2f7d0a0f772f6a66c39268746))
* **editor:** render viewer at device pixel density ([#249](https://github.com/abijith-suresh/interleaf/issues/249)) ([aadb92c](https://github.com/abijith-suresh/interleaf/commit/aadb92c0cbe116006cdc3de52bd747baa6770671))
* **pdf:** make source-load invalidation race-safe ([#255](https://github.com/abijith-suresh/interleaf/issues/255)) ([43d80e4](https://github.com/abijith-suresh/interleaf/commit/43d80e455f08db88e7e9943dd644958f49acd47d))
* **pdf:** release source caches with files ([#254](https://github.com/abijith-suresh/interleaf/issues/254)) ([e2320cd](https://github.com/abijith-suresh/interleaf/commit/e2320cd63ef07402f5cc61d0035ee79a682fb8ab))

## [0.0.6](https://github.com/abijith-suresh/interleaf/compare/0.0.5...0.0.6) (2026-09-20)


### Features

* **editor:** compact bottom bar controls ([#243](https://github.com/abijith-suresh/interleaf/issues/243)) ([be61905](https://github.com/abijith-suresh/interleaf/commit/be61905afd3bb50376760f4fe5eb05b3f79f9255))
* **pdf:** accept images in initial upload ([c2bf4c0](https://github.com/abijith-suresh/interleaf/commit/c2bf4c0a8b99cb0c2b68fef20260869823fb62c5))
* **pdf:** export pages as PNG images ([#241](https://github.com/abijith-suresh/interleaf/issues/241)) ([e79f894](https://github.com/abijith-suresh/interleaf/commit/e79f894f7ced4ca3ba8cb49b8c796f16c33b265d))


### Bug Fixes

* **editor:** align desktop download controls ([#246](https://github.com/abijith-suresh/interleaf/issues/246)) ([6fe6d60](https://github.com/abijith-suresh/interleaf/commit/6fe6d6073465162ab9346e4309815b54cac0c062))

## [0.0.5](https://github.com/abijith-suresh/interleaf/compare/0.0.4...0.0.5) (2026-09-19)


### Features

* **pdf:** add lossless qpdf WASM spike ([#234](https://github.com/abijith-suresh/interleaf/issues/234)) ([f977244](https://github.com/abijith-suresh/interleaf/commit/f97724480c8f2f5acb6e388bb4e8fde46a02d40e))
* **pdf:** integrate lossless compression workflow ([#237](https://github.com/abijith-suresh/interleaf/issues/237)) ([fee3dd7](https://github.com/abijith-suresh/interleaf/commit/fee3dd772b0d1013ba92934d41d5603f54dbc540))

## [0.0.4](https://github.com/abijith-suresh/interleaf/compare/0.0.3...0.0.4) (2026-09-18)


### Features

* **editor:** move to universal workspace ([#230](https://github.com/abijith-suresh/interleaf/issues/230)) ([fd34ba2](https://github.com/abijith-suresh/interleaf/commit/fd34ba2a1af6f28071eae4064b2c36ce5d5e31aa))

## [0.0.3](https://github.com/abijith-suresh/interleaf/compare/0.0.2...0.0.3) (2026-09-16)


### Features

* refresh editor workspace ([#220](https://github.com/abijith-suresh/interleaf/issues/220)) ([ceda1d5](https://github.com/abijith-suresh/interleaf/commit/ceda1d5dfce37e28543bb11fde5f7ff8e30e8060))


### Bug Fixes

* align marketing page heroes ([a166f59](https://github.com/abijith-suresh/interleaf/commit/a166f59a73acc4e778be96ad77638b2f1d869824))
* **brand:** replace file glyph with interleaf mark ([#226](https://github.com/abijith-suresh/interleaf/issues/226)) ([9124c17](https://github.com/abijith-suresh/interleaf/commit/9124c17eb1bc8293da2a49eddafd96db904bc0ec))
* **deploy:** update temporary canonical URL ([#227](https://github.com/abijith-suresh/interleaf/issues/227)) ([78881d6](https://github.com/abijith-suresh/interleaf/commit/78881d6fc210b001e687659f14cad8239bce47b7))

## [0.0.2](https://github.com/abijith-suresh/interleaf/compare/0.0.1...0.0.2) (2026-09-13)


### Bug Fixes

* align editor action states ([#213](https://github.com/abijith-suresh/interleaf/issues/213)) ([434aaa0](https://github.com/abijith-suresh/interleaf/commit/434aaa08e7178374b3af1ace16735315d1a39076))
* align Interleaf favicon assets ([#211](https://github.com/abijith-suresh/interleaf/issues/211)) ([2149891](https://github.com/abijith-suresh/interleaf/commit/21498913f6069de51d86c87bde2f564803deaef8))
* replace marketing arrow glyphs with svg ([#216](https://github.com/abijith-suresh/interleaf/issues/216)) ([3db11d4](https://github.com/abijith-suresh/interleaf/commit/3db11d405e65c8c33c41eb0efac8ff592f20e25c))

## [0.0.1](https://github.com/abijith-suresh/interleaf/compare/0.0.1...0.0.1) (2026-09-09)


### Miscellaneous Chores

* cut release baseline 0.0.1 ([e1eab9a](https://github.com/abijith-suresh/interleaf/commit/e1eab9a4af279177862d513a4a5f234e8f4e2402))
