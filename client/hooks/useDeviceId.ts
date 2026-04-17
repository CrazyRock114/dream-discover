import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';

const DEVICE_ID_KEY = '@dream_app_device_id';

// Cache the device ID in memory to avoid repeated AsyncStorage reads
let cachedDeviceId: string | null = null;

/**
 * 获取或创建设备唯一标识
 * 首次使用生成 UUID 并持久化到 AsyncStorage，后续直接从内存缓存读取
 */
export async function getDeviceId(): Promise<string> {
  // Return cached value immediately
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const existingId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (existingId) {
      cachedDeviceId = existingId;
      return existingId;
    }

    const newId = randomUUID();
    await AsyncStorage.setItem(DEVICE_ID_KEY, newId);
    cachedDeviceId = newId;
    return newId;
  } catch {
    const fallbackId = `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cachedDeviceId = fallbackId;
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
