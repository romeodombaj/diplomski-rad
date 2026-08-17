import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/text';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text variant="h2">{t('nav.home')}</Text>

        <Card>
          <CardHeader>
            <CardTitle>Welcome{user?.name ? `, ${user.name}` : ''}</CardTitle>
            <CardDescription>Your app is ready. Start building!</CardDescription>
          </CardHeader>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
