//! Moore-neighborhood contour tracing for alpha masks (CJK canvas 轮廓化).

const DX: [i32; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
const DY: [i32; 8] = [0, 1, 1, 1, 0, -1, -1, -1];

fn solid_at(mask: &[u8], w: usize, h: usize, x: i32, y: i32) -> bool {
    if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
        return false;
    }
    mask[y as usize * w + x as usize] != 0
}

fn mark_outside_empty(mask: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut outside = vec![0u8; w * h];
    let mut stack: Vec<(i32, i32)> = Vec::new();
    let push = |x: i32, y: i32, outside: &mut [u8], stack: &mut Vec<(i32, i32)>| {
        if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
            return;
        }
        let i = y as usize * w + x as usize;
        if outside[i] != 0 || mask[i] != 0 {
            return;
        }
        outside[i] = 1;
        stack.push((x, y));
    };
    for x in 0..w as i32 {
        push(x, 0, &mut outside, &mut stack);
        push(x, h as i32 - 1, &mut outside, &mut stack);
    }
    for y in 0..h as i32 {
        push(0, y, &mut outside, &mut stack);
        push(w as i32 - 1, y, &mut outside, &mut stack);
    }
    while let Some((x, y)) = stack.pop() {
        push(x + 1, y, &mut outside, &mut stack);
        push(x - 1, y, &mut outside, &mut stack);
        push(x, y + 1, &mut outside, &mut stack);
        push(x, y - 1, &mut outside, &mut stack);
    }
    outside
}

fn trace_region(region: &dyn Fn(i32, i32) -> bool, w: usize, h: usize) -> Vec<Vec<[f32; 2]>> {
    let mut visited = vec![0u8; w * h];
    let mut contours: Vec<Vec<[f32; 2]>> = Vec::new();

    let flood_mark = |sx: i32, sy: i32, visited: &mut [u8]| {
        let mut stack: Vec<(i32, i32)> = vec![(sx, sy)];
        while let Some((x, y)) = stack.pop() {
            if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
                continue;
            }
            let i = y as usize * w + x as usize;
            if visited[i] != 0 || !region(x, y) {
                continue;
            }
            visited[i] = 1;
            stack.push((x + 1, y));
            stack.push((x - 1, y));
            stack.push((x, y + 1));
            stack.push((x, y - 1));
        }
    };

    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let i = y as usize * w + x as usize;
            if visited[i] != 0 || !region(x, y) || region(x - 1, y) {
                continue;
            }
            let sx = x;
            let sy = y;
            let mut pts: Vec<[f32; 2]> = Vec::new();
            let mut cx = sx;
            let mut cy = sy;
            let mut dir: i32 = 0;
            let max_steps = w * h * 2;
            for _ in 0..max_steps {
                pts.push([cx as f32, cy as f32]);
                let mut found = false;
                for k in 0..8 {
                    let nd = (dir + 6 + k) % 8;
                    let nx = cx + DX[nd as usize];
                    let ny = cy + DY[nd as usize];
                    if region(nx, ny) {
                        cx = nx;
                        cy = ny;
                        dir = nd;
                        found = true;
                        break;
                    }
                }
                if !found {
                    break;
                }
                if cx == sx && cy == sy && pts.len() > 8 {
                    break;
                }
            }
            flood_mark(sx, sy, &mut visited);
            if pts.len() >= 8 {
                contours.push(pts);
            }
        }
    }
    contours
}

fn pack_contours(contours: &[Vec<[f32; 2]>]) -> Vec<f32> {
    let mut out: Vec<f32> = Vec::new();
    out.push(contours.len() as f32);
    for c in contours {
        out.push(c.len() as f32);
        for p in c {
            out.push(p[0]);
            out.push(p[1]);
        }
    }
    out
}

/// Trace solid + hole contours from an RGBA buffer (ImageData layout).
/// Returns packed `[count, n0, x0,y0, …, n1, …]`. Empty Vec = failure.
pub fn trace_rgba_contours(rgba: &[u8], width: u32, height: u32, alpha_threshold: u8) -> Vec<f32> {
    let w = width as usize;
    let h = height as usize;
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return Vec::new();
    }
    let mut mask = vec![0u8; w * h];
    for i in 0..(w * h) {
        if rgba[i * 4 + 3] > alpha_threshold {
            mask[i] = 1;
        }
    }
    let outside = mark_outside_empty(&mask, w, h);
    let solid_fn = |x: i32, y: i32| solid_at(&mask, w, h, x, y);
    let mut all = trace_region(&solid_fn, w, h);
    let hole_fn = |x: i32, y: i32| {
        if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
            return false;
        }
        let i = y as usize * w + x as usize;
        mask[i] == 0 && outside[i] == 0
    };
    all.extend(trace_region(&hole_fn, w, h));
    if all.is_empty() {
        // Successful empty glyph (space) — encode as [0]
        return vec![0.0];
    }
    pack_contours(&all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traces_filled_square() {
        let w = 16u32;
        let h = 16u32;
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 4..12 {
            for x in 4..12 {
                let i = ((y * w + x) * 4) as usize;
                rgba[i + 3] = 255;
            }
        }
        let out = trace_rgba_contours(&rgba, w, h, 20);
        assert!(out[0] >= 1.0);
        assert!(out[1] >= 8.0);
    }
}
