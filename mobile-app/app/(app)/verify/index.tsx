import { useState, useCallback } from 'react';
import { View, ScrollView, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-fields';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { verifyAccess, getDoors, getBuildings, Door } from '@/services/verifyService';

type DoorWithBuilding = Door & { buildingName: string };

export default function VerifyScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { doorCode } = useLocalSearchParams<{ doorCode?: string }>();

  const [code, setCode] = useState('');
  const [selectedDoor, setSelectedDoor] = useState(doorCode ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [doors, setDoors] = useState<DoorWithBuilding[]>([]);

  const successAnim = new Animated.Value(0);

  const loadDoors = useCallback(async () => {
    const [doorsList, buildings] = await Promise.all([getDoors(), getBuildings()]);
    const enriched: DoorWithBuilding[] = doorsList.map((door) => {
      const building = buildings.find((b) => b.id === door.building_id);
      return {
        ...door,
        buildingName: building?.name ?? `Building ${door.building_id}`,
      };
    });
    setDoors(enriched);

    if (doorCode) {
      const doorExists = doorsList.some((d) => d.door_code === doorCode);
      if (doorExists) {
        setSelectedDoor(doorCode);
      }
    }
  }, [doorCode]);

  const handleOpen = useCallback(async () => {
    if (!selectedDoor) {
      setError(t('verify.selectDoor'));
      return;
    }
    if (!code || code.length !== 6) {
      setError(t('verify.enterValidCode'));
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await verifyAccess(selectedDoor, code);
      if (result.success) {
        setSuccess(true);
        Animated.timing(successAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }).start();
        setTimeout(() => {
          router.back();
        }, 2000);
      } else {
        setError(result.message);
      }
    } catch {
      setError(t('verify.networkError'));
    } finally {
      setLoading(false);
    }
  }, [selectedDoor, code, t, successAnim]);

  const selectedDoorData = doors.find((d) => d.door_code === selectedDoor);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScrollView className="flex-1" contentContainerClassName="p-4 gap-4 pb-8">
        <Text variant="h2">{t('verify.title')}</Text>

        <Card>
          <CardHeader>
            <CardTitle>{t('verify.doorAccess')}</CardTitle>
            <CardDescription>{t('verify.doorAccessDescription')}</CardDescription>
          </CardHeader>

          <CardContent className="gap-4">
            {/* Door selector */}
            <FormInput
              label={t('verify.selectDoor')}
              value={selectedDoor}
              onChangeText={setSelectedDoor}
              placeholder={t('verify.selectDoorPlaceholder')}
              editable={false}
              autoCapitalize="none"
            />

            {/* Door details */}
            {selectedDoor && selectedDoorData && (
              <View className="gap-2">
                <Text variant="label">{t('verify.doorInfo')}</Text>
                <View className="flex-row items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                  <View className="gap-1">
                    <Text variant="default">{selectedDoorData.name}</Text>
                    <Text variant="muted">{selectedDoorData.buildingName}</Text>
                  </View>
                  <Badge
                    label={selectedDoorData.active ? t('status.active') : t('status.inactive')}
                    variant={selectedDoorData.active ? 'default' : 'outline'}
                  />
                </View>
              </View>
            )}

            {/* TOTP code input */}
            <FormInput
              label={t('verify.enterCode')}
              value={code}
              onChangeText={setCode}
              placeholder="••••••"
              keyboardType="number-pad"
              autoCapitalize="none"
              maxLength={6}
              error={error ? t('verify.invalidCode') : undefined}
            />
          </CardContent>

          <CardFooter className="gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => router.back()}
              label={t('common.cancel')}
            />
            <Button
              variant="default"
              className="flex-1"
              onPress={handleOpen}
              disabled={loading}
              label={loading ? t('verify.verifying') : t('verify.openDoor')}
            />
          </CardFooter>
        </Card>

        {/* Success feedback */}
        {success && (
          <View className="rounded-xl border border-green-500/30 bg-green-500/10 p-4">
            <Text variant="success">{t('verify.doorOpened')}</Text>
          </View>
        )}

        {/* Error feedback */}
        {error && !success && (
          <View className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <Text variant="destructive">{error}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
