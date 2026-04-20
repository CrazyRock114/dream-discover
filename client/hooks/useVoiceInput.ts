import { useState, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import { transcribeAudioDirect } from '@/utils/api';

type VoiceState = 'idle' | 'recording' | 'transcribing';

/**
 * 可复用的语音录入 Hook
 * 支持录音 → ASR 转文字完整流程
 * 空内容时返回空字符串，由调用方决定如何提示
 */
export function useVoiceInput() {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startRecording = useCallback(async () => {
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        return { success: false, error: '需要麦克风权限才能录制' };
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setVoiceState('recording');
      setRecordingDuration(0);

      durationTimerRef.current = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);

      return { success: true };
    } catch {
      return { success: false, error: '录音启动失败，请重试' };
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<{ success: boolean; text: string; error?: string }> => {
    try {
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }

      if (!recordingRef.current) {
        setVoiceState('idle');
        return { success: false, text: '', error: '没有正在进行的录音' };
      }

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

      if (!uri) {
        setVoiceState('idle');
        setRecordingDuration(0);
        return { success: false, text: '', error: '录音文件获取失败' };
      }

      setVoiceState('transcribing');

      const asrResult = await transcribeAudioDirect(uri, 'audio/m4a');

      setVoiceState('idle');
      setRecordingDuration(0);

      if (!asrResult.text || !asrResult.text.trim()) {
        return { success: false, text: '', error: '内容为空，请重新说' };
      }

      return { success: true, text: asrResult.text.trim() };
    } catch (err: any) {
      setVoiceState('idle');
      setRecordingDuration(0);
      return { success: false, text: '', error: '语音处理失败，请手动输入' };
    }
  }, []);

  const cancelRecording = useCallback(async () => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch {}
      recordingRef.current = null;
    }
    setVoiceState('idle');
    setRecordingDuration(0);
  }, []);

  const isRecording = voiceState === 'recording';
  const isProcessing = voiceState === 'transcribing';
  const isActive = voiceState !== 'idle';

  return {
    voiceState,
    recordingDuration,
    isRecording,
    isProcessing,
    isActive,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
