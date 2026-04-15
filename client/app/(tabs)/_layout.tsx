import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { useCSSVariable } from 'uniwind';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const [background, muted, accent, border] = useCSSVariable([
    '--color-background',
    '--color-muted',
    '--color-accent',
    '--color-border',
  ]) as string[];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: 'rgba(13, 16, 38, 0.95)',
          borderTopWidth: 1,
          borderTopColor: border || 'rgba(167, 139, 250, 0.15)',
          height: Platform.OS === 'web' ? 55 : 50 + insets.bottom,
          paddingBottom: Platform.OS === 'web' ? 0 : insets.bottom,
        },
        tabBarActiveTintColor: accent || '#A78BFA',
        tabBarInactiveTintColor: muted || '#6B6890',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '梦境',
          tabBarIcon: ({ color }) => (
            <FontAwesome6 name="moon" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="record"
        options={{
          title: '录梦',
          tabBarIcon: ({ color }) => (
            <FontAwesome6 name="microphone" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '我的',
          tabBarIcon: ({ color }) => (
            <FontAwesome6 name="user" size={20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
