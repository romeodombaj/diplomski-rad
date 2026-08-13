import { useState } from 'react';
import { View, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/apiFetch';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { FormInput } from '@/components/ui/form-fields';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (!email || !password) return;
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      await login(data.user, { accessToken: data.accessToken, refreshToken: data.refreshToken });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerClassName="flex-grow items-center justify-center p-6">
        <View className="w-full max-w-sm gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('auth.welcomeBack')}</CardTitle>
              <CardDescription>{t('auth.loginWithEmail')}</CardDescription>
            </CardHeader>
            <CardContent>
              <View className="gap-4">
                <FormInput
                  label={t('auth.email')}
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                />
                <FormInput
                  label={t('auth.password')}
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                {error ? <Text variant="destructive">{error}</Text> : null}
                <Button
                  label={loading ? t('auth.loggingIn') : t('auth.login')}
                  loading={loading}
                  onPress={handleSubmit}
                />
              </View>
            </CardContent>
          </Card>

          <Text className="text-center text-sm text-muted-foreground">
            {t('auth.noAccount')}{' '}
            <Link href="/(auth)/register">
              <Text className="text-sm font-medium text-foreground underline">{t('auth.signUp')}</Text>
            </Link>
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
