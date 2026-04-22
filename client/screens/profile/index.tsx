import { FREUD_AVATAR_BASE64, ZHOUGONG_AVATAR_BASE64 } from '@/assets/avatars';
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { Screen } from '@/components/Screen';
import { FontAwesome6 } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuth } from '@/contexts/AuthContext';

export default function ProfileScreen() {
  const { user, isAuthenticated, isLoading, sendCode, verifyCode, logout } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'input-email' | 'input-code' | 'sent'>('input-email');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const showAlert = useCallback((title: string, message?: string) => {
    if (typeof window !== 'undefined' && window.alert) {
      window.alert(message ? `${title}\n${message}` : title);
    } else {
      Alert.alert(title, message);
    }
  }, []);

  const handleSendCode = useCallback(async () => {
    if (!email.trim() || !email.includes('@')) {
      showAlert('请输入有效的邮箱地址');
      return;
    }
    setSending(true);
    const result = await sendCode(email.trim());
    setSending(false);
    if (result.success) {
      setStep('input-code');
    } else {
      showAlert('发送失败', result.error || '请稍后重试');
    }
  }, [email, sendCode, showAlert]);

  const handleVerify = useCallback(async () => {
    if (!code.trim() || code.length !== 6) {
      showAlert('请输入6位验证码');
      return;
    }
    setVerifying(true);
    const result = await verifyCode(email.trim(), code.trim());
    setVerifying(false);
    if (result.success) {
      setStep('sent');
      setCode('');
    } else {
      showAlert('验证失败', result.error || '验证码错误或已过期');
    }
  }, [email, code, verifyCode, showAlert]);

  const handleLogout = useCallback(async () => {
    // Use window.confirm on web, Alert on native
    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm('确定要退出登录吗？')) {
        await logout();
      }
    } else {
      Alert.alert('退出登录', '确定要退出吗？', [
        { text: '取消', style: 'cancel' },
        { text: '退出', style: 'destructive', onPress: logout },
      ]);
    }
  }, [logout]);

  const handleBack = useCallback(() => {
    setStep('input-email');
    setCode('');
  }, []);

  if (isLoading) {
    return (
      <Screen safeAreaEdges={['left', 'right']} backgroundColor="#0D1026">
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#A78BFA" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen safeAreaEdges={['left', 'right']} backgroundColor="#0D1026">
      {/* Header */}
      <View className="px-6 pb-6" style={{ paddingTop: 60, backgroundColor: '#0D1026' }}>
        <Text className="text-foreground text-2xl font-bold">我的</Text>
        <Text className="text-muted text-sm mt-1">梦境旅程记录</Text>
      </View>

      {/* Content */}
      <View
        className="flex-1 px-5 pt-6"
        style={{ marginTop: -16, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: '#0D1026' }}
      >
        {/* User Auth Section */}
        <View className="bg-surface rounded-3xl border border-border/30 p-5 mb-6">
          {isAuthenticated && user ? (
            <>
              <View className="flex-row items-center gap-4 mb-4">
                <View className="w-14 h-14 rounded-full bg-accent/20 items-center justify-center">
                  <FontAwesome6 name="user" size={24} color="#A78BFA" />
                </View>
                <View className="flex-1">
                  <Text className="text-foreground text-base font-semibold">已登录</Text>
                  <Text className="text-muted text-xs mt-1">{user.email}</Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={handleLogout}
                className="bg-red-500/10 rounded-xl py-3 px-4 flex-row items-center justify-center gap-2"
              >
                <FontAwesome6 name="arrow-right-from-bracket" size={14} color="#EF4444" />
                <Text className="text-red-400 text-sm font-medium">退出登录</Text>
              </TouchableOpacity>
            </>
          ) : step === 'input-code' ? (
            <>
              <View className="flex-row items-center gap-4 mb-4">
                <View className="w-14 h-14 rounded-full bg-accent/20 items-center justify-center">
                  <FontAwesome6 name="envelope" size={24} color="#A78BFA" />
                </View>
                <View className="flex-1">
                  <Text className="text-foreground text-base font-semibold">输入验证码</Text>
                  <Text className="text-muted text-xs mt-1">验证码已发送至 {email}</Text>
                </View>
              </View>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="000000"
                placeholderTextColor="#6B6890"
                keyboardType="number-pad"
                maxLength={6}
                className="bg-background rounded-xl px-4 py-3 text-foreground text-lg text-center border border-border/30 mb-3 tracking-[8px]"
              />
              <TouchableOpacity
                onPress={handleVerify}
                disabled={verifying}
                className="bg-accent rounded-xl py-3 px-4 flex-row items-center justify-center gap-2 mb-3"
                style={{ backgroundColor: verifying ? '#A78BFA80' : '#A78BFA' }}
              >
                {verifying ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <FontAwesome6 name="check" size={14} color="#FFF" />
                    <Text className="text-white text-sm font-medium">验证并登录</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={handleBack}>
                <Text className="text-accent text-sm text-center">← 返回，使用其他邮箱</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View className="flex-row items-center gap-4 mb-4">
                <View className="w-14 h-14 rounded-full bg-border/20 items-center justify-center">
                  <FontAwesome6 name="user-slash" size={24} color="#6B6890" />
                </View>
                <View className="flex-1">
                  <Text className="text-foreground text-base font-semibold">未登录</Text>
                  <Text className="text-muted text-xs mt-1">登录后可跨设备同步梦境</Text>
                </View>
              </View>
              <Text className="text-muted text-xs mb-2">邮箱地址</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="your@email.com"
                placeholderTextColor="#6B6890"
                keyboardType="email-address"
                autoCapitalize="none"
                className="bg-background rounded-xl px-4 py-3 text-foreground text-sm border border-border/30 mb-3"
              />
              <TouchableOpacity
                onPress={handleSendCode}
                disabled={sending}
                className="bg-accent rounded-xl py-3 px-4 flex-row items-center justify-center gap-2"
                style={{ backgroundColor: sending ? '#A78BFA80' : '#A78BFA' }}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <FontAwesome6 name="paper-plane" size={14} color="#FFF" />
                    <Text className="text-white text-sm font-medium">发送验证码</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text className="text-muted text-xs mt-3 text-center leading-4">
                我们向你的邮箱发送 6 位验证码，输入即可登录，无需密码。
              </Text>
            </>
          )}
        </View>

        {/* Interpreters showcase */}
        <Text className="text-foreground text-lg font-semibold mb-4">解梦师</Text>

        {/* Freud card */}
        <View className="bg-surface rounded-3xl border border-border/30 p-5 mb-3">
          <View className="flex-row items-center gap-4">
            <Image
              source={{ uri: `${FREUD_AVATAR_BASE64}` }}
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
              source={{ uri: `${ZHOUGONG_AVATAR_BASE64}` }}
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
