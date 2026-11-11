//! Taffy behind a batched WebAssembly interface. The host writes a whole tree as fixed-size f32
//! records, parents before children, calls `compute` once, and reads every node's box back from
//! one buffer; leaves it measures, such as text, are measured through the imported `measure`.
//!
//! The records carry CSS values as they are: defaults such as OpenPencil's (no automatic minimum
//! size, no shrinking) are the host's to write. The field and code tables are mirrored in
//! `host/records.ts`; change both together.

use std::cell::RefCell;

use taffy::prelude::*;
use taffy::style::Direction;
use taffy::style_helpers::{line, span};
use taffy::{Overflow, Point};

/// The record's fields, one f32 each; a length is a value followed by its unit.
mod field {
    pub const PARENT: usize = 0;
    pub const DISPLAY: usize = 1;
    pub const DIRECTION: usize = 2;
    pub const POSITION: usize = 3;
    pub const BOX_SIZING: usize = 4;
    pub const OVERFLOW: usize = 5;
    pub const FLEX_DIRECTION: usize = 6;
    pub const FLEX_WRAP: usize = 7;
    pub const JUSTIFY_CONTENT: usize = 8;
    pub const ALIGN_CONTENT: usize = 9;
    pub const ALIGN_ITEMS: usize = 10;
    pub const JUSTIFY_ITEMS: usize = 11;
    pub const ALIGN_SELF: usize = 12;
    pub const JUSTIFY_SELF: usize = 13;
    pub const FLEX_GROW: usize = 14;
    pub const FLEX_SHRINK: usize = 15;
    pub const FLEX_BASIS: usize = 16;
    pub const WIDTH: usize = 18;
    pub const HEIGHT: usize = 20;
    pub const MIN_WIDTH: usize = 22;
    pub const MIN_HEIGHT: usize = 24;
    pub const MAX_WIDTH: usize = 26;
    pub const MAX_HEIGHT: usize = 28;
    /// Left, top, right, bottom.
    pub const PADDING: usize = 30;
    /// Left, top, right, bottom; NaN for `auto`.
    pub const INSET: usize = 34;
    pub const COLUMN_GAP: usize = 38;
    pub const ROW_GAP: usize = 39;
    /// NaN for none.
    pub const ASPECT_RATIO: usize = 40;
    pub const MEASURED: usize = 41;
    /// Start line (0 for `auto`), then span.
    pub const GRID_COLUMN: usize = 42;
    pub const GRID_ROW: usize = 44;
    /// Offset and count into the track array.
    pub const GRID_TEMPLATE_COLUMNS: usize = 46;
    pub const GRID_TEMPLATE_ROWS: usize = 48;
    pub const STRIDE: usize = 50;
}

/// Units of a length: points or a percentage as a fraction; any other code is `auto`.
mod unit {
    pub const LENGTH: u32 = 1;
    pub const PERCENT: u32 = 2;
}

/// Kinds of available space passed to `measure`.
mod space {
    pub const DEFINITE: f32 = 0.0;
    pub const MIN_CONTENT: f32 = 1.0;
    pub const MAX_CONTENT: f32 = 2.0;
}

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// Measures node `index`: each known size is NaN when unknown, and each available size comes
    /// with its kind. The host writes the width and height to `measure_result()`.
    fn measure(
        index: u32,
        known_width: f32,
        known_height: f32,
        available_width: f32,
        available_width_kind: f32,
        available_height: f32,
        available_height_kind: f32,
    );
}

thread_local! {
    static OUTPUT: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}
static mut MEASURE_RESULT: [f32; 2] = [0.0; 2];

#[unsafe(no_mangle)]
pub extern "C" fn measure_result() -> *mut f32 {
    (&raw mut MEASURE_RESULT).cast()
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc_f32(len: usize) -> *mut f32 {
    let mut buffer = vec![0f32; len.max(1)];
    let ptr = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    ptr
}

/// # Safety
/// `ptr` and `len` must come from one `alloc_f32` call that was not freed yet.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn free_f32(ptr: *mut f32, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, len.max(1), len.max(1))) }
}

fn code(value: f32) -> u32 {
    value as u32
}

fn dimension(r: &[f32], at: usize) -> Dimension {
    match code(r[at + 1]) {
        unit::LENGTH => Dimension::length(r[at]),
        unit::PERCENT => Dimension::percent(r[at]),
        _ => Dimension::auto(),
    }
}

fn length_auto(r: &[f32], at: usize) -> LengthPercentageAuto {
    match code(r[at + 1]) {
        unit::LENGTH => LengthPercentageAuto::length(r[at]),
        unit::PERCENT => LengthPercentageAuto::percent(r[at]),
        _ => LengthPercentageAuto::auto(),
    }
}

