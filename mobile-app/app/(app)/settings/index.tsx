import { View, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronRight, User, LogOut } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/text';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertDialog } from '@/components/ui/alert-dialog';
import { useState } from 'react';
import i18n from '@/i18n';

interface SettingsRowProps {
  icon: React.ReactNode;
  label: string;
  onPress?: () => void;
  destructive?: boolean;
  showChevron?: boolean;
}

function SettingsRow({ icon, label, onPress, destructive = false, showChevron = true }: SettingsRowProps) {
  return (
    <Pressable
      className="flex-row items-center gap-3 py-3 active:opacity-60"
      onPress={onPress}
    >
      <View className="w-5 items-center">{icon}</View>
      <Text className={`flex-1 text-base ${destructive ? 'text-destructive' : 'text-foreground'}`}>
        {label}
      </Text>
      {showChevron && <ChevronRight size={16} color="#71717a" />}
    </Pressable>
  );
}

export default function Settings() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const router = useRouter();
  const [logoutOpen, setLogoutOpen] = useState(false);

  async function changeLanguage(lang: string) {
    await i18n.changeLanguage(lang);
    await AsyncStorage.setItem('language', lang);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text variant="h2">{t('settings.heading')}</Text>

        <Card>
          <CardContent>
            <SettingsRow
              icon={<User size={18} color="#18181b" />}
              label={t('settings.account')}
              onPress={() => router.push('/(app)/settings/account')}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Text variant="label" className="mb-2 text-muted-foreground">{t('settings.language')}</Text>
            <Pressable
              className="flex-row items-center justify-between py-2 active:opacity-60"
              onPress={() => changeLanguage('en')}
            >
              <Text>{t('settings.english')}</Text>
              {i18n.language === 'en' && <Text variant="muted">✓</Text>}
            </Pressable>
            <Separator />
            <Pressable
              className="flex-row items-center justify-between py-2 active:opacity-60"
              onPress={() => changeLanguage('hr')}
            >
              <Text>{t('settings.croatian')}</Text>
              {i18n.language === 'hr' && <Text variant="muted">✓</Text>}
            </Pressable>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <SettingsRow
              icon={<LogOut size={18} color="#ef4444" />}
              label={t('nav.logout')}
              destructive
              showChevron={false}
              onPress={() => setLogoutOpen(true)}
            />
          </CardContent>
        </Card>
      </ScrollView>

      <AlertDialog
        open={logoutOpen}
        title={t('nav.logout')}
        description={t('common.areYouSure')}
        confirmLabel={t('nav.logout')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => { setLogoutOpen(false); logout(); }}
        onCancel={() => setLogoutOpen(false)}
      />
    </SafeAreaView>
  );
}
