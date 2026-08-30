//! N-up grid layout calculation and page grouping for multi-up printing.
//!
//! Provides platform-agnostic geometric calculations:
//! - Cell partitioning in Z-order (left-to-right, top-to-bottom)
//! - Aspect-ratio preserving centering within individual cells
//! - Grouping logical pages into physical sheets
//! - DPI adjustments for reduced per-cell rasterization load

use crate::contracts::NupLayout;

/// Destination rectangle for an individual N-up cell in device coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellRect {
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
}

/// Computes the destination rectangle for every cell in an N-up grid.
///
/// Cells are ordered in Z-order: row by row, left to right.
pub fn compute_cell_rects(
    printable_w: i32,
    printable_h: i32,
    cols: u32,
    rows: u32,
    gap: i32,
) -> Vec<CellRect> {
    let cols = cols.max(1) as i32;
    let rows = rows.max(1) as i32;

    let total_gap_x = gap.max(0) * (cols - 1);
    let total_gap_y = gap.max(0) * (rows - 1);
    let cell_w = ((printable_w - total_gap_x) / cols).max(1);
    let cell_h = ((printable_h - total_gap_y) / rows).max(1);

    let mut cells = Vec::with_capacity((cols * rows) as usize);
    for row in 0..rows {
        for col in 0..cols {
            cells.push(CellRect {
                left: col * (cell_w + gap.max(0)),
                top: row * (cell_h + gap.max(0)),
                width: cell_w,
                height: cell_h,
            });
        }
    }
    cells
}

/// Calculates the target drawing rectangle `(left, top, width, height)` within a cell
/// while preserving the source image aspect ratio and centering it.
pub fn fit_image_in_cell(
    cell: &CellRect,
    image_width: u32,
    image_height: u32,
) -> (i32, i32, i32, i32) {
    let cw = cell.width.max(1) as f64;
    let ch = cell.height.max(1) as f64;
    let iw = image_width.max(1) as f64;
    let ih = image_height.max(1) as f64;

    let scale = (cw / iw).min(ch / ih);
    let draw_w = (iw * scale).round().max(1.0);
    let draw_h = (ih * scale).round().max(1.0);
    let left = cell.left + ((cw - draw_w) / 2.0).round() as i32;
    let top = cell.top + ((ch - draw_h) / 2.0).round() as i32;

    (left, top, draw_w as i32, draw_h as i32)
}

/// Groups a slice of items into physical sheets, where each sheet contains at most `slots` items.
pub fn group_items_into_sheets<T>(items: &[T], slots: usize) -> Vec<Vec<&T>> {
    if slots == 0 || items.is_empty() {
        return Vec::new();
    }
    items
        .chunks(slots)
        .map(|chunk| chunk.iter().collect())
        .collect()
}

