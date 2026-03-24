import { useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';

export type AgentHealth = 'healthy' | 'warning' | 'recovering' | 'critical';

export interface HarnessState {
  socketAgent: { status: AgentHealth; message: string };
  webrtcAgent: { status: AgentHealth; message: string };
  mediaAgent: { status: AgentHealth; message: string };
}

interface UseAutoHealProps {
  socket: Socket | null;
  peerConnection: RTCPeerConnection | null;
  localStream: MediaStream | null;
  userRole: 'broadcaster' | 'viewer' | null;
  onWebRTCRestartRequest: () => void;
  onMediaRestartRequest: () => void;
}

export function useAutoHealAgents({
  socket,
  peerConnection,
  localStream,
  userRole,
  onWebRTCRestartRequest,
  onMediaRestartRequest
}: UseAutoHealProps) {
  
  const [harnessState, setHarnessState] = useState<HarnessState>({
    socketAgent: { status: 'healthy', message: '대기 중' },
    webrtcAgent: { status: 'healthy', message: '대기 중' },
    mediaAgent: { status: 'healthy', message: '대기 중' },
  });

  const updateAgent = (agent: keyof HarnessState, status: AgentHealth, message: string) => {
    setHarnessState(prev => ({ ...prev, [agent]: { status, message } }));
    if (status === 'recovering' || status === 'critical') {
      console.warn(`[🤖 ${agent.toUpperCase()}] ${status}: ${message}`);
    } else {
      console.log(`[🤖 ${agent.toUpperCase()}] ${status}: ${message}`);
    }
  };

  // 1. Socket Agent: 통신망 감시
  useEffect(() => {
    if (!socket) return;

    updateAgent('socketAgent', 'healthy', '소켓 연결 활성화됨');

    const onDisconnect = (reason: string) => {
      updateAgent('socketAgent', 'recovering', `연결 끊김 (${reason}), 핑퐁 재시도 중...`);
    };

    const onConnectError = (err: Error) => {
      updateAgent('socketAgent', 'critical', `터널 503/에러 발생! 소켓 재연결 시도 중...`);
    };

    const onConnect = () => {
      updateAgent('socketAgent', 'healthy', '서버 통신 100% 정상');
    };

    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('connect', onConnect);

    return () => {
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('connect', onConnect);
    };
  }, [socket]);

  // 2. WebRTC ICE Agent: 터널링 복구 요원
  useEffect(() => {
    if (!peerConnection) return;

    const handleIceChange = () => {
      const state = peerConnection.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        updateAgent('webrtcAgent', 'healthy', 'P2P 영상 직송 터널 연결됨');
      } else if (state === 'disconnected') {
        updateAgent('webrtcAgent', 'warning', 'P2P 터널 불안정, 재연결 의심 중...');
      } else if (state === 'failed') {
        updateAgent('webrtcAgent', 'recovering', '터널 완전 붕괴! 긴급 ICE Restart 가동 🚀');
        // 스스로 치유 (부모 컴포넌트에 트리거)
        onWebRTCRestartRequest();
      } else {
        updateAgent('webrtcAgent', 'warning', `터널 협상 중... (${state})`);
      }
    };

    peerConnection.addEventListener('iceconnectionstatechange', handleIceChange);
    // Init state check
    handleIceChange();

    return () => {
      peerConnection.removeEventListener('iceconnectionstatechange', handleIceChange);
    };
  }, [peerConnection, onWebRTCRestartRequest]);

  // 3. Media Agent: 하드웨어 감시 요원
  useEffect(() => {
    if (!localStream && userRole === 'broadcaster') {
      updateAgent('mediaAgent', 'warning', '카메라 권한 대기 중...');
      return;
    }
    if (userRole === 'viewer') {
      updateAgent('mediaAgent', 'healthy', '시청자 모드 (카메라 불필요)');
      return;
    }
    if (!localStream) return;

    updateAgent('mediaAgent', 'healthy', '카메라 센서 정상 작동 중');

    // 트랙 중 하나라도 끊기면 (다른 앱에서 카메라 가로채기, USB 뽑힘 등)
    const onTrackEnded = () => {
      updateAgent('mediaAgent', 'critical', '카메라 센서 권한 유실! 즉각 재가동 시도 🔁');
      onMediaRestartRequest();
    };

    localStream.getTracks().forEach(track => {
      track.addEventListener('ended', onTrackEnded);
    });

    return () => {
      localStream.getTracks().forEach(track => {
        track.removeEventListener('ended', onTrackEnded);
      });
    };
  }, [localStream, userRole, onMediaRestartRequest]);

  return { harnessState, updateAgent };
}
