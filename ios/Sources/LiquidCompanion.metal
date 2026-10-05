#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Jelly glass body, 0.5.1 «Glass aurora» (planning/v05/MASCOT-SPEC.md §1-2; PC: components/mascot/renderer.ts with
// lib/mascot/palette.ts — every constant below is identical there).
// A 32-node radial ring deforms the superellipse outline:
//   D(theta) = sum(d_i * w_i) / sum(w_i),  w_i = exp(K * (cos(theta - theta_i) - 1)),  K = 38
//   r(theta) = R0 * (1 + D(theta)),  dist = superellipse(p) / r(theta),  R0 = 0.78
// Translucent thick glass: the inside is seen through the curved surface (bent and magnified toward the edge, crisp);
// two layers of crisp-edged colour veils (violet, lavender, lime, cyan, a touch of pink) drift on ~10 s cycles over a
// deep graphite-violet core; a smooth radial field that knows nothing about the face turns the veils deep
// indigo-violet in the upper-middle interior and lets them brighten toward the rim and the bottom (white face >= 4.5:1
// in every frame); a crisp lavender rim with a slight chromatic fringe, a thin inner edge line, a window streak,
// lime -> lavender light along the inner bottom, and an outer band that lets the page show through.
// Analytic shading only: no texture fetches, noise octaves or off-screen blur. Output is premultiplied.
// Swift call order: .boundingRect, time, energy, gazeX, gazeY, .floatArray(disp),
// dark, tintR, tintG, tintB, tintAmount.

// Thin-film colours (lime, lavender, cyan) cycled by three phase-shifted weights.
inline float3 mascotFilm(float3 w) {
    const float3 lime = float3(0.855, 0.945, 0.388);
    const float3 lavender = float3(0.733, 0.698, 0.961);
    const float3 cyan = float3(0.247, 0.835, 0.918);
    return (lime * w.x + lavender * w.y + cyan * w.z) / (w.x + w.y + w.z);
}

