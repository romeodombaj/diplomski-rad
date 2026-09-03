import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { View, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { storage } from '@/lib/storage';
import { resetEnrollment } from '@/lib/device';
import { resetFace, isFaceRegistered } from '@/lib/faceGate';
import { hasIdentity } from '@/lib/identity';

export default function Settings() {
  const [did, setDid] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [faceRegistered, setFaceRegistered] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setDid(await storage.getDid());
    setSecret(await storage.getTotpSecret());
    setFaceRegistered(await isFaceRegistered());
    setHasKey(await hasIdentity());
  }

  useEffect(() => {
    refresh();
  }, []);

  /**
   * Wipe the identity. There is deliberately no "re-enrol" button any more: a
   * device cannot mint itself a new credential, it can only discard the one it
   * has and wait for an operator to issue a fresh enrolment code.
   */
  function handleReset() {
    Alert.alert(
      'Reset this device?',
      'The private key is deleted permanently and this DID can never be recovered. ' +
        'You will need a new enrolment code from your administrator.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await resetEnrollment();
              await refresh();
              // Go back to Access, which now has nothing to show but the
              // enrolment form. Staying here left the previous screen still
              // rendering doors and a TOTP code for a key that no longer
              // exists, and the only way out was to restart the app.
              Alert.alert(
                'Done',
                'Device identity cleared. Ask for a new enrolment code.',
                [{ text: 'OK', onPress: () => router.replace('/') }],
              );
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Could not reset');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
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
            <CardDescription>
              This phone holds its own keypair, DID and TOTP secret
            </CardDescription>
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
            <Text className="font-medium mt-2">Private key</Text>
            <Text className="text-muted-foreground text-xs">
              {hasKey ? 'held in the secure enclave — never displayed or transmitted' : 'none'}
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
              label={busy ? 'Resetting…' : 'Reset device identity'}
              loading={busy}
              onPress={handleReset}
            />
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
