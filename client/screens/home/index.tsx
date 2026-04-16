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
import { fetchDreams, deleteDream, type Dream, type DreamTag } from '@/utils/api';
import { Toast, useToast } from '@/components/Toast';
import dayjs from 'dayjs';

const INTERPRETER_MAP: Record<string, { name: string; color: string }> = {
  freud: { name: '弗洛伊德', color: '#A78BFA' },
  zhougong: { name: '周公', color: '#67E8F9' },
};

const MOOD_MAP: Record<string, { label: string; color: string; icon: string }> = {
  good: { label: '好梦', color: '#A78BFA', icon: 'moon' },
  bad: { label: '噩梦', color: '#EF4444', icon: 'ghost' },
  neutral: { label: '中性', color: '#6B7280', icon: 'cloud' },
};

const MOOD_FILTERS = [
  { value: '', label: '全部' },
  { value: 'good', label: '好梦' },
  { value: 'bad', label: '噩梦' },
  { value: 'neutral', label: '中性' },
];

const PRESET_TAG_FILTERS = ['灵感来源', '印象深刻', '有待深度解读'];

function DreamCard({ dream, onPress, onDelete }: { dream: Dream; onPress: () => void; onDelete: () => void }) {
  const interpreter = dream.interpreter ? INTERPRETER_MAP[dream.interpreter] : null;
  const moodInfo = dream.mood ? MOOD_MAP[dream.mood] : null;
  const dateStr = dayjs(dream.created_at).format('MM/DD HH:mm');
  const preview = dream.content.length > 60 ? dream.content.slice(0, 60) + '...' : dream.content;
  const tags = dream.tags || [];

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
      {/* Top row: date + mood + interpreter */}
      <View className="flex-row justify-between items-center mb-2">
        <View className="flex-row items-center gap-2">
          <Text className="text-muted text-xs">{dateStr}</Text>
          {moodInfo && (
            <View
              className="px-2 py-0.5 rounded-full flex-row items-center gap-1"
              style={{ backgroundColor: moodInfo.color + '20' }}
            >
              <FontAwesome6 name={moodInfo.icon} size={8} color={moodInfo.color} />
              <Text className="text-xs" style={{ color: moodInfo.color }}>{moodInfo.label}</Text>
            </View>
          )}
        </View>
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

      {/* Content */}
      <Text className="text-foreground text-sm leading-6" numberOfLines={3}>
        {preview}
      </Text>

      {/* Interpretation preview */}
      {dream.interpretation && (
        <View className="mt-3 pt-3 border-t border-border/20">
          <Text className="text-muted text-xs" numberOfLines={2}>
            {dream.interpretation.length > 80
              ? dream.interpretation.slice(0, 80) + '...'
              : dream.interpretation}
          </Text>
        </View>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 mt-3">
          {tags.slice(0, 4).map((tag: DreamTag) => (
            <View
              key={tag.id}
              className="px-2.5 py-0.5 rounded-full"
              style={{ backgroundColor: tag.is_custom ? '#67E8F915' : '#A78BFA15' }}
            >
              <Text
                className="text-xs"
                style={{ color: tag.is_custom ? '#67E8F9' : '#A78BFA' }}
              >
                {tag.tag}
              </Text>
            </View>
          ))}
          {tags.length > 4 && (
            <Text className="text-muted text-xs self-center">+{tags.length - 4}</Text>
          )}
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
  const [moodFilter, setMoodFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [showTagFilters, setShowTagFilters] = useState(false);
  /** All unique tags from loaded dreams, for the filter bar */
  const [allTags, setAllTags] = useState<string[]>([]);

  const { toast, showToast, dismissToast } = useToast();

  const loadDreams = useCallback(async (reset = true, mood?: string, tag?: string) => {
    try {
      const effectiveMood = mood !== undefined ? mood : moodFilter;
      const effectiveTag = tag !== undefined ? tag : tagFilter;
      const result = await fetchDreams(
        20,
        reset ? undefined : nextCursor || undefined,
        effectiveMood || undefined,
        effectiveTag || undefined,
      );
      if (reset) {
        setDreams(result.data);
      } else {
        setDreams(prev => [...prev, ...result.data]);
      }
      setNextCursor(result.nextCursor);

      // Collect all unique tags from loaded dreams for filter chips
      if (reset) {
        const tagSet = new Set<string>();
        for (const dream of result.data) {
          for (const t of dream.tags || []) {
            tagSet.add(t.tag);
          }
        }
        setAllTags(Array.from(tagSet));
      }
    } catch {
      showToast('加载梦境列表失败', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [nextCursor, moodFilter, tagFilter, showToast]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadDreams(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [moodFilter, tagFilter])
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
    } catch {
      showToast('删除失败', 'error');
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
      <Toast message={toast?.message || null} type={toast?.type || 'error'} onDismiss={dismissToast} />

      {/* Header */}
      <View
        className="px-6 pb-4"
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
        <Text className="text-muted text-sm" style={{ marginLeft: 52 }}>记录每一个梦，解读每一个谜</Text>
      </View>

      {/* Content */}
      <View
        className="flex-1 px-5 pt-4"
        style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
      >
        {/* Mood filter tabs */}
        <View className="flex-row items-center gap-2 mb-3">
          {MOOD_FILTERS.map(filter => (
            <TouchableOpacity
              key={filter.value}
              onPress={() => {
                setMoodFilter(filter.value);
              }}
              className="px-4 py-2 rounded-full border"
              style={{
                backgroundColor: moodFilter === filter.value ? '#A78BFA20' : 'rgba(30, 32, 60, 0.6)',
                borderColor: moodFilter === filter.value ? '#A78BFA60' : 'rgba(167, 139, 250, 0.15)',
              }}
            >
              <Text
                className="text-xs font-medium"
                style={{ color: moodFilter === filter.value ? '#A78BFA' : '#6B6890' }}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Tag filter toggle */}
          <TouchableOpacity
            onPress={() => setShowTagFilters(!showTagFilters)}
            className="px-4 py-2 rounded-full border flex-row items-center gap-1.5"
            style={{
              backgroundColor: tagFilter ? '#67E8F920' : showTagFilters ? 'rgba(103, 232, 249, 0.1)' : 'rgba(30, 32, 60, 0.6)',
              borderColor: tagFilter ? '#67E8F960' : 'rgba(167, 139, 250, 0.15)',
            }}
          >
            <FontAwesome6 name="tag" size={9} color={tagFilter ? '#67E8F9' : '#6B6890'} />
            <Text
              className="text-xs font-medium"
              style={{ color: tagFilter ? '#67E8F9' : '#6B6890' }}
            >
              {tagFilter || '标签'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tag filter chips (expandable) */}
        {showTagFilters && (
          <View className="flex-row flex-wrap gap-2 mb-3">
            {PRESET_TAG_FILTERS.map(tag => (
              <TouchableOpacity
                key={tag}
                onPress={() => {
                  setTagFilter(tagFilter === tag ? '' : tag);
                  setShowTagFilters(false);
                }}
                className="px-3 py-1.5 rounded-full border"
                style={{
                  backgroundColor: tagFilter === tag ? '#67E8F920' : 'rgba(30, 32, 60, 0.6)',
                  borderColor: tagFilter === tag ? '#67E8F960' : 'rgba(103, 232, 249, 0.15)',
                }}
              >
                <Text
                  className="text-xs"
                  style={{ color: tagFilter === tag ? '#67E8F9' : '#6B6890' }}
                >
                  {tag}
                </Text>
              </TouchableOpacity>
            ))}
            {/* Custom tags from user's dreams */}
            {allTags
              .filter(t => !PRESET_TAG_FILTERS.includes(t))
              .map(tag => (
                <TouchableOpacity
                  key={tag}
                  onPress={() => {
                    setTagFilter(tagFilter === tag ? '' : tag);
                    setShowTagFilters(false);
                  }}
                  className="px-3 py-1.5 rounded-full border"
                  style={{
                    backgroundColor: tagFilter === tag ? '#67E8F920' : 'rgba(30, 32, 60, 0.6)',
                    borderColor: tagFilter === tag ? '#67E8F960' : 'rgba(103, 232, 249, 0.15)',
                  }}
                >
                  <Text
                    className="text-xs"
                    style={{ color: tagFilter === tag ? '#67E8F9' : '#6B6890' }}
                  >
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
          </View>
        )}

        {/* Active filter indicator */}
        {(moodFilter || tagFilter) && (
          <View className="flex-row items-center justify-between mb-3">
            <Text className="text-muted text-xs">
              筛选: {moodFilter ? MOOD_MAP[moodFilter]?.label : ''}{moodFilter && tagFilter ? ' + ' : ''}{tagFilter || ''}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setMoodFilter('');
                setTagFilter('');
                setShowTagFilters(false);
              }}
            >
              <Text className="text-accent text-xs">清除筛选</Text>
            </TouchableOpacity>
          </View>
        )}

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
