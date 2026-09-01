import { useCallback, useEffect, useRef, useState } from 'react';
import { View, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  loadEnrollment,
  claimEnrollment,
  requestAccess,
  type Enrollment,
  type Door,
} from '@/lib/device';
import { totpNow, secondsRemaining } from '@/lib/totp';
import { isFaceRegistered, registerFaceFromUri, verifyFaceFromUri } from '@/lib/faceGate';
import { CameraCapture } from '@/components/CameraCapture';
import { useDoorProximity } from '@/hooks/useDoorProximity';
import { storage } from '@/lib/storage';

type Phase = 'idle' | 'processing' | 'sending' | 'enrolling';
type Result = { success: boolean; text: string } | null;

/** The same 0..levels ramp the door's LED ring is showing, on the phone. */
function SignalBars({ level, levels }: { level: number; levels: number }) {
  return (
    <View className="flex-row items-end gap-[3px]" accessibilityLabel={`Signal ${level} of ${levels}`}>
      {Array.from({ length: levels }, (_, i) => (
        <View
          key={i}
          style={{ height: 6 + i * 2 }}
          className={`w-[4px] rounded-sm ${i < level ? 'bg-green-500' : 'bg-muted'}`}
        />
      ))}
    </View>
  );
}

export default function Access() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [booted, setBooted] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [enrollError, setEnrollError] = useState<string | null>(null);

  const [faceRegistered, setFaceRegistered] = useState(false);
  const [livenessEnabled, setLivenessEnabledState] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result>(null);

  const [cameraMode, setCameraMode] = useState<'register' | 'scan' | null>(null);
  const [selectedDoor, setSelectedDoor] = useState<Door | null>(null);

  const [code, setCode] = useState('------');
  const [secs, setSecs] = useState(30);
  const enrollmentRef = useRef<Enrollment | null>(null);

  /**
   * BLE door detection. Scanning only while the screen is usable — there is no
   * background mode, because the app is already open for the face scan.
   *
   * `supported` is false whenever the radio, the permission or the cached door
   * list cannot support it, and everything below then falls back to the manual
   * picker. A phone with Bluetooth switched off must still be able to open a
   * door: the gate is UX, and the backend re-checks the door regardless.
   */
  const proximity = useDoorProximity(enrollment?.doors ?? [], booted && !!enrollment);

  // Standing at a door selects it. Manual taps still work when BLE cannot run.
  useEffect(() => {
    if (proximity.nearest) setSelectedDoor(proximity.nearest.door);
  }, [proximity.nearest?.door.door_code]);

  useEffect(() => {
    (async () => {
      const e = await loadEnrollment();
      enrollmentRef.current = e;
      setEnrollment(e);
      if (e?.doors?.length) setSelectedDoor(e.doors[0]);
      setFaceRegistered(await isFaceRegistered());
      setLivenessEnabledState((await storage.getLivenessEnabled()) === 'true');
      setBooted(true);
    })();
  }, []);

  const setLivenessEnabled = useCallback((v: boolean) => {
    setLivenessEnabledState(v);
    storage.setLivenessEnabled(v ? 'true' : 'false');
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

  const handleEnrol = useCallback(async () => {
    if (!tokenInput.trim()) return;
    setPhase('enrolling');
    setEnrollError(null);
    try {
      const e = await claimEnrollment(tokenInput);
      enrollmentRef.current = e;
      setEnrollment(e);
      if (e.doors.length) setSelectedDoor(e.doors[0]);
      setTokenInput('');
      setResult({
        success: true,
        text: `Enrolled at ${e.buildingName || 'this building'}${
          e.chainRegistered ? '' : ' (identity not yet on-chain)'
        }`,
      });
    } catch (err: any) {
      setEnrollError(err?.message || 'Enrolment failed');
    } finally {
      setPhase('idle');
    }
  }, [tokenInput]);

  /** Sign and send. Called only after the face scan produces a score. */
  const send = useCallback(
    async (faceScore: number) => {
      const e = enrollmentRef.current;
      if (!e || !selectedDoor) return;
      setPhase('sending');
      try {
        const res = await requestAccess(selectedDoor.door_code, totpNow(e), faceScore);
        setResult({
          success: res.granted,
          text: res.granted
            ? `${res.message} — ${res.door?.name ?? selectedDoor.name}` +
              (res.unlocked ? '' : ' (door not reachable)')
            : res.message,
        });
      } catch {
        setResult({ success: false, text: 'Network error — is the backend reachable?' });
      } finally {
        setPhase('idle');
      }
    },
    [selectedDoor],
  );

  const handleUnlock = useCallback(() => {
    setResult(null);
    if (!selectedDoor) {
      setResult({ success: false, text: 'Pick a door first' });
      return;
    }
    if (!faceRegistered) {
      setResult({ success: false, text: 'Register your face first' });
      return;
    }
    setCameraMode('scan');
  }, [faceRegistered, selectedDoor]);

  const handleRegisterFace = useCallback(() => {
    setResult(null);
    setCameraMode('register');
  }, []);

  const handleCameraCapture = useCallback(
    async (uri: string) => {
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
          await send(scan.score);
        }
      } catch (e: any) {
        setResult({ success: false, text: String(e?.message ?? e) || 'Face processing failed' });
      } finally {
        setPhase('idle');
      }
    },
    [cameraMode, send],
  );

  const handleCameraCancel = useCallback(() => setCameraMode(null), []);

  const busy = phase !== 'idle';

  /**
   * Whether a door may be verified for at all. When BLE cannot run this is
   * always true, so the screen behaves exactly as it did before the beacons
   * existed — a flat battery in a door beacon, or a denied permission, must not
   * strand someone outside.
   */
  const atADoor = !proximity.supported || proximity.nearest !== null;

  const doorCardHint = !enrollment?.doors.length
    ? 'No doors available for your account'
    : proximity.supported
    ? 'Doors near you, found over Bluetooth'
    : proximity.status === 'permission-denied'
    ? 'Bluetooth permission denied — pick your door manually'
    : proximity.status === 'bluetooth-off'
    ? 'Bluetooth is off — pick your door manually'
    : proximity.status === 'no-beacons'
    ? 'No door beacons found — pick your door manually'
    : 'Pick the door you are standing at';

  // ── Not enrolled: the token is the only way in ────────────────────────────
  if (booted && !enrollment) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <ScrollView className="flex-1 p-4" contentContainerClassName="gap-4 pb-8">
          <Text variant="h2">Enrol this device</Text>

          <Card>
            <CardHeader>
              <CardTitle>Enrolment code</CardTitle>
              <CardDescription>
                Ask your building administrator for an enrolment code. It can only be used once.
              </CardDescription>
            </CardHeader>
            <CardContent className="gap-3">
              <Input
                placeholder="Paste your enrolment code"
                value={tokenInput}
                onChangeText={setTokenInput}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
              />
              <Button
                label={phase === 'enrolling' ? 'Enrolling…' : 'Enrol'}
                loading={phase === 'enrolling'}
                disabled={!tokenInput.trim() || busy}
                onPress={handleEnrol}
              />
              {enrollError ? (
                <View className="rounded-xl p-3 bg-red-500/10 border border-red-500/30">
                  <Text variant="destructive">{enrollError}</Text>
                </View>
              ) : null}
              <Text className="text-muted-foreground text-xs">
                A keypair is generated on this phone during enrolment. The private key stays in the
                secure enclave and is never sent anywhere.
              </Text>
            </CardContent>
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1 p-4" contentContainerClassName="gap-4 pb-8">
        <Text variant="h2">Access</Text>
        {enrollment?.buildingName ? (
          <Text className="text-muted-foreground -mt-2">{enrollment.buildingName}</Text>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Door</CardTitle>
            <CardDescription>{doorCardHint}</CardDescription>
          </CardHeader>
          <CardContent className="gap-2">
            {proximity.supported ? (
              proximity.nearby.length ? (
                proximity.nearby.map((n) => (
                  <View
                    key={n.door.door_code}
                    className={`flex-row items-center justify-between rounded-xl border p-3 ${
                      n.withinGate
                        ? 'border-green-500/40 bg-green-500/10'
                        : 'border-border bg-transparent'
                    }`}
                  >
                    <View className="flex-1 pr-3">
                      <Text className="font-medium">{n.door.name}</Text>
                      <Text className="text-muted-foreground text-xs">
                        {n.withinGate ? 'You are here' : 'Getting closer…'} · {Math.round(n.rssi)} dBm
                      </Text>
                    </View>
                    <SignalBars level={n.level} levels={proximity.levels} />
                  </View>
                ))
              ) : (
                <View className="items-center gap-1 py-4">
                  <ActivityIndicator />
                  <Text className="text-muted-foreground text-xs">Listening for doors…</Text>
                </View>
              )
            ) : (
              enrollment?.doors.map((d) => {
                const active = d.door_code === selectedDoor?.door_code;
                return (
                  <Button
                    key={d.door_code}
                    variant={active ? 'default' : 'outline'}
                    label={`${d.name} (${d.door_code})`}
                    disabled={busy}
                    onPress={() => setSelectedDoor(d)}
                  />
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your code</CardTitle>
            <CardDescription>Second factor, generated on this device</CardDescription>
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
            <Text className="text-muted-foreground text-xs">
              The face scan is required — the backend rejects a request without a passing score, so
              there is no way to skip it from this app.
            </Text>
          </CardContent>
        </Card>

        <Button
          size="lg"
          label={
            phase === 'processing'
              ? 'Verifying face…'
              : phase === 'sending'
              ? 'Verifying…'
              : atADoor && selectedDoor
              ? `Verify for ${selectedDoor.name}`
              : proximity.supported
              ? 'Walk up to a door'
              : 'Scan face & unlock'
          }
          loading={busy}
          disabled={!enrollment || !selectedDoor || !atADoor || busy}
          onPress={handleUnlock}
        />

        <View className="flex-row items-center justify-between px-1">
          <View className="flex-1 pr-3">
            <Text className="font-medium">Liveness detection</Text>
            <Text className="text-muted-foreground text-xs">
              Require a blink before face verification to block photo/screen spoofing
            </Text>
          </View>
          <Switch value={livenessEnabled} onValueChange={setLivenessEnabled} />
        </View>

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
          </View>
        )}
      </ScrollView>

      <CameraCapture
        visible={cameraMode !== null}
        mode={cameraMode ?? 'scan'}
        requireLiveness={livenessEnabled}
        onCapture={handleCameraCapture}
        onCancel={handleCameraCancel}
      />
    </SafeAreaView>
  );
}
