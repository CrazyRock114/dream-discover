import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { Image } from 'expo-image';

export default function ProfileScreen() {
  return (
    <Screen safeAreaEdges={['left', 'right', 'bottom']}>
      {/* Header */}
      <View
        className="px-6 pb-6"
        style={{ paddingTop: 60, backgroundColor: '#0D1026' }}
      >
        <Text className="text-foreground text-2xl font-bold">我的</Text>
        <Text className="text-muted text-sm mt-1">梦境旅程记录</Text>
      </View>

      {/* Content */}
      <View
        className="flex-1 px-5 pt-6"
        style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
      >
        {/* Interpreters showcase */}
        <Text className="text-foreground text-lg font-semibold mb-4">解梦师</Text>

        {/* Freud card */}
        <View className="bg-surface rounded-3xl border border-border/30 p-5 mb-3">
          <View className="flex-row items-center gap-4">
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face' }}
              style={{ width: 52, height: 52, borderRadius: 26 }}
              contentFit="cover"
            />
            <View className="flex-1">
              <Text className="text-foreground text-base font-semibold">弗洛伊德</Text>
              <Text className="text-muted text-xs mt-1">精神分析学派创始人</Text>
            </View>
            <View className="w-8 h-8 rounded-lg bg-accent/20 items-center justify-center">
              <FontAwesome6 name="brain" size={14} color="#A78BFA" />
            </View>
          </View>
          <Text className="text-accent text-sm italic mt-3">「梦是通往潜意识的皇家大道」</Text>
        </View>

        {/* Zhou Gong card */}
        <View className="bg-surface rounded-3xl border border-border/30 p-5 mb-6">
          <View className="flex-row items-center gap-4">
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1577401239170-897c2f45dfd0?w=200&h=200&fit=crop&crop=face' }}
              style={{ width: 52, height: 52, borderRadius: 26 }}
              contentFit="cover"
            />
            <View className="flex-1">
              <Text className="text-foreground text-base font-semibold">周公</Text>
              <Text className="text-muted text-xs mt-1">中华解梦始祖</Text>
            </View>
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: '#67E8F920' }}>
              <FontAwesome6 name="book-open" size={14} color="#67E8F9" />
            </View>
          </View>
          <Text className="text-sm italic mt-3" style={{ color: '#67E8F9' }}>「梦境皆有征兆，吉凶自有玄机」</Text>
        </View>

        {/* About */}
        <View className="bg-surface rounded-3xl border border-border/30 p-5">
          <Text className="text-foreground text-base font-semibold mb-3">关于梦境录</Text>
          <Text className="text-muted text-sm leading-6">
            梦境录基于女娲蒸馏方法论（Nuwa Skill）构建解梦师人设，提取弗洛伊德和周公的核心心智模型、表达DNA与决策启发式，为你提供深度的梦境解析与持续咨询。
          </Text>
          <View className="mt-4 pt-4 border-t border-border/20">
            <Text className="text-muted text-xs">
              解梦师人设基于公开理论体系提炼，非真实人物对话。{'\n'}
              梦境解读仅供参考，不构成专业心理建议。
            </Text>
          </View>
        </View>
      </View>
    </Screen>
  );
}
