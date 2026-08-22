import { useRef, useState } from 'react';
import { Modal, View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';

type Props = {
  visible: boolean;
  mode: 'register' | 'scan';
  onCapture: (uri: string) => void;
  onCancel: () => void;
};

export function CameraCapture({ visible, mode, onCapture, onCancel }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function handleCapture() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, base64: false });
      if (photo?.uri) onCapture(photo.uri);
    } finally {
      setCapturing(false);
    }
  }

  const title = mode === 'register' ? 'Register your face' : 'Scan your face';
  const hint = mode === 'register'
    ? 'Position your face in the frame and tap the button'
    : 'Look at the camera to verify your identity';

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
            <CameraView ref={cameraRef} style={styles.camera} facing="front" />

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.hint}>{hint}</Text>
            </View>

            {/* Face oval guide */}
            <View style={styles.ovalWrapper} pointerEvents="none">
              <View style={styles.oval} />
            </View>

            {/* Bottom controls */}
            <View style={styles.footer}>
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.whiteText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[styles.shutterOuter, capturing && styles.shutterCapturing]}
                onPress={handleCapture}
                disabled={capturing}
              >
                {capturing
                  ? <ActivityIndicator color="#000" />
                  : <View style={styles.shutterInner} />}
              </Pressable>

              {/* spacer to balance layout */}
              <View style={styles.cancelBtn} />
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
  hint: { color: 'rgba(255,255,255,0.8)', fontSize: 14, textAlign: 'center', textShadowColor: '#000', textShadowRadius: 4 },
  ovalWrapper: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  oval: {
    width: 240,
    height: 300,
    borderRadius: 120,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.7)',
    marginBottom: 60,
  },
  footer: {
    position: 'absolute',
    bottom: 60,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
  },
  cancelBtn: { width: 70, alignItems: 'center' },
  shutterOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  shutterCapturing: { borderColor: 'rgba(255,255,255,0.4)' },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  whiteText: { color: '#fff', fontSize: 16 },
});
