/**
 * WebGL2 UV remap preview — design sheet over base with shadow × highlight (screen).
 */



export type UvPreviewKit = {
  width: number;
  height: number;
  baseUrl: string;
  maskUrl: string;
  uv: Float32Array;
  /** Optional luminance-derived shadow map (RGB data URL). */
  shadowUrl?: string | null;
  /** Optional highlight map (RGB data URL). */
  highlightUrl?: string | null;
};



const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;



const FS = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform sampler2D uDesign;
uniform sampler2D uMask;
uniform sampler2D uUV;
uniform sampler2D uShadow;
uniform sampler2D uHighlight;
uniform bool uHasDesign;
uniform bool uHasPbr;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 base = texture(uBase, vUv);
  float m = texture(uMask, vUv).r;
  if (!uHasDesign || m < 0.01) {
    outColor = vec4(base.rgb, 1.0);
    return;
  }
  vec2 uv = texture(uUV, vUv).rg;
  vec4 design = texture(uDesign, uv);
  float a = design.a * m;
  vec3 lit = design.rgb;
  if (uHasPbr) {
    vec3 shadow = texture(uShadow, vUv).rgb;
    vec3 highlight = texture(uHighlight, vUv).rgb;
    vec3 shaded = design.rgb * shadow;
    // Screen blend (matches pbr_blend.blend_screen)
    lit = 1.0 - (1.0 - shaded) * (1.0 - highlight * 0.85);
  }
  outColor = vec4(mix(base.rgb, lit, a), 1.0);
}
`;



function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('WebGL shader alloc failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(sh) || 'compile error';
    gl.deleteShader(sh);
    throw new Error(info);
  }
  return sh;
}



function link(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error('WebGL program alloc failed');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog) || 'link error';
    gl.deleteProgram(prog);
    throw new Error(info);
  }
  return prog;
}



function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}



function texImage2D(
  gl: WebGL2RenderingContext,
  unit: number,
  source: TexImageSource | null,
  opts?: { floatUv?: boolean; width?: number; height?: number; data?: Float32Array | null }
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('texture alloc failed');
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (opts?.floatUv && opts.width && opts.height && opts.data) {
    // Float UV: NEAREST — LINEAR on float needs OES_texture_float_linear (often missing).
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const w = opts.width;
    const h = opts.height;
    const rg = opts.data;
    // Pack RG → RGBA32F for wider GPU support than RG32F.
    const rgba = new Float32Array(w * h * 4);
    const n = Math.min(rg.length / 2, w * h);
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      rgba[o] = rg[i * 2];
      rgba[o + 1] = rg[i * 2 + 1];
      rgba[o + 2] = 0;
      rgba[o + 3] = 1;
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, rgba);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      gl.deleteTexture(tex);
      throw new Error(`UV texture upload failed (WebGL 0x${err.toString(16)})`);
    }
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (source) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 0])
      );
    }
  }
  return tex;
}



/** 1×1 white / black placeholders when PBR maps are absent. */
function solidTex(gl: WebGL2RenderingContext, unit: number, rgb: [number, number, number]): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('texture alloc failed');
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([rgb[0], rgb[1], rgb[2], 255])
  );
  return tex;
}



export type MockupUvPreview = {
  setKit: (kit: UvPreviewKit) => Promise<void>;
  /** Swap printable region maps without clearing the bound design sheet. */
  setRegionSurfaces: (
    partial: Pick<UvPreviewKit, 'maskUrl' | 'uv'> &
      Partial<Pick<UvPreviewKit, 'shadowUrl' | 'highlightUrl'>>
  ) => Promise<void>;
  setDesignSheet: (dataUrl: string | null) => Promise<void>;
  /** True only after a design sheet was bound — kit-only frames must not publish/bake. */
  hasDesignBound: () => boolean;
  draw: () => void;
  toDataURL: () => string;
  dispose: () => void;
  canvas: HTMLCanvasElement;
};



export function createMockupUvPreview(canvas?: HTMLCanvasElement): MockupUvPreview {
  const el = canvas || document.createElement('canvas');
  const gl = el.getContext('webgl2', {
    premultipliedAlpha: false,
    alpha: false,
    antialias: false,
  });
  if (!gl) throw new Error('WebGL2 unavailable');



  // Float color textures often need this for RG32F sampling.
  gl.getExtension('EXT_color_buffer_float');



  const vs = compile(gl, gl.VERTEX_SHADER, VS);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  const prog = link(gl, vs, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);



  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  const uBase = gl.getUniformLocation(prog, 'uBase');
  const uDesign = gl.getUniformLocation(prog, 'uDesign');
  const uMask = gl.getUniformLocation(prog, 'uMask');
  const uUV = gl.getUniformLocation(prog, 'uUV');
  const uShadow = gl.getUniformLocation(prog, 'uShadow');
  const uHighlight = gl.getUniformLocation(prog, 'uHighlight');
  const uHasDesign = gl.getUniformLocation(prog, 'uHasDesign');
  const uHasPbr = gl.getUniformLocation(prog, 'uHasPbr');



  let texBase: WebGLTexture | null = null;
  let texMask: WebGLTexture | null = null;
  let texUv: WebGLTexture | null = null;
  let texDesign: WebGLTexture | null = null;
  let texShadow: WebGLTexture | null = null;
  let texHighlight: WebGLTexture | null = null;
  let hasDesign = false;
  let hasPbr = false;
  let kitW = 1;
  let kitH = 1;



  const disposeTex = (t: WebGLTexture | null) => {
    if (t) gl.deleteTexture(t);
  };



  const bindPbr = async (shadowUrl?: string | null, highlightUrl?: string | null) => {
    disposeTex(texShadow);
    disposeTex(texHighlight);
    texShadow = null;
    texHighlight = null;
    hasPbr = Boolean(shadowUrl || highlightUrl);
    if (shadowUrl) {
      const img = await loadImage(shadowUrl);
      texShadow = texImage2D(gl, 4, img);
    } else {
      texShadow = solidTex(gl, 4, [255, 255, 255]);
    }
    if (highlightUrl) {
      const img = await loadImage(highlightUrl);
      texHighlight = texImage2D(gl, 5, img);
    } else {
      texHighlight = solidTex(gl, 5, [0, 0, 0]);
    }
  };



  const draw = () => {
    if (!texBase || !texMask || !texUv) return;
    el.width = kitW;
    el.height = kitH;
    gl.viewport(0, 0, kitW, kitH);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);



    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texBase);
    gl.uniform1i(uBase, 0);



    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texDesign || texBase);
    gl.uniform1i(uDesign, 1);



    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, texMask);
    gl.uniform1i(uMask, 2);



    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, texUv);
    gl.uniform1i(uUV, 3);



    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, texShadow || texBase);
    gl.uniform1i(uShadow, 4);



    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, texHighlight || texBase);
    gl.uniform1i(uHighlight, 5);



    gl.uniform1i(uHasDesign, hasDesign ? 1 : 0);
    gl.uniform1i(uHasPbr, hasPbr ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };



  return {
    canvas: el,
    async setKit(kit: UvPreviewKit) {
      kitW = Math.max(1, kit.width);
      kitH = Math.max(1, kit.height);
      const [baseImg, maskImg] = await Promise.all([loadImage(kit.baseUrl), loadImage(kit.maskUrl)]);
      disposeTex(texBase);
      disposeTex(texMask);
      disposeTex(texUv);
      // New kit invalidates the prior design sheet until setDesignSheet runs again.
      disposeTex(texDesign);
      texDesign = null;
      hasDesign = false;
      texBase = texImage2D(gl, 0, baseImg);
      texMask = texImage2D(gl, 2, maskImg);
      texUv = texImage2D(gl, 3, null, {
        floatUv: true,
        width: kitW,
        height: kitH,
        data: kit.uv,
      });
      await bindPbr(kit.shadowUrl, kit.highlightUrl);
      draw();
    },
    async setRegionSurfaces(partial) {
      const maskImg = await loadImage(partial.maskUrl);
      disposeTex(texMask);
      disposeTex(texUv);
      texMask = texImage2D(gl, 2, maskImg);
      texUv = texImage2D(gl, 3, null, {
        floatUv: true,
        width: kitW,
        height: kitH,
        data: partial.uv,
      });
      if (partial.shadowUrl !== undefined || partial.highlightUrl !== undefined) {
        await bindPbr(partial.shadowUrl, partial.highlightUrl);
      }
      draw();
    },
    async setDesignSheet(dataUrl: string | null) {
      disposeTex(texDesign);
      texDesign = null;
      hasDesign = false;
      if (dataUrl) {
        const img = await loadImage(dataUrl);
        texDesign = texImage2D(gl, 1, img);
        hasDesign = true;
      }
      draw();
    },
    hasDesignBound: () => hasDesign,
    draw,
    toDataURL: () => el.toDataURL('image/png'),
    dispose() {
      disposeTex(texBase);
      disposeTex(texMask);
      disposeTex(texUv);
      disposeTex(texDesign);
      disposeTex(texShadow);
      disposeTex(texHighlight);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    },
  };
}


