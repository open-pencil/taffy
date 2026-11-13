# Taffy for OpenPencil

Branch `openpencil/taffy` of open-pencil/taffy: Taffy as OpenPencil uses it, for auto layout and, through Blitz, for HTML import. It changes only through reviewed pull requests; `AGENTS.md` has the rules.

- **Base:** DioxusLabs/taffy#1380 (CSS table layout, `78da1fde`) with DioxusLabs/taffy#1361 (requested baselines, `be8edbbd`) merged into it: the Taffy that open-pencil/blitz's `openpencil/blitz` needs for the Blitz pull requests it carries, so open-pencil/open-pencil can patch Blitz's Taffy to this branch. Neither has merged upstream; move the base when they do, or when `openpencil/blitz` moves.
- **Releases:** every push builds `openpencil/` and releases it as `taffy-<commit>` (`.github/workflows/openpencil.yml`): `taffy.js`, the host, `taffy.wasm`, the module it loads from beside it, `taffy.d.ts`, `THIRD-PARTY-NOTICES.md`, and `SHA256SUMS`. open-pencil/open-pencil's `packages/taffy/release.json` pins one.
- **`openpencil/`:** a crate that takes a whole tree as fixed-size records in one call (`src/lib.rs`) and its TypeScript host (`host/index.ts`), which keep the record layout in step. `bun build.ts` builds the release into `out/`; `bun test host` tests the host against it.

## Patches

Each fix also goes upstream; drop it here once upstream has it and Blitz's pin includes it.

- Flexbox: transfer a growing item's cross size through its aspect ratio — cherry-picked from DioxusLabs/taffy#1081 (fixes DioxusLabs/taffy#804), with fixtures for rows, columns, a max-width clamp, and a sibling. On top of it: only an `auto` cross size is transferred, not a sizing keyword such as `max-content`, and min and max sizes transfer between content boxes under `box-sizing: content-box` (fixtures `aspect_ratio_flex_row_max_content_height_is_kept`, `aspect_ratio_flex_row_max_content_height_with_width_is_kept`, `aspect_ratio_flex_row_min_width_transfers_without_padding`).
- Flexbox: size a row's line, and so a row without a height, from a growing item's cross size transferred through its aspect ratio from its used main size, as Chrome does; a column's width still comes from intrinsic sizes. That includes an item whose width gave it a height before it grew. Fixtures `aspect_ratio_flex_{row,column}_grow_sizes_auto_container`, `aspect_ratio_flex_row_grow_from_width_sizes_auto_container`.
