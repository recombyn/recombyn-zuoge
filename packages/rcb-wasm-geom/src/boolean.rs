//! Polygon boolean ops via i_overlay (union / difference / intersection / xor).
//! Packed f32 layout (input & output MultiPolygon):
//!   [polyCount,
//!     for each polygon:
//!       ringCount,
//!       for each ring: vertCount, x0, y0, x1, y1, ...]
//! Op: 0=union 1=difference 2=intersection 3=xor

use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;

type Contour = Vec<[f32; 2]>;
type Shape = Vec<Contour>;
type Shapes = Vec<Shape>;

pub const OP_UNION: u8 = 0;
pub const OP_DIFFERENCE: u8 = 1;
pub const OP_INTERSECTION: u8 = 2;
pub const OP_XOR: u8 = 3;

pub(crate) fn decode_shapes(packed: &[f32]) -> Option<Shapes> {
    if packed.is_empty() {
        return Some(Vec::new());
    }
    let mut i = 0usize;
    let poly_count = packed[i] as usize;
    i += 1;
    let mut shapes: Shapes = Vec::with_capacity(poly_count);
    for _ in 0..poly_count {
        if i >= packed.len() {
            return None;
        }
        let ring_count = packed[i] as usize;
        i += 1;
        let mut shape: Shape = Vec::with_capacity(ring_count);
        for _ in 0..ring_count {
            if i >= packed.len() {
                return None;
            }
            let vert_count = packed[i] as usize;
            i += 1;
            let need = vert_count.checked_mul(2)?;
            if i + need > packed.len() {
                return None;
            }
            if vert_count < 3 {
                i += need;
                continue;
            }
            let mut contour: Contour = Vec::with_capacity(vert_count);
            for _ in 0..vert_count {
                contour.push([packed[i], packed[i + 1]]);
                i += 2;
            }
            // Drop closing duplicate if present.
            if contour.len() >= 2 {
                let a = contour[0];
                let b = contour[contour.len() - 1];
                if (a[0] - b[0]).abs() < 1e-6 && (a[1] - b[1]).abs() < 1e-6 {
                    contour.pop();
                }
            }
            if contour.len() >= 3 {
                shape.push(contour);
            }
        }
        if !shape.is_empty() {
            shapes.push(shape);
        }
    }
    Some(shapes)
}

pub(crate) fn encode_shapes(shapes: &Shapes) -> Vec<f32> {
    let mut out: Vec<f32> = Vec::new();
    out.push(shapes.len() as f32);
    for shape in shapes {
        out.push(shape.len() as f32);
        for contour in shape {
            out.push(contour.len() as f32);
            for p in contour {
                out.push(p[0]);
                out.push(p[1]);
            }
        }
    }
    out
}

fn overlay_rule(op: u8) -> Option<OverlayRule> {
    match op {
        OP_UNION => Some(OverlayRule::Union),
        OP_DIFFERENCE => Some(OverlayRule::Difference),
        OP_INTERSECTION => Some(OverlayRule::Intersect),
        OP_XOR => Some(OverlayRule::Xor),
        _ => None,
    }
}

/// Fold N polygons with the given boolean op (same arity as polygon-clipping).
/// Returns an empty Vec on hard failure (TS treats length-0 as fallback to JS).
/// A successful empty multipolygon is encoded as `[0.0]`.
pub fn boolean_fold(op: u8, packed_polygons: &[f32]) -> Vec<f32> {
    let Some(rule) = overlay_rule(op) else {
        return Vec::new();
    };
    let Some(shapes) = decode_shapes(packed_polygons) else {
        return Vec::new();
    };
    if shapes.len() < 2 {
        return Vec::new();
    }

    let mut acc: Shapes = vec![shapes[0].clone()];
    for shape in shapes.iter().skip(1) {
        let clip: Shapes = vec![shape.clone()];
        acc = acc.overlay(&clip, rule, FillRule::NonZero);
        if acc.is_empty() && matches!(rule, OverlayRule::Intersect | OverlayRule::Difference) {
            break;
        }
    }
    encode_shapes(&acc)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack_two_rects() -> Vec<f32> {
        // Two axis-aligned rects as single-ring polygons.
        vec![
            2.0, // polyCount
            // poly0: unit square [0,0]-[2,2]
            1.0, 4.0, 0.0, 0.0, 2.0, 0.0, 2.0, 2.0, 0.0, 2.0,
            // poly1: [1,1]-[3,3]
            1.0, 4.0, 1.0, 1.0, 3.0, 1.0, 3.0, 3.0, 1.0, 3.0,
        ]
    }

    #[test]
    fn union_two_rects_has_area() {
        let out = boolean_fold(OP_UNION, &pack_two_rects());
        assert!(out[0] >= 1.0);
        let decoded = decode_shapes(&out).expect("decode");
        assert!(!decoded.is_empty());
        assert!(decoded[0][0].len() >= 4);
    }

    #[test]
    fn intersect_two_rects() {
        let out = boolean_fold(OP_INTERSECTION, &pack_two_rects());
        let decoded = decode_shapes(&out).expect("decode");
        assert_eq!(decoded.len(), 1);
        // Intersection is roughly [1,1]-[2,2]
        let xs: Vec<f32> = decoded[0][0].iter().map(|p| p[0]).collect();
        let ys: Vec<f32> = decoded[0][0].iter().map(|p| p[1]).collect();
        let min_x = xs.iter().cloned().fold(f32::INFINITY, f32::min);
        let max_x = xs.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        let min_y = ys.iter().cloned().fold(f32::INFINITY, f32::min);
        let max_y = ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        assert!((min_x - 1.0).abs() < 0.05);
        assert!((max_x - 2.0).abs() < 0.05);
        assert!((min_y - 1.0).abs() < 0.05);
        assert!((max_y - 2.0).abs() < 0.05);
    }
}
