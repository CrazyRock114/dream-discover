import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Image } from 'expo-image';
import { fetchInterpreters, type Interpreter } from '@/utils/api';

const INTERPRETER_DATA: Interpreter[] = [
  {
    id: 'freud',
    name: '弗洛伊德',
    name_en: 'Sigmund Freud',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
    title: '精神分析学派创始人',
    tagline: '梦是通往潜意识的皇家大道',
    description: '以精神分析理论解读你的梦境，揭示潜意识中被压抑的欲望与冲突。弗洛伊德会用他的愿望满足理论、审查机制与象征分析，深入你梦境的显意与隐意之间。',
  },
  {
    id: 'zhougong',
    name: '周公',
    name_en: 'Duke of Zhou',
    avatar: 'https://images.unsplash.com/photo-1577401239170-897c2f45dfd0?w=200&h=200&fit=crop&crop=face',
    title: '中华解梦始祖',
    tagline: '梦境皆有征兆，吉凶自有玄机',
    description: '以《周公解梦》与千年易学智慧，为你揭示梦中的预兆与启示。周公会观梦之气象、辨阴阳之象、明吉凶之兆，不仅断吉凶，更指趋避之道。',
  },
];

export default function InterpreterSelectScreen() {
  const router = useSafeRouter();
  const { dreamId } = useSafeSearchParams<{ dreamId: number }>();
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!selected || !dreamId) return;
    setLoading(true);
    try {
      router.push('/chat', { dreamId, interpreter: selected });
    } catch (e) {
      console.error('Failed to start interpretation:', e);
      Alert.alert('解梦失败', '无法启动解梦，请重试');
    } finally {
      setLoading(false);
    }
  }, [selected, dreamId, router]);

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']}>
      {/* Header */}
      <View
        className="px-6 pb-6"
        style={{ paddingTop: 60, backgroundColor: '#0D1026' }}
      >
        <TouchableOpacity onPress={() => router.back()} className="mb-4">
          <FontAwesome6 name="arrow-left" size={20} color="#A78BFA" />
        </TouchableOpacity>
        <Text className="text-foreground text-2xl font-bold">选择解梦师</Text>
        <Text className="text-muted text-sm mt-1">由谁来解读你的梦境？</Text>
      </View>

      {/* Content */}
      <View
        className="flex-1 px-5 pt-6"
        style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
      >
        {INTERPRETER_DATA.map(interp => {
          const isSelected = selected === interp.id;
          const accentColor = interp.id === 'freud' ? '#A78BFA' : '#67E8F9';

          return (
            <TouchableOpacity
              key={interp.id}
              onPress={() => setSelected(interp.id)}
              className="mb-4 rounded-3xl border p-5"
              style={{
                backgroundColor: isSelected ? accentColor + '15' : 'rgba(30, 32, 60, 0.85)',
                borderColor: isSelected ? accentColor + '60' : 'rgba(167, 139, 250, 0.15)',
                shadowColor: isSelected ? accentColor : 'transparent',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: isSelected ? 0.2 : 0,
                shadowRadius: 12,
                elevation: isSelected ? 4 : 0,
              }}
            >
              <View className="flex-row items-start gap-4">
                {/* Avatar */}
                <View className="relative">
                  <Image
                    source={{ uri: interp.avatar }}
                    style={{ width: 56, height: 56, borderRadius: 28 }}
                    contentFit="cover"
                  />
                  {isSelected && (
                    <View
                      className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full items-center justify-center"
                      style={{ backgroundColor: accentColor }}
                    >
                      <FontAwesome6 name="check" size={10} color="#FFF" />
                    </View>
                  )}
                </View>

                {/* Info */}
                <View className="flex-1">
                  <View className="flex-row items-center gap-2 mb-1">
                    <Text className="text-foreground text-lg font-bold">{interp.name}</Text>
                    <Text className="text-muted text-xs">{interp.name_en}</Text>
                  </View>
                  <Text className="text-sm mb-2" style={{ color: accentColor }}>
                    {interp.title}
                  </Text>
                  <Text
                    className="text-foreground text-sm font-medium mb-2 italic"
                    style={{ color: accentColor }}
                  >
                    「{interp.tagline}」
                  </Text>
                  <Text className="text-muted text-xs leading-5">
                    {interp.description}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Confirm button */}
        <TouchableOpacity
          onPress={handleConfirm}
          disabled={!selected || loading}
          className="py-4 rounded-2xl items-center mt-2"
          style={{
            backgroundColor: selected ? '#A78BFA' : 'rgba(167, 139, 250, 0.3)',
            shadowColor: selected ? '#A78BFA' : 'transparent',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: selected ? 0.3 : 0,
            shadowRadius: 12,
            elevation: selected ? 4 : 0,
          }}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Text className="text-white text-base font-semibold">
              开始解梦
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </Screen>
  );
}
