# Document Auto-Capture Algorithm Specification

This document is the **single source of truth** for the document detection
pipeline. The Flutter (`flutter/lib/src/vision/`) and Web (`web/src/vision/`)
implementations MUST behave identically. All constants below live in one
config object per platform (`DetectionConfig` in Dart, `DetectionParams` in
TypeScript) with these defaults.

## Frame budget

Process at most **10 frames per second** regardless of camera FPS. A frame
is dropped (never queued) while a previous frame is still being processed.

## Per-frame pipeline

1. **Grayscale acquisition**
   - Flutter/Android: take the Y plane of the NV21/YUV420 image directly,
     respecting `bytesPerRow` stride.
   - Flutter/iOS: BGRA8888 → `cvtColor(COLOR_BGRA2GRAY)`.
   - Web: draw the video element to an offscreen canvas at processing size,
     `cv.matFromImageData` → `cvtColor(COLOR_RGBA2GRAY)`.
2. **Downscale** so the longest dimension = **480 px** (`processingMaxDim`).
   Record `scale` to map detected corners back to source coordinates.
3. **Blur**: `GaussianBlur(ksize=5×5, sigma=0)`.
4. **Adaptive Canny**: let `m` = median of the grayscale histogram;
   thresholds `lower = 0.66·m`, `upper = 1.33·m`, each clamped to
   **[30, 200]**.
5. **Dilate** with a 3×3 rect kernel, 1 iteration (closes small edge gaps).
6. **Contours**: `findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)`, sort by
   area descending, examine the top **5** (`maxContourCandidates`).
7. **Quadrilateral test** per candidate: `approxPolyDP(ε = 0.02 × arcLength)`;
   if that yields ≠4 points or a non-convex shape, retry on the contour's
   **convex hull** (fingers holding a card break its outline into >4
   vertices; the hull smooths those intrusions back into a quadrilateral).
   Accept iff ALL of:
   - exactly 4 points;
   - convex (`isContourConvex`);
   - every interior angle ∈ **[60°, 120°]**;
   - contour area ≥ **8%** of processed-frame area (`minFrameAreaFrac`)
     AND ≥ **50%** of the guide-rect area (`minGuideAreaFrac`);
   - all corners ≥ **8 px** inside the processed frame border.
8. **Corner ordering & shape checks**
   - Order TL, TR, BR, BL: TL = min(x+y), BR = max(x+y), TR = max(x−y),
     BL = min(x−y).
   - Aspect ratio = mean(top edge, bottom edge) / mean(left edge, right
     edge). Target **1.586** for ID-1 cards (Thai national ID, driver
     license, bank book — 85.60 × 53.98 mm) and **1.42** for passports
     (ID-3 data page, 125 × 88 mm). Accept within **±0.25**
     (`aspectTolerance`).
   - Guide alignment: quad centroid inside the guide rect AND quad area
     between **60%–130%** of guide area (users naturally overfill the
     guide slightly).
9. **Stability tracking** (pure code, no OpenCV — unit tested):
   sliding window of the last **6** processed frames (`stabilityWindow`).
   A frame is *stable* if it was accepted AND its maximum corner
   displacement vs. the previous accepted frame is < **3.5%** of the frame
   diagonal (`maxCornerDriftFrac` — handheld cards always tremor a few
   px). Trigger condition: ≥ **4 of 6** frames stable (`minStableFrames`),
   ~0.5 s of a normal hold at 10 fps.
10. **Sharpness**: `Laplacian(CV_64F)` on the quad's bounding-box crop of
    the 480-px grayscale; score = variance. Sharp iff score ≥ **60**
    (`minSharpness` — consumer cameras are soft, and the ring buffer
    submits the sharpest frame anyway). Keep a ring buffer of the last
    **5** accepted frames (corners + sharpness + source reference).
11. **Auto-capture** fires when the stability trigger holds AND the best
    ring-buffer sharpness ≥ threshold.
    - Flutter: call `takePicture()` (full sensor resolution), re-run steps
      1–8 on the still using the last stream quad (scaled) as a sanity
      prior; if detection on the still fails, fall back to the best
      buffered stream frame (NV21 → BGR via `COLOR_YUV2BGR_NV21`).
    - Web: draw the current video frame at native resolution to a canvas.
12. **Perspective correction**: scale corners to the captured resolution;
    `getPerspectiveTransform` → destination size at ~300 DPI:
    **1011×637** (ID-1) or **1476×1039** (passport);
    `warpPerspective(INTER_LINEAR)`; encode **JPEG quality 92**; assert
    result < 10 MB.
13. **Submission**: multipart POST, field `file`, to the endpoint mapped
    from `DocumentType`:

    | DocumentType | Endpoint (relative to `baseUrl`) | Aspect |
    |---|---|---|
    | `thaiIdFront` | `/v3/store/ekyc/thai-national-id-card/front` | 1.586 |
    | `thaiIdBack` | `/v3/store/ekyc/thai-national-id-card/back` | 1.586 |
    | `thaiIdWithSignature` | `/v3/store/ekyc/thai-national-id-card-with-signature` | 1.586 |
    | `thaiDriverLicense` | `/v3/store/ekyc/thai-driver-license` | 1.586 |
    | `bookBank` | `/v3/store/ekyc/book-bank` | 1.586 |
    | `passport` | `/v3/store/ekyc/passport` | 1.42 |

## UX state machine (strings localized via the i18n tables)

`searching` → `holdStill` (quad accepted, accumulating stability) →
`tooBlurry` | `moveCloser` (area < 60% of guide) | `alignCard`
(aspect/centroid failure) → `capturing` → `uploading` → `done` | `error`.

**Assisted fallback** (`assistedFallbackMs = 3000`): if no quad has been
accepted after 3 s, auto-capture switches to guide-region mode — when the
guide crop is sharp (Laplacian ≥ `minSharpness`) AND motion-stable
(mean abs frame diff ≤ `assistedMaxMeanDiff = 10`) for
`assistedStableFrames = 4` consecutive frames, the guide rect is captured
directly (no perspective warp). This keeps hands-over-edges scenarios
automatic instead of falling through to the manual button.

**Presence gate** (mandatory for assisted mode): an empty desk is sharp
and stable too. A baseline guide crop is sampled ≥5 frames after camera
start (auto-exposure settled) from a frame with no detected document;
assisted frames count ONLY while the current guide crop differs from that
baseline by mean abs diff ≥ `assistedPresenceMinDiff = 12`. If the
document is already in the guide at start, the baseline is never sampled
and assisted mode stays off — the quad path or the manual button covers
that session.

A **manual capture button** appears after **10 s** without auto-capture
(`manualFallbackMs = 10000`).

## Shared test vectors

`web/tests/fixtures/vectors/*.json` holds geometry and stability test
vectors (corner sets → expected ordering/angles/aspect/stability verdicts).
The SAME files are copied to `flutter/test/fixtures/vectors/` and both test
suites assert identical outcomes. Any change to constants requires
regenerating vectors in BOTH trees in the same commit.
