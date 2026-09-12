import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { parseEnrollmentPayload } from '@/lib/enrollmentPayload';

type Props = {
  visible: boolean;
  onScanned: (token: string) => void;
  onCancel: () => void;
};

export function QrScanner({ visible, onScanned, onCancel }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);

  const handled = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    if (visible) {
      handled.current = false;
      setError(null);
    }
  }, [visible]);

  const onBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (handled.current || !data) return;

      const payload = parseEnrollmentPayload(data);
      if (!payload) {
        setError('That is not an enrolment code');
        return;
      }

      handled.current = true;
      onScanned(payload.token);
    },
    [onScanned],
  );

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.whiteText}>Camera permission required</Text>
            <Button label="Grant permission" onPress={requestPermission} />
            <Button label="Cancel" variant="outline" onPress={onCancel} />
          </View>
        ) : (
          <>
            {visible ? (
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={onBarcodeScanned}
              />
            ) : null}

            <View style={styles.header}>
              <Text style={styles.title}>Scan enrolment code</Text>
              <Text style={styles.hint}>
                Point the camera at the QR code on the dashboard
              </Text>
            </View>

            <View style={styles.frameWrapper} pointerEvents="none">
              <View style={styles.frame} />
            </View>

            <View style={styles.footer}>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.whiteText}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { ...StyleSheet.absoluteFillObject },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 },
  header: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 6,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '700', textShadowColor: '#000', textShadowRadius: 4 },
  hint: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  frameWrapper: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  frame: {
    width: 260,
    height: 260,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.7)',
    marginBottom: 40,
  },
  footer: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 14,
  },
  error: {
    color: '#fca5a5',
    fontSize: 13,
    textShadowColor: '#000',
    textShadowRadius: 4,
  },
  cancelBtn: { paddingHorizontal: 28, paddingVertical: 10 },
  whiteText: { color: '#fff', fontSize: 16 },
});
