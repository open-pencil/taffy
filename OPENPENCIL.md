# Taffy for OpenPencil

Branch `openpencil/taffy` of open-pencil/taffy: Taffy as OpenPencil uses it, for auto layout and, through Blitz, for HTML import.

- **Base:** `affd437f`, the Taffy commit Blitz pins (DioxusLabs/taffy#1361), so open-pencil/open-pencil can patch Blitz's Taffy to this branch. Rebase onto Blitz's next pin when it moves.
- **Releases:** every push builds `openpencil/` and releases it as `taffy-<commit>` (`.github/workflows/openpencil.yml`): `taffy.js`, the host with the WebAssembly module embedded, `taffy.d.ts`, `THIRD-PARTY-NOTICES.md`, and `SHA256SUMS`. open-pencil/open-pencil's `packages/taffy/release.json` pins one.
- **`openpencil/`:** a crate that takes a whole tree as fixed-size records in one call (`src/lib.rs`) and its TypeScript host (`host/index.ts`), which keep the record layout in step. `bun build.ts` builds the release into `out/`; `bun test host` tests the host against it.

## Patches

Each fix also goes upstream; drop it here once upstream has it and Blitz's pin includes it.

- Flexbox: transfer a growing item's cross size through its aspect ratio — cherry-picked from DioxusLabs/taffy#1081 (fixes DioxusLabs/taffy#804), with fixtures for rows, columns, a max-width clamp, and a sibling.
- Flexbox: size a row's line, and so a row without a height, from a growing item's cross size transferred through its aspect ratio from its used main size, as Chrome does; a column's width still comes from intrinsic sizes. Fixtures `aspect_ratio_flex_{row,column}_grow_sizes_auto_container`.