/// `align-items`, `align-self`, `justify-items`, `justify-self`; 0 is unset.
fn align_items(value: f32) -> Option<AlignItems> {
    match code(value) {
        1 => Some(AlignItems::FLEX_START),
        2 => Some(AlignItems::CENTER),
        3 => Some(AlignItems::FLEX_END),
        4 => Some(AlignItems::STRETCH),
        5 => Some(AlignItems::BASELINE),
        6 => Some(AlignItems::START),
        7 => Some(AlignItems::END),
        _ => None,
    }
}

/// `justify-content`, `align-content`; 0 is unset.
fn align_content(value: f32) -> Option<AlignContent> {
    match code(value) {
        1 => Some(AlignContent::FLEX_START),
        2 => Some(AlignContent::CENTER),
        3 => Some(AlignContent::FLEX_END),
        4 => Some(AlignContent::STRETCH),
        5 => Some(AlignContent::SPACE_BETWEEN),
        6 => Some(AlignContent::SPACE_AROUND),
        7 => Some(AlignContent::SPACE_EVENLY),
        8 => Some(AlignContent::START),
        9 => Some(AlignContent::END),
        _ => None,
    }
}

fn tracks(all: &[f32], r: &[f32], at: usize) -> Vec<GridTemplateComponent<String>> {
    let (offset, count) = (r[at] as usize, r[at + 1] as usize);
    (offset..offset + count)
        .map(|i| {
            let value = all[i * 2 + 1];
            match code(all[i * 2]) {
                1 => length(value),
                2 => percent(value),
                3 => fr(value),
                4 => min_content(),
                5 => max_content(),
                _ => auto(),
            }
        })
        .collect()
}

fn placement(r: &[f32], at: usize) -> taffy::Line<GridPlacement<String>> {
    let (start, count) = (r[at] as i16, r[at + 1].max(1.0) as u16);
    taffy::Line { start: if start == 0 { GridPlacement::Auto } else { line(start) }, end: span(count) }
}

fn style(r: &[f32], all_tracks: &[f32]) -> Style {
    let side = |at: usize, i: usize| LengthPercentage::length(r[at + i]);
    let inset = |i: usize| {
        let value = r[field::INSET + i];
        if value.is_nan() { LengthPercentageAuto::auto() } else { LengthPercentageAuto::length(value) }
    };
    let overflow = match code(r[field::OVERFLOW]) {
        1 => Overflow::Clip,
        2 => Overflow::Hidden,
        3 => Overflow::Scroll,
        _ => Overflow::Visible,
    };
    let ratio = r[field::ASPECT_RATIO];
    Style {
        display: match code(r[field::DISPLAY]) {
            1 => Display::Grid,
            2 => Display::None,
            _ => Display::Flex,
        },
        direction: if code(r[field::DIRECTION]) == 1 { Direction::Rtl } else { Direction::Ltr },
        position: if code(r[field::POSITION]) == 1 { Position::Absolute } else { Position::Relative },
        box_sizing: if code(r[field::BOX_SIZING]) == 1 { BoxSizing::ContentBox } else { BoxSizing::BorderBox },
        overflow: Point { x: overflow, y: overflow },
        flex_direction: match code(r[field::FLEX_DIRECTION]) {
            1 => FlexDirection::Column,
            2 => FlexDirection::RowReverse,
            3 => FlexDirection::ColumnReverse,
            _ => FlexDirection::Row,
        },
        flex_wrap: match code(r[field::FLEX_WRAP]) {
            1 => FlexWrap::Wrap,
            2 => FlexWrap::WrapReverse,
            _ => FlexWrap::NoWrap,
        },
        justify_content: align_content(r[field::JUSTIFY_CONTENT]).unwrap_or(AlignContent::NORMAL),
        align_content: align_content(r[field::ALIGN_CONTENT]).unwrap_or(AlignContent::NORMAL),
        align_items: align_items(r[field::ALIGN_ITEMS]).unwrap_or(AlignItems::NORMAL),
        justify_items: align_items(r[field::JUSTIFY_ITEMS]).unwrap_or(AlignItems::NORMAL),
        align_self: align_items(r[field::ALIGN_SELF]),
        justify_self: align_items(r[field::JUSTIFY_SELF]),
        flex_grow: r[field::FLEX_GROW],
        flex_shrink: r[field::FLEX_SHRINK],
        flex_basis: dimension(r, field::FLEX_BASIS),
        size: Size { width: dimension(r, field::WIDTH), height: dimension(r, field::HEIGHT) },
        min_size: Size { width: length_auto(r, field::MIN_WIDTH), height: length_auto(r, field::MIN_HEIGHT) },
        max_size: Size { width: length_auto(r, field::MAX_WIDTH), height: length_auto(r, field::MAX_HEIGHT) },
        padding: Rect {
            left: side(field::PADDING, 0),
            top: side(field::PADDING, 1),
            right: side(field::PADDING, 2),
            bottom: side(field::PADDING, 3),
        },
        inset: Rect { left: inset(0), top: inset(1), right: inset(2), bottom: inset(3) },
        gap: Size {
            width: LengthPercentage::length(r[field::COLUMN_GAP]),
            height: LengthPercentage::length(r[field::ROW_GAP]),
        },
        aspect_ratio: (!ratio.is_nan() && ratio > 0.0).then_some(ratio),
        grid_template_columns: tracks(all_tracks, r, field::GRID_TEMPLATE_COLUMNS),
        grid_template_rows: tracks(all_tracks, r, field::GRID_TEMPLATE_ROWS),
        grid_column: placement(r, field::GRID_COLUMN),
        grid_row: placement(r, field::GRID_ROW),
        ..Style::default()
    }
}

