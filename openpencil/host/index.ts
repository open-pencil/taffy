// Taffy for OpenPencil: build a tree of `LayoutNode`s with CSS styles, lay it out with one call
// to `computeLayout`, and read each node's `layout`. The tree crosses into WebAssembly as one
// batch of fixed-size records (`src/lib.rs`), and leaves with a `measure` function, such as text,
// are measured on the way. Styles default to CSS's initial values. The module, `taffy.wasm`, sits
// beside this file: a browser fetches it, which bundlers such as Vite see as an asset of this
// module through `new URL(..., import.meta.url)`, and Node and Bun read it from disk.

/** A length in points, a percentage of the containing block, or `auto`. */
export type Length = number | `${number}%` | 'auto'

export type AlignItems =
  | 'flex-start'
  | 'center'
  | 'flex-end'
  | 'stretch'
  | 'baseline'
  | 'start'
  | 'end'

export type AlignContent =
  | 'flex-start'
  | 'center'
  | 'flex-end'
  | 'stretch'
  | 'space-between'
  | 'space-around'
  | 'space-evenly'
  | 'start'
  | 'end'

export type GridTrack =
  | number
  | `${number}%`
  | `${number}fr`
  | 'auto'
  | 'min-content'
  | 'max-content'

/** A grid line to start at (1-based, negative from the end; `auto` placed by the grid) and a span. */
export interface GridPlacement {
  start?: number | 'auto'
  span?: number
}

export interface Edges {
  top?: number
  right?: number
  bottom?: number
  left?: number
}

export interface Style {
  display?: 'flex' | 'grid' | 'none'
  direction?: 'ltr' | 'rtl'
  position?: 'relative' | 'absolute'
  boxSizing?: 'border-box' | 'content-box'
  overflow?: 'visible' | 'clip' | 'hidden' | 'scroll'
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse'
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse'
  justifyContent?: AlignContent
  alignContent?: AlignContent
  alignItems?: AlignItems
  justifyItems?: AlignItems
  alignSelf?: AlignItems
  justifySelf?: AlignItems
  flexGrow?: number
  flexShrink?: number
  flexBasis?: Length
  width?: Length
  height?: Length
  minWidth?: Length
  minHeight?: Length
  maxWidth?: Length
  maxHeight?: Length
  /** Points on each side. */
  padding?: Edges
  /** Points from each side of the containing block; a side left out is `auto`. */
  inset?: Edges
  /** Points on each side, negative ones included. */
  margin?: Edges
  columnGap?: number
  rowGap?: number
  aspectRatio?: number
  gridTemplateColumns?: GridTrack[]
  gridTemplateRows?: GridTrack[]
  gridColumn?: GridPlacement
  gridRow?: GridPlacement
}

/** Space to lay out in: a definite size, or the size content takes at its narrowest or widest. */
export type AvailableSpace = number | 'min-content' | 'max-content'

/**
 * Measures a leaf. A known size is the one layout has already fixed on that axis; the content is
 * measured to fit the available space on the others.
 */
export type MeasureFunction = (
  known: { width?: number; height?: number },
  available: { width: AvailableSpace; height: AvailableSpace }
) => { width: number; height: number }

/** A node's box: its border box's offset within its parent's, and its size, unrounded. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export class LayoutNode {
  readonly children: LayoutNode[] = []
  /** Measures the node while it has no children. */
  measure: MeasureFunction | null = null
  /** The box from the last `computeLayout` of a tree this node is in. */
  layout: Box = { left: 0, top: 0, width: 0, height: 0 }

  constructor(public style: Style = {}) {}

  append(child: LayoutNode): void {
    this.children.push(child)
  }
}

// The record layout and codes of `src/lib.rs`; change both together.
const F = {
  PARENT: 0,
  DISPLAY: 1,
  DIRECTION: 2,
  POSITION: 3,
  BOX_SIZING: 4,
  OVERFLOW: 5,
  FLEX_DIRECTION: 6,
  FLEX_WRAP: 7,
  JUSTIFY_CONTENT: 8,
  ALIGN_CONTENT: 9,
  ALIGN_ITEMS: 10,
  JUSTIFY_ITEMS: 11,
  ALIGN_SELF: 12,
  JUSTIFY_SELF: 13,
  FLEX_GROW: 14,
  FLEX_SHRINK: 15,
  FLEX_BASIS: 16,
  WIDTH: 18,
  HEIGHT: 20,
  MIN_WIDTH: 22,
  MIN_HEIGHT: 24,
  MAX_WIDTH: 26,
  MAX_HEIGHT: 28,
  PADDING: 30,
  INSET: 34,
  COLUMN_GAP: 38,
  ROW_GAP: 39,
  ASPECT_RATIO: 40,
  MEASURED: 41,
  GRID_COLUMN: 42,
  GRID_ROW: 44,
  GRID_TEMPLATE_COLUMNS: 46,
  GRID_TEMPLATE_ROWS: 48,
  MARGIN: 50,
  STRIDE: 54
} as const

