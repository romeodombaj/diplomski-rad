import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function Home() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text variant="h2">{t('nav.home')}</Text>

        <Card>
          <CardHeader>
            <CardTitle>
              Welcome{user?.name ? `, ${user.name}` : ''}
            </CardTitle>
            <CardDescription>
              {user?.role && `Role: ${user.role}`}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Access doors and verify codes</CardDescription>
          </CardHeader>
          <CardContent className="gap-3">
            <Button
              variant="default"
              onPress={() => router.push('/(app)/doors')}
              label={`🚪 ${t('verify.openDoor')}`}
            />
            <Button
              variant="outline"
              onPress={() => router.push('/(app)/code')}
              label={`🔐 ${t('code.yourCode')}`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your App</CardTitle>
            <CardDescription>
              Your app is ready. Start building!
            </CardDescription>
          </CardHeader>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
