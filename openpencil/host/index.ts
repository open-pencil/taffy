// Taffy for OpenPencil: build a tree of `LayoutNode`s with CSS styles, lay it out with one call
// to `computeLayout`, and read each node's `layout`. The tree crosses into WebAssembly as one
// batch of fixed-size records (`src/lib.rs`), and leaves with a `measure` function, such as text,
// are measured on the way. Styles default to CSS's initial values.
import moduleBase64 from './module.generated'

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
  STRIDE: 50
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

function availableSpace(value: number, kind: number): AvailableSpace {
  if (kind === SPACE_DEFINITE) return value
  return kind === SPACE_MIN_CONTENT ? 'min-content' : 'max-content'
}

const bytes = Uint8Array.from(atob(moduleBase64), (char) => char.charCodeAt(0))
const { instance } = await WebAssembly.instantiate(bytes, {
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
      const node = measuring[index]
      const size = node.measure?.(
        {
          width: Number.isNaN(knownWidth) ? undefined : knownWidth,
          height: Number.isNaN(knownHeight) ? undefined : knownHeight
        },
        {
          width: availableSpace(availableWidth, availableWidthKind),
          height: availableSpace(availableHeight, availableHeightKind)
        }
      ) ?? { width: 0, height: 0 }
      const out = new Float32Array(wasm.memory.buffer, wasm.measure_result(), 2)
      out[0] = size.width
      out[1] = size.height
    }
  }
})
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

function writeRecord(
  record: Float32Array,
  node: LayoutNode,
  parent: number,
  tracks: number[]
): void {
  const s = node.style
  record[F.PARENT] = parent
  record[F.DISPLAY] = DISPLAY[s.display ?? 'flex']
  record[F.DIRECTION] = s.direction === 'rtl' ? 1 : 0
  record[F.POSITION] = s.position === 'absolute' ? 1 : 0
  record[F.BOX_SIZING] = s.boxSizing === 'content-box' ? 1 : 0
  record[F.OVERFLOW] = OVERFLOW[s.overflow ?? 'visible']
  record[F.FLEX_DIRECTION] = FLEX_DIRECTION[s.flexDirection ?? 'row']
  record[F.FLEX_WRAP] = FLEX_WRAP[s.flexWrap ?? 'nowrap']
  record[F.JUSTIFY_CONTENT] = s.justifyContent ? ALIGN_CONTENT[s.justifyContent] : 0
  record[F.ALIGN_CONTENT] = s.alignContent ? ALIGN_CONTENT[s.alignContent] : 0
  record[F.ALIGN_ITEMS] = s.alignItems ? ALIGN_ITEMS[s.alignItems] : 0
  record[F.JUSTIFY_ITEMS] = s.justifyItems ? ALIGN_ITEMS[s.justifyItems] : 0
  record[F.ALIGN_SELF] = s.alignSelf ? ALIGN_ITEMS[s.alignSelf] : 0
  record[F.JUSTIFY_SELF] = s.justifySelf ? ALIGN_ITEMS[s.justifySelf] : 0
  record[F.FLEX_GROW] = s.flexGrow ?? 0
  record[F.FLEX_SHRINK] = s.flexShrink ?? 1
  writeLength(record, F.FLEX_BASIS, s.flexBasis)
  writeLength(record, F.WIDTH, s.width)
  writeLength(record, F.HEIGHT, s.height)
  writeLength(record, F.MIN_WIDTH, s.minWidth)
  writeLength(record, F.MIN_HEIGHT, s.minHeight)
  writeLength(record, F.MAX_WIDTH, s.maxWidth)
  writeLength(record, F.MAX_HEIGHT, s.maxHeight)
  const sides = ['left', 'top', 'right', 'bottom'] as const
  sides.forEach((side, i) => {
    record[F.PADDING + i] = s.padding?.[side] ?? 0
    record[F.INSET + i] = s.inset?.[side] ?? Number.NaN
  })
  record[F.COLUMN_GAP] = s.columnGap ?? 0
  record[F.ROW_GAP] = s.rowGap ?? 0
  record[F.ASPECT_RATIO] = s.aspectRatio ?? Number.NaN
  record[F.MEASURED] = node.measure && node.children.length === 0 ? 1 : 0
  for (const [at, placement] of [
    [F.GRID_COLUMN, s.gridColumn],
    [F.GRID_ROW, s.gridRow]
  ] as const) {
    const start = placement?.start
    record[at] = start === undefined || start === 'auto' ? 0 : start
    record[at + 1] = placement?.span ?? 1
  }
  for (const [at, list] of [
    [F.GRID_TEMPLATE_COLUMNS, s.gridTemplateColumns],
    [F.GRID_TEMPLATE_ROWS, s.gridTemplateRows]
  ] as const) {
    record[at] = tracks.length / 2
    record[at + 1] = list?.length ?? 0
    for (const track of list ?? []) writeTrack(tracks, track)
  }
}

/**
 * Lays out the tree under `root` in the available width and height (max-content where left out)
 * and sets every node's `layout`.
 */
export function computeLayout(
  root: LayoutNode,
  available: { width?: number; height?: number } = {}
): void {
  const nodes: LayoutNode[] = []
  const parents: number[] = []
  const visit = (node: LayoutNode, parent: number) => {
    const index = nodes.length
    nodes.push(node)
    parents.push(parent)
    for (const child of node.children) visit(child, index)
  }
  visit(root, -1)

  const records = new Float32Array(nodes.length * F.STRIDE)
  const tracks: number[] = []
  nodes.forEach((node, i) => {
    writeRecord(records.subarray(i * F.STRIDE, (i + 1) * F.STRIDE), node, parents[i], tracks)
  })

  const recordsPtr = wasm.alloc_f32(records.length)
  const tracksPtr = wasm.alloc_f32(tracks.length)
  try {
    new Float32Array(wasm.memory.buffer, recordsPtr, records.length).set(records)
    new Float32Array(wasm.memory.buffer, tracksPtr, tracks.length).set(tracks)
    measuring = nodes
    const out = wasm.compute(
      recordsPtr,
      nodes.length,
      tracksPtr,
      tracks.length / 2,
      available.width ?? Number.NaN,
      available.height ?? Number.NaN
    )
    // Read after `compute`: measuring may have grown, and so detached, the memory.
    const boxes = new Float32Array(wasm.memory.buffer, out, nodes.length * 4)
    nodes.forEach((node, i) => {
      node.layout = {
        left: boxes[i * 4],
        top: boxes[i * 4 + 1],
        width: boxes[i * 4 + 2],
        height: boxes[i * 4 + 3]
      }
    })
  } finally {
    measuring = []
    wasm.free_f32(recordsPtr, records.length)
    wasm.free_f32(tracksPtr, tracks.length)
  }
}