// Veil colours: violet, lavender, lime, cyan and (half share) pink, cycled smoothly by phase.
inline float3 mascotAurora(float phase) {
    float4 wa = 0.5 + 0.5 * cos(6.2831853 * (phase - float4(0.0, 0.2, 0.4, 0.6)));
    float wp = 0.5 + 0.5 * cos(6.2831853 * (phase - 0.8));
    wa = wa * wa * wa;
    wp = wp * wp * wp * 0.5;
    return (float3(0.52, 0.38, 1.0) * wa.x + float3(0.82, 0.76, 1.0) * wa.y + float3(0.86, 0.98, 0.45) * wa.z
            + float3(0.32, 0.88, 1.0) * wa.w + float3(1.0, 0.58, 0.8) * wp) / (wa.x + wa.y + wa.z + wa.w + wp);
}

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

    float darkness = clamp(dark, 0.0, 1.0);
    float2 gaze = float2(gazeX, gazeY);
    float z = sqrt(max(0.001, 1.0 - dist * dist));
    float3 normal = normalize(float3(sign(q.x) * pow(abs(q.x), 1.5), sign(q.y) * pow(abs(q.y), 1.5), z * 0.88));
    float2 refracted = q * (0.67 + z * 0.28) + normal.xy * 0.19;
    float flow = sin(refracted.x * 3.0 + refracted.y * 2.1 + time * 0.48);
    float pool = sin(refracted.y * 3.7 - refracted.x * 1.3 - time * 0.37);
    float3 light = normalize(float3(-0.52 + gazeX * 0.15, -0.69 + gazeY * 0.12, 0.7));
    float fresnel = pow(1.0 - z, 2.0);
    // Dark theme: rim +15 %, body x1.08, specular x1.2, film +10 %.
    float edge = exp(-abs(dist - 0.969) * 108.0) * (1.0 + 0.15 * darkness);
    float upper = smoothstep(0.30, 0.95, -q.y - q.x * 0.35);
    float3 moodTint = float3(tintR, tintG, tintB);
    float mood = clamp(tintAmount, 0.0, 0.35);
    const float3 luma = float3(0.2126, 0.7152, 0.0722);

    // The inside, seen through the curved surface; a deep core hue-shifted by the mood at constant luminance.
    float2 inner = q * (0.5 + 0.5 * z) + normal.xy * 0.28 + gaze * 0.06;
    float3 body = mix(float3(0.07, 0.055, 0.17), float3(0.15, 0.10, 0.34), smoothstep(-1.0, 1.0, inner.x * 0.45 + inner.y * 0.85));
    body = mix(body, moodTint * (dot(body, luma) / max(0.04, dot(moodTint, luma))), mood * 1.4);
    // Two-step domain-warped colour fields (~10 s cycles).
    float2 warp = inner * 1.7;
    warp += 0.6 * float2(sin(warp.y * 1.6 + time * 0.61), sin(warp.x * 1.8 - time * 0.53));
    warp += 0.35 * float2(sin(warp.y * 2.7 - time * 0.47 + 1.7), sin(warp.x * 2.2 + time * 0.67 + 0.4));
    float fieldA = sin(warp.x * 1.2 + warp.y * 0.8 + time * 0.29);
    float fieldB = sin(warp.y * 1.5 - warp.x * 0.7 - time * 0.37 + 2.0);
    // Calm interior: veils in the upper-middle run deep indigo-violet, full colour toward the rim and the bottom.
    float lift = smoothstep(0.42, 0.88, length((q - float2(0.0, -0.05)) / float2(1.0, 0.9)));
    float moodFlow = clamp(mood * 1.2, 0.0, 1.0);
    float3 colourA = mix(mascotAurora(fieldA * 0.3 + fieldB * 0.2 + time * 0.016 + gazeX * 0.08), moodTint, moodFlow);
    float3 colourB = mix(mascotAurora(fieldB * 0.3 - fieldA * 0.15 + time * 0.016 + 0.45), moodTint, moodFlow);
    colourA = mix(mix(colourA, float3(0.28, 0.2, 0.62), 0.5) * 0.62, colourA, lift);
    colourB = mix(mix(colourB, float3(0.28, 0.2, 0.62), 0.5) * 0.62, colourB, lift);
    body = mix(body, colourB, smoothstep(0.0, 0.22, fieldB * 0.7 - fieldA * 0.3 - 0.1) * 0.56);
    body = mix(body, colourA * (0.9 + 0.15 * fieldB), smoothstep(0.0, 0.22, fieldA * 0.65 + fieldB * 0.35) * 0.8);
    // Light through coloured glass along the inner bottom: lavender at its edge, lime at the hottest point.
    float bottom = exp(-q.x * q.x * 2.0) * smoothstep(0.45, 0.92, q.y) * (1.0 - smoothstep(0.94, 0.995, dist));
    float3 bottomColour = mix(mix(float3(0.5, 0.4, 0.92), float3(0.855, 0.945, 0.388), smoothstep(0.35, 0.95, bottom)),
                              moodTint, clamp(mood * 1.5, 0.0, 1.0));
    body = mix(body, bottomColour, bottom * 0.6);
    // Caustic light lines in the lower body, moving with the deformation.
    float lines = pow(abs(sin(inner.x * 6.5 + inner.y * 2.5 + flow * 1.4 + time * 0.4)), 14.0)
        * smoothstep(-0.3, 0.7, pool) * smoothstep(0.35, 0.8, q.y);
    body += float3(0.82, 0.90, 0.62) * lines * 0.18;
    body *= 0.86 + z * 0.14;
    // Crisp Fresnel rim with a slight chromatic fringe (R/G/B rims at slightly different radii).
    float3 rimMask = pow(float3(smoothstep(0.86, 0.99, dist * 1.012), smoothstep(0.86, 0.99, dist), smoothstep(0.86, 0.99, dist / 1.012)),
                         float3(1.6));
    float3 rim = mix(float3(0.76, 0.71, 1.0), moodTint, clamp(mood * 3.0, 0.0, 1.0));
    body = mix(body, rim, rimMask * 0.9);
    body *= 1.0 + 0.08 * darkness;
    float3 filmW = 0.5 + 0.5 * cos(6.2831853 * (fresnel * 1.4 + q.y * 0.3 - q.x * 0.2 + time * 0.05 + gazeX * 0.2
                                                 - float3(0.0, 0.333333, 0.666667)));
    float3 result = mix(body, mascotFilm(filmW), clamp(fresnel * (1.0 - z) * 1.2 * (1.0 + 0.1 * darkness), 0.0, 1.0));
    // Thin bright inner edge line, key specular, window streak, soft secondary highlight, rim lights.
    result += float3(0.5, 0.48, 0.62) * exp(-abs(dist - 0.935) * 150.0) * (0.55 + 0.45 * upper);
    float facing = max(0.0, dot(normal, light));
    result += float3(1.0) * pow(facing, 60.0) * (1.0 + 0.2 * darkness);
    result += float3(1.0) * smoothstep(0.78, 0.82, dist) * (1.0 - smoothstep(0.86, 0.9, dist))
        * smoothstep(0.45, 0.75, -q.y * 0.75 - q.x * 0.65) * 0.55;
    result += float3(0.10, 0.09, 0.15) * pow(max(0.0, dot(normal, float3(0.6, 0.55, 0.58))), 10.0);
    result += float3(0.80, 0.78, 1.0) * upper * edge;
    result += float3(0.5, 0.7, 0.3) * edge * smoothstep(-0.25, 0.7, q.x + q.y);
    // Light theme: a thin deep-violet outer line keeps the silhouette solid on a pale page.
    result = mix(result, float3(0.19, 0.12, 0.42), smoothstep(0.968, 1.0, dist) * 0.65 * (1.0 - darkness));
    result += body * clamp(energy, 0.0, 1.0) * 0.06;
    // The outer band lets the page show through; the rim line stays solid.
    float opacity = alpha * (1.0 - 0.32 * smoothstep(0.68, 0.95, dist) * (1.0 - smoothstep(0.955, 0.985, dist)));
    return half4(half3(clamp(result, 0.0, 1.0) * opacity), half(opacity));
}
