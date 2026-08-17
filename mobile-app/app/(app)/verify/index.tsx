import { useState, useCallback } from 'react';
import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { FormInput } from '@/components/ui/form-fields';
import { apiFetch } from '@/lib/apiFetch';

export default function Verify() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleVerify = useCallback(async () => {
    if (!code || code.length !== 6) {
      setMessage({ type: 'error', text: 'Please enter a 6-digit code' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const res = await apiFetch('/mobile/verify/totp', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || data.message || 'Verification failed' });
      } else {
        setMessage({ type: 'success', text: data.message || 'Verification successful!' });
        setCode('');
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  }, [code]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1 p-4" contentContainerClassName="gap-4 pb-8">
        <Text variant="h2">Verification</Text>

        <Card>
          <CardHeader>
            <CardTitle>Enter Verification Code</CardTitle>
            <CardDescription>Enter the 6-digit code from your authenticator app</CardDescription>
          </CardHeader>

          <CardContent className="gap-4">
            <FormInput
              label="Code"
              value={code}
              onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="••••••"
              keyboardType="number-pad"
              autoCapitalize="none"
              maxLength={6}
            />
          </CardContent>

          <CardFooter>
            <Button
              variant="default"
              className="w-full"
              onPress={handleVerify}
              disabled={loading}
              label={loading ? 'Verifying...' : 'Verify'}
            />
          </CardFooter>
        </Card>

        {message && (
          <View
            className={`rounded-xl p-4 ${
              message.type === 'success'
                ? 'bg-green-500/10 border border-green-500/30'
                : 'bg-red-500/10 border border-red-500/30'
            }`}
          >
            <Text variant={message.type === 'success' ? 'success' : 'destructive'}>
              {message.text}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
