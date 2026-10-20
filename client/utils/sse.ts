import { Platform } from 'react-native';
import RNSSE from 'react-native-sse';

/**
 * 统一的 SSE 连接函数，兼容 Web 和 Native
 *
 * headers 必须包含 x-device-id 与 Authorization：
 * 服务端会对梦境记录做归属校验，缺少这些头的请求会被判为无权访问。
 */
export function connectSSE(
  url: string,
  body: object,
  headers: Record<string, string>,
  onMessage: (data: string) => void,
  onDone: () => void,
  onError: (err: any) => void
): { close: () => void } {
  if (Platform.OS === 'web') {
    const controller = new AbortController();
    fetch(url, {
      method: 'POST',
      headers,
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
    headers,
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
