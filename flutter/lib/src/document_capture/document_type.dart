/// Document types supported by the capture flow, with their endpoint,
/// physical aspect ratio and perspective-corrected output size
/// (see docs/ALGORITHM.md).
enum DocumentType {
  /// Thai national ID card — front side. 1.25 IC/page.
  thaiIdFront('/v3/store/ekyc/thai-national-id-card/front'),

  /// Thai national ID card — back side. 0.75 IC/page.
  thaiIdBack('/v3/store/ekyc/thai-national-id-card/back'),

  /// Thai national ID card including the holder's signature. 1.0 IC/page.
  thaiIdWithSignature('/v3/store/ekyc/thai-national-id-card-with-signature'),

  /// Thai driver license. 1.25 IC/page.
  thaiDriverLicense('/v3/store/ekyc/thai-driver-license'),

  /// Thai bank book (book bank). 1.25 IC/page.
  bookBank('/v3/store/ekyc/book-bank'),

  /// Passport (ID-3 data page). 0.75 IC/page.
  passport('/v3/store/ekyc/passport');

  const DocumentType(this.endpointPath);

  /// Endpoint path relative to the client's `baseUrl`.
  final String endpointPath;

  /// Whether this is the ID-3 passport data page (all others are ID-1).
  bool get isPassport => this == DocumentType.passport;

  /// Target aspect ratio: 1.586 for ID-1 cards (85.60 × 53.98 mm),
  /// 1.42 for passports (ID-3 data page, 125 × 88 mm).
  double get aspectRatio => isPassport ? 1.42 : 1.586;

  /// Perspective-corrected output width in pixels (~300 DPI).
  int get outputWidth => isPassport ? 1476 : 1011;

  /// Perspective-corrected output height in pixels (~300 DPI).
  int get outputHeight => isPassport ? 1039 : 637;
}
