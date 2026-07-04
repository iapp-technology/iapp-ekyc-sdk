/**
 * Document types and their endpoint / geometry mapping, per
 * docs/ALGORITHM.md step 13 and docs/API_CONTRACTS.md.
 */

export type DocumentType =
  | 'thaiIdFront'
  | 'thaiIdBack'
  | 'thaiIdWithSignature'
  | 'thaiDriverLicense'
  | 'bookBank'
  | 'passport';

export interface DocumentSpec {
  /** Endpoint path relative to `baseUrl`. */
  endpoint: string;
  /** Target aspect ratio (width / height). ID-1 = 1.586, ID-3 = 1.42. */
  aspect: number;
  /** Perspective-corrected output size (~300 DPI), docs/ALGORITHM.md step 12. */
  warpWidth: number;
  warpHeight: number;
}

/** ID-1 card geometry (85.60 x 53.98 mm). */
const ID1 = { aspect: 1.586, warpWidth: 1011, warpHeight: 637 } as const;
/** ID-3 passport data page geometry (125 x 88 mm). */
const ID3 = { aspect: 1.42, warpWidth: 1476, warpHeight: 1039 } as const;

export const DOCUMENT_SPECS: Record<DocumentType, DocumentSpec> = {
  thaiIdFront: { endpoint: '/v3/store/ekyc/thai-national-id-card/front', ...ID1 },
  thaiIdBack: { endpoint: '/v3/store/ekyc/thai-national-id-card/back', ...ID1 },
  thaiIdWithSignature: { endpoint: '/v3/store/ekyc/thai-national-id-card-with-signature', ...ID1 },
  thaiDriverLicense: { endpoint: '/v3/store/ekyc/thai-driver-license', ...ID1 },
  bookBank: { endpoint: '/v3/store/ekyc/book-bank', ...ID1 },
  passport: { endpoint: '/v3/store/ekyc/passport', ...ID3 },
};
