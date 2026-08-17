import { View, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export default function Home() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text variant="h2">Home</Text>

        <Card>
          <CardHeader>
            <CardTitle>Access Verification</CardTitle>
            <CardDescription>Verify your code to open a door</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="default"
              className="w-full"
              onPress={() => router.push('/(app)/verify')}
              label="Verify"
            />
          </CardContent>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
