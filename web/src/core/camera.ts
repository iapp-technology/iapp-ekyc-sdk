/**
 * getUserMedia wrapper with secure-context checking, permission-error
 * mapping and deterministic cleanup.
 */
import {
  CameraError,
  CameraNotFoundError,
  CameraPermissionDeniedError,
  InsecureContextError,
} from './errors';

export interface CameraOpenOptions {
  /** 'environment' for documents, 'user' for selfie/liveness. */
  facingMode: 'user' | 'environment';
  /** Ideal capture width (default 1920). */
  idealWidth?: number;
  /** Ideal capture height (default 1080). */
  idealHeight?: number;
}

export class CameraController {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;

  /**
   * Open the camera and attach it to `video`. Resolves once the first
   * frame's dimensions are known (videoWidth > 0).
   */
  async open(video: HTMLVideoElement, options: CameraOpenOptions): Promise<void> {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      throw new InsecureContextError();
    }
    const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
      throw new CameraError('navigator.mediaDevices.getUserMedia is not available');
    }

    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: options.facingMode,
          width: { ideal: options.idealWidth ?? 1920 },
          height: { ideal: options.idealHeight ?? 1080 },
        },
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        throw new CameraPermissionDeniedError(undefined, { cause: e });
      }
      if (
        name === 'NotFoundError' ||
        name === 'DevicesNotFoundError' ||
        name === 'OverconstrainedError' ||
        name === 'NotReadableError'
      ) {
        throw new CameraNotFoundError(undefined, { cause: e });
      }
      throw new CameraError(`Failed to open camera: ${String(e)}`, { cause: e });
    }

    this.stream = stream;
    this.video = video;
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true'); // iOS Safari
    try {
      await video.play();
    } catch (e) {
      this.stop();
      throw new CameraError(`Failed to start video playback: ${String(e)}`, { cause: e });
    }
    await this.waitForDimensions(video);
  }

  private waitForDimensions(video: HTMLVideoElement): Promise<void> {
    if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = setInterval(() => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() - started > 10_000) {
          clearInterval(poll);
          reject(new CameraError('Timed out waiting for camera frames'));
        }
      }, 50);
    });
  }

  /** Stop all tracks and detach from the video element. Safe to call twice. */
  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
