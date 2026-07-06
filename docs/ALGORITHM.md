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
5. **Morphological close** with a **7×7** rect kernel (`closeKernelSize`) —
   bridges glare / low-contrast / finger gaps in the card border so it
   survives as ONE closed contour. (Replaced a plain 3×3 dilate; the wider
   close is the single biggest robustness win.)
6. **Contours**: `findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)`, sort by
   area descending, examine the top **8** (`maxContourCandidates`).
7. **Corner extraction (jscanify method, MIT — see NOTICE):** the document
   is the largest contour filling the guide. Its 4 corners are the points
   **farthest from the contour centroid within each quadrant** (TL = max
   distance among points with dx≤0, dy≤0; TR dx>0,dy≤0; BR dx>0,dy>0;
   BL dx≤0,dy>0), yielding corners already ordered TL, TR, BR, BL. This is
   robust to rounded corners, broken edges and fingers — unlike a strict
   `approxPolyDP` demanding exactly 4 convex vertices with interior-angle
   limits, which flickered frame-to-frame and rejected well-presented
   cards. A candidate is skipped if any quadrant is empty; the first
   (largest-first) candidate passing step 8 wins.
8. **Acceptance checks** on the extreme-corner quad:
   - Aspect ratio = mean(top edge, bottom edge) / mean(left edge, right
     edge). Target **1.586** for ID-1 cards (Thai national ID, driver
     license, bank book — 85.60 × 53.98 mm) and **0.71** for passports
     (88 × 125 mm data page held **portrait**, the natural reading
     orientation — photo bottom-left, MRZ across the bottom). Accept
     within **±0.30** (`aspectTolerance`).
   - Corners must sit within the guide expanded by
     `guideCornerMarginFrac = 0.12` AND inside the frame border
     (`borderMarginPx = 6`); quad area between **50%–135%** of guide area
     (`guideAreaMinFrac`/`guideAreaMaxFrac` — users naturally overfill).
9. **Corner smoothing + stability tracking.** Accepted corners are first
   **EMA-smoothed** (`cornerSmoothingAlpha = 0.45`; a jump > 60 px snaps to
   raw for fast repositions) so per-frame detection jitter is damped — this
   is what makes "hold still" reachable by hand and steadies the drawn
   quad. The tracker (pure code, unit-tested) then keeps a sliding window
   of the last **4** processed frames; a frame is *stable* if accepted AND
   its max corner displacement vs. the previous accepted frame is < **9%**
   of the frame diagonal (`maxCornerDriftFrac`). Trigger: ≥ **2 of 4**
   frames stable (`minStableFrames`), ~0.2 s of a normal hold.
10. **Sharpness**: `Laplacian(CV_64F)` on the quad's bounding-box crop of
    the 480-px grayscale; score = variance. Sharp iff score ≥ **45**
    (`minSharpness` — consumer cameras are soft, and the ring buffer
    submits the sharpest frame anyway). Keep a ring buffer of the last
    **5** accepted frames (corners + sharpness + source reference).
11. **Auto-capture.**
    - **Web (occupancy + motion + sharp snap):** capture does NOT wait for
      the fragile edge-contour quad to be accepted. Each frame the detector
      reports `guideEdgeDensity` (fraction of Canny-edge pixels inside the
      guide rect — a text-filled card scores high, an empty wall ≈ 0). The
      snap fires after `easyStableFrames = 4` consecutive frames (~0.3 s)
      that are all: **occupied** (`guideEdgeDensity ≥ occupancyMinEdgeDensity
      = 0.03`), **motion-stable** (mean-abs-diff of the gray guide crop vs
      the previous frame ≤ `easyMotionMaxMeanDiff = 8`), and **sharp**
      (`Laplacian` variance of the guide crop ≥ `minSharpness`). If a quad
      IS accepted on the firing frame it is used (smoothed, perspective-
      corrected) for the best crop; otherwise the guide-region crop is used
      — the user is cooperatively presenting a card, so the guide crop
      already contains the whole card. Occupancy prevents empty-wall snaps.
      The captured frame is the current video frame at native resolution.
    - **Flutter:** fires when the step-9 stability trigger holds AND the best
      ring-buffer sharpness ≥ threshold; call `takePicture()` (full sensor
      resolution), re-run steps 1–8 on the still using the last stream quad
      (scaled) as a sanity prior; if detection on the still fails, fall back
      to the best buffered stream frame (NV21 → BGR via
      `COLOR_YUV2BGR_NV21`).
12. **Perspective correction**: scale corners to the captured resolution;
    `getPerspectiveTransform` → destination size at ~300 DPI:
    **1011×637** (ID-1, landscape) or **1039×1476** (passport, portrait);
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
    | `passport` | `/v3/store/ekyc/passport` | 0.71 (portrait) |

## UX state machine (strings localized via the i18n tables)

`searching` → `holdStill` (guide occupied + sharp, accumulating hold) →
`tooBlurry` (occupied but not sharp) → `capturing` → `uploading` → `done`
| `error`.

**Web capture keys off occupancy, not quad acceptance** (step 11). The old
rule — auto-capture only on an accepted document quad — was too fragile: a
well-placed card whose edge contour never quite passed the aspect/centroid
checks would never snap, frustrating users. The new snap model instead
fires when the guide is *occupied by a detailed object* (high
`guideEdgeDensity`), the frame is *motion-stable*, and it is *sharp*, held
for ~0.3 s. Occupancy (a text-filled card vs an empty wall) is what
prevents a still empty scene from snapping; the user is cooperatively
presenting a card, so an occasional guide-region crop (when no quad is
accepted that frame) still contains the whole card. The chip reflects the
gates: `searching` when not occupied, `tooBlurry` when occupied but soft,
`holdStill` while the run accumulates.

The detector still runs full quad detection (steps 6–8) and reports
`cardLike` for UX hints; an accepted quad, when present on the firing
frame, is used for a perspective-corrected crop, but it is no longer a
precondition for the snap.

A **manual capture button** appears after **4 s** without auto-capture
(`manualFallbackMs = 4000`) as a safety net.

## Shared test vectors

`web/tests/fixtures/vectors/*.json` holds geometry and stability test
vectors (corner sets → expected ordering/angles/aspect/stability verdicts).
The SAME files are copied to `flutter/test/fixtures/vectors/` and both test
suites assert identical outcomes. Any change to constants requires
regenerating vectors in BOTH trees in the same commit.
