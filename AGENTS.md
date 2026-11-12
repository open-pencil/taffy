# Taffy for OpenPencil

Branch `openpencil/taffy` is the Taffy that [OpenPencil](https://github.com/open-pencil/open-pencil) ships for auto layout and, through Blitz, for HTML import. `OPENPENCIL.md` says what the branch is and lists its patches; this file holds the rules for changing it. Taffy's own `CONTRIBUTING.md` applies to everything sent upstream.

## Changing the branch

- Every push to `openpencil/taffy` is a release (`.github/workflows/openpencil.yml`), so the branch changes only through pull requests against it, never by a direct push. A pull request is reviewed by CodeRabbit and then a maintainer, and merges only once both are done and its checks pass.
- A pull request follows OpenPencil's body template: Summary, What changed, AI assistance (the model's name, never as commit authorship or a trailer), Validation.
- Branch from `openpencil/taffy` and keep history linear: merge it into a branch that falls behind rather than force-pushing a branch under review.
- OpenPencil moves to a release only after its pull request merges, with `bun run fork:pin packages/taffy taffy-<commit>` in a pull request of its own there; it moves the `[patch]` rev in its root `Cargo.toml` too.

## Layout fixes

- A change to Taffy's algorithm comes with fixtures in `test_fixtures/` that Chrome lays out, generated as Taffy's `CONTRIBUTING.md` describes, and the generated tests pass: `cargo test`.
- Each fix is added to Patches in `OPENPENCIL.md` and offered upstream, following Taffy's rule of an issue comment before a pull request. A patch is dropped here once upstream has it and Blitz's pin includes it.
- The base is the Taffy commit Blitz pins, so HTML import and auto layout share one Taffy; moving it is a rebase onto Blitz's next pin, in a pull request of its own.

## `openpencil/`

- `src/lib.rs` reads a whole tree as fixed-size f32 records and `host/index.ts` writes them; a change to the record layout changes both, with a host test in `host/index.test.ts`.
- No JavaScript exception may unwind through the module, since its frames never restore Rust's stack pointer: the host catches what a measure function throws and rethrows it after the call (`host/index.test.ts`).
- Before a pull request: `cargo fmt --check`, `cargo clippy --release --locked --target wasm32-unknown-unknown -- -D warnings`, `bun build.ts`, and `bun run test` in `openpencil/`; the workflow runs the same on the pull request.
