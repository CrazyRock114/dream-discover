import { FREUD_AVATAR_BASE64, ZHOUGONG_AVATAR_BASE64 } from '@/assets/avatars';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { useSafeRouter, useSafeSearchParams } from '@/hooks/useSafeRouter';
import { Image } from 'expo-image';
import RNSSE from 'react-native-sse';
import { fetchDream, fetchMessages, type Dream } from '@/utils/api';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { Toast, useToast } from '@/components/Toast';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';

const INTERPRETER_CONFIG: Record<string, { name: string; color: string; avatar: string }> = {
  freud: {
    name: '弗洛伊德',
    color: '#A78BFA',
    avatar: '${FREUD_AVATAR_BASE64}',
  },
  zhougong: {
    name: '周公',
    color: '#67E8F9',
    avatar: '${ZHOUGONG_AVATAR_BASE64}',
  },
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

/**
 * 统一的 SSE 连接函数，兼容 Web 和 Native
 */
function connectSSE(
  url: string,
  body: object,
  onMessage: (data: string) => void,
  onDone: () => void,
  onError: (err: any) => void
): { close: () => void } {
  if (Platform.OS === 'web') {
    const controller = new AbortController();
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          onError(new Error(`HTTP ${response.status}`));
          return;
        }
        const reader = (response as any).body?.getReader();
        if (!reader) {
          const text = await response.text();
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') { onDone(); return; }
              onMessage(data);
            }
          }
          onDone();
          return;
        }
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') { onDone(); return; }
              onMessage(data);
            }
          }
        }
        onDone();
      })
      .catch((err) => {
        if (err.name !== 'AbortError') onError(err);
      });

    return { close: () => controller.abort() };
  }

  // Native: use react-native-sse
  const sse = new RNSSE(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  sse.addEventListener('message', (event: any) => {
    if (!event.data || event.data === '[DONE]') {
      onDone();
      sse.close();
      return;
    }
    onMessage(event.data);
  });

  sse.addEventListener('error', () => {
    onError(new Error('SSE connection error'));
    sse.close();
  });

  return { close: () => sse.close() };
}

