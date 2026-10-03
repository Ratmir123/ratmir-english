// Procedural glass lens. One small quad, no textures, dependencies or blur passes.
const vertexSource = `attribute vec2 a_position; varying vec2 v_uv;
void main() { v_uv = a_position * 0.5 + 0.5; gl_Position = vec4(a_position, 0.0, 1.0); }`;
const fragmentSource = `precision highp float;
varying vec2 v_uv; uniform vec2 u_size; uniform float u_time; uniform float u_energy; uniform vec2 u_gaze;
void main() {
  vec2 p = vec2(v_uv.x, 1.0-v_uv.y) * 2.0 - 1.0;
  float breath = sin(u_time * 1.45);
  p.x /= 0.91 + breath * 0.016 + u_energy * 0.018;
  p.y /= 0.91 - breath * 0.018 - u_energy * 0.022;
  p.x += sin(p.y * 3.2 + u_time * 1.12) * (0.021 + u_energy * 0.018);
  p.y += sin(p.x * 3.7 - u_time * 0.91) * 0.018;
  float distance = pow(pow(abs(p.x), 2.65) + pow(abs(p.y), 2.65), 1.0 / 2.65);
  float aa = 2.4 / max(u_size.x, u_size.y);
  float alpha = 1.0 - smoothstep(1.0-aa, 1.0+aa, distance);
  if (alpha < 0.001) { gl_FragColor=vec4(0.0); return; }
  float z = sqrt(max(0.001, 1.0-distance*distance));
  vec3 normal = normalize(vec3(sign(p.x)*pow(abs(p.x),1.5),sign(p.y)*pow(abs(p.y),1.5),z*0.88));
  vec2 refracted = p * (0.67+z*0.28) + normal.xy*0.19;
  float flow = sin(refracted.x*3.0 + refracted.y*2.1 + u_time*0.48);
  float pool = sin(refracted.y*3.7 - refracted.x*1.3 - u_time*0.37);
  vec3 tint = mix(vec3(0.24,0.86,0.96),vec3(0.42,0.34,0.94),smoothstep(-0.85,0.9,flow+p.x*0.35));
  tint = mix(tint,vec3(0.83,0.91,0.99),smoothstep(0.32,1.22,pool+p.y*0.38)*0.48);
  float fresnel=pow(1.0-z,2.0);
  vec3 light=normalize(vec3(-0.52+u_gaze.x*0.15,-0.69+u_gaze.y*0.12,0.7));
  float specular=pow(max(0.0,dot(normal,light)),25.0);
  vec3 reflection=mix(vec3(0.72,0.92,1.0),vec3(0.91,0.86,1.0),0.5+0.5*sin(u_time*0.32+p.y*2.0));
  float edge=exp(-abs(distance-0.969)*108.0);
  float upper=smoothstep(0.30,0.95,-p.y-p.x*0.35);
  vec3 result=mix(tint*(0.70+z*0.28),reflection,fresnel*0.47);
  result+=vec3(specular*0.64+upper*edge*0.44);
  result+=vec3(0.18,0.24,0.32)*edge*smoothstep(-0.25,0.7,p.x+p.y)*0.55;
  gl_FragColor=vec4(clamp(result,0.0,1.0)*alpha,alpha);
}`;

export type LensRenderer = { draw(time: number, energy: number, gazeX: number, gazeY: number): void; resize(width: number, height: number): void; dispose(): void };
export function createLensRenderer(canvas: HTMLCanvasElement): LensRenderer | null {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'low-power' });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  function cleanup() { if (buffer) gl!.deleteBuffer(buffer); if (program) gl!.deleteProgram(program); shaders.forEach(shader => gl!.deleteShader(shader)); }
  try {
    function compile(type: number, source: string) {
      const shader = gl!.createShader(type); if (!shader) throw new Error('No shader'); shaders.push(shader);
      gl!.shaderSource(shader, source); gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error('Shader unavailable');
      return shader;
    }
    program = gl.createProgram(); if (!program) throw new Error('No program');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Lens unavailable');
    gl.useProgram(program);
    buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const timeUniform=gl.getUniformLocation(program,'u_time'), energyUniform=gl.getUniformLocation(program,'u_energy');
    const gazeUniform=gl.getUniformLocation(program,'u_gaze'), sizeUniform=gl.getUniformLocation(program,'u_size');
    gl.clearColor(0,0,0,0);
    return {
      resize(width,height) { const scale = Math.min(1.5, window.devicePixelRatio || 1); canvas.width=Math.max(1,Math.round(width*scale)); canvas.height=Math.max(1,Math.round(height*scale)); gl!.viewport(0,0,canvas.width,canvas.height); gl!.uniform2f(sizeUniform,canvas.width,canvas.height); },
      draw(time,energy,gazeX,gazeY) { if(gl!.isContextLost())return; gl!.uniform1f(timeUniform,time);gl!.uniform1f(energyUniform,energy);gl!.uniform2f(gazeUniform,gazeX,gazeY);gl!.drawArrays(gl!.TRIANGLES,0,6); },
      dispose: cleanup,
    };
  } catch { cleanup(); return null; }
}

export type Spring = { value: number; velocity: number };
export function advanceSpring(spring: Spring, target: number, dt: number, stiffness = 190, damping = 22) {
  spring.velocity += ((target-spring.value)*stiffness-spring.velocity*damping)*dt;
  spring.value += spring.velocity*dt;
}

// Same cubic topology in every expression. A pill bends into a curved smile.
export function eyePath(open: number, joy: number) {
  const j=Math.min(1,Math.max(0,joy)), o=Math.max(0.08,open);
  const point=(x:number,y:number,sx:number,sy:number)=>`${((x+(sx-x)*j)*20).toFixed(3)},${((0.5+(y+(sy-y)*j-0.5)*o)*32).toFixed(3)}`;
  return `M${point(.05,.5,0,.68)} C${point(.05,.16,.08,.43)} ${point(.2,0,.28,.28)} ${point(.5,0,.5,.28)} C${point(.8,0,.72,.28)} ${point(.95,.16,.92,.43)} ${point(.95,.5,1,.68)} C${point(.95,.84,.96,.87)} ${point(.8,1,.72,.48)} ${point(.5,1,.5,.48)} C${point(.2,1,.28,.48)} ${point(.05,.84,.04,.87)} ${point(.05,.5,0,.68)}Z`;
}
