import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

const DEVICE_ID_KEY = '@dream_app_device_id';

/**
 * 获取或创建设备唯一标识
 * 首次使用生成 UUID 并持久化到 AsyncStorage，后续统一读取
 */
export async function getDeviceId(): Promise<string> {
  try {
    const existingId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existingId) return existingId;

    const newId = randomUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch {
    const fallbackId = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await AsyncStorage.setItem(DEVICE_ID_KEY, fallbackId);
    } catch {}
    return fallbackId;
  }
}

/**
 * Hook: 在组件中获取 deviceId
 */
export function useDeviceId() {
  const [deviceId, setDeviceId] = useState<string>('');

  useEffect(() => {
    getDeviceId().then(setDeviceId);
  }, []);

  return deviceId;
}
