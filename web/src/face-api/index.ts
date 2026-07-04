/**
 * Thin wrappers over the stateless face endpoints
 * (docs/API_CONTRACTS.md — Face APIs).
 */
import type { EkycApiClient } from '../core/api-client';
import type { FaceVerificationResult, PassiveLivenessResult } from '../core/types';

export class FaceApi {
  private readonly client: EkycApiClient;

  constructor(client: EkycApiClient) {
    this.client = client;
  }

  /** POST /v3/store/ekyc/face-verification (`file1`, `file2`). */
  verify(file1: Blob, file2: Blob): Promise<FaceVerificationResult> {
    return this.client.verifyFaces(file1, file2);
  }

  /** POST /v3/store/ekyc/face-passive-liveness (`file`). */
  passiveLiveness(file: Blob): Promise<PassiveLivenessResult> {
    return this.client.checkPassiveLiveness(file);
  }
}
