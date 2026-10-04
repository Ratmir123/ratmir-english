#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Jelly liquid-glass body (planning/v05/MASCOT-SPEC.md §1-2).
// A 32-node radial ring deforms the superellipse outline:
//   D(theta) = sum(d_i * w_i) / sum(w_i),  w_i = exp(K * (cos(theta - theta_i) - 1)),  K = 38
//   r(theta) = R0 * (1 + D(theta)),  dist = superellipse(p) / r(theta),  R0 = 0.78
// Analytic shading only: no texture fetches, noise octaves or off-screen blur.
// Swift call order: .boundingRect, time, energy, gazeX, gazeY, .floatArray(disp),
// dark, tintR, tintG, tintB, tintAmount.
[[ stitchable ]] half4 liquidCompanion(float2 position, half4 colour, float4 bounds,
                                      float time, float energy, float gazeX, float gazeY,
                                      device const float *disp, int count,
                                      float dark, float tintR, float tintG, float tintB, float tintAmount) {
    const float R0 = 0.78;
    const float K = 38.0;
    const float exponent = 2.65;
    float2 p = (position - bounds.xy) / bounds.zw * 2.0 - 1.0;
    float shape = pow(pow(abs(p.x), exponent) + pow(abs(p.y), exponent), 1.0 / exponent);
    // The largest outward displacement is +0.26, so nothing beyond this can be body.
    if (shape > R0 * 1.3) {
        return half4(0.0);
    }

    float len = length(p);
    float2 dir = len > 0.00001 ? p / len : float2(1.0, 0.0);
    int nodes = min(count, 32);
    float sumD = 0.0;
    float sumW = 0.0;
    if (nodes > 0) {
        // Node directions by incremental rotation: theta_i = 2 * pi * i / nodes.
        float stepAngle = 6.28318531 / float(nodes);
        float stepCos = cos(stepAngle);
        float stepSin = sin(stepAngle);
        float nodeCos = 1.0;
        float nodeSin = 0.0;
        for (int i = 0; i < 32; ++i) {
            if (i >= nodes) {
                break;
            }
            float c = dir.x * nodeCos + dir.y * nodeSin;
            float w = exp(K * (c - 1.0));
            sumD += disp[i] * w;
            sumW += w;
            float nextCos = nodeCos * stepCos - nodeSin * stepSin;
            nodeSin = nodeSin * stepCos + nodeCos * stepSin;
            nodeCos = nextCos;
        }
    }
    float D = sumW > 0.000001 ? sumD / sumW : 0.0;
    float radius = max(R0 * (1.0 + D), 0.05);
    float dist = shape / radius;
    float2 q = p / radius;

    float aa = 2.4 / max(max(bounds.z, bounds.w), 1.0) / radius;
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, dist);
    if (alpha < 0.001) {
        return half4(0.0);
    }

    float glow = clamp(dark, 0.0, 1.0);
    float z = sqrt(max(0.001, 1.0 - dist * dist));
    float3 normal = normalize(float3(sign(q.x) * pow(abs(q.x), 1.5), sign(q.y) * pow(abs(q.y), 1.5), z * 0.88));
    float2 refracted = q * (0.67 + z * 0.28) + normal.xy * 0.19;
    float flow = sin(refracted.x * 3.0 + refracted.y * 2.1 + time * 0.48);
    float pool = sin(refracted.y * 3.7 - refracted.x * 1.3 - time * 0.37);
    float3 tint = mix(float3(0.24, 0.86, 0.96), float3(0.42, 0.34, 0.94), smoothstep(-0.85, 0.9, flow + q.x * 0.35));
    tint = mix(tint, float3(0.83, 0.91, 0.99), smoothstep(0.32, 1.22, pool + q.y * 0.38) * 0.48);
    // Mood tint (0 - 0.35), then the dark-theme glow: body x1.08, specular x1.2, rim +15 %.
    tint = mix(tint, float3(tintR, tintG, tintB), clamp(tintAmount, 0.0, 0.35));
    tint *= 1.0 + 0.08 * glow;
    float fresnel = pow(1.0 - z, 2.0);
    float3 light = normalize(float3(-0.52 + gazeX * 0.15, -0.69 + gazeY * 0.12, 0.7));
    float specular = pow(max(0.0, dot(normal, light)), 25.0) * (1.0 + 0.2 * glow);
    float3 reflection = mix(float3(0.72, 0.92, 1.0), float3(0.91, 0.86, 1.0), 0.5 + 0.5 * sin(time * 0.32 + q.y * 2.0));
    float edge = exp(-abs(dist - 0.969) * 108.0) * (1.0 + 0.15 * glow);
    float upper = smoothstep(0.30, 0.95, -q.y - q.x * 0.35);
    float3 result = mix(tint * (0.70 + z * 0.28), reflection, fresnel * 0.47);
    // The upper reflection and rim define the glass; no artificial light bar across its belly.
    result += float3(specular * 0.64 + upper * edge * 0.44);
    result += float3(0.18, 0.24, 0.32) * edge * smoothstep(-0.25, 0.7, q.x + q.y) * 0.55;
    result += tint * clamp(energy, 0.0, 1.0) * 0.06;
    return half4(half3(clamp(result, 0.0, 1.0) * alpha), half(alpha));
}
