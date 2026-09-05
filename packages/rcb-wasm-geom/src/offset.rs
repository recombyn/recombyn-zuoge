//! Stroke centerline → filled outline via i_overlay StrokeOffset.
//! Output packing matches `boolean::encode_shapes` (MultiPolygon layout).

use crate::boolean::encode_shapes;
use i_overlay::mesh::stroke::offset::StrokeOffset;
use i_overlay::mesh::style::{LineCap, LineJoin, StrokeStyle};

type Contour = Vec<[f32; 2]>;
type Shape = Vec<Contour>;
type Shapes = Vec<Shape>;

pub const JOIN_BEVEL: u8 = 0;
pub const JOIN_MITER: u8 = 1;
pub const JOIN_ROUND: u8 = 2;

pub const CAP_BUTT: u8 = 0;
pub const CAP_ROUND: u8 = 1;
pub const CAP_SQUARE: u8 = 2;

fn decode_path(xy: &[f32]) -> Contour {
    let n = xy.len() / 2;
    let mut out: Contour = Vec::with_capacity(n);
    for i in 0..n {
        let x = xy[i * 2];
        let y = xy[i * 2 + 1];
        if let Some(last) = out.last() {
            if (last[0] - x).abs() < 1e-6 && (last[1] - y).abs() < 1e-6 {
                continue;
            }
        }
        out.push([x, y]);
    }
    out
}

/// Canvas/SVG miterLimit M → i_overlay Miter min-angle (radians).
fn miter_angle_from_limit(miter_limit: f32) -> f32 {
    let m = miter_limit.max(1.0) as f64;
    let theta = 2.0 * (1.0 / m).atan();
    theta.clamp(0.02, 3.0) as f32
}

fn build_style(
    width: f32,
    join: u8,
    cap: u8,
    miter_limit: f32,
    round_approx: f32,
) -> StrokeStyle<[f32; 2]> {
    let w = width.max(0.25);
    let round_a = if round_approx > 0.0 {
        round_approx
    } else {
        0.15
    };
    let line_join = match join {
        JOIN_BEVEL => LineJoin::Bevel,
        JOIN_ROUND => LineJoin::Round(round_a),
        _ => LineJoin::Miter(miter_angle_from_limit(miter_limit)),
    };
    let line_cap = match cap {
        CAP_ROUND => LineCap::Round(round_a),
        CAP_SQUARE => LineCap::Square,
        _ => LineCap::Butt,
    };
    StrokeStyle::new(w)
        .line_join(line_join)
        .start_cap(line_cap.clone())
        .end_cap(line_cap)
}

/// Offset an open/closed polyline. Empty Vec = hard failure for TS fallback.
pub fn offset_polyline(
    xy: &[f32],
    width: f32,
    closed: bool,
    join: u8,
    cap: u8,
    miter_limit: f32,
    round_approx: f32,
) -> Vec<f32> {
    let mut path = decode_path(xy);
    if closed && path.len() >= 3 {
        let a = path[0];
        let b = path[path.len() - 1];
        if (a[0] - b[0]).abs() < 0.05 && (a[1] - b[1]).abs() < 0.05 {
            path.pop();
        }
    }
    let min_pts = if closed { 3 } else { 2 };
    if path.len() < min_pts || !(width > 0.0) {
        return Vec::new();
    }

    let style = build_style(width, join, cap, miter_limit, round_approx);
    // i64 engine handles large scene coordinates more safely than default i32.
    let shapes_f: Shapes = path.stroke_as::<i64>(style, closed);
    if shapes_f.is_empty() {
        return Vec::new();
    }
    encode_shapes(&shapes_f)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::boolean::decode_shapes;

    #[test]
    fn open_butt_stroke_makes_a_ring() {
        let xy = [0.0f32, 0.0, 40.0, 0.0];
        let out = offset_polyline(xy.as_slice(), 4.0, false, JOIN_MITER, CAP_BUTT, 100.0, 0.15);
        assert!(!out.is_empty());
        let shapes = decode_shapes(&out).expect("decode");
        assert!(!shapes.is_empty());
        assert!(shapes[0][0].len() >= 4);
    }

    #[test]
    fn closed_stroke_has_outer_and_hole() {
        let xy = [0.0f32, 0.0, 20.0, 0.0, 20.0, 20.0, 0.0, 20.0];
        let out = offset_polyline(xy.as_slice(), 4.0, true, JOIN_MITER, CAP_BUTT, 100.0, 0.15);
        let shapes = decode_shapes(&out).expect("decode");
        assert_eq!(shapes.len(), 1);
        assert!(shapes[0].len() >= 2, "closed stroke should be outer+hole");
    }
}
