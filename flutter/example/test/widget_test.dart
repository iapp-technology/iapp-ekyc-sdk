import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:iapp_ekyc_sdk_example/main.dart';

void main() {
  testWidgets('home menu renders all six flow tiles', (tester) async {
    await tester.pumpWidget(const EkycExampleApp());

    expect(find.text('iApp API key'), findsOneWidget);

    const tiles = [
      'Thai ID card — front',
      'Thai ID card — back',
      'Passport',
      'Official card',
      'Active liveness',
      'Face APIs',
    ];
    for (final title in tiles) {
      await tester.scrollUntilVisible(
        find.text(title),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      expect(find.text(title), findsOneWidget);
    }
  });
}