export default function ChatScreen() {
  const router = useSafeRouter();
  const params = useSafeSearchParams<{ dreamId: number; interpreter: string }>();
  const dreamId = params.dreamId;
  const interpreterStr = params.interpreter || 'freud';
  const config = INTERPRETER_CONFIG[interpreterStr] || INTERPRETER_CONFIG.freud;

  const [dream, setDream] = useState<Dream | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [verboseMode, setVerboseMode] = useState(true); // true = 详细, false = 精简
  const flatListRef = useRef<FlatList>(null);
  const sseCloseRef = useRef<(() => void) | null>(null);

  const { toast, showToast, dismissToast } = useToast();
  const {
    isRecording: isVoiceRecording,
    isProcessing: isVoiceProcessing,
    recordingDuration,
    startRecording: startVoiceRecording,
    stopRecording: stopVoiceRecording,
  } = useVoiceInput();

  // Helper: handle SSE data
  const handleSSEData = useCallback((assistantMsgId: string, rawData: string) => {
    try {
      const parsed = JSON.parse(rawData);
      if (parsed.content) {
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantMsgId ? { ...m, content: m.content + parsed.content } : m
          )
        );
      }
      if (parsed.error) {
        showToast(parsed.error, 'error');
      }
    } catch {
      // Ignore parse errors
    }
  }, [showToast]);

  // Start interpretation via SSE
  const startInterpretation = useCallback(
    (dId: number, interp: string, mode: string) => {
      setIsStreaming(true);
      const assistantMsgId = `stream-${Date.now()}`;
      setMessages([
        { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
      ]);

      /**
       * 服务端文件：server/src/index.ts
       * 接口：POST /api/v1/dreams/:id/interpret
       * Body 参数：interpreter: 'freud'|'zhougong', mode?: 'verbose'|'concise'
       */
      const url = `${BASE_URL}/api/v1/dreams/${dId}/interpret`;

      const conn = connectSSE(
        url,
        { interpreter: interp, mode },
        (data) => {
          handleSSEData(assistantMsgId, data);
        },
        () => {
          setIsStreaming(false);
          setMessages(prev =>
            prev.map(m => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
          );
          sseCloseRef.current = null;
        },
        () => {
          setIsStreaming(false);
          showToast('连接解梦师失败，请重试', 'error');
          setMessages(prev =>
            prev.map(m => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
          );
          sseCloseRef.current = null;
        }
      );
      sseCloseRef.current = conn.close;
    },
    [handleSSEData, showToast]
  );

  // Send follow-up message via SSE
  const sendMessage = useCallback(() => {
    if (!inputText.trim() || !dreamId || isStreaming) return;

    const msg = inputText.trim();
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: msg,
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsStreaming(true);

    const assistantMsgId = `stream-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
    ]);

    /**
     * 服务端文件：server/src/index.ts
     * 接口：POST /api/v1/dreams/:id/chat
     * Body 参数：message: string, interpreter: 'freud'|'zhougong', mode?: 'verbose'|'concise'
     */
    const url = `${BASE_URL}/api/v1/dreams/${dreamId}/chat`;
    const currentMode = verboseMode ? 'verbose' : 'concise';
    const conn = connectSSE(
      url,
      { message: msg, interpreter: interpreterStr, mode: currentMode },
      (data) => handleSSEData(assistantMsgId, data),
      () => {
        setIsStreaming(false);
        setMessages(prev =>
          prev.map(m => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
        );
        sseCloseRef.current = null;
      },
      () => {
        setIsStreaming(false);
        showToast('发送消息失败，请重试', 'error');
        setMessages(prev =>
          prev.map(m => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
        );
        sseCloseRef.current = null;
      }
    );
    sseCloseRef.current = conn.close;
  }, [inputText, dreamId, interpreterStr, isStreaming, verboseMode, handleSSEData, showToast]);

  // Voice input handler
  const handleVoicePress = useCallback(async () => {
    if (isVoiceRecording) {
      const result = await stopVoiceRecording();
      if (result.success && result.text) {
        setInputText(prev => (prev ? prev + result.text : result.text));
      } else if (result.error) {
        showToast(result.error, 'error');
      }
    } else {
      const result = await startVoiceRecording();
      if (!result.success && result.error) {
        showToast(result.error, 'error');
      }
    }
  }, [isVoiceRecording, startVoiceRecording, stopVoiceRecording, showToast]);

  /** Navigate to interpreter select to switch interpreter — carries only dream content */
  const handleSwitchInterpreter = useCallback(() => {
    if (!dream) return;
    if (isStreaming && sseCloseRef.current) {
      sseCloseRef.current();
      sseCloseRef.current = null;
      setIsStreaming(false);
    }
    // Pass dream content (not dreamId) so we can find or create a record for the new interpreter
    router.push('/interpreter-select', {
      dreamContent: dream.content,
      dreamMood: dream.mood || '',
    });
  }, [dream, isStreaming, router]);

  // Load dream and messages
  useEffect(() => {
    if (!dreamId) return;

    const loadData = async () => {
      try {
        const dreamData = await fetchDream(dreamId);
        setDream(dreamData);

        const messagesData = await fetchMessages(dreamId);
        const chatMsgs: ChatMessage[] = messagesData.map(m => ({
          id: String(m.id),
          role: m.role,
          content: m.content,
        }));

        // If no messages yet, start interpretation
        if (chatMsgs.length === 0) {
          startInterpretation(dreamId, interpreterStr, verboseMode ? 'verbose' : 'concise');
        } else {
          setMessages(chatMsgs);
        }
      } catch {
        showToast('加载梦境数据失败', 'error');
      } finally {
        setInitialLoading(false);
      }
    };

    loadData();
  }, [dreamId]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (sseCloseRef.current) {
        sseCloseRef.current();
        sseCloseRef.current = null;
      }
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isUser = item.role === 'user';

      if (isUser) {
        return (
          <View className="mb-4 items-end" style={{ maxWidth: '100%' }}>
            <View
              className="rounded-2xl rounded-tr-sm px-4 py-3"
              style={{ backgroundColor: '#A78BFA', maxWidth: '80%' }}
            >
              <Text className="text-white text-sm leading-6" style={{ flexShrink: 1 } as any}>
                {item.content}
              </Text>
            </View>
          </View>
        );
      }

      return (
        <View className="mb-4 items-start" style={{ maxWidth: '100%' }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, maxWidth: '85%' }}>
            <Image
              source={{ uri: config.avatar }}
              style={{ width: 32, height: 32, borderRadius: 16, flexShrink: 0 }}
              contentFit="cover"
            />
            <View
              className="rounded-2xl rounded-tl-sm px-4 py-3"
              style={{
                backgroundColor: 'rgba(30, 32, 60, 0.9)',
                borderColor: config.color + '30',
                borderWidth: 1,
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              {item.streaming && !item.content ? (
                <View className="flex-row gap-1 py-2 items-center">
                  <View className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                  <View className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                  <View className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                  <Text className="text-muted text-xs ml-2">正在思考...</Text>
                </View>
              ) : (
                <Text className="text-foreground text-sm leading-6" selectable style={{ flexShrink: 1 } as any}>
                  {item.content}
                </Text>
              )}
            </View>
          </View>
        </View>
      );
    },
    [config]
  );

  if (initialLoading) {
    return (
      <Screen>
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#A78BFA" />
          <Text className="text-muted text-sm mt-3">正在加载梦境...</Text>
        </View>
      </Screen>
    );
  }

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Screen safeAreaEdges={['left', 'right']}>
      <Toast message={toast?.message || null} type={toast?.type || 'error'} onDismiss={dismissToast} />

      {/* Header */}
      <View
        className="flex-row items-center px-5 pb-4"
        style={{ paddingTop: 55, backgroundColor: '#0D1026' }}
      >
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <FontAwesome6 name="arrow-left" size={18} color="#A78BFA" />
        </TouchableOpacity>
        <View className="flex-row items-center gap-3 flex-1">
          <Image
            source={{ uri: config.avatar }}
            style={{ width: 36, height: 36, borderRadius: 18 }}
            contentFit="cover"
          />
          <View className="flex-1">
            <Text className="text-foreground text-base font-semibold">{config.name}</Text>
            <Text className="text-muted text-xs">
              {isStreaming ? '正在解梦...' : '解梦师'}
            </Text>
          </View>
          {/* Switch interpreter button */}
          <TouchableOpacity
            onPress={handleSwitchInterpreter}
            disabled={isStreaming}
            className="px-3 py-2 rounded-xl border border-border/30"
            style={{ backgroundColor: 'rgba(30, 32, 60, 0.6)' }}
          >
            <View className="flex-row items-center gap-1.5">
              <FontAwesome6 name="repeat" size={10} color="#A78BFA" />
              <Text className="text-accent text-xs font-medium">换人</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1, overflow: 'hidden' }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: 20, paddingBottom: 10, flexGrow: 1 }}
          style={{ flex: 1, minHeight: 0 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View className="items-center py-10">
              <ActivityIndicator size="small" color="#A78BFA" />
              <Text className="text-muted text-sm mt-3">正在连接解梦师...</Text>
            </View>
          }
        />

        {/* Voice recording indicator */}
        {isVoiceRecording && (
          <View className="flex-row items-center justify-center gap-2 py-2">
            <View className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <Text className="text-red-400 text-xs font-mono">{formatDuration(recordingDuration)}</Text>
            <Text className="text-muted text-xs">录音中...</Text>
          </View>
        )}
        {isVoiceProcessing && (
          <View className="flex-row items-center justify-center gap-2 py-2">
            <ActivityIndicator size="small" color="#A78BFA" />
            <Text className="text-muted text-xs">识别中...</Text>
          </View>
        )}

        {/* Mode toggle + Input bar */}
        <View
          style={{
            backgroundColor: 'rgba(20, 22, 46, 0.95)',
            borderTopColor: 'rgba(167, 139, 250, 0.15)',
            borderTopWidth: 1,
          }}
        >
          {/* Mode toggle row */}
          <View className="flex-row items-center justify-center gap-1 pt-2 px-4">
            <TouchableOpacity
              onPress={() => setVerboseMode(true)}
              disabled={isStreaming}
              className="flex-row items-center gap-1 px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: verboseMode ? 'rgba(167, 139, 250, 0.15)' : 'transparent',
                borderColor: verboseMode ? 'rgba(167, 139, 250, 0.4)' : 'rgba(167, 139, 250, 0.15)',
              }}
            >
              <FontAwesome6 name="align-left" size={8} color={verboseMode ? '#A78BFA' : '#6B6890'} />
              <Text
                className="text-xs font-medium"
                style={{ color: verboseMode ? '#A78BFA' : '#6B6890' }}
              >
                详细
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setVerboseMode(false)}
              disabled={isStreaming}
              className="flex-row items-center gap-1 px-3 py-1.5 rounded-full border"
              style={{
                backgroundColor: !verboseMode ? 'rgba(103, 232, 249, 0.15)' : 'transparent',
                borderColor: !verboseMode ? 'rgba(103, 232, 249, 0.4)' : 'rgba(167, 139, 250, 0.15)',
              }}
            >
              <FontAwesome6 name="compress" size={8} color={!verboseMode ? '#67E8F9' : '#6B6890'} />
              <Text
                className="text-xs font-medium"
                style={{ color: !verboseMode ? '#67E8F9' : '#6B6890' }}
              >
                精简
              </Text>
            </TouchableOpacity>
          </View>

          {/* Input row */}
          <View className="flex-row items-end gap-2 px-4 py-3">
            {/* Voice button */}
            <TouchableOpacity
              onPress={handleVoicePress}
              disabled={isStreaming || isVoiceProcessing}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{
                backgroundColor: isVoiceRecording ? '#EF4444' : isVoiceProcessing ? 'rgba(167, 139, 250, 0.3)' : 'rgba(167, 139, 250, 0.15)',
              }}
            >
              {isVoiceProcessing ? (
                <ActivityIndicator size="small" color="#A78BFA" />
              ) : (
                <FontAwesome6 name="microphone" size={14} color={isVoiceRecording ? '#FFF' : '#A78BFA'} />
              )}
            </TouchableOpacity>

            {/* Text input */}
            <View className="flex-1 bg-surface rounded-2xl border border-border/30 px-4 py-2">
              <TextInput
                className="text-foreground text-sm"
                placeholder="继续向解梦师咨询..."
                placeholderTextColor="#6B6890"
                value={inputText}
                onChangeText={setInputText}
                multiline
                maxLength={500}
                editable={!isStreaming}
                style={{ maxHeight: 80 }}
              />
            </View>

            {/* Send button */}
            <TouchableOpacity
              onPress={sendMessage}
              disabled={!inputText.trim() || isStreaming}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{
                backgroundColor:
                  inputText.trim() && !isStreaming ? '#A78BFA' : 'rgba(167, 139, 250, 0.3)',
              }}
            >
              {isStreaming ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <FontAwesome6 name="paper-plane" size={14} color="#FFF" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
