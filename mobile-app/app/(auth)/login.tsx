import { useState } from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { FormInput } from '@/components/ui/form-fields';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password || !totpCode) {
      setError('All fields are required');
      return;
    }
    setError('');
    setLoading(true);

    try {
      const success = await login(email, password, totpCode);
      if (!success) {
        setError('Invalid credentials or TOTP code');
      } else {
        Alert.alert('Success', 'Logged in successfully');
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerClassName="flex-grow items-center justify-center p-6"
        keyboardShouldPersistTaps="handled"
      >
        <View className="w-full max-w-sm gap-6">
          <Card>
            <CardHeader>
              <CardTitle>TOTP Verification</CardTitle>
              <CardDescription>Enter your credentials and verification code</CardDescription>
            </CardHeader>
            <CardContent className="gap-4">
              <FormInput
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              <FormInput
                label="Password"
                placeholder="••••••••"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <FormInput
                label="Verification Code"
                placeholder="6-digit code"
                value={totpCode}
                onChangeText={(v) => setTotpCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                keyboardType="number-pad"
                autoCapitalize="none"
                maxLength={6}
              />
              {error ? <Text variant="destructive">{error}</Text> : null}
              <Button
                label={loading ? 'Verifying...' : 'Verify'}
                loading={loading}
                onPress={handleSubmit}
              />
            </CardContent>
          </Card>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
