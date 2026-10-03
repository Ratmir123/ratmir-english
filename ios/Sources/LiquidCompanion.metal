#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Analytic glass lens: no texture fetches, noise octaves or off-screen blur.
[[ stitchable ]] half4 liquidCompanion(float2 position, half4 colour, float4 bounds,
                                      float time, float energy, float gazeX, float gazeY) {
    float2 p = (position - bounds.xy) / bounds.zw * 2.0 - 1.0;
    float breath = sin(time * 1.45);
    p.x /= 0.91 + breath * 0.016 + energy * 0.018;
    p.y /= 0.91 - breath * 0.018 - energy * 0.022;
    p.x += sin(p.y * 3.2 + time * 1.12) * (0.021 + energy * 0.018);
    p.y += sin(p.x * 3.7 - time * 0.91) * 0.018;
    float distance = pow(pow(abs(p.x), 2.65) + pow(abs(p.y), 2.65), 1.0 / 2.65);
    float aa = 2.4 / max(bounds.z, bounds.w);
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, distance);
    if (alpha < 0.001) return half4(0.0);
    float z = sqrt(max(0.001, 1.0 - distance * distance));
    float3 normal = normalize(float3(sign(p.x) * pow(abs(p.x), 1.5), sign(p.y) * pow(abs(p.y), 1.5), z * 0.88));
    float2 refracted = p * (0.67 + z * 0.28) + normal.xy * 0.19;
    float flow = sin(refracted.x * 3.0 + refracted.y * 2.1 + time * 0.48);
    float pool = sin(refracted.y * 3.7 - refracted.x * 1.3 - time * 0.37);
    float3 tint = mix(float3(0.24, 0.86, 0.96), float3(0.42, 0.34, 0.94), smoothstep(-0.85, 0.9, flow + p.x * 0.35));
    tint = mix(tint, float3(0.83, 0.91, 0.99), smoothstep(0.32, 1.22, pool + p.y * 0.38) * 0.48);
    float fresnel = pow(1.0 - z, 2.0);
    float3 light = normalize(float3(-0.52 + gazeX * 0.15, -0.69 + gazeY * 0.12, 0.7));
    float specular = pow(max(0.0, dot(normal, light)), 25.0);
    float3 reflection = mix(float3(0.72, 0.92, 1.0), float3(0.91, 0.86, 1.0), 0.5 + 0.5 * sin(time * 0.32 + p.y * 2.0));
    float edge = exp(-abs(distance - 0.969) * 108.0);
    float upper = smoothstep(0.30, 0.95, -p.y - p.x * 0.35);
    float3 result = mix(tint * (0.70 + z * 0.28), reflection, fresnel * 0.47);
    // The upper reflection and rim define the glass; no artificial light bar across its belly.
    result += float3(specular * 0.64 + upper * edge * 0.44);
    result += float3(0.18, 0.24, 0.32) * edge * smoothstep(-0.25, 0.7, p.x + p.y) * 0.55;
    return half4(half3(clamp(result, 0.0, 1.0) * alpha), half(alpha));
}
