import { describe, expect, test } from 'bun:test'

// The built release, as packages load it: taffy.js with taffy.wasm beside it (bun build.ts).
import { computeLayout, LayoutNode } from '../out/taffy.js'

const box = (node: LayoutNode) => node.layout

describe('computeLayout', () => {
  test('grows row items into the free space', () => {
    const root = new LayoutNode({ width: 300, height: 100 })
    const fixed = new LayoutNode({ width: 100 })
    const grow = new LayoutNode({ flexGrow: 1 })
    root.append(fixed)
    root.append(grow)
    computeLayout(root)
    expect(box(fixed)).toEqual({ left: 0, top: 0, width: 100, height: 100 })
    expect(box(grow)).toEqual({ left: 100, top: 0, width: 200, height: 100 })
  })

  test("sizes a growing item's cross axis from its aspect ratio", () => {
    const root = new LayoutNode({ width: 500, height: 100, alignItems: 'flex-start' })
    const item = new LayoutNode({ flexGrow: 1, aspectRatio: 2 })
    root.append(item)
    computeLayout(root)
    expect(box(item)).toMatchObject({ width: 500, height: 250 })
  })

  test('applies padding, gap, and RTL direction', () => {
    const root = new LayoutNode({
      width: 200,
      direction: 'rtl',
      columnGap: 10,
      padding: { left: 5, right: 15 }
    })
    const a = new LayoutNode({ width: 50, height: 20 })
    const b = new LayoutNode({ width: 50, height: 20 })
    root.append(a)
    root.append(b)
    computeLayout(root)
    expect(box(a).left).toBe(200 - 15 - 50)
    expect(box(b).left).toBe(200 - 15 - 50 - 10 - 50)
  })

  test('applies negative margins', () => {
    const root = new LayoutNode({ width: 100, height: 100 })
    const inner = new LayoutNode({ flexGrow: 1, margin: { left: -10, right: -20 } })
    root.append(inner)
    computeLayout(root)
    expect(inner.layout).toMatchObject({ left: -10, width: 130 })
  })

  test('places absolute children by inset', () => {
    const root = new LayoutNode({ width: 100, height: 100 })
    const child = new LayoutNode({
      position: 'absolute',
      inset: { left: 10, top: 20 },
      width: 30,
      height: 40
    })
    root.append(child)
    computeLayout(root)
    expect(box(child)).toEqual({ left: 10, top: 20, width: 30, height: 40 })
  })

  test('lays out grid tracks and placements', () => {
    const root = new LayoutNode({
      display: 'grid',
      width: 300,
      gridTemplateColumns: [100, '1fr'],
      gridTemplateRows: [50, 50],
      columnGap: 20
    })
    const spanning = new LayoutNode({ gridColumn: { start: 1, span: 2 } })
    const last = new LayoutNode({ gridColumn: { start: 2 }, gridRow: { start: 2 } })
    root.append(spanning)
    root.append(last)
    computeLayout(root)
    expect(box(spanning)).toEqual({ left: 0, top: 0, width: 300, height: 50 })
    expect(box(last)).toEqual({ left: 120, top: 50, width: 180, height: 50 })
  })

  test('measures leaves with what layout knows and the space available', () => {
    const root = new LayoutNode({ width: 120, flexDirection: 'column', alignItems: 'stretch' })
    const text = new LayoutNode()
    const calls: Array<Parameters<NonNullable<LayoutNode['measure']>>> = []
    text.measure = (known, available) => {
      calls.push([known, available])
      const width = known.width ?? (typeof available.width === 'number' ? available.width : 400)
      return { width, height: Math.ceil(400 / width) * 10 }
    }
    root.append(text)
    computeLayout(root)
    expect(box(text)).toMatchObject({ width: 120, height: 40 })
    expect(calls.some(([known]) => known.width === 120)).toBe(true)
  })

  test('skips display none and lays out max-content roots', () => {
    const root = new LayoutNode()
    const hidden = new LayoutNode({ display: 'none', width: 50, height: 50 })
    const shown = new LayoutNode({ width: 30, height: 10 })
    root.append(hidden)
    root.append(shown)
    computeLayout(root)
    expect(box(hidden)).toMatchObject({ width: 0, height: 0 })
    expect(box(root)).toMatchObject({ width: 30, height: 10 })
  })
})
