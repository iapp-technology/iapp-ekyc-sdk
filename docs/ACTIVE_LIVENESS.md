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
  count: number;            // PEOPLE in frame (filtered, see below)
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
  `smile = max(mouthSmileLeft, mouthSmileRight)` (max, not mean — natural
  smiles are often asymmetric).

### `count` is filtered, not the raw detector output

`count` is the number of PEOPLE in frame, not the number of detections.
The web landmarker runs with `numFaces: 2` so a second person can be seen
at all; the price is that the detector re-scans the whole frame for that
second face on every frame, and on wide-FOV, high-resolution front cameras
it periodically returns a phantom — the subject's own face boxed a second
time, or a small face-like pattern in the background. `selectFaces()`
(web) and `faceObservationFrom()` (Flutter) therefore reduce the
detector's list to *people*, with identical rules:

1. Degenerate landmark sets (zero-area box, non-finite coordinates) are
   dropped.
2. The **subject** is the LARGEST remaining face. Every per-face read —
   bounding box, blendshapes, transformation matrix — uses that face's
   index, never slot 0, which a phantom can occupy.
3. A second face counts only when it is at least `minFaceWidthFrac` (0.06)
   of the frame wide, at least `minSecondaryWidthRatio` (0.40) of the
   subject's width, and overlaps the subject by less than
   `duplicateOverlap` (0.30 of the smaller box).

`FaceObservation.rawFaceCount` (web) carries the pre-filter number for
support diagnostics. Thresholds are overridable per session via
`startActiveLiveness({ faceSelection })` / `captureFace({ faceSelection })`;
on Flutter they are the `kMinSecondaryFaceWidthFrac`,
`kMinSecondaryWidthRatio` and `kDuplicateFaceOverlap` constants in
`face_metrics.dart`.

## State machine

Pure code (no camera/ML imports), RNG injectable for tests:

`init → findFace → challenge[0..N-1] → recenter → capture → finalizing → done | failed`

- **findFace**: a face and no confirmed second person, `faceWidthFrac ≥ 0.25`, `|yaw| < 15°`,
  `|pitch| < 12°`, `centerOffsetFrac < 0.12`, held for **20** consecutive
  processed frames.
- **Challenges**: draw **N = 3** distinct challenges uniformly at random
  from `{blink, turnLeft, turnRight, smile}` (`challengeCount`,
  `challengePool` configurable). Completion predicates:
  - **blink** — MEAN eye openness below the closed threshold, THEN mean
    above the reopen threshold within **2 s** of the closed sample. The
    closed→open transition is mandatory (a printed photo of closed eyes
    must NOT pass). Thresholds are **adaptive**: the machine tracks the
    user's own open-eye baseline (EMA of mean(left,right) over frontal
    frames, samples below 80% of baseline ignored); closed =
    `clamp(baseline × 0.72, 0.12, 0.55)`, reopen =
    `min(0.7, baseline × 0.8)` (≥ closed + 0.05). With no baseline yet,
    absolute fallbacks **0.2 / 0.7** apply. Depth is judged on the mean
    because glasses glare / strong backlight can flatten ONE eye's blink
    score; a wink still cannot pass because each eye must additionally
    dip below `baseline × 0.85` (per-eye dip gate).
  - **turnLeft / turnRight** — yaw delta from the baseline captured at
    challenge issue ≥ **18°** in the required direction, then return to
    `|yaw| < 12°` to complete.
  - **smile** — `smile ≥ 0.45` sustained **350 ms** (score is the max of
    the two mouth-corner blendshapes; a neutral face reads < 0.2).
- **Anti-cheat**: face lost > 1 s, a second person in frame, or a
  tracking-ID change (Flutter) → restart the current challenge. **3**
  restarts of one challenge or **15 s** timeout per challenge →
  `failed(reason)`. The second-person rule is **debounced**: `count > 1`
  must hold for `multiFaceFrames` (**5**) consecutive frames before it
  blocks findFace, shows `multiple_faces`, or restarts a challenge — and it
  restarts once per streak, not once per frame. Snapshots expose the
  debounced state as `MachineSnapshot.multiFace`.
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

- `sdk.name` ∈ `iapp-ekyc-sdk-flutter` | `iapp-ekyc-sdk-web` |
  `iapp-ekyc-sdk-ios` | `iapp-ekyc-sdk-android` | `iapp-ekyc-sdk-react-native`;
  `platform` ∈ `android` | `ios` | `web`. Wrapper SDKs (WebView shells,
  docs/WEBVIEW_BRIDGE.md) report their identity via the engine's
  `integration` option; React Native reports `ios`/`android`, never a
  platform of its own.
- `type` wire values: `blink`, `turn_left`, `turn_right`, `smile`
  (snake_case on the wire; camelCase enums in code).
- All timestamps are Unix epoch **milliseconds**. The server enforces
  strict monotonicity and duration sanity — clients must record real
  wall-clock times, never synthesize them.
