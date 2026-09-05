//! Ramer–Douglas–Peucker polyline simplify (iterative stack — no deep recursion).

/// Open RDP. Input/output: interleaved xy. Empty Vec = hard failure.
pub fn simplify_rdp(xy: &[f32], epsilon: f32) -> Vec<f32> {
    let n = xy.len() / 2;
    if n <= 2 {
        return xy.to_vec();
    }
    let eps = epsilon.max(0.0);
    // Stack of (start, end) inclusive indices into the point array.
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack: Vec<(usize, usize)> = vec![(0, n - 1)];
    while let Some((i, j)) = stack.pop() {
        if j <= i + 1 {
            continue;
        }
        let ax = xy[i * 2];
        let ay = xy[i * 2 + 1];
        let bx = xy[j * 2];
        let by = xy[j * 2 + 1];
        let mut max_d = 0.0f32;
        let mut max_k = i;
        for k in (i + 1)..j {
            let d = dist_point_to_seg(xy[k * 2], xy[k * 2 + 1], ax, ay, bx, by);
            if d > max_d {
                max_d = d;
                max_k = k;
            }
        }
        if max_d > eps {
            keep[max_k] = true;
            stack.push((i, max_k));
            stack.push((max_k, j));
        }
    }
    let mut out: Vec<f32> = Vec::with_capacity(n * 2);
    for i in 0..n {
        if keep[i] {
            out.push(xy[i * 2]);
            out.push(xy[i * 2 + 1]);
        }
    }
    out
}

/// Closed ring RDP: drop closing duplicate, run open RDP on ring+[first], return open ring.
pub fn simplify_rdp_closed(xy: &[f32], epsilon: f32) -> Vec<f32> {
    let mut n = xy.len() / 2;
    if n < 3 {
        return xy.to_vec();
    }
    // Drop closing duplicate if present.
    let mut end = n;
    if (xy[0] - xy[(n - 1) * 2]).abs() < 1e-6 && (xy[1] - xy[(n - 1) * 2 + 1]).abs() < 1e-6 {
        end = n - 1;
        n = end;
    }
    if n < 3 {
        return xy[..(end * 2).min(xy.len())].to_vec();
    }
    // Work buffer: ring + first point for closed RDP.
    let mut work: Vec<f32> = Vec::with_capacity((n + 1) * 2);
    work.extend_from_slice(&xy[..n * 2]);
    work.push(xy[0]);
    work.push(xy[1]);
    let simplified = simplify_rdp(&work, epsilon);
    let sn = simplified.len() / 2;
    if sn < 2 {
        return xy[..n * 2].to_vec();
    }
    // Drop trailing duplicate of first if RDP kept both ends.
    let mut out_n = sn;
    if out_n >= 2
        && (simplified[0] - simplified[(out_n - 1) * 2]).abs() < 1e-6
        && (simplified[1] - simplified[(out_n - 1) * 2 + 1]).abs() < 1e-6
    {
        out_n -= 1;
    }
    simplified[..out_n * 2].to_vec()
}

fn dist_point_to_seg(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let dx = bx - ax;
    let dy = by - ay;
    let len2 = dx * dx + dy * dy;
    if len2 < 1e-20 {
        let ex = px - ax;
        let ey = py - ay;
        return (ex * ex + ey * ey).sqrt();
    }
    let mut t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if t < 0.0 {
        t = 0.0;
    } else if t > 1.0 {
        t = 1.0;
    }
    let qx = ax + t * dx;
    let qy = ay + t * dy;
    let ex = px - qx;
    let ey = py - qy;
    (ex * ex + ey * ey).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_line_collinear_collapses() {
        let xy = [0.0f32, 0.0, 1.0, 0.0, 2.0, 0.0, 3.0, 0.0];
        let out = simplify_rdp(&xy, 0.1);
        assert_eq!(out.len() / 2, 2);
        assert!((out[0] - 0.0).abs() < 1e-5);
        assert!((out[2] - 3.0).abs() < 1e-5);
    }

    #[test]
    fn closed_square_keeps_corners() {
        let xy = [
            0.0f32, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0, 0.0, 0.0,
        ];
        let out = simplify_rdp_closed(&xy, 0.5);
        assert!(out.len() / 2 >= 4);
    }
}
