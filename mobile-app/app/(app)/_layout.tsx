import { Tabs } from 'expo-router';
import { Home, Settings } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

// gt:tab-imports

export default function AppLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#18181b',
        tabBarInactiveTintColor: '#71717a',
        tabBarStyle: { borderTopColor: '#e4e4e7' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.home'),
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      {/* gt:tabs */}
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
