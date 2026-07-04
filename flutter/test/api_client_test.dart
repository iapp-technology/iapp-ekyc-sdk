import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:iapp_ekyc_sdk/src/core/api/ekyc_api_client.dart';
import 'package:iapp_ekyc_sdk/src/core/api/ekyc_exception.dart';
import 'package:iapp_ekyc_sdk/src/document_capture/document_type.dart';

final _bytes = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]);

IappEkycClient _client(MockClient mock, {String apiKey = 'test-key'}) =>
    IappEkycClient(apiKey: apiKey, httpClient: mock);

MockClient _respond(
  int status,
  String body, {
  void Function(http.Request request)? inspect,
}) {
  return MockClient((request) async {
    inspect?.call(request);
    return http.Response(body, status);
  });
}

void main() {
  group('error mapping', () {
    test('401 → InvalidApiKeyException', () async {
      final client = _client(_respond(401, '{"message": "Invalid API key"}'));
      await expectLater(
        client.checkPassiveLiveness(_bytes),
        throwsA(
          isA<InvalidApiKeyException>()
              .having((e) => e.statusCode, 'statusCode', 401)
              .having((e) => e.userMessageKey, 'key', 'error_invalid_key'),
        ),
      );
    });

    test('402 → InsufficientCreditException', () async {
      final client = _client(
        _respond(402, '{"message": "Insufficient credit"}'),
      );
      await expectLater(
        client.checkPassiveLiveness(_bytes),
        throwsA(
          isA<InsufficientCreditException>()
              .having((e) => e.statusCode, 'statusCode', 402)
              .having((e) => e.userMessageKey, 'key', 'error_no_credit'),
        ),
      );
    });

    test('400 → BadRequestException with error code + reasons', () async {
      final client = _client(
        _respond(
          400,
          '{"error": {"code": "INVALID_CHALLENGE_LOG", '
          '"message": "bad log", "reasons": ["not monotonic"]}}',
        ),
      );
      await expectLater(
        client.finalizeActiveLiveness(_bytes, {'challenges': []}),
        throwsA(
          isA<BadRequestException>()
              .having((e) => e.errorCode, 'errorCode', 'INVALID_CHALLENGE_LOG')
              .having((e) => e.reasons, 'reasons', ['not monotonic']),
        ),
      );
    });

    test('413 → FileTooLargeException', () async {
      final client = _client(_respond(413, '{}'));
      await expectLater(
        client.checkPassiveLiveness(_bytes),
        throwsA(isA<FileTooLargeException>()),
      );
    });

    test('429 → RateLimitedException honoring Retry-After', () async {
      final client = _client(
        MockClient(
          (request) async =>
              http.Response('{}', 429, headers: {'retry-after': '17'}),
        ),
      );
      await expectLater(
        client.checkPassiveLiveness(_bytes),
        throwsA(
          isA<RateLimitedException>().having(
            (e) => e.retryAfter,
            'retryAfter',
            const Duration(seconds: 17),
          ),
        ),
      );
    });

    test('500 → ServerException', () async {
      final client = _client(_respond(500, 'oops'));
      await expectLater(
        client.checkPassiveLiveness(_bytes),
        throwsA(
          isA<ServerException>().having((e) => e.statusCode, 'status', 500),
        ),
      );
    });
  });

  group('multipart request shape', () {
    test('submitDocument posts field `file` to the mapped endpoint '
        'with the apikey header', () async {
      late http.Request captured;
      final client = _client(
        _respond(200, '{"message": "ok"}', inspect: (r) => captured = r),
      );

      final result = await client.submitDocument(
        DocumentType.thaiIdFront,
        _bytes,
      );
      expect(result.raw['message'], 'ok');
      expect(
        captured.url.toString(),
        'https://api.iapp.co.th/v3/store/ekyc/thai-national-id-card/front',
      );
      expect(captured.headers['apikey'], 'test-key');

      final body = latin1.decode(captured.bodyBytes);
      expect(body, contains('name="file"'));
    });

    test('verifyFaces posts file1 + file2', () async {
      late http.Request captured;
      final client = _client(_respond(200, '{}', inspect: (r) => captured = r));

      await client.verifyFaces(_bytes, _bytes);
      expect(captured.url.path, '/v3/store/ekyc/face-verification');

      final body = latin1.decode(captured.bodyBytes);
      expect(body, contains('name="file1"'));
      expect(body, contains('name="file2"'));
    });

    test('finalizeActiveLiveness posts file + challenges JSON; '
        'return_image only when requested', () async {
      late http.Request captured;
      final client = _client(
        _respond(
          200,
          '{"verdict": {"passed": true}}',
          inspect: (r) => captured = r,
        ),
      );

      final log = {
        'session_id': 'abc',
        'sdk': {
          'name': 'iapp-ekyc-sdk-flutter',
          'version': '0.1.0',
          'platform': 'android',
        },
        'challenges': [
          {'type': 'blink', 'issued_at': 1, 'completed_at': 2, 'passed': true},
        ],
      };
      final result = await client.finalizeActiveLiveness(_bytes, log);
      expect(result.passed, isTrue);

      var body = latin1.decode(captured.bodyBytes);
      expect(body, contains('name="file"'));
      expect(body, contains('name="challenges"'));
      expect(body, contains('"session_id"'));
      expect(body, contains('"type":"blink"'));
      expect(body, isNot(contains('name="return_image"')));

      await client.finalizeActiveLiveness(_bytes, log, returnImage: true);
      body = latin1.decode(captured.bodyBytes);
      expect(body, contains('name="return_image"'));
    });

    test(
      'apikey header is omitted when apiKey is empty (proxy mode)',
      () async {
        late http.Request captured;
        final client = _client(
          _respond(200, '{}', inspect: (r) => captured = r),
          apiKey: '',
        );

        await client.checkPassiveLiveness(_bytes);
        expect(captured.headers.containsKey('apikey'), isFalse);
      },
    );
  });

  group('response parsing', () {
    test('non-JSON success payload → InvalidResponseException', () async {
      final client = _client(_respond(200, 'not json'));
      await expectLater(
        client.checkPassiveLiveness(_bytes),
        throwsA(isA<InvalidResponseException>()),
      );
    });

    test('passive liveness typed accessors', () async {
      final client = _client(
        _respond(
          200,
          '{"filename": "selfie.jpg", "predict": "REAL", "score": 3.2, '
          '"normalized": {"SPOOF": 0.0001, "REAL": 0.9999}}',
        ),
      );
      final result = await client.checkPassiveLiveness(_bytes);
      expect(result.isReal, isTrue);
      expect(result.score, closeTo(3.2, 1e-9));
      expect(result.realScore, closeTo(0.9999, 1e-9));
    });
  });
}
