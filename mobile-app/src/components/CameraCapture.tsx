import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
  type CameraRef,
} from 'react-native-vision-camera';
import { useFaceDetectorOutput } from 'react-native-vision-camera-face-detector';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { BlinkLivenessDetector, type LivenessStage } from '@/lib/liveness';

type Props = {
  visible: boolean;
  mode: 'register' | 'scan';
  requireLiveness?: boolean;
  onCapture: (uri: string) => void;
  onCancel: () => void;
};

export function CameraCapture({ visible, mode, requireLiveness, onCapture, onCancel }: Props) {
  const cameraRef = useRef<CameraRef>(null);
  const [capturing, setCapturing] = useState(false);
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const photoOutput = usePhotoOutput({ quality: 0.9 });

  const livenessActive = mode === 'scan' && !!requireLiveness;
  const detectorActive = visible;
  const livenessDetector = useRef(new BlinkLivenessDetector());
  const [livenessStage, setLivenessStage] = useState<LivenessStage>('waiting-face');
  const [faceSeen, setFaceSeen] = useState(false);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    if (visible) {
      livenessDetector.current.reset();
      setLivenessStage('waiting-face');
      setFaceSeen(false);
    }
  }, [visible, mode]);

  const faceDetectorOutput = useFaceDetectorOutput({
    performanceMode: 'fast',
    runClassifications: true,
    onFacesDetected(faces) {
      const face = faces[0];
      setFaceSeen((prev) => (prev === !!face ? prev : !!face));
      if (!face) return;
      if (!livenessActive) return;
      livenessDetector.current.update(face.leftEyeOpenProbability ?? 0, face.rightEyeOpenProbability ?? 0);
      const next = livenessDetector.current.stage;
      setLivenessStage((prev) => (prev === next ? prev : next));
    },
    onError(error) {
      console.warn('[Liveness] face detector error:', error);
    },
  });

  const stableFaceOutput = useRef(faceDetectorOutput).current;

  const outputs = useMemo(
    () => (detectorActive ? [photoOutput, stableFaceOutput] : [photoOutput]),
    [detectorActive, photoOutput, stableFaceOutput],
  );

  const canCapture =
    !capturing && faceSeen && (!livenessActive || livenessStage === 'confirmed');

  async function handleCapture() {
    if (!canCapture) return;
    setCapturing(true);
    try {
      const file = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
      if (file?.filePath) onCapture(`file://${file.filePath}`);
    } finally {
      setCapturing(false);
    }
  }

  const title = mode === 'register' ? 'Register your face' : 'Scan your face';
  const hint = !faceSeen
    ? 'No face detected — center your face in the frame'
    : mode === 'register'
    ? 'Face detected — tap the button to register'
    : livenessActive
    ? livenessStage === 'confirmed'
      ? 'Liveness confirmed — tap to verify'
      : livenessStage === 'waiting-blink'
      ? 'Now blink to confirm you’re really there'
      : 'Look at the camera'
    : 'Look at the camera to verify your identity';

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent>
      <View style={styles.container}>
        {!hasPermission ? (
          <View style={styles.center}>
            <Text style={styles.whiteText}>Camera permission required</Text>
            <Button label="Grant permission" onPress={requestPermission} />
            <Button label="Cancel" variant="outline" onPress={onCancel} />
          </View>
        ) : !device ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <>
            <Camera
              ref={cameraRef}
              style={styles.camera}
              device={device}
              isActive={visible}
              outputs={outputs}
            />

            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.hint}>{hint}</Text>
            </View>

            <View style={styles.ovalWrapper} pointerEvents="none">
              <View
                style={[
                  styles.oval,
                  livenessActive && livenessStage === 'confirmed' && styles.ovalConfirmed,
                ]}
              />
            </View>

            <View style={styles.footer}>
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.whiteText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.shutterOuter,
                  capturing && styles.shutterCapturing,
                  !canCapture && styles.shutterDisabled,
                ]}
                onPress={handleCapture}
                disabled={!canCapture}
              >
                {capturing
                  ? <ActivityIndicator color="#000" />
                  : <View style={styles.shutterInner} />}
              </Pressable>

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
  ovalConfirmed: {
    borderColor: 'rgba(74,222,128,0.9)',
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
  shutterDisabled: { borderColor: 'rgba(255,255,255,0.3)', opacity: 0.5 },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  whiteText: { color: '#fff', fontSize: 16 },
});