/// `margin` keeps Taffy's zero default: auto layout has none, and `inset` places absolute boxes.
fn available(value: f32) -> AvailableSpace {
    if value.is_nan() { AvailableSpace::MaxContent } else { AvailableSpace::Definite(value) }
}

fn space_kind(available: AvailableSpace) -> (f32, f32) {
    match available {
        AvailableSpace::Definite(value) => (value, space::DEFINITE),
        AvailableSpace::MinContent => (f32::NAN, space::MIN_CONTENT),
        AvailableSpace::MaxContent => (f32::NAN, space::MAX_CONTENT),
    }
}

/// Lays out `count` records (the root first, each parent before its children) in the available
/// width and height (NaN for max-content), and returns a pointer to `count * 4` floats: each
/// node's left and top within its parent's border box, its width, and its height, unrounded.
///
/// # Safety
/// `records` must hold `count * field::STRIDE` floats and `tracks` `track_count * 2`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn compute(
    records: *const f32,
    count: usize,
    tracks: *const f32,
    track_count: usize,
    available_width: f32,
    available_height: f32,
) -> *const f32 {
    let records = unsafe { std::slice::from_raw_parts(records, count * field::STRIDE) };
    let all_tracks: &[f32] =
        if track_count == 0 { &[] } else { unsafe { std::slice::from_raw_parts(tracks, track_count * 2) } };

    let mut tree: TaffyTree<u32> = TaffyTree::with_capacity(count);
    tree.disable_rounding();
    let mut ids = Vec::with_capacity(count);
    let mut children: Vec<Vec<NodeId>> = vec![Vec::new(); count];
    for (index, r) in records.as_chunks::<{ field::STRIDE }>().0.iter().enumerate() {
        let style = style(r, all_tracks);
        let id = if r[field::MEASURED] > 0.0 {
            tree.new_leaf_with_context(style, index as u32)
        } else {
            tree.new_leaf(style)
        }
        .expect("a new node");
        ids.push(id);
        let parent = r[field::PARENT];
        if parent >= 0.0 {
            children[parent as usize].push(id);
        }
    }
    for (index, kids) in children.iter().enumerate() {
        if !kids.is_empty() {
            tree.set_children(ids[index], kids).expect("known children");
        }
    }

    let space = Size { width: available(available_width), height: available(available_height) };
    tree.compute_layout_with_measure(ids[0], space, |inputs, _id, context, style| {
        taffy::compute_leaf_layout(
            inputs,
            style,
            |_, _| 0.0,
            |known, available| {
                let Some(&mut index) = context else { return Size::ZERO };
                let (width, width_kind) = space_kind(available.width);
                let (height, height_kind) = space_kind(available.height);
                unsafe {
                    measure(
                        index,
                        known.width.unwrap_or(f32::NAN),
                        known.height.unwrap_or(f32::NAN),
                        width,
                        width_kind,
                        height,
                        height_kind,
                    );
                    let [width, height] = MEASURE_RESULT;
                    Size { width, height }
                }
            },
        )
    })
    .expect("a laid out tree");

    OUTPUT.with_borrow_mut(|out| {
        out.clear();
        for id in &ids {
            let layout = tree.layout(*id).expect("a laid out node");
            out.extend_from_slice(&[layout.location.x, layout.location.y, layout.size.width, layout.size.height]);
        }
        out.as_ptr()
    })
}
