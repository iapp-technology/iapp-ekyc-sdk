# Face Active Liveness Specification

The active liveness flow runs randomized challenges on-device, selects the
best frontal selfie frame, and finalizes the session server-side via
`POST /v3/store/ekyc/face-active-liveness/finalize` (see
[API_CONTRACTS.md](API_CONTRACTS.md)). The server re-verifies the selfie
with iApp's passive-liveness engine and returns a signed verdict —
**on-device results alone must never be treated as proof of liveness.**

## Normalized FaceObservation

Both platforms reduce their face detector output to this shape before the
state machine sees it:

```ts
interface FaceObservation {
  count: number;            // faces in frame
  yawDeg: number;           // + = user turned to THEIR left
  pitchDeg: number;         // + = looking up
  rollDeg: number;
  leftEyeOpen: number;      // 0..1
  rightEyeOpen: number;     // 0..1
  smile: number;            // 0..1
  faceWidthFrac: number;    // face bbox width / frame width
  centerOffsetFrac: number; // face center distance from oval center / frame width
}
```

- **Flutter** (`face_metrics.dart`): ML Kit `FaceDetectorOptions` —
  `enableClassification: true`, `enableTracking: true`,
  `performanceMode: fast`, `minFaceSize: 0.15`, contours **disabled**
  (≈2× latency for no benefit). The legacy Android yaw-sign flip
  (`headEulerAngleY *= -1`) and front-camera mirroring are applied HERE and
  nowhere else, so the state machine sees one sign convention.
- **Web** (`face-metrics.ts`): MediaPipe Face Landmarker with blendshapes +
  facial transformation matrix. Euler angles from matrix decomposition
  (unit-tested against known matrices); `eyeOpen = 1 − eyeBlink{Left,Right}`;
  `smile = mean(mouthSmileLeft, mouthSmileRight)`.

## State machine

Pure code (no camera/ML imports), RNG injectable for tests:

`init → findFace → challenge[0..N-1] → recenter → capture → finalizing → done | failed`

- **findFace**: exactly 1 face, `faceWidthFrac ≥ 0.25`, `|yaw| < 15°`,
  `|pitch| < 12°`, `centerOffsetFrac < 0.12`, held for **20** consecutive
  processed frames.
- **Challenges**: draw **N = 3** distinct challenges uniformly at random
  from `{blink, turnLeft, turnRight, smile}` (`challengeCount`,
  `challengePool` configurable). Completion predicates:
  - **blink** — both eyes below the closed threshold, THEN both above the
    reopen threshold within **1.5 s** of the closed sample. The
    closed→open transition is mandatory (a printed photo of closed eyes
    must NOT pass). Thresholds are **adaptive**: the machine tracks the
    user's own open-eye baseline (EMA of min(left,right) over frontal
    frames, samples below 80% of baseline ignored); closed =
    `clamp(baseline × 0.55, 0.15, 0.5)`, reopen =
    `min(0.7, baseline × 0.85)` (≥ closed + 0.05). With no baseline yet,
    absolute fallbacks **0.2 / 0.7** apply. Glasses and small-eyes users
    rarely reach the absolute floor — the relative rule is what makes
    blink detection reliable for them.
  - **turnLeft / turnRight** — yaw delta from the baseline captured at
    challenge issue ≥ **18°** in the required direction, then return to
    `|yaw| < 12°` to complete.
  - **smile** — `smile ≥ 0.8` sustained **500 ms**.
- **Anti-cheat**: face lost > 1 s, `count ≠ 1`, or tracking-ID change
  (Flutter) → restart the current challenge. **3** restarts of one
  challenge or **15 s** timeout per challenge → `failed(reason)`.
- **recenter**: findFace conditions again (fresh frontal pose before
  capture).
- **Best-frame selection** runs across the ENTIRE session: every processed
  frame with 1 face, `|yaw| < 10°`, `|pitch| < 10°`, both eyes > 0.8,
  `faceWidthFrac ≥ 0.25` is a candidate, scored
  `laplacianVariance × faceWidthFrac²`. Final selfie = argmax, cropped to
  the face bounding box expanded by **40%** margin, JPEG quality 92.
- **finalizing**: submit selfie + challenge log (schema below). Network or
  server failure → `failed(finalizeError)` with the typed API error.

## Challenge log schema (multipart field `challenges`, JSON string)

```json
{
  "session_id": "b0e7…-uuid-v4",
  "sdk": { "name": "iapp-ekyc-sdk-flutter", "version": "0.1.0", "platform": "android" },
  "started_at": 1767500000000,
  "finished_at": 1767500008000,
  "challenges": [
    { "type": "blink",      "issued_at": 1767500000123, "completed_at": 1767500001873, "passed": true },
    { "type": "turn_left",  "issued_at": 1767500002000, "completed_at": 1767500004100, "passed": true },
    { "type": "smile",      "issued_at": 1767500004500, "completed_at": 1767500006900, "passed": true }
  ]
}
```

- `sdk.name` ∈ `iapp-ekyc-sdk-flutter` | `iapp-ekyc-sdk-web`;
  `platform` ∈ `android` | `ios` | `web`.
- `type` wire values: `blink`, `turn_left`, `turn_right`, `smile`
  (snake_case on the wire; camelCase enums in code).
- All timestamps are Unix epoch **milliseconds**. The server enforces
  strict monotonicity and duration sanity — clients must record real
  wall-clock times, never synthesize them.
