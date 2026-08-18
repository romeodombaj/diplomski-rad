import { useEffect, useState } from 'react';
import { View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { storage } from '@/lib/storage';
import { reEnroll } from '@/lib/device';
import { resetFace, isFaceRegistered } from '@/lib/faceGate';

export default function Settings() {
  const [did, setDid] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [faceRegistered, setFaceRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setDid(await storage.getDid());
    setSecret(await storage.getTotpSecret());
    setFaceRegistered(await isFaceRegistered());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleReEnroll() {
    setBusy(true);
    try {
      await reEnroll();
      await refresh();
      Alert.alert('Done', 'Device re-enrolled with a new DID and secret.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not re-enroll');
    } finally {
      setBusy(false);
    }
  }

  async function handleResetFace() {
    await resetFace();
    await refresh();
    Alert.alert('Done', 'Registered face cleared.');
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1 p-4" contentContainerClassName="gap-4 pb-8">
        <Text variant="h2">Settings</Text>

        <Card>
          <CardHeader>
            <CardTitle>Device identity</CardTitle>
            <CardDescription>This phone holds its own DID and TOTP secret</CardDescription>
          </CardHeader>
          <CardContent className="gap-2">
            <Text className="font-medium">DID</Text>
            <Text className="text-muted-foreground text-xs" selectable>
              {did || 'not enrolled'}
            </Text>
            <Text className="font-medium mt-2">TOTP secret (base32)</Text>
            <Text className="text-muted-foreground text-xs" selectable>
              {secret || 'none'}
            </Text>
            <Text className="font-medium mt-2">Face</Text>
            <Text className="text-muted-foreground text-xs">
              {faceRegistered ? 'registered' : 'not registered'}
            </Text>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Maintenance</CardTitle>
            <CardDescription>Reset local state for testing</CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <Button
              variant="outline"
              label="Reset registered face"
              onPress={handleResetFace}
              disabled={busy}
            />
            <Button
              variant="destructive"
              label={busy ? 'Re-enrolling...' : 'Re-enroll device (new DID)'}
              loading={busy}
              onPress={handleReEnroll}
            />
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
