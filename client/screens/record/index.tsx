import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { createDream } from '@/utils/api';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { Toast, useToast } from '@/components/Toast';
import { useKeepAwake } from 'expo-keep-awake';

const PRESET_TAGS = ['灵感来源', '印象深刻', '有待深度解读'];

const MOOD_OPTIONS = [
  { value: 'good', label: '好梦', icon: 'moon', color: '#A78BFA' },
  { value: 'bad', label: '噩梦', icon: 'ghost', color: '#EF4444' },
  { value: 'neutral', label: '中性', icon: 'cloud', color: '#6B7280' },
] as const;

export default function RecordScreen() {
  // Prevent screen from sleeping while on this page (important during voice recording)
  useKeepAwake();

  const router = useSafeRouter();
  const [content, setContent] = useState('');
  const [mood, setMood] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const { toast, showToast, dismissToast } = useToast();
  const {
    isRecording,
    isProcessing,
    recordingDuration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceInput();

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  }, []);

  const addCustomTag = useCallback(() => {
    const tag = customTagInput.trim();
    if (!tag) return;
    if (selectedTags.includes(tag)) {
      showToast('标签已存在', 'info');
      return;
    }
    if (selectedTags.length >= 5) {
      showToast('最多添加5个标签', 'info');
      return;
    }
    setSelectedTags(prev => [...prev, tag]);
    setCustomTagInput('');
  }, [customTagInput, selectedTags, showToast]);

  const handleVoiceRecord = useCallback(async () => {
    if (isRecording) {
      const result = await stopRecording();
      if (result.success && result.text) {
        setContent(prev => (prev ? prev + '\n' + result.text : result.text));
      } else if (result.error) {
        showToast(result.error, 'error');
      }
    } else {
      const result = await startRecording();
      if (!result.success && result.error) {
        showToast(result.error, 'error');
      }
    }
  }, [isRecording, startRecording, stopRecording, showToast]);

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      showToast('请先输入或录制梦境内容', 'error');
      return;
    }

    setSaving(true);
    try {
      const dream = await createDream({
        content: content.trim(),
        mood: mood || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
      });
      router.push('/interpreter-select', { dreamId: dream.id });
    } catch (err: any) {
      showToast(err.message || '保存失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  }, [content, mood, selectedTags, router, showToast]);

  /** Clear all input and start a new dream record */
  const handleClearAll = useCallback(() => {
    if (!content && !mood && selectedTags.length === 0) return;

    const doClear = async () => {
      if (isRecording) {
        await cancelRecording();
      }
      setContent('');
      setMood('');
      setSelectedTags([]);
      setCustomTagInput('');
      showToast('已清空，开始新记录', 'success');
    };

    // Web uses window.confirm, native uses Alert.alert
    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm('将清空当前所有输入内容，确定吗？')) {
        doClear();
      }
    } else {
      Alert.alert('开始新记录', '将清空当前所有输入内容，确定吗？', [
        { text: '取消', style: 'cancel' },
        {
          text: '清空',
          style: 'destructive',
          onPress: () => { doClear(); },
        },
      ]);
    }
  }, [content, mood, selectedTags, isRecording, cancelRecording, showToast]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Screen safeAreaEdges={['left', 'right']} backgroundColor="#0D1026">
      <Toast message={toast?.message || null} type={toast?.type || 'error'} onDismiss={dismissToast} />

      {/* Header */}
      <View
        className="px-6 pb-6 flex-row items-center justify-between"
        style={{ paddingTop: 60, backgroundColor: '#0D1026' }}
      >
        <View>
          <Text className="text-foreground text-2xl font-bold">录梦</Text>
          <Text className="text-muted text-sm mt-1">醒来第一件事，记录你的梦</Text>
        </View>
        {/* Clear / New dream button */}
        <TouchableOpacity
          onPress={handleClearAll}
          className="px-3 py-2 rounded-xl border border-border/30"
          style={{ backgroundColor: 'rgba(30, 32, 60, 0.6)' }}
        >
          <View className="flex-row items-center gap-1.5">
            <FontAwesome6 name="rotate" size={10} color="#A78BFA" />
            <Text className="text-accent text-xs font-medium">新记录</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        style={{ backgroundColor: '#0D1026' }}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="px-5 pt-6"
          style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
        >
          {/* Dream text input */}
          <View className="mb-6">
            <Text className="text-foreground text-base font-semibold mb-3">梦境内容</Text>
            <View
              className="bg-surface rounded-2xl border border-border/30 p-4"
              style={{ minHeight: 150 }}
            >
              <TextInput
                className="text-foreground text-sm leading-7"
                style={{ minHeight: 110, textAlignVertical: 'top' }}
                placeholder="描述你的梦境...越详细越好"
                placeholderTextColor="#6B6890"
                value={content}
                onChangeText={setContent}
                multiline
              />
            </View>
          </View>

          {/* Voice recording */}
          <View className="items-center mb-6">
            <Text className="text-muted text-sm mb-4">或用语音快速记录</Text>

            {isRecording && (
              <View className="flex-row items-center gap-2 mb-4">
                <View className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                <Text className="text-red-400 text-sm font-mono">{formatDuration(recordingDuration)}</Text>
              </View>
            )}

            {isProcessing && (
              <View className="flex-row items-center gap-2 mb-4">
                <ActivityIndicator size="small" color="#A78BFA" />
                <Text className="text-muted text-sm">
                  识别中...
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleVoiceRecord}
              disabled={isProcessing}
              className="items-center justify-center"
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: isRecording ? '#EF4444' : '#A78BFA',
                shadowColor: isRecording ? '#EF4444' : '#A78BFA',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.4,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <FontAwesome6
                name={isRecording ? 'stop' : 'microphone'}
                size={24}
                color="#FFFFFF"
              />
            </TouchableOpacity>
            <Text className="text-muted text-xs mt-3">
              {isRecording ? '点击停止录音' : '点击开始录音'}
            </Text>
          </View>

          {/* Mood selection */}
          <View className="mb-6">
            <Text className="text-foreground text-base font-semibold mb-3">梦境感受</Text>
            <View className="flex-row gap-3">
              {MOOD_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setMood(mood === opt.value ? '' : opt.value)}
                  className="flex-1 py-3 rounded-2xl items-center border"
                  style={{
                    backgroundColor: mood === opt.value ? opt.color + '20' : 'rgba(30, 32, 60, 0.6)',
                    borderColor: mood === opt.value ? opt.color + '60' : 'rgba(167, 139, 250, 0.15)',
                  }}
                >
                  <FontAwesome6 name={opt.icon} size={18} color={mood === opt.value ? opt.color : '#6B6890'} />
                  <Text
                    className="text-xs mt-1 font-medium"
                    style={{ color: mood === opt.value ? opt.color : '#6B6890' }}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Tags */}
          <View className="mb-8">
            <Text className="text-foreground text-base font-semibold mb-3">标签</Text>
            <View className="flex-row flex-wrap gap-2 mb-3">
              {PRESET_TAGS.map(tag => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    onPress={() => toggleTag(tag)}
                    className="px-4 py-2 rounded-full border"
                    style={{
                      backgroundColor: isSelected ? '#A78BFA20' : 'rgba(30, 32, 60, 0.6)',
                      borderColor: isSelected ? '#A78BFA60' : 'rgba(167, 139, 250, 0.15)',
                    }}
                  >
                    <Text
                      className="text-xs font-medium"
                      style={{ color: isSelected ? '#A78BFA' : '#6B6890' }}
                    >
                      {isSelected ? '✓ ' : ''}{tag}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {selectedTags.filter(t => !PRESET_TAGS.includes(t)).map(tag => (
                <View
                  key={tag}
                  className="px-4 py-2 rounded-full border flex-row items-center gap-1"
                  style={{ backgroundColor: '#67E8F920', borderColor: '#67E8F960' }}
                >
                  <Text className="text-xs font-medium" style={{ color: '#67E8F9' }}>{tag}</Text>
                  <TouchableOpacity onPress={() => toggleTag(tag)}>
                    <FontAwesome6 name="xmark" size={10} color="#67E8F9" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>

            {/* Custom tag input */}
            {selectedTags.length < 5 && (
              <View className="flex-row gap-2">
                <View className="flex-1 bg-surface rounded-xl border border-border/30 px-3 py-2">
                  <TextInput
                    className="text-foreground text-xs"
                    placeholder="添加自定义标签..."
                    placeholderTextColor="#6B6890"
                    value={customTagInput}
                    onChangeText={setCustomTagInput}
                    onSubmitEditing={addCustomTag}
                    maxLength={20}
                    returnKeyType="done"
                  />
                </View>
                <TouchableOpacity
                  onPress={addCustomTag}
                  disabled={!customTagInput.trim()}
                  className="px-4 rounded-xl items-center justify-center"
                  style={{
                    backgroundColor: customTagInput.trim() ? '#A78BFA' : 'rgba(167, 139, 250, 0.3)',
                  }}
                >
                  <FontAwesome6 name="plus" size={12} color="#FFF" />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Save button */}
          <TouchableOpacity
            onPress={handleSave}
            disabled={!content.trim() || saving}
            className="py-4 rounded-2xl items-center"
            style={{
              backgroundColor: content.trim() && !saving ? '#A78BFA' : 'rgba(167, 139, 250, 0.3)',
              shadowColor: content.trim() && !saving ? '#A78BFA' : 'transparent',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: content.trim() && !saving ? 0.3 : 0,
              shadowRadius: 12,
              elevation: content.trim() && !saving ? 4 : 0,
            }}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text className="text-white text-base font-semibold">
                保存并选择解梦师
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Screen>
  );
}