const UNIT_AUTO = 0
const UNIT_LENGTH = 1
const UNIT_PERCENT = 2

const DISPLAY = { flex: 0, grid: 1, none: 2 } as const
const OVERFLOW = { visible: 0, clip: 1, hidden: 2, scroll: 3 } as const
const FLEX_DIRECTION = { row: 0, column: 1, 'row-reverse': 2, 'column-reverse': 3 } as const
const FLEX_WRAP = { nowrap: 0, wrap: 1, 'wrap-reverse': 2 } as const
const ALIGN_ITEMS: Record<AlignItems, number> = {
  'flex-start': 1,
  center: 2,
  'flex-end': 3,
  stretch: 4,
  baseline: 5,
  start: 6,
  end: 7
}
const ALIGN_CONTENT: Record<AlignContent, number> = {
  'flex-start': 1,
  center: 2,
  'flex-end': 3,
  stretch: 4,
  'space-between': 5,
  'space-around': 6,
  'space-evenly': 7,
  start: 8,
  end: 9
}
const TRACK_AUTO = 0
const TRACK_LENGTH = 1
const TRACK_PERCENT = 2
const TRACK_FR = 3
const TRACK_MIN_CONTENT = 4
const TRACK_MAX_CONTENT = 5
const SPACE_DEFINITE = 0
const SPACE_MIN_CONTENT = 1

interface Exports {
  memory: WebAssembly.Memory
  alloc_f32(len: number): number
  free_f32(ptr: number, len: number): void
  measure_result(): number
  /** Rust's shadow stack pointer, put back when a call traps part way. */
  __stack_pointer: WebAssembly.Global
  compute(
    records: number,
    count: number,
    tracks: number,
    trackCount: number,
    availableWidth: number,
    availableHeight: number
  ): number
}

/** The nodes of the tree being laid out, by record index, for `measure` calls back from Taffy. */
let measuring: LayoutNode[] = []

/**
 * The first error a measure function threw during the call. An exception must not unwind through
 * the module: its frames would never put Rust's stack pointer back, and after a few hundred such
 * calls it runs off the end of its stack. The measure answers zero instead, and the call rethrows
 * the error once the module has returned.
 */
let measureError: { error: unknown } | undefined

function availableSpace(value: number, kind: number): AvailableSpace {
  if (kind === SPACE_DEFINITE) return value
  return kind === SPACE_MIN_CONTENT ? 'min-content' : 'max-content'
}

const imports: WebAssembly.Imports = {
  env: {
    measure(
      index: number,
      knownWidth: number,
      knownHeight: number,
      availableWidth: number,
      availableWidthKind: number,
      availableHeight: number,
      availableHeightKind: number
    ) {
      let size: ReturnType<MeasureFunction> = { width: 0, height: 0 }
      if (measureError === undefined) {
        try {
          size =
            measuring[index].measure?.(
              {
                width: Number.isNaN(knownWidth) ? undefined : knownWidth,
                height: Number.isNaN(knownHeight) ? undefined : knownHeight
              },
              {
                width: availableSpace(availableWidth, availableWidthKind),
                height: availableSpace(availableHeight, availableHeightKind)
              }
            ) ?? size
        } catch (error) {
          measureError = { error }
        }
      }
      const out = new Float32Array(wasm.memory.buffer, wasm.measure_result(), 2)
      out[0] = size.width
      out[1] = size.height
    }
  }
}

const MODULE_URL = new URL('./taffy.wasm', import.meta.url)

async function instantiate(): Promise<WebAssembly.Instance> {
  if (MODULE_URL.protocol === 'file:') {
    const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises')
    return (await WebAssembly.instantiate(await readFile(MODULE_URL), imports)).instance
  }
  const response = await fetch(MODULE_URL)
  if (!response.ok) throw new Error(`taffy.wasm failed to load from ${MODULE_URL}: ${response.status}`)
  // Compiled while it downloads where it is served as WebAssembly.
  if (response.headers.get('content-type')?.startsWith('application/wasm')) {
    return (await WebAssembly.instantiateStreaming(response, imports)).instance
  }
  return (await WebAssembly.instantiate(await response.arrayBuffer(), imports)).instance
}

