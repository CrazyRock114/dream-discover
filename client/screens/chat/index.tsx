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
import { fetchDream, fetchMessages, type Dream, type Message } from '@/utils/api';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_BASE_URL || '';

const INTERPRETER_CONFIG: Record<string, { name: string; color: string; avatar: string }> = {
  freud: {
    name: '弗洛伊德',
    color: '#A78BFA',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
  },
  zhougong: {
    name: '周公',
    color: '#67E8F9',
    avatar: 'https://images.unsplash.com/photo-1577401239170-897c2f45dfd0?w=200&h=200&fit=crop&crop=face',
  },
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
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
  const flatListRef = useRef<FlatList>(null);
  const sseRef = useRef<RNSSE | null>(null);

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
          startInterpretation(dreamId, interpreterStr);
        } else {
          setMessages(chatMsgs);
        }
      } catch (e) {
        console.error('Failed to load dream data:', e);
      } finally {
        setInitialLoading(false);
      }
    };

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dreamId]);

  // Helper: handle SSE message event
  const handleSSEMessage = useCallback(
    (eventData: string | null, assistantMsgId: string) => {
      if (!eventData || eventData === '[DONE]') {
        if (sseRef.current) {
          sseRef.current.close();
          sseRef.current = null;
        }
        setIsStreaming(false);
        setMessages(prev =>
          prev.map(m => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
        );
        return;
      }

      try {
        const parsed = JSON.parse(eventData);
        if (parsed.content) {
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantMsgId ? { ...m, content: m.content + parsed.content } : m
            )
          );
        }
      } catch {
        // Ignore parse errors
      }
    },
    []
  );

  const handleSSEError = useCallback((assistantMsgId: string) => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setIsStreaming(false);
    setMessages(prev =>
      prev.map(m => (m.id === assistantMsgId ? { ...m, streaming: false } : m))
    );
  }, []);

  // Start interpretation via SSE
  const startInterpretation = useCallback(
    (dId: number, interp: string) => {
      setIsStreaming(true);
      const assistantMsgId = `stream-${Date.now()}`;
      setMessages(prev => [
        ...prev,
        { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
      ]);

      const url = `${BASE_URL}/api/v1/dreams/${dId}/interpret`;
      const sse = new RNSSE(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interpreter: interp }),
      });

      sseRef.current = sse;

      sse.addEventListener('message', (event) => {
        handleSSEMessage(event.data, assistantMsgId);
      });

      sse.addEventListener('error', () => {
        handleSSEError(assistantMsgId);
      });
    },
    [handleSSEMessage, handleSSEError]
  );

  // Send follow-up message via SSE
  const sendMessage = useCallback(() => {
    if (!inputText.trim() || !dreamId || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputText.trim(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');

    setIsStreaming(true);
    const assistantMsgId = `stream-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true },
    ]);

    const url = `${BASE_URL}/api/v1/dreams/${dreamId}/chat`;
    const sse = new RNSSE(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMsg.content, interpreter: interpreterStr }),
    });

    sseRef.current = sse;

    sse.addEventListener('message', (event) => {
      handleSSEMessage(event.data, assistantMsgId);
    });

    sse.addEventListener('error', () => {
      handleSSEError(assistantMsgId);
    });
  }, [inputText, dreamId, interpreterStr, isStreaming, handleSSEMessage, handleSSEError]);

  // Cleanup SSE on unmount
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
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
          <View className="mb-4 items-end">
            <View
              className="rounded-2xl rounded-tr-sm px-4 py-3 max-w-[80%]"
              style={{ backgroundColor: '#A78BFA' }}
            >
              <Text className="text-white text-sm leading-6">{item.content}</Text>
            </View>
          </View>
        );
      }

      return (
        <View className="mb-4 items-start">
          <View className="flex-row items-start gap-3 max-w-[85%]">
            <Image
              source={{ uri: config.avatar }}
              style={{ width: 32, height: 32, borderRadius: 16 }}
              contentFit="cover"
            />
            <View
              className="rounded-2xl rounded-tl-sm px-4 py-3"
              style={{
                backgroundColor: 'rgba(30, 32, 60, 0.9)',
                borderColor: config.color + '30',
                borderWidth: 1,
              }}
            >
              {item.streaming && !item.content ? (
                <View className="flex-row gap-1 py-2">
                  <View
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: config.color }}
                  />
                  <View
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: config.color }}
                  />
                  <View
                    className="w-2 h-2 rounded-full animate-pulse"
                    style={{ backgroundColor: config.color }}
                  />
                </View>
              ) : (
                <Text className="text-foreground text-sm leading-6">{item.content}</Text>
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
        </View>
      </Screen>
    );
  }

  return (
    <Screen safeAreaEdges={['left', 'right']}>
      {/* Header */}
      <View
        className="flex-row items-center px-5 pb-4"
        style={{ paddingTop: 55, backgroundColor: '#0D1026' }}
      >
        <TouchableOpacity onPress={() => router.back()} className="mr-4">
          <FontAwesome6 name="arrow-left" size={18} color="#A78BFA" />
        </TouchableOpacity>
        <View className="flex-row items-center gap-3">
          <Image
            source={{ uri: config.avatar }}
            style={{ width: 36, height: 36, borderRadius: 18 }}
            contentFit="cover"
          />
          <View>
            <Text className="text-foreground text-base font-semibold">{config.name}</Text>
            <Text className="text-muted text-xs">正在为你解梦...</Text>
          </View>
        </View>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ padding: 20, paddingBottom: 10 }}
          showsVerticalScrollIndicator={false}
        />

        {/* Input bar */}
        <View
          className="flex-row items-end gap-3 px-4 py-3"
          style={{
            backgroundColor: 'rgba(20, 22, 46, 0.95)',
            borderTopColor: 'rgba(167, 139, 250, 0.15)',
            borderTopWidth: 1,
          }}
        >
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
      </KeyboardAvoidingView>
    </Screen>
  );
}
