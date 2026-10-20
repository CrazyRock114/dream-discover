import React from 'react';
import renderer, { act } from 'react-test-renderer';
import ChatScreen from '@/screens/chat';

const mockConnectSSE = jest.fn(() => ({ close: jest.fn() }));
const mockGetHeaders = jest.fn(async () => ({
  'Content-Type': 'application/json',
  'x-device-id': 'device-under-test',
  Authorization: 'Bearer test-token',
}));

jest.mock('@/utils/sse', () => ({
  connectSSE: (...args: unknown[]) => mockConnectSSE(...args),
}));

jest.mock('@/utils/api', () => ({
  getHeaders: () => mockGetHeaders(),
  fetchDream: jest.fn(async () => ({
    id: 42,
    device_id: 'device-under-test',
    user_id: null,
    content: '测试梦境内容',
    audio_key: null,
    interpreter: 'freud',
    interpretation: null,
    mood: 'good',
    created_at: '2026-01-01T00:00:00.000Z',
  })),
  fetchMessages: jest.fn(async () => []),
}));

jest.mock('@/hooks/useSafeRouter', () => ({
  useSafeRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSafeSearchParams: () => ({ dreamId: 42, interpreter: 'freud' }),
}));

jest.mock('@/hooks/useVoiceInput', () => ({
  useVoiceInput: () => ({
    isRecording: false,
    isProcessing: false,
    recordingDuration: 0,
    startRecording: jest.fn(),
    stopRecording: jest.fn(),
  }),
}));

jest.mock('@/components/Toast', () => ({
  Toast: () => null,
  useToast: () => ({
    toast: null,
    showToast: jest.fn(),
    dismissToast: jest.fn(),
  }),
}));

jest.mock('expo-image', () => ({ Image: 'Image' }));

// Screen 组件依赖 uniwind（node_modules 里的 TS 源码，jest 默认不转译），此处直接替换
jest.mock('@/components/Screen', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));

describe('ChatScreen —— SSE 请求必须带归属凭证', () => {
  beforeEach(() => {
    mockConnectSSE.mockClear();
    mockGetHeaders.mockClear();
  });

  it('无历史消息时自动发起解读，且请求头含 x-device-id 与 Authorization', async () => {
    let tree: renderer.ReactTestRenderer | undefined;

    await act(async () => {
      tree = renderer.create(<ChatScreen />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetHeaders).toHaveBeenCalled();
    expect(mockConnectSSE).toHaveBeenCalledTimes(1);

    const [url, body, headers] = mockConnectSSE.mock.calls[0];
    expect(url).toContain('/api/v1/dreams/42/interpret');
    expect(body).toMatchObject({ interpreter: 'freud' });
    expect(headers['x-device-id']).toBe('device-under-test');
    expect(headers['Authorization']).toBe('Bearer test-token');

    await act(async () => {
      tree?.unmount();
    });
  });
});
