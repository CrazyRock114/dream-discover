import React, { useEffect, useCallback, useState } from 'react';
import { View, Text, Animated, TouchableOpacity } from 'react-native';

interface ToastProps {
  message: string | null;
  type?: 'error' | 'success' | 'info';
  duration?: number;
  onDismiss: () => void;
}

// Shared animated value - persists across re-renders without useRef
let animatedOpacity: Animated.Value | null = null;
function getOpacity(): Animated.Value {
  if (!animatedOpacity) animatedOpacity = new Animated.Value(0);
  return animatedOpacity;
}

/**
 * 自动消失的 Toast 提示组件
 */
export function Toast({ message, type = 'error', duration = 3000, onDismiss }: ToastProps) {
  const [opacity] = useState(() => getOpacity());

  useEffect(() => {
    if (!message) {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      return;
    }

    // Show
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();

    // Auto dismiss
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        onDismiss();
      });
    }, duration);

    return () => {
      clearTimeout(timer);
    };
  }, [message, duration, onDismiss, opacity]);

  if (!message) return null;

  const bgColor = type === 'error' ? 'rgba(239, 68, 68, 0.9)' :
    type === 'success' ? 'rgba(34, 197, 94, 0.9)' :
    'rgba(167, 139, 250, 0.9)';

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 60,
        left: 20,
        right: 20,
        zIndex: 100,
        opacity,
        transform: [{
          translateY: opacity.interpolate({
            inputRange: [0, 1],
            outputRange: [-20, 0],
          }),
        }],
      }}
      pointerEvents="box-none"
    >
      <View
        style={{
          backgroundColor: bgColor,
          borderRadius: 16,
          paddingHorizontal: 20,
          paddingVertical: 14,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 14, flex: 1, lineHeight: 20 }}>
          {message}
        </Text>
        <TouchableOpacity onPress={onDismiss} style={{ marginLeft: 12 }}>
          <Text style={{ color: '#FFFFFF80', fontSize: 16 }}>✕</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

/**
 * Hook: 管理Toast状态
 */
export function useToast() {
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);

  const showToast = useCallback((message: string, type: 'error' | 'success' | 'info' = 'error') => {
    setToast({ message, type });
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  return { toast, showToast, dismissToast };
}
