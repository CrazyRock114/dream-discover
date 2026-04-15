import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { fetchDreams, deleteDream, type Dream } from '@/utils/api';
import dayjs from 'dayjs';

const INTERPRETER_MAP: Record<string, { name: string; color: string }> = {
  freud: { name: '弗洛伊德', color: '#A78BFA' },
  zhougong: { name: '周公', color: '#67E8F9' },
};

function DreamCard({ dream, onPress, onDelete }: { dream: Dream; onPress: () => void; onDelete: () => void }) {
  const interpreter = dream.interpreter ? INTERPRETER_MAP[dream.interpreter] : null;
  const dateStr = dayjs(dream.created_at).format('MM/DD HH:mm');
  const preview = dream.content.length > 60 ? dream.content.slice(0, 60) + '...' : dream.content;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={() => {
        Alert.alert('删除梦境', '确定要删除这条梦境记录吗？', [
          { text: '取消', style: 'cancel' },
          { text: '删除', style: 'destructive', onPress: onDelete },
        ]);
      }}
      className="bg-surface rounded-3xl p-5 mb-3 border border-border/30"
      style={{
        shadowColor: 'rgba(100, 80, 200, 0.15)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 4,
      }}
    >
      <View className="flex-row justify-between items-start mb-3">
        <Text className="text-muted text-xs">{dateStr}</Text>
        {interpreter && (
          <View
            className="px-3 py-1 rounded-full"
            style={{ backgroundColor: interpreter.color + '20' }}
          >
            <Text className="text-xs font-medium" style={{ color: interpreter.color }}>
              {interpreter.name}解梦
            </Text>
          </View>
        )}
      </View>
      <Text className="text-foreground text-sm leading-6" numberOfLines={3}>
        {preview}
      </Text>
      {dream.interpretation && (
        <View className="mt-3 pt-3 border-t border-border/20">
          <Text className="text-muted text-xs" numberOfLines={2}>
            {dream.interpretation.length > 80
              ? dream.interpretation.slice(0, 80) + '...'
              : dream.interpretation}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const router = useSafeRouter();
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const loadDreams = useCallback(async (reset = true) => {
    try {
      const result = await fetchDreams(20, reset ? undefined : nextCursor || undefined);
      if (reset) {
        setDreams(result.data);
      } else {
        setDreams(prev => [...prev, ...result.data]);
      }
      setNextCursor(result.nextCursor);
    } catch (e) {
      console.error('Failed to load dreams:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [nextCursor]);

  useFocusEffect(
    useCallback(() => {
      loadDreams(true);
    }, [])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadDreams(true);
  }, [loadDreams]);

  const handleDreamPress = (dream: Dream) => {
    if (dream.interpreter && dream.interpretation) {
      router.push('/chat', { dreamId: dream.id, interpreter: dream.interpreter });
    } else {
      router.push('/interpreter-select', { dreamId: dream.id });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteDream(id);
      setDreams(prev => prev.filter(d => d.id !== id));
    } catch (e) {
      console.error('Failed to delete dream:', e);
    }
  };

  if (loading) {
    return (
      <Screen>
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#A78BFA" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']}>
      {/* Header */}
      <View
        className="px-6 pb-6"
        style={{
          paddingTop: 60,
          backgroundColor: '#0D1026',
        }}
      >
        <View className="flex-row items-center gap-3 mb-1">
          <View className="w-10 h-10 rounded-xl bg-accent/20 items-center justify-center">
            <FontAwesome6 name="moon" size={18} color="#A78BFA" />
          </View>
          <Text className="text-foreground text-2xl font-bold">梦境录</Text>
        </View>
        <Text className="text-muted text-sm ml-13">记录每一个梦，解读每一个谜</Text>
      </View>

      {/* Content */}
      <View
        className="flex-1 px-5 pt-4"
        style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
      >
        {dreams.length === 0 ? (
          <View className="flex-1 justify-center items-center px-10">
            <View className="w-20 h-20 rounded-full bg-accent/10 items-center justify-center mb-5">
              <FontAwesome6 name="cloud-moon" size={32} color="#A78BFA" />
            </View>
            <Text className="text-foreground text-lg font-semibold mb-2">还没有梦境记录</Text>
            <Text className="text-muted text-sm text-center leading-6">
              点击下方录梦按钮，{'\n'}用语音或文字记录你的梦境
            </Text>
          </View>
        ) : (
          <FlatList
            data={dreams}
            keyExtractor={item => String(item.id)}
            renderItem={({ item }) => (
              <DreamCard
                dream={item}
                onPress={() => handleDreamPress(item)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A78BFA" />}
            onEndReached={() => {
              if (nextCursor) loadDreams(false);
            }}
            onEndReachedThreshold={0.5}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
          />
        )}
      </View>
    </Screen>
  );
}
