import { useEffect, useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/apiFetch';
import { Text } from '@/components/ui/text';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { FormInput } from '@/components/ui/form-fields';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

function splitName(full: string) {
  const idx = full.indexOf(' ');
  if (idx === -1) return { firstName: full, lastName: '' };
  return { firstName: full.slice(0, idx), lastName: full.slice(idx + 1) };
}

function SectionFeedback({ error, success }: { error: string; success: string }) {
  if (!error && !success) return null;
  return <Text variant={error ? 'destructive' : 'success'}>{error || success}</Text>;
}

function ProfileCard() {
  const { t } = useTranslation();
  const { user, refetch } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (user?.name) {
      const { firstName: f, lastName: l } = splitName(user.name);
      setFirstName(f);
      setLastName(l);
    }
  }, [user?.name]);

  async function handleSave() {
    setError('');
    setSuccess('');
    const name = `${firstName.trim()} ${lastName.trim()}`.trim();
    if (!name) { setError(t('account.nameRequired')); return; }
    setSaving(true);
    try {
      const res = await apiFetch('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update profile');
      setSuccess(t('account.profileUpdated'));
      await refetch();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.profile')}</CardTitle>
        <CardDescription>{t('account.profileDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <FormInput
              label={t('account.firstName')}
              value={firstName}
              onChangeText={setFirstName}
              placeholder={t('account.firstName')}
            />
          </View>
          <View className="flex-1">
            <FormInput
              label={t('account.lastName')}
              value={lastName}
              onChangeText={setLastName}
              placeholder={t('account.lastName')}
            />
          </View>
        </View>
        <FormInput
          label={t('account.email')}
          value={user?.email ?? ''}
          editable={false}
        />
        <SectionFeedback error={error} success={success} />
      </CardContent>
      <CardFooter>
        <Button
          label={saving ? t('common.saving') : t('account.saveChanges')}
          loading={saving}
          onPress={handleSave}
        />
      </CardFooter>
    </Card>
  );
}

function PasswordCard() {
  const { t } = useTranslation();
  const { user, refetch } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const isSettingFirst = !user?.has_password;

  async function handleSubmit() {
    setError('');
    setSuccess('');
    if (next !== confirm) { setError(t('account.passwordsMismatch')); return; }
    setSaving(true);
    try {
      const endpoint = isSettingFirst ? '/auth/set-password' : '/auth/change-password';
      const body = isSettingFirst
        ? { password: next }
        : { currentPassword: current, newPassword: next };
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password');
      setSuccess(isSettingFirst ? t('account.passwordSet') : t('account.passwordChanged'));
      setCurrent('');
      setNext('');
      setConfirm('');
      await refetch();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isSettingFirst ? t('account.setPassword') : t('account.changePassword')}</CardTitle>
        <CardDescription>
          {isSettingFirst ? t('account.setPasswordDescription') : t('account.changePasswordDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!isSettingFirst && (
          <FormInput
            label={t('account.currentPassword')}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="••••••••"
          />
        )}
        <FormInput
          label={t('account.newPassword')}
          value={next}
          onChangeText={setNext}
          secureTextEntry
          placeholder="••••••••"
        />
        <FormInput
          label={t('account.confirmPassword')}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          placeholder="••••••••"
        />
        <SectionFeedback error={error} success={success} />
      </CardContent>
      <CardFooter>
        <Button
          label={saving ? t('common.saving') : isSettingFirst ? t('account.setPassword') : t('account.changePassword')}
          loading={saving}
          onPress={handleSubmit}
        />
      </CardFooter>
    </Card>
  );
}

export default function Account() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();

  if (!user) return null;

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-row items-center gap-3 px-4 py-3">
        <Pressable onPress={() => router.back()} className="active:opacity-60">
          <ArrowLeft size={22} color="#18181b" />
        </Pressable>
        <Text variant="h3">{t('account.heading')}</Text>
      </View>
      <Separator />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text variant="muted">{user.email}</Text>
        <ProfileCard />
        <PasswordCard />
      </ScrollView>
    </SafeAreaView>
  );
}
