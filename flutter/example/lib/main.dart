import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:iapp_ekyc_sdk/iapp_ekyc_sdk.dart';
import 'package:image_picker/image_picker.dart';

void main() => runApp(const EkycExampleApp());

class EkycExampleApp extends StatelessWidget {
  const EkycExampleApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'iApp eKYC SDK Example',
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: const Color(0xFF0284C7),
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _apiKeyController = TextEditingController(
    text: const String.fromEnvironment('IAPP_API_KEY'),
  );
  EkycLocale _locale = EkycLocale.en;
  final _picker = ImagePicker();

  @override
  void dispose() {
    _apiKeyController.dispose();
    super.dispose();
  }

  IappEkycClient _client() => IappEkycClient(apiKey: _apiKeyController.text);

  void _showError(Object error) {
    if (!mounted) return;
    final message = error is EkycException ? error.message : '$error';
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openResult(
    String title,
    Map<String, dynamic> json, {
    Uint8List? image,
  }) async {
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ResultPage(title: title, json: json, image: image),
      ),
    );
  }

  // -------------------------------------------------------------------
  // Flows
  // -------------------------------------------------------------------

  Future<void> _captureDocument(DocumentType type, String title) async {
    try {
      final result = await DocumentCaptureView.start(
        context,
        client: _client(),
        documentType: type,
        locale: _locale,
      );
      if (result != null) {
        await _openResult(title, result.raw, image: result.capturedImage);
      }
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _pickOfficialCard() async {
    final type = await showModalBottomSheet<DocumentType>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.directions_car_outlined),
              title: const Text('Thai driver license'),
              onTap: () =>
                  Navigator.pop(context, DocumentType.thaiDriverLicense),
            ),
            ListTile(
              leading: const Icon(Icons.menu_book_outlined),
              title: const Text('Book bank'),
              onTap: () => Navigator.pop(context, DocumentType.bookBank),
            ),
            ListTile(
              leading: const Icon(Icons.draw_outlined),
              title: const Text('Thai ID with signature'),
              onTap: () =>
                  Navigator.pop(context, DocumentType.thaiIdWithSignature),
            ),
          ],
        ),
      ),
    );
    if (type != null) {
      await _captureDocument(type, 'Official card');
    }
  }

  Future<void> _startActiveLiveness() async {
    try {
      final result = await ActiveLivenessView.start(
        context,
        client: _client(),
        locale: _locale,
        returnImage: true,
      );
      if (result != null) {
        await _openResult(
          'Active liveness',
          result.raw,
          image: result.selfieImage,
        );
      }
    } catch (e) {
      _showError(e);
    }
  }

  Future<Uint8List?> _pickImage(String hint) async {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(hint)));
    final file = await _picker.pickImage(source: ImageSource.gallery);
    return file?.readAsBytes();
  }

  Future<void> _pickFaceApi() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.compare_outlined),
              title: const Text('Face verification (pick two images)'),
              onTap: () => Navigator.pop(context, 'verify'),
            ),
            ListTile(
              leading: const Icon(Icons.remove_red_eye_outlined),
              title: const Text('Passive liveness (pick one image)'),
              onTap: () => Navigator.pop(context, 'passive'),
            ),
          ],
        ),
      ),
    );
    if (action == 'verify') {
      await _verifyFaces();
    } else if (action == 'passive') {
      await _passiveLiveness();
    }
  }

  Future<void> _verifyFaces() async {
    try {
      final image1 = await _pickImage('Pick the FIRST face image');
      if (image1 == null) return;
      final image2 = await _pickImage('Pick the SECOND face image');
      if (image2 == null) return;
      final result = await _client().verifyFaces(image1, image2);
      await _openResult('Face verification', result.raw);
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _passiveLiveness() async {
    try {
      final image = await _pickImage('Pick a selfie image');
      if (image == null) return;
      final result = await _client().checkPassiveLiveness(image);
      await _openResult('Passive liveness', result.raw);
    } catch (e) {
      _showError(e);
    }
  }

  // -------------------------------------------------------------------
  // UI
  // -------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('iApp eKYC SDK')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _apiKeyController,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'iApp API key',
              helperText:
                  'Get a key at iapp.co.th/control/api-keys — or pass '
                  '--dart-define=IAPP_API_KEY=...',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          DropdownMenu<EkycLocale>(
            initialSelection: _locale,
            label: const Text('SDK language'),
            onSelected: (locale) {
              if (locale != null) setState(() => _locale = locale);
            },
            dropdownMenuEntries: const [
              DropdownMenuEntry(value: EkycLocale.en, label: 'English'),
              DropdownMenuEntry(value: EkycLocale.th, label: 'ไทย'),
              DropdownMenuEntry(value: EkycLocale.zh, label: '中文'),
            ],
          ),
          const SizedBox(height: 20),
          _tile(
            icon: Icons.badge_outlined,
            title: 'Thai ID card — front',
            subtitle: 'Auto-capture + OCR',
            onTap: () =>
                _captureDocument(DocumentType.thaiIdFront, 'Thai ID front'),
          ),
          _tile(
            icon: Icons.flip_to_back_outlined,
            title: 'Thai ID card — back',
            subtitle: 'Auto-capture + OCR',
            onTap: () =>
                _captureDocument(DocumentType.thaiIdBack, 'Thai ID back'),
          ),
          _tile(
            icon: Icons.public_outlined,
            title: 'Passport',
            subtitle: 'ID-3 data page auto-capture + MRZ OCR',
            onTap: () => _captureDocument(DocumentType.passport, 'Passport'),
          ),
          _tile(
            icon: Icons.card_membership_outlined,
            title: 'Official card',
            subtitle: 'Driver license / book bank / ID with signature',
            onTap: _pickOfficialCard,
          ),
          _tile(
            icon: Icons.face_retouching_natural_outlined,
            title: 'Active liveness',
            subtitle: 'Randomized challenges + signed server verdict',
            onTap: _startActiveLiveness,
          ),
          _tile(
            icon: Icons.people_alt_outlined,
            title: 'Face APIs',
            subtitle: 'Face verification / passive liveness from gallery',
            onTap: _pickFaceApi,
          ),
        ],
      ),
    );
  }

  Widget _tile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: Icon(icon, size: 32),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

/// Shows the returned image (if any) and the pretty-printed JSON payload.
class ResultPage extends StatelessWidget {
  final String title;
  final Map<String, dynamic> json;
  final Uint8List? image;

  const ResultPage({
    super.key,
    required this.title,
    required this.json,
    this.image,
  });

  @override
  Widget build(BuildContext context) {
    final pretty = const JsonEncoder.withIndent('  ').convert(json);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (image != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Image.memory(image!, fit: BoxFit.contain),
            ),
            const SizedBox(height: 16),
          ],
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: SelectableText(
                pretty,
                style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
