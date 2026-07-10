# React Native example

Copy-paste `App.tsx` for a fresh React Native app (after installing
`react-native-webview` and this package — see [../README.md](../README.md)):

```tsx
import { useState } from 'react';
import {
  Button,
  Modal,
  PermissionsAndroid,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
} from 'react-native';
import {
  IappEkycFlow,
  type EkycDocumentType,
  type EkycFlowType,
} from '@iapp-technology/react-native-ekyc-sdk';

const API_KEY = 'YOUR_API_KEY'; // https://iapp.co.th/control/api-keys

export default function App() {
  const [flow, setFlow] = useState<EkycFlowType | null>(null);
  const [documentType, setDocumentType] = useState<EkycDocumentType>('thaiIdFront');
  const [status, setStatus] = useState('Result appears here');

  const start = async (nextFlow: EkycFlowType, doc?: EkycDocumentType) => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        setStatus('Camera permission denied');
        return;
      }
    }
    if (doc) setDocumentType(doc);
    setFlow(nextFlow);
  };

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <ScrollView>
        <Button
          title="Capture Thai ID (front)"
          onPress={() => start('documentCapture', 'thaiIdFront')}
        />
        <Button
          title="Capture passport"
          onPress={() => start('documentCapture', 'passport')}
        />
        <Button title="Face Active Liveness" onPress={() => start('activeLiveness')} />
        <Button title="Capture face (no liveness)" onPress={() => start('faceCapture')} />
        <Text style={{ marginTop: 16 }}>{status}</Text>
      </ScrollView>

      <Modal
        visible={flow !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFlow(null)}
      >
        {flow !== null && (
          <IappEkycFlow
            flow={flow}
            documentType={documentType}
            apiKey={API_KEY}
            locale="en"
            onResult={(result) => {
              setFlow(null);
              if (result.flow === 'documentCapture') {
                setStatus(`OCR: ${JSON.stringify(result.raw).slice(0, 400)}`);
              } else if (result.flow === 'activeLiveness') {
                // Verify result.verdict + result.signature on YOUR backend.
                setStatus(`Liveness passed=${result.passed}`);
              } else {
                setStatus(`Selfie captured: ${result.image.byteLength} bytes`);
              }
            }}
            onError={(error) => {
              setFlow(null);
              setStatus(`Failed [${error.code}]: ${error.message}`);
            }}
            onCancel={() => {
              setFlow(null);
              setStatus('Cancelled by user');
            }}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}
```