/// Slightly downscales render DPI for N-up layouts because each logical page occupies a smaller area.
pub fn adjust_render_dpi_for_nup(base_dpi: u32, layout: NupLayout) -> u32 {
    let slots = layout.cols.max(layout.rows);
    let factor = match slots {
        1 => 1.0,
        2 => 0.85,
        3 => 0.7,
        _ => 0.6,
    };
    let adjusted = (base_dpi as f64 * factor).round() as u32;
    adjusted.max(150).min(base_dpi)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_2x2_grid_without_gap() {
        let cells = compute_cell_rects(1000, 1000, 2, 2, 0);
        assert_eq!(cells.len(), 4);
        assert_eq!(
            cells[0],
            CellRect {
                left: 0,
                top: 0,
                width: 500,
                height: 500
            }
        );
        assert_eq!(
            cells[1],
            CellRect {
                left: 500,
                top: 0,
                width: 500,
                height: 500
            }
        );
        assert_eq!(
            cells[2],
            CellRect {
                left: 0,
                top: 500,
                width: 500,
                height: 500
            }
        );
        assert_eq!(
            cells[3],
            CellRect {
                left: 500,
                top: 500,
                width: 500,
                height: 500
            }
        );
    }

    #[test]
    fn computes_3x2_grid_with_gap() {
        // 3 cols, 2 rows, gap 10
        // printable_w = 320 -> total_gap_x = 20 -> cell_w = (320 - 20) / 3 = 100
        // printable_h = 210 -> total_gap_y = 10 -> cell_h = (210 - 10) / 2 = 100
        let cells = compute_cell_rects(320, 210, 3, 2, 10);
        assert_eq!(cells.len(), 6);
        assert_eq!(
            cells[0],
            CellRect {
                left: 0,
                top: 0,
                width: 100,
                height: 100
            }
        );
        assert_eq!(
            cells[1],
            CellRect {
                left: 110,
                top: 0,
                width: 100,
                height: 100
            }
        );
        assert_eq!(
            cells[2],
            CellRect {
                left: 220,
                top: 0,
                width: 100,
                height: 100
            }
        );
        assert_eq!(
            cells[3],
            CellRect {
                left: 0,
                top: 110,
                width: 100,
                height: 100
            }
        );
        assert_eq!(
            cells[4],
            CellRect {
                left: 110,
                top: 110,
                width: 100,
                height: 100
            }
        );
        assert_eq!(
            cells[5],
            CellRect {
                left: 220,
                top: 110,
                width: 100,
                height: 100
            }
        );
    }

    #[test]
    fn computes_1x1_grid_degenerates_to_full_printable() {
        let cells = compute_cell_rects(800, 600, 1, 1, 10);
        assert_eq!(cells.len(), 1);
        assert_eq!(
            cells[0],
            CellRect {
                left: 0,
                top: 0,
                width: 800,
                height: 600
            }
        );
    }

    #[test]
    fn fits_image_in_cell_aspect_ratio_and_centering() {
        let cell = CellRect {
            left: 100,
            top: 100,
            width: 200,
            height: 200,
        };

        // 1. Landscape image in square cell (2:1 aspect ratio) -> scaled by width
        let (l, t, w, h) = fit_image_in_cell(&cell, 400, 200);
        assert_eq!(w, 200);
        assert_eq!(h, 100);
        assert_eq!(l, 100);
        assert_eq!(t, 150); // centered vertically: 100 + (200 - 100) / 2 = 150

        // 2. Portrait image in square cell (1:2 aspect ratio) -> scaled by height
        let (l, t, w, h) = fit_image_in_cell(&cell, 200, 400);
        assert_eq!(w, 100);
        assert_eq!(h, 200);
        assert_eq!(l, 150); // centered horizontally: 100 + (200 - 100) / 2 = 150
        assert_eq!(t, 100);
    }

    #[test]
    fn groups_items_into_sheets() {
        let items = vec![1, 2, 3, 4, 5, 6, 7];
        let sheets = group_items_into_sheets(&items, 4);
        assert_eq!(sheets.len(), 2);
        assert_eq!(sheets[0], vec![&1, &2, &3, &4]);
        assert_eq!(sheets[1], vec![&5, &6, &7]);

        let empty: Vec<i32> = vec![];
        assert!(group_items_into_sheets(&empty, 4).is_empty());
        assert!(group_items_into_sheets(&items, 0).is_empty());
    }

    #[test]
    fn adjusts_render_dpi() {
        let base_dpi = 300;
        assert_eq!(
            adjust_render_dpi_for_nup(base_dpi, NupLayout { cols: 1, rows: 1 }),
            300
        );
        assert_eq!(
            adjust_render_dpi_for_nup(base_dpi, NupLayout { cols: 1, rows: 2 }),
            255
        );
        assert_eq!(
            adjust_render_dpi_for_nup(base_dpi, NupLayout { cols: 3, rows: 2 }),
            210
        );
        assert_eq!(
            adjust_render_dpi_for_nup(base_dpi, NupLayout { cols: 4, rows: 4 }),
            180
        );
    }
}
