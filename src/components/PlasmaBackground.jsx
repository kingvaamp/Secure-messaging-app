import { useEffect, useRef } from 'react';

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform float u_time;
uniform vec2 u_res;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time * 0.15;
  vec2 p = uv * 3.0;
  float n1 = noise(p + vec2(t, 0.0));
  float n2 = noise(p * 1.5 - vec2(0.0, t * 0.7));
  float n3 = noise(p * 0.8 + vec2(t * 0.3, t * 0.5));
  vec3 organic = vec3(n1 * 0.5 + 0.5, n2 * 0.5 + 0.5, n3 * 0.5 + 0.5);
  vec3 col = vec3(0.02, 0.0, 0.0) + vec3(0.6, 0.0, 0.05) * organic.r + vec3(0.2, 0.0, 0.0) * organic.g;
  float centerDist = length(uv - 0.5);
  float vignette = 1.0 - smoothstep(0.2, 0.8, centerDist);
  col *= vignette * 1.2;
  float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + fract(u_time * 0.1) * 100.0) * 43758.5453);
  col = mix(col, vec3(grain), 0.03);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default function PlasmaBackground({ opacity = 1 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
    if (!gl) return;

    // Compile shaders
    function compileShader(src, type) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      return shader;
    }

    const vs = compileShader(VERTEX_SHADER, gl.VERTEX_SHADER);
    const fs = compileShader(FRAGMENT_SHADER, gl.FRAGMENT_SHADER);

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);

    // Fullscreen triangle
    const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(program, 'u_time');
    const uRes = gl.getUniformLocation(program, 'u_res');

    function resize() {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    resize();
    window.addEventListener('resize', resize);

    function render(now) {
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(render);
        return;
      }
      gl.uniform1f(uTime, now * 0.001);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      rafRef.current = requestAnimationFrame(render);
    }

    rafRef.current = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
}
