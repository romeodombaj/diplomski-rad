import { Tabs } from 'expo-router';
import { KeyRound, Settings } from 'lucide-react-native';

export default function AppLayout() {
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
          title: 'Access',
          tabBarIcon: ({ color, size }) => <KeyRound size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