const instance = await instantiate()
const wasm = instance.exports as unknown as Exports

function writeLength(record: Float32Array, at: number, value: Length | undefined): void {
  if (value === undefined || value === 'auto') {
    record[at + 1] = UNIT_AUTO
  } else if (typeof value === 'number') {
    record[at] = value
    record[at + 1] = UNIT_LENGTH
  } else {
    record[at] = Number.parseFloat(value) / 100
    record[at + 1] = UNIT_PERCENT
  }
}

function writeTrack(tracks: number[], track: GridTrack): void {
  if (typeof track === 'number') tracks.push(TRACK_LENGTH, track)
  else if (track === 'auto') tracks.push(TRACK_AUTO, 0)
  else if (track === 'min-content') tracks.push(TRACK_MIN_CONTENT, 0)
  else if (track === 'max-content') tracks.push(TRACK_MAX_CONTENT, 0)
  else if (track.endsWith('fr')) tracks.push(TRACK_FR, Number.parseFloat(track))
  else tracks.push(TRACK_PERCENT, Number.parseFloat(track) / 100)
}

function writeEdges(
  records: Float32Array,
  at: number,
  edges: Edges | undefined,
  missing: number
): void {
  records[at] = edges?.left ?? missing
  records[at + 1] = edges?.top ?? missing
  records[at + 2] = edges?.right ?? missing
  records[at + 3] = edges?.bottom ?? missing
}

function writePlacement(records: Float32Array, at: number, placement: GridPlacement | undefined) {
  const start = placement?.start
  records[at] = start === undefined || start === 'auto' ? 0 : start
  records[at + 1] = placement?.span ?? 1
}

function writeTracks(
  records: Float32Array,
  at: number,
  list: readonly GridTrack[] | undefined,
  tracks: number[]
): void {
  records[at] = tracks.length / 2
  records[at + 1] = list?.length ?? 0
  if (list) for (const track of list) writeTrack(tracks, track)
}

// Every field is written, since the buffer is reused from the call before.
function writeRecord(
  records: Float32Array,
  r: number,
  node: LayoutNode,
  parent: number,
  tracks: number[]
): void {
  const s = node.style
  records[r + F.PARENT] = parent
  records[r + F.DISPLAY] = DISPLAY[s.display ?? 'flex']
  records[r + F.DIRECTION] = s.direction === 'rtl' ? 1 : 0
  records[r + F.POSITION] = s.position === 'absolute' ? 1 : 0
  records[r + F.BOX_SIZING] = s.boxSizing === 'content-box' ? 1 : 0
  records[r + F.OVERFLOW] = OVERFLOW[s.overflow ?? 'visible']
  records[r + F.FLEX_DIRECTION] = FLEX_DIRECTION[s.flexDirection ?? 'row']
  records[r + F.FLEX_WRAP] = FLEX_WRAP[s.flexWrap ?? 'nowrap']
  records[r + F.JUSTIFY_CONTENT] = s.justifyContent ? ALIGN_CONTENT[s.justifyContent] : 0
  records[r + F.ALIGN_CONTENT] = s.alignContent ? ALIGN_CONTENT[s.alignContent] : 0
  records[r + F.ALIGN_ITEMS] = s.alignItems ? ALIGN_ITEMS[s.alignItems] : 0
  records[r + F.JUSTIFY_ITEMS] = s.justifyItems ? ALIGN_ITEMS[s.justifyItems] : 0
  records[r + F.ALIGN_SELF] = s.alignSelf ? ALIGN_ITEMS[s.alignSelf] : 0
  records[r + F.JUSTIFY_SELF] = s.justifySelf ? ALIGN_ITEMS[s.justifySelf] : 0
  records[r + F.FLEX_GROW] = s.flexGrow ?? 0
  records[r + F.FLEX_SHRINK] = s.flexShrink ?? 1
  writeLength(records, r + F.FLEX_BASIS, s.flexBasis)
  writeLength(records, r + F.WIDTH, s.width)
  writeLength(records, r + F.HEIGHT, s.height)
  writeLength(records, r + F.MIN_WIDTH, s.minWidth)
  writeLength(records, r + F.MIN_HEIGHT, s.minHeight)
  writeLength(records, r + F.MAX_WIDTH, s.maxWidth)
  writeLength(records, r + F.MAX_HEIGHT, s.maxHeight)
  writeEdges(records, r + F.PADDING, s.padding, 0)
  writeEdges(records, r + F.INSET, s.inset, Number.NaN)
  writeEdges(records, r + F.MARGIN, s.margin, 0)
  records[r + F.COLUMN_GAP] = s.columnGap ?? 0
  records[r + F.ROW_GAP] = s.rowGap ?? 0
  records[r + F.ASPECT_RATIO] = s.aspectRatio ?? Number.NaN
  records[r + F.MEASURED] = node.measure && node.children.length === 0 ? 1 : 0
  writePlacement(records, r + F.GRID_COLUMN, s.gridColumn)
  writePlacement(records, r + F.GRID_ROW, s.gridRow)
  writeTracks(records, r + F.GRID_TEMPLATE_COLUMNS, s.gridTemplateColumns, tracks)
  writeTracks(records, r + F.GRID_TEMPLATE_ROWS, s.gridTemplateRows, tracks)
}

