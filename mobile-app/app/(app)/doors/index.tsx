import { useState, useCallback, useEffect } from 'react';
import { View, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { getDoors, getBuildings, Door } from '@/services/verifyService';

type DoorWithBuilding = Door & { buildingName: string };

export default function DoorsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [doors, setDoors] = useState<DoorWithBuilding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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
  }, []);

  useEffect(() => {
    loadDoors();
  }, [loadDoors]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDoors();
    setRefreshing(false);
  }, [loadDoors]);

  const handleDoorPress = (doorCode: string) => {
    router.push({
      pathname: '/(app)/verify',
      params: { doorCode },
    });
  };

  const renderDoorItem = ({ item }: { item: DoorWithBuilding }) => (
    <Card className="mb-2">
      <CardHeader>
        <CardTitle className="flex-row items-center justify-between">
          <Text variant="default" className="text-base">{item.name}</Text>
          <Badge
            label={item.active ? t('status.active') : t('status.inactive')}
            variant={item.active ? 'default' : 'outline'}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <View className="flex-row items-center gap-2">
          <Text variant="muted">{item.buildingName}</Text>
        </View>
        <View className="flex-row items-center gap-2 mt-1">
          <Text variant="muted">🔑 {item.door_code}</Text>
        </View>
        <Button
          variant="default"
          size="sm"
          className="mt-3"
          onPress={() => handleDoorPress(item.door_code)}
          label={t('verify.openDoor')}
        />
      </CardContent>
    </Card>
  );

  if (loading && doors.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <View className="p-4 gap-4">
          <Text variant="h2">{t('doors.title')}</Text>
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="p-4 pb-2">
        <Text variant="h2">{t('doors.title')}</Text>
      </View>

      {doors.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text variant="default" className="text-center text-muted-foreground mb-4">
            {t('doors.noDoors')}
          </Text>
          <Button variant="outline" onPress={loadDoors} label={t('common.refresh')} />
        </View>
      ) : (
        <FlatList
          data={doors}
          renderItem={renderDoorItem}
          keyExtractor={(item) => item.id.toString()}
          contentContainerClassName="px-4 gap-2 pb-8"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#71717a"
            />
          }
        />
      )}
    </SafeAreaView>
  );
}
