import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BASE_URL } from '@/utils/api';
import { getDeviceId } from '@/hooks/useDeviceId';

const AUTH_TOKEN_KEY = '@dreamdiscover:auth_token';
const AUTH_USER_KEY = '@dreamdiscover:auth_user';

export interface User {
  id: string;
  email?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sendCode: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyCode: (email: string, code: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  getToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load auth state from AsyncStorage on mount
  useEffect(() => {
    const loadAuth = async () => {
      try {
        const [tokenJson, userJson] = await Promise.all([
          AsyncStorage.getItem(AUTH_TOKEN_KEY),
          AsyncStorage.getItem(AUTH_USER_KEY),
        ]);
        if (tokenJson && userJson) {
          const userData = JSON.parse(userJson);
          setUser(userData);
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };
    loadAuth();
  }, []);

  const sendCode = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { success: false, error: data.error || '发送失败' };
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const verifyCode = useCallback(async (email: string, code: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || '验证失败' };
      }

      // Save token and user
      await AsyncStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(data.token));
      await AsyncStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
      setUser(data.user);

      // Auto-migrate anonymous device data to logged-in user
      try {
        const deviceId = await getDeviceId();
        await fetch(`${BASE_URL}/api/v1/migrate-device-data`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${data.token}`,
          },
          body: JSON.stringify({ device_id: deviceId }),
        });
      } catch {
        // ignore migration errors
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_USER_KEY]);
    setUser(null);
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    try {
      const tokenJson = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      if (!tokenJson) return null;
      return JSON.parse(tokenJson);
    } catch {
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      isLoading,
      sendCode,
      verifyCode,
      logout,
      getToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
