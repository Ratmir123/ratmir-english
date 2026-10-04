#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Jelly glass body, 0.5.1 «Black opal» (planning/v05/MASCOT-SPEC.md §1-2; PC: components/mascot/renderer.ts with
// lib/mascot/palette.ts — every constant below is identical there).
// A 32-node radial ring deforms the superellipse outline:
//   D(theta) = sum(d_i * w_i) / sum(w_i),  w_i = exp(K * (cos(theta - theta_i) - 1)),  K = 38
//   r(theta) = R0 * (1 + D(theta)),  dist = superellipse(p) / r(theta),  R0 = 0.78
// Thick dark glass: a deep graphite-violet core under the white face (>= 7:1), opal flecks and veins in the outer
// body, light through coloured glass along the inner bottom, a crisp Fresnel rim of lavender, thin-film iridescence
// on the edge and a crisp key specular. Analytic shading only: no texture fetches, noise octaves or off-screen blur.
// Swift call order: .boundingRect, time, energy, gazeX, gazeY, .floatArray(disp),
// dark, tintR, tintG, tintB, tintAmount.

// Thin-film / opal colours (lime, lavender, cyan) cycled by three phase-shifted weights.
inline float3 mascotFilm(float3 w) {
    const float3 lime = float3(0.855, 0.945, 0.388);
    const float3 lavender = float3(0.733, 0.698, 0.961);
    const float3 cyan = float3(0.247, 0.835, 0.918);
    return (lime * w.x + lavender * w.y + cyan * w.z) / (w.x + w.y + w.z);
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

    // Thick dark glass: a deep core with a gentle gradient; the mood shifts its hue at constant luminance.
    float3 body = mix(float3(0.06, 0.05, 0.14), float3(0.15, 0.10, 0.34),
                      smoothstep(-1.0, 1.0, q.x * 0.45 + q.y * 0.85 + flow * 0.12));
    const float3 luma = float3(0.2126, 0.7152, 0.0722);
    body = mix(body, moodTint * (dot(body, luma) / max(0.04, dot(moodTint, luma))), mood * 1.4);
    body *= 0.84 + z * 0.16;
    // Opal flecks and veins in the outer body, never under the face. They live in refracted space and brighten
    // where the surface faces the key light, so they catch the light as the body deforms and the gaze moves.
    float facing = max(0.0, dot(normal, light));
    float vein = (1.0 - smoothstep(0.0, 0.3, abs(sin(refracted.x * 4.6 - refracted.y * 2.7 + pool * 1.3 + time * 0.11))))
        * smoothstep(0.1, 0.8, pool);
    float speck = smoothstep(0.7, 0.97, sin(refracted.x * 9.0 + time * 0.07) * sin(refracted.y * 8.0 - time * 0.05 + flow));
    float fleckMask = smoothstep(0.62, 0.76, dist) * (1.0 - smoothstep(0.9, 0.97, dist));
    float3 opalW = 0.5 + 0.5 * cos(6.2831853 * (refracted.x * 0.35 - refracted.y * 0.25 + flow * 0.2 + time * 0.02
                                                 + gazeX * 0.15 - float3(0.0, 0.333333, 0.666667)));
    body = mix(body, mascotFilm(opalW), clamp((vein * 0.45 + speck) * fleckMask * (0.35 + 0.65 * facing) * 0.6, 0.0, 1.0));
    // Light through coloured glass along the inner bottom: lavender at its edge, lime at the hottest point.
    float bottom = exp(-q.x * q.x * 2.0) * smoothstep(0.45, 0.92, q.y) * (1.0 - smoothstep(0.94, 0.995, dist));
    float3 bottomColour = mix(mix(float3(0.5, 0.4, 0.92), float3(0.855, 0.945, 0.388), smoothstep(0.35, 0.95, bottom)),
                              moodTint, clamp(mood * 1.5, 0.0, 1.0));
    body = mix(body, bottomColour, bottom * 0.82);
    // Fresnel rim: brightens decisively near the edge only; the mood tint shows here at full strength.
    float3 rim = mix(float3(0.74, 0.69, 1.0), moodTint, clamp(mood * 3.0, 0.0, 1.0));
    body = mix(body, rim, pow(smoothstep(0.76, 0.99, dist), 1.3) * 0.92);
    body *= 1.0 + 0.08 * darkness;
    float3 filmW = 0.5 + 0.5 * cos(6.2831853 * (fresnel * 1.4 + q.y * 0.3 - q.x * 0.2 + time * 0.05 + gazeX * 0.2
                                                 - float3(0.0, 0.333333, 0.666667)));
    float3 result = mix(body, mascotFilm(filmW), clamp(fresnel * 0.9 * (1.0 + 0.1 * darkness), 0.0, 1.0));
    result += float3(1.0) * (pow(facing, 52.0) * (1.0 + 0.2 * darkness) + pow(facing, 6.0) * 0.05);
    result += float3(0.75, 0.72, 0.95) * upper * edge;
    result += float3(0.5, 0.7, 0.3) * edge * smoothstep(-0.25, 0.7, q.x + q.y);
    // Light theme: a thin deep-violet outer line keeps the silhouette solid on a pale page.
    result = mix(result, float3(0.19, 0.12, 0.42), smoothstep(0.968, 1.0, dist) * 0.75 * (1.0 - darkness));
    result += body * clamp(energy, 0.0, 1.0) * 0.06;
    return half4(half3(clamp(result, 0.0, 1.0) * alpha), half(alpha));
}