/** A buffer in the module's memory, kept between calls and grown when a tree needs more. */
interface Buffer {
  ptr: number
  capacity: number
}

const recordBuffer: Buffer = { ptr: 0, capacity: 0 }
const trackBuffer: Buffer = { ptr: 0, capacity: 0 }

function reserve(buffer: Buffer, length: number): number {
  if (length > buffer.capacity) {
    if (buffer.capacity > 0) wasm.free_f32(buffer.ptr, buffer.capacity)
    // Grown by half again, so a tree that keeps growing a little does not reallocate each call.
    buffer.capacity = Math.max(length, Math.ceil(buffer.capacity * 1.5))
    buffer.ptr = wasm.alloc_f32(buffer.capacity)
  }
  return buffer.ptr
}

/** The nodes of the last tree laid out, in record order; reused, since most calls lay out one tree again. */
const order: LayoutNode[] = []
const parents: number[] = []

function collect(node: LayoutNode, parent: number): void {
  const index = order.length
  order.push(node)
  parents.push(parent)
  for (const child of node.children) collect(child, index)
}

/**
 * Lays out the tree under `root` in the available width and height (max-content where left out)
 * and sets every node's `layout`.
 */
export function computeLayout(
  root: LayoutNode,
  available: { width?: number; height?: number } = {}
): void {
  // The buffers and node order are shared: a measure function cannot lay out another tree.
  if (measuring.length > 0) throw new Error('computeLayout cannot run inside a measure function')
  order.length = 0
  parents.length = 0
  collect(root, -1)
  const count = order.length

  const recordsPtr = reserve(recordBuffer, count * F.STRIDE)
  // Allocating can grow, and so detach, the module's memory: views are made after it.
  const records = new Float32Array(wasm.memory.buffer, recordsPtr, count * F.STRIDE)
  const tracks: number[] = []
  for (let i = 0; i < count; i++) writeRecord(records, i * F.STRIDE, order[i], parents[i], tracks)
  const tracksPtr = reserve(trackBuffer, tracks.length)
  if (tracks.length > 0) new Float32Array(wasm.memory.buffer, tracksPtr, tracks.length).set(tracks)

  measuring = order
  measureError = undefined
  const stack = wasm.__stack_pointer.value as number
  let out: number
  try {
    out = wasm.compute(
      recordsPtr,
      count,
      tracksPtr,
      tracks.length / 2,
      available.width ?? Number.NaN,
      available.height ?? Number.NaN
    )
  } catch (error) {
    // A trap leaves the stack pointer where the trapping frame had it; later calls need it back.
    // What the call had allocated stays allocated, which is the lesser harm.
    wasm.__stack_pointer.value = stack
    throw error
  } finally {
    measuring = []
  }
  if (measureError !== undefined) {
    const { error } = measureError
    measureError = undefined
    throw error
  }
  // Read after `compute`: measuring may have grown, and so detached, the memory.
  const boxes = new Float32Array(wasm.memory.buffer, out, count * 4)
  for (let i = 0; i < count; i++) {
    const at = i * 4
    order[i].layout = {
      left: boxes[at],
      top: boxes[at + 1],
      width: boxes[at + 2],
      height: boxes[at + 3]
    }
  }
}
