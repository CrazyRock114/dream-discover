import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { useSafeRouter } from '@/hooks/useSafeRouter';
import { createDream, uploadAudio, transcribeAudio } from '@/utils/api';
import { Audio } from 'expo-av';

type RecordingState = 'idle' | 'recording' | 'uploading' | 'transcribing';

export default function RecordScreen() {
  const router = useSafeRouter();
  const [content, setContent] = useState('');
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限提示', '需要麦克风权限才能录制梦境');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setRecordingState('recording');
      setRecordingDuration(0);

      durationTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to start recording:', err);
      Alert.alert('录音失败', '无法启动录音，请重试');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }

      if (!recordingRef.current) return;
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) {
        Alert.alert('录音失败', '录音文件获取失败');
        setRecordingState('idle');
        return;
      }

      setRecordingState('uploading');

      // Upload audio
      const uploadResult = await uploadAudio(uri, 'audio/m4a');

      setRecordingState('transcribing');

      // Transcribe audio
      const asrResult = await transcribeAudio(uploadResult.key);

      if (asrResult.text) {
        setContent(prev => (prev ? prev + '\n' + asrResult.text : asrResult.text));
      }

      setRecordingState('idle');
      setRecordingDuration(0);
    } catch (err) {
      console.error('Failed to process recording:', err);
      Alert.alert('处理失败', '语音转文字失败，请手动输入');
      setRecordingState('idle');
      setRecordingDuration(0);
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      Alert.alert('提示', '请先输入或录制梦境内容');
      return;
    }

    try {
      const dream = await createDream({ content: content.trim() });
      router.push('/interpreter-select', { dreamId: dream.id });
    } catch (err) {
      console.error('Failed to save dream:', err);
      Alert.alert('保存失败', '梦境记录保存失败，请重试');
    }
  }, [content, router]);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isRecording = recordingState === 'recording';
  const isProcessing = recordingState === 'uploading' || recordingState === 'transcribing';

  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']}>
      {/* Header */}
      <View
        className="px-6 pb-6"
        style={{ paddingTop: 60, backgroundColor: '#0D1026' }}
      >
        <Text className="text-foreground text-2xl font-bold">录梦</Text>
        <Text className="text-muted text-sm mt-1">醒来第一件事，记录你的梦</Text>
      </View>

      {/* Content */}
      <View
        className="flex-1 px-5 pt-6"
        style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
      >
        {/* Dream text input */}
        <View className="mb-6">
          <Text className="text-foreground text-base font-semibold mb-3">梦境内容</Text>
          <View
            className="bg-surface rounded-2xl border border-border/30 p-4"
            style={{ minHeight: 180 }}
          >
            <TextInput
              className="text-foreground text-sm leading-7"
              style={{ minHeight: 140, textAlignVertical: 'top' }}
              placeholder="描述你的梦境...越详细越好"
              placeholderTextColor="#6B6890"
              value={content}
              onChangeText={setContent}
              multiline
              autoFocus
            />
          </View>
        </View>

        {/* Voice recording area */}
        <View className="items-center mb-8">
          <Text className="text-muted text-sm mb-5">或用语音快速记录</Text>

          {/* Recording indicator */}
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
                {recordingState === 'uploading' ? '上传中...' : '识别中...'}
              </Text>
            </View>
          )}

          {/* Record button */}
          <TouchableOpacity
            onPress={isRecording ? stopRecording : startRecording}
            disabled={isProcessing}
            className="items-center justify-center"
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
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
              size={28}
              color="#FFFFFF"
            />
          </TouchableOpacity>
          <Text className="text-muted text-xs mt-3">
            {isRecording ? '点击停止录音' : '点击开始录音'}
          </Text>
        </View>

        {/* Save button */}
        <TouchableOpacity
          onPress={handleSave}
          disabled={!content.trim()}
          className="py-4 rounded-2xl items-center"
          style={{
            backgroundColor: content.trim() ? '#A78BFA' : 'rgba(167, 139, 250, 0.3)',
            shadowColor: content.trim() ? '#A78BFA' : 'transparent',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: content.trim() ? 0.3 : 0,
            shadowRadius: 12,
            elevation: content.trim() ? 4 : 0,
          }}
        >
          <Text className="text-white text-base font-semibold">
            保存并选择解梦师
          </Text>
        </TouchableOpacity>
      </View>
    </Screen>
  );
}
