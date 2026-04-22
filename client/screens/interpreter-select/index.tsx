import { FREUD_AVATAR_BASE64, ZHOUGONG_AVATAR_BASE64 } from '@/assets/avatars';
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, ScrollView } from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Image } from 'expo-image';
import { createDream, findDream, type Interpreter } from '@/utils/api';

const INTERPRETER_DATA: Interpreter[] = [
  {
    id: 'freud',
    name: '弗洛伊德',
    name_en: 'Sigmund Freud',
    avatar: `${FREUD_AVATAR_BASE64}`,
    title: '精神分析学派创始人',
    tagline: '梦是通往潜意识的皇家大道',
    description: '以精神分析理论解读你的梦境，揭示潜意识中被压抑的欲望与冲突。',
  },
  {
    id: 'zhougong',
    name: '周公',
    name_en: 'Duke of Zhou',
    avatar: `${ZHOUGONG_AVATAR_BASE64}`,
    title: '中华解梦始祖',
    tagline: '梦境皆有征兆，吉凶自有玄机',
    description: '以《周公解梦》与千年易学智慧，为你揭示梦中的预兆与启示。',
  },
];

export default function InterpreterSelectScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<{
    dreamId: number;
    dreamContent: string;
    dreamMood: string;
  }>();
  const dreamId = params.dreamId;
  const dreamContent = params.dreamContent;
  const dreamMood = params.dreamMood;

  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      let targetDreamId: number;

      if (dreamContent) {
        // Coming from "switch interpreter" — check if a record with same content+interpreter already exists
        try {
          const existingDream = await findDream(dreamContent, selected);
          if (existingDream) {
            // Found existing record for this interpreter — navigate to it (resume conversation)
            targetDreamId = existingDream.id;
          } else {
            // No existing record — create a new one for this interpreter
            const newDream = await createDream({
              content: dreamContent,
              mood: dreamMood || undefined,
              interpreter: selected,
            });
            targetDreamId = newDream.id;
          }
        } catch {
          // If find fails, fall back to creating new record
          const newDream = await createDream({
            content: dreamContent,
            mood: dreamMood || undefined,
            interpreter: selected,
          });
          targetDreamId = newDream.id;
        }
      } else if (dreamId) {
        // First time from record page — use existing dream record
        targetDreamId = dreamId;
      } else {
        Alert.alert('出错了', '无法找到梦境记录，请返回重试');
        return;
      }

      router.push('/chat', {
        dreamId: targetDreamId,
        interpreter: selected,
      });
    } catch (e) {
      Alert.alert('解梦失败', '无法启动解梦，请重试');
    } finally {
      setLoading(false);
    }
  }, [selected, dreamId, dreamContent, dreamMood, router]);

  // Show dream content preview if available
  const previewContent = dreamContent || '';

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
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="px-5 pt-6"
          style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
        >
          {/* Dream content preview */}
          {previewContent ? (
            <View
              className="mb-5 rounded-2xl border border-border/30 p-4"
              style={{ backgroundColor: 'rgba(30, 32, 60, 0.6)' }}
            >
              <View className="flex-row items-center gap-2 mb-2">
                <FontAwesome6 name="cloud-moon" size={10} color="#A78BFA" />
                <Text className="text-muted text-xs font-medium">你的梦境</Text>
              </View>
              <Text className="text-foreground text-sm leading-6" numberOfLines={3}>
                {previewContent.length > 100 ? previewContent.slice(0, 100) + '...' : previewContent}
              </Text>
            </View>
          ) : null}

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
      </ScrollView>
    </Screen>
  );
}
