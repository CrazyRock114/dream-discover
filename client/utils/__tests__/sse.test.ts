import { Platform } from 'react-native';
import { connectSSE } from '@/utils/sse';

jest.mock('react-native-sse', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(),
    close: jest.fn(),
  })),
}));

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  'x-device-id': 'device-under-test',
  Authorization: 'Bearer test-token',
};

function asWeb() {
  Object.defineProperty(Platform, 'OS', { get: () => 'web', configurable: true });
}

function asNative() {
  Object.defineProperty(Platform, 'OS', { get: () => 'ios', configurable: true });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('connectSSE —— Web 分支', () => {
  it('把 x-device-id 与 Authorization 原样传给服务端', () => {
    asWeb();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: jest.fn() },
    });
    (global as any).fetch = fetchMock;

    connectSSE(
      'http://localhost:9091/api/v1/dreams/1/chat',
      { message: 'hi' },
      AUTH_HEADERS,
      jest.fn(),
      jest.fn(),
      jest.fn()
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers).toEqual(AUTH_HEADERS);
    expect(init.headers['x-device-id']).toBeDefined();
    expect(init.headers['Authorization']).toBeDefined();
  });

  it('HTTP 错误时走 onError', async () => {
    asWeb();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    const onError = jest.fn();

    connectSSE('http://x/chat', {}, AUTH_HEADERS, jest.fn(), jest.fn(), onError);
    await new Promise((r) => setTimeout(r, 0));

    expect(onError).toHaveBeenCalled();
  });
});

describe('connectSSE —— Native 分支', () => {
  it('把 x-device-id 与 Authorization 传给 react-native-sse', () => {
    asNative();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RNSSE = require('react-native-sse').default;
    RNSSE.mockClear();

    connectSSE(
      'http://localhost:9091/api/v1/dreams/1/chat',
      { message: 'hi' },
      AUTH_HEADERS,
      jest.fn(),
      jest.fn(),
      jest.fn()
    );

    expect(RNSSE).toHaveBeenCalledTimes(1);
    const options = RNSSE.mock.calls[0][1];
    expect(options.headers).toEqual(AUTH_HEADERS);
  });
});
