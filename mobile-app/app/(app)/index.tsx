import { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { apiFetch } from '@/lib/apiFetch';
import { ensureEnrolled, type Enrollment } from '@/lib/device';
import { totpNow, secondsRemaining } from '@/lib/totp';
import { isFaceRegistered, registerFaceFromUri, verifyFaceFromUri } from '@/lib/faceGate';
import { CameraCapture } from '@/components/CameraCapture';

type Phase = 'idle' | 'processing' | 'sending';
type Result = { success: boolean; text: string } | null;

export default function Access() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const [faceRegistered, setFaceRegistered] = useState(false);
  const [bypassFace, setBypassFace] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result>(null);

  const [cameraMode, setCameraMode] = useState<'register' | 'scan' | null>(null);

  const [code, setCode] = useState('------');
  const [secs, setSecs] = useState(30);
  const enrollmentRef = useRef<Enrollment | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const e = await ensureEnrolled();
        enrollmentRef.current = e;
        setEnrollment(e);
        setFaceRegistered(await isFaceRegistered());
      } catch (err: any) {
        setBootError(err?.message || 'Could not reach backend to enroll device');
      }
    })();
  }, []);

  useEffect(() => {
    if (!enrollment) return;
    const update = () => {
      setCode(totpNow(enrollment));
      setSecs(secondsRemaining(enrollment.period));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [enrollment]);

  const sendCode = useCallback(async (faceScore?: number) => {
    const e = enrollmentRef.current;
    if (!e) return;
    setPhase('sending');
    const currentCode = totpNow(e);
    try {
      const res = await apiFetch('/mobile/verify/totp', {
        method: 'POST',
        body: JSON.stringify({ did: e.did, code: currentCode, faceScore }),
      });
      const data = await res.json();
      if (res.ok && data?.data?.success) {
        const scoreStr = faceScore != null ? ` (face score: ${faceScore.toFixed(3)})` : '';
        setResult({ success: true, text: (data.data.message || 'Access granted') + scoreStr });
      } else {
        setResult({ success: false, text: data?.message || 'Access denied' });
      }
    } catch {
      setResult({ success: false, text: 'Network error — is the backend reachable?' });
    } finally {
      setPhase('idle');
    }
  }, []);

  const handleUnlock = useCallback(() => {
    setResult(null);
    if (bypassFace) {
      sendCode();
      return;
    }
    if (!faceRegistered) {
      setResult({ success: false, text: 'Register your face first (or enable testing bypass)' });
      return;
    }
    setCameraMode('scan');
  }, [bypassFace, faceRegistered, sendCode]);

  const handleRegisterFace = useCallback(() => {
    setResult(null);
    setCameraMode('register');
  }, []);

  const handleCameraCapture = useCallback(async (uri: string) => {
    const mode = cameraMode;
    setCameraMode(null);
    setPhase('processing');
    setResult(null);
    try {
      if (mode === 'register') {
        await registerFaceFromUri(uri);
        setFaceRegistered(true);
        setResult({ success: true, text: 'Face registered on this device' });
      } else {
        const scan = await verifyFaceFromUri(uri);
        if (!scan.ok) {
          setResult({ success: false, text: scan.reason || 'Face not recognized' });
          return;
        }
        await sendCode(scan.score);
      }
    } catch (e: any) {
      setResult({ success: false, text: String(e?.message ?? e) || 'Face processing failed' });
    } finally {
      setPhase('idle');
    }
  }, [cameraMode, sendCode]);

  const handleCameraCancel = useCallback(() => setCameraMode(null), []);

  const busy = phase !== 'idle';

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1 p-4" contentContainerClassName="gap-4 pb-8">
        <Text variant="h2">Access</Text>

        {bootError ? (
          <View className="rounded-xl p-4 bg-red-500/10 border border-red-500/30">
            <Text variant="destructive">{bootError}</Text>
            <Text className="text-muted-foreground mt-1 text-xs">
              Set EXPO_PUBLIC_API_URL to your machine&apos;s LAN IP (e.g. http://192.168.1.20:5000)
              when running in Expo Go on a phone.
            </Text>
          </View>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Your code</CardTitle>
            <CardDescription>Live 6-digit code — shown in case face verification fails</CardDescription>
          </CardHeader>
          <CardContent className="items-center gap-2">
            <Text className="text-4xl font-bold tracking-[8px]">
              {code.slice(0, 3)} {code.slice(3)}
            </Text>
            <Text className="text-muted-foreground text-xs">Refreshes in {secs}s</Text>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Face</CardTitle>
            <CardDescription>
              {faceRegistered ? 'Reference face registered on this device' : 'No face registered yet'}
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <Button
              variant={faceRegistered ? 'outline' : 'default'}
              label={faceRegistered ? 'Re-register face' : 'Register my face'}
              disabled={busy}
              onPress={handleRegisterFace}
            />
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="font-medium">Skip face scan (testing)</Text>
                <Text className="text-muted-foreground text-xs">
                  Send the correct code straight to the backend
                </Text>
              </View>
              <Switch value={bypassFace} onValueChange={setBypassFace} />
            </View>
          </CardContent>
        </Card>

        <Button
          size="lg"
          label={
            phase === 'processing'
              ? cameraMode === null ? 'Verifying face...' : 'Scanning...'
              : phase === 'sending'
              ? 'Verifying...'
              : bypassFace
              ? 'Send code (bypass face)'
              : 'Scan face & unlock'
          }
          loading={busy}
          disabled={!enrollment || busy}
          onPress={handleUnlock}
        />

        {phase === 'processing' ? (
          <View className="items-center gap-2 py-2">
            <ActivityIndicator />
            <Text className="text-muted-foreground text-xs">Running face recognition model…</Text>
          </View>
        ) : null}

        {result ? (
          <View
            className={`rounded-xl p-4 ${
              result.success
                ? 'bg-green-500/10 border border-green-500/30'
                : 'bg-red-500/10 border border-red-500/30'
            }`}
          >
            <Text variant={result.success ? 'success' : 'destructive'}>{result.text}</Text>
          </View>
        ) : null}

        {enrollment ? (
          <Text className="text-muted-foreground text-[10px] mt-2" numberOfLines={1}>
            {enrollment.did}
          </Text>
        ) : (
          <View className="items-center py-4">
            <ActivityIndicator />
            <Text className="text-muted-foreground text-xs mt-2">Enrolling device…</Text>
          </View>
        )}
      </ScrollView>

      <CameraCapture
        visible={cameraMode !== null}
        mode={cameraMode ?? 'scan'}
        onCapture={handleCameraCapture}
        onCancel={handleCameraCancel}
      />
    </SafeAreaView>
  );
}
