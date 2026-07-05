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

/**
 * One schematic hint drawn faintly inside the guide so the user aligns the
 * card the right way up. All coordinates are normalized 0..1 within the
 * guide rect.
 */
export interface CardHint {
  kind: 'photo' | 'lines' | 'flag' | 'emblem' | 'mrz';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Number of bars for `lines` / `mrz`. */
  lines?: number;
}

/** Per-card layout schematic (drawn while searching for the document). */
export interface CardLayout {
  hints: CardHint[];
}

export interface DocumentSpec {
  /** Endpoint path relative to `baseUrl`. */
  endpoint: string;
  /** Target aspect ratio (width / height). ID-1 = 1.586, passport ≈ 0.71. */
  aspect: number;
  /** Perspective-corrected output size (~300 DPI), docs/ALGORITHM.md step 12. */
  warpWidth: number;
  warpHeight: number;
  /** Schematic hint layout for the HUD guide. */
  layout: CardLayout;
}

/** ID-1 card geometry (85.60 x 53.98 mm, landscape). */
const ID1 = { aspect: 1.586, warpWidth: 1011, warpHeight: 637 } as const;

/**
 * Thai National ID (front): emblem + ID number across the top, name / last
 * name / date-of-birth lines on the left, portrait photo on the right.
 */
const THAI_ID_FRONT_LAYOUT: CardLayout = {
  hints: [
    { kind: 'emblem', x: 0.06, y: 0.08, w: 0.1, h: 0.16 },
    { kind: 'lines', x: 0.2, y: 0.1, w: 0.55, h: 0.08, lines: 1 },
    { kind: 'lines', x: 0.06, y: 0.34, w: 0.55, h: 0.42, lines: 4 },
    { kind: 'photo', x: 0.72, y: 0.34, w: 0.22, h: 0.56 },
  ],
};

/** Thai National ID (back): laser-engraved box top-left, small flag. */
const THAI_ID_BACK_LAYOUT: CardLayout = {
  hints: [
    { kind: 'photo', x: 0.06, y: 0.12, w: 0.16, h: 0.34 },
    { kind: 'flag', x: 0.55, y: 0.12, w: 0.12, h: 0.1 },
    { kind: 'lines', x: 0.06, y: 0.62, w: 0.5, h: 0.12, lines: 2 },
  ],
};

/**
 * Thai driving licence: flag + emblem top-left, portrait photo on the
 * left, licence number / name / dates lines on the right.
 */
const THAI_DRIVER_LICENSE_LAYOUT: CardLayout = {
  hints: [
    { kind: 'flag', x: 0.05, y: 0.06, w: 0.11, h: 0.09 },
    { kind: 'emblem', x: 0.05, y: 0.2, w: 0.13, h: 0.22 },
    { kind: 'photo', x: 0.04, y: 0.46, w: 0.24, h: 0.48 },
    { kind: 'lines', x: 0.34, y: 0.16, w: 0.6, h: 0.66, lines: 5 },
  ],
};

/** Bank passbook: bank logo top-left, account-number lines below. */
const BOOK_BANK_LAYOUT: CardLayout = {
  hints: [
    { kind: 'emblem', x: 0.06, y: 0.12, w: 0.14, h: 0.24 },
    { kind: 'lines', x: 0.06, y: 0.46, w: 0.7, h: 0.4, lines: 4 },
  ],
};

/**
 * Passport data page — PORTRAIT (88 x 125 mm ≈ 0.71). Personal-data lines
 * on the right, photo bottom-left, two-line MRZ across the very bottom.
 */
const PASSPORT = { aspect: 0.71, warpWidth: 1039, warpHeight: 1476 } as const;
const PASSPORT_LAYOUT: CardLayout = {
  hints: [
    { kind: 'lines', x: 0.08, y: 0.12, w: 0.84, h: 0.1, lines: 1 },
    { kind: 'photo', x: 0.08, y: 0.44, w: 0.32, h: 0.4 },
    { kind: 'lines', x: 0.46, y: 0.3, w: 0.46, h: 0.5, lines: 6 },
    { kind: 'mrz', x: 0.06, y: 0.88, w: 0.88, h: 0.09, lines: 2 },
  ],
};

export const DOCUMENT_SPECS: Record<DocumentType, DocumentSpec> = {
  thaiIdFront: {
    endpoint: '/v3/store/ekyc/thai-national-id-card/front',
    ...ID1,
    layout: THAI_ID_FRONT_LAYOUT,
  },
  thaiIdBack: {
    endpoint: '/v3/store/ekyc/thai-national-id-card/back',
    ...ID1,
    layout: THAI_ID_BACK_LAYOUT,
  },
  thaiIdWithSignature: {
    endpoint: '/v3/store/ekyc/thai-national-id-card-with-signature',
    ...ID1,
    layout: THAI_ID_FRONT_LAYOUT,
  },
  thaiDriverLicense: {
    endpoint: '/v3/store/ekyc/thai-driver-license',
    ...ID1,
    layout: THAI_DRIVER_LICENSE_LAYOUT,
  },
  bookBank: {
    endpoint: '/v3/store/ekyc/book-bank',
    ...ID1,
    layout: BOOK_BANK_LAYOUT,
  },
  passport: {
    endpoint: '/v3/store/ekyc/passport',
    ...PASSPORT,
    layout: PASSPORT_LAYOUT,
  },
};
