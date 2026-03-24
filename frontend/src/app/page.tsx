/* eslint-disable */
"use client";

import { useEffect, useState, useRef, FormEvent, useCallback } from "react";
import { 
  Play, Image as ImageIcon, Send, X, Mic, MicOff, Camera, MapPin, 
  Search, ChevronRight, Wand2, ArrowLeft, CameraOff, Clock, User, 
  Pin, Gift, Heart, Volume2, VolumeX 
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { PRODUCT_CATEGORIES } from "../lib/categories";
import { arEngineInstance } from "@/lib/ArEngine";
import { useAutoHealAgents } from "@/lib/agents/useAutoHealAgents";

interface ChatMessage {
  id: string;
  sender: string;
  type: string;
  text?: string;
  color?: string;
  isStreaming?: boolean;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '1', sender: '시스템', type: 'newUser', text: '방금 입장' },
  ]);
  const [inputText, setInputText] = useState("");
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [userRole, setUserRole] = useState<'broadcaster' | 'viewer' | null>(null);
  const userRoleRef = useRef<'broadcaster' | 'viewer' | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const initViewerPCRef = useRef<((offer: RTCSessionDescriptionInit) => void) | null>(null);
  
  useEffect(() => {
    setMounted(true);
    setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    userRoleRef.current = userRole;
    // Role이 'viewer'로 설정되었을 때
    if (userRole === 'viewer') {
      // 1. 대기 중인 offer가 있으면 즉시 처리
      if (pendingOfferRef.current && initViewerPCRef.current) {
        console.log('[WebRTC] 대기 중이던 offer를 viewer role 설정 후 즉시 처리');
        initViewerPCRef.current(pendingOfferRef.current);
        pendingOfferRef.current = null;
      }
      // 2. 모바일(broadcaster)에게 fresh offer를 즉시 요청 (liveStarted 이벤트를 놓쳤을 때 대비)
      if (socketRef.current) {
        console.log('[WebRTC] viewer 역할 선택 → broadcaster에게 offer 재요청');
        setCameraActive(false);
        socketRef.current.emit('sendMessage', { sender: '시스템_viewer', type: 'system', text: '시청자 접속' });
      }
    }
  }, [userRole]);
  
  const [cameraActive, setCameraActive] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // WebRTC & Media States for Auto-Heal Hook Dependency Tracking
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const [pcInstance, setPcInstance] = useState<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [streamInstance, setStreamInstance] = useState<MediaStream | null>(null);
  
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const initMediaRef = useRef<((qualityOverride?: string, facingOverride?: string) => Promise<void>) | null>(null);

  // Auto-Heal Diagnostics Harness
  const handleWebRTCRestart = useCallback(() => {
    if (initMediaRef.current) {
      console.log('🔄 [Harness] WebRTC ICE Restart Triggered');
      initMediaRef.current(); // Reboot pipeline
    }
  }, []);

  const handleMediaRestart = useCallback(() => {
    if (initMediaRef.current) {
      console.log('🔄 [Harness] Camera Sensor Restart Triggered');
      initMediaRef.current();
    }
  }, []);

  const { harnessState } = useAutoHealAgents({
    socket,
    peerConnection: pcInstance,
    localStream: streamInstance,
    userRole,
    onWebRTCRestartRequest: handleWebRTCRestart,
    onMediaRestartRequest: handleMediaRestart
  });
  
  
  // 녹음(STT) 상태
  const [isListening, setIsListening] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const webmChunksRef = useRef<Blob[]>([]);
  
  // 내부 코치 AI 지시사항 (Director's Cue)
  const [coachHint, setCoachHint] = useState<string | null>(null);
  const coachHintTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // TTS 보이스 온오프 기능 (기본값: OFF)
  const [isTtsEnabled, setIsTtsEnabled] = useState(false);
  const isTtsEnabledRef = useRef(false);

  // 카테고리 팝업 모달 상태
  const [isLiveStarted, setIsLiveStarted] = useState(false);
  const [selectedMainCat, setSelectedMainCat] = useState("");
  const [selectedSubCat, setSelectedSubCat] = useState("");
  const [videoQuality, setVideoQuality] = useState<string>("HD");
  const [cameraFacing, setCameraFacing] = useState<string>("user");
  const [webrtcState, setWebrtcState] = useState<string>("init");
  const [visitorCount, setVisitorCount] = useState(20);
  const [currentTime, setCurrentTime] = useState("");
  const [timelineState, setTimelineState] = useState<{state: string, elapsed: number}>({ state: 'INTRO', elapsed: 0 });
  
  // 좋아요 인터랙션 상태
  const [isLiked, setIsLiked] = useState(false);
  const [likeAnim, setLikeAnim] = useState(false);
  const [floatingHearts, setFloatingHearts] = useState<{id: number, left: number}[]>([]);

  // 뷰티/바디 AR 필터 UI 상태 (0~100)
  const [beautyParams, setBeautyParams] = useState({
    faceSize: 50, jawline: 50, skinTone: 50, smoothing: 50, eyeSize: 50, noseSize: 50, mouthSize: 50,
    shoulders: 50, waist: 50, hips: 50, legs: 50, arms: 50,
    backgroundBlur: 0,
    autoBeauty: 0 // 0 = off, 1 = on
  });

  const [showBeautyPreview, setShowBeautyPreview] = useState(false);
  const showBeautyPreviewRef = useRef(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  const openBeautyPreview = async (isSocket = false) => {
    if (showBeautyPreviewRef.current) return; // Prevent double trigger echo loop
    showBeautyPreviewRef.current = true;
    setShowBeautyPreview(true);
    arEngineInstance.setShowLandmarks(true);

    if (!isSocket && socketRef.current) {
      socketRef.current.emit('sendMessage', { sender: '시스템', type: 'system', text: 'cmd_open_ar_preview' });
    }
    
    // Connect WebRTC after UI is rendered and ref attached
    setTimeout(() => {
      if (initMediaRef.current) {
        initMediaRef.current(videoQuality, cameraFacing);
      }
    }, 200);
  };

  const closeBeautyPreview = (isSocket = false) => {
    if (!showBeautyPreviewRef.current) return;
    showBeautyPreviewRef.current = false;
    setShowBeautyPreview(false);
    arEngineInstance.setShowLandmarks(false);
    
    if (!isSocket && socketRef.current) {
      socketRef.current.emit('sendMessage', { sender: '시스템', type: 'system', text: 'cmd_close_ar_preview' });
    }
  };

  const updateBeautyParam = (key: keyof typeof beautyParams, val: number, isSocket = false) => {
    setBeautyParams(p => ({ ...p, [key]: val }));
    if (!isSocket && socketRef.current) {
      socketRef.current.emit('sendMessage', { sender: '시스템', type: 'system', text: `cmd_ar_param:${key}:${val}` });
    }
  };

  const openBeautyPreviewRef = useRef(openBeautyPreview);
  const closeBeautyPreviewRef = useRef(closeBeautyPreview);
  const updateBeautyParamRef = useRef(updateBeautyParam);
  useEffect(() => { openBeautyPreviewRef.current = openBeautyPreview; }, [openBeautyPreview]);
  useEffect(() => { closeBeautyPreviewRef.current = closeBeautyPreview; }, [closeBeautyPreview]);
  useEffect(() => { updateBeautyParamRef.current = updateBeautyParam; }, [updateBeautyParam]);

  // AR 엔진 초기화 및 상태 연동
  useEffect(() => { arEngineInstance.initialize(); }, []);
  useEffect(() => { arEngineInstance.updateParams(beautyParams); }, [beautyParams]);

  // 비디오 엘리먼트 마운트 시 자동 스트림 연결 (레이스컨디션 방지)
  useEffect(() => {
    if (remoteStream) {
      if (videoRef.current && videoRef.current.srcObject !== remoteStream) {
        videoRef.current.srcObject = remoteStream;
        videoRef.current.play().catch(e => console.warn("Video mount play error:", e));
      }
      if (previewVideoRef.current && previewVideoRef.current.srcObject !== remoteStream) {
        previewVideoRef.current.srcObject = remoteStream;
        previewVideoRef.current.play().catch(e => console.warn("Preview mount play error:", e));
      }
    } else if (localStreamRef.current) {
      // 송출자 본인의 화면인 경우
      if (videoRef.current && videoRef.current.srcObject !== localStreamRef.current) {
        videoRef.current.srcObject = localStreamRef.current;
        videoRef.current.play().catch(e => console.warn("Local video mount play error:", e));
      }
      if (previewVideoRef.current && previewVideoRef.current.srcObject !== localStreamRef.current) {
        previewVideoRef.current.srcObject = localStreamRef.current;
        previewVideoRef.current.play().catch(e => console.warn("Local preview mount play error:", e));
      }
    }
  }, [remoteStream, showBeautyPreview, isLiveStarted]);

  // Removed duplicate initMediaRef declaration here
  const liveStartTimeRef = useRef<number | null>(null);

  // 0. 현재 시간 및 동접자 시뮬레이션
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    setCurrentTime(new Date().toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLiveStarted) return;
    if (!liveStartTimeRef.current) liveStartTimeRef.current = Date.now();

    const visitorInterval = setInterval(() => {
      const elapsedSec = (Date.now() - liveStartTimeRef.current!) / 1000;
      
      setVisitorCount(prev => {
        let trend = 20;
        
        // 1. 아주 천천히 올라가는 베이스라인
        if (elapsedSec < 60) trend = 20 + (elapsedSec / 60) * 10; // 0~1분: 20~30명 점진적 상승
        else if (elapsedSec < 180) trend = 30 + ((elapsedSec - 60) / 120) * 20; // 1~3분: 30~50명
        else if (elapsedSec < 300) trend = 50 + ((elapsedSec - 180) / 120) * 30; // 3~5분: 50~80명
        else trend = 80 + Math.sin(elapsedSec / 40) * 20; // 5분 이후: 60~100명 서서히 출렁임
        
        // 2. 한참 지나서 갑자기 확 올라가거나 내려가는 랜덤 스파이크 (알고리즘 폭발)
        if (elapsedSec > 180) { // 3분 이후부터 가끔씩 발생
             // 2% 확률로 알고리즘 터져서 폭발적 유입
             if (Math.random() < 0.02) trend += 60;
             // 2% 확률로 시청자 확 빠짐
             else if (Math.random() < 0.02) trend -= 30;
        }

        const target = trend + (Math.random() * 10 - 5); // 오차범위 ±5
        
        // 3. 변동폭 아주 천천히 (가끔은 아예 안변함)
        if (Math.random() < 0.4) return prev; // 40% 확률로 동결시켜서 천천히 변하는 느낌

        const diff = target - prev;
        const step = Math.sign(diff) * (Math.floor(Math.random() * 2) + 1); // 1~2명씩만 이동
        
        return Math.max(12, Math.floor(prev + step));
      });
    }, 3000); // 3초 간격으로 대폭 늦춤

    return () => clearInterval(visitorInterval);
  }, [isLiveStarted]);

  useEffect(() => {
    // 1. 소켓 연결 (클라우드 환경에서는 외부 백엔드 URL, 로컬에서는 Proxy 경유)
    const backendUrl = process.env.NEXT_PUBLIC_SOCKET_URL || '';
    const newSocket = io(backendUrl, { path: '/socket.io' }); 
    setSocket(newSocket);
    socketRef.current = newSocket;

    const initBroadcasterPC = (stream: MediaStream, qualityStr: string) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      iceCandidateQueue.current = []; // [핵심 해결] 새 연결 시 기존 쓸모없는 ICE 후보들 깨끗이 지우기
      const iceConfig = {
        iceServers: [
          { urls: 'stun:stun.relay.metered.ca:80' },
          { urls: 'stun:stun.l.google.com:19302' }, 
          { urls: 'stun:stun1.l.google.com:19302' },
          // Metered 공식 TURN 릴레이 (사용자 실제 인증키)
          { urls: 'turn:global.relay.metered.ca:80', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
          { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
          { urls: 'turn:global.relay.metered.ca:443', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
          { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
        ],
        iceCandidatePoolSize: 10,
      };
      const pc = new RTCPeerConnection(iceConfig);
      peerConnectionRef.current = pc;
      setPcInstance(pc);

      pc.oniceconnectionstatechange = () => setWebrtcState(`Broadcaster ICE: ${pc.iceConnectionState}`);

      stream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, stream);
        
        // [Phase 10] 해상도 세팅에 맞춘 강제 비트레이트 컨트롤 (WebRTC 자동 화질 저하 방지)
        if (track.kind === 'video') {
           const parameters = sender.getParameters();
           if (!parameters.encodings) parameters.encodings = [{}];
           
           if (qualityStr === 'FHD') parameters.encodings[0].maxBitrate = 4000000;      // 4 Mbps
           else if (qualityStr === 'HD') parameters.encodings[0].maxBitrate = 2000000;  // 2 Mbps
           else parameters.encodings[0].maxBitrate = 800000;                            // 800 kbps

           sender.setParameters(parameters).catch(e => console.warn("Bitrate Set Error:", e));
        }
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) newSocket.emit('ice-candidate', e.candidate);
      };

      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => newSocket.emit('offer', pc.localDescription));
    };

    const initViewerPC = async (offer: RTCSessionDescriptionInit) => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      iceCandidateQueue.current = []; // [핵심 해결] 시청자쪽도 초기화 시 이전 쓰레기 큐 지우기
      const iceConfig = {
        iceServers: [
          { urls: 'stun:stun.relay.metered.ca:80' },
          { urls: 'stun:stun.l.google.com:19302' }, 
          { urls: 'stun:stun1.l.google.com:19302' },
          // Metered 공식 TURN 릴레이 (사용자 실제 인증키)
          { urls: 'turn:global.relay.metered.ca:80', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
          { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
          { urls: 'turn:global.relay.metered.ca:443', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
          { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '5e8dd7158aedf2587096a227', credential: 'KE8+BFkaaZc0icAQ' },
        ],
        iceCandidatePoolSize: 10,
      };
      const pc = new RTCPeerConnection(iceConfig);
      peerConnectionRef.current = pc;
      setPcInstance(pc);

      pc.oniceconnectionstatechange = () => {
        setWebrtcState(`Viewer ICE: ${pc.iceConnectionState}`);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
           // 연결 실패 시 송출자에게 새로운 화면 재요청
           setTimeout(() => newSocket.emit('sendMessage', { sender: '시스템_viewer', type: 'system', text: 'request_offer' }), 3000);
        }
      };

      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
          videoRef.current.play().catch(e => console.warn("Video play error (safe to ignore):", e));
        }
        if (previewVideoRef.current) {
          previewVideoRef.current.srcObject = event.streams[0];
          previewVideoRef.current.play().catch(e => console.warn("Preview play error:", e));
        }
        setCameraActive(true); // 통신 성공 시 UI 복구
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) newSocket.emit('ice-candidate', e.candidate);
      };

      await pc.setRemoteDescription(offer);
      // [치명적 버그 수정] 대기 중이던 ICE 후보들을 다시 넣을 때 반드시 RTCIceCandidate 객체로 감싸야 브라우저가 거부하지 않습니다.
      iceCandidateQueue.current.forEach(c => {
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.error("ICE Queue Add Error:", e));
      });
      iceCandidateQueue.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      newSocket.emit('answer', pc.localDescription);
    };

    // 2. 카메라/마이크 권한 요청 및 역할 분배
    const initMedia = async (qualityOverride?: string, facingOverride?: string) => {
      console.log(`📡 initMedia called. Role: ${userRoleRef.current}`);
      
      if (userRoleRef.current === 'viewer') {
        setCameraActive(false);
        if (socketRef.current) socketRef.current.emit('sendMessage', { sender: '시스템_viewer', type: 'system', text: '시청자 접속' });
        console.log("PC 시청자 뷰: 모바일 영상 수신 대기 중...");
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error("❌ getUserMedia is not supported in this browser (Likely HTTP instead of HTTPS)");
        alert("이 브라우저/환경에서는 카메라 호출을 지원하지 않습니다. (https 접속 필요)");
        return;
      }

      const activeQuality = qualityOverride || videoQuality;
      const activeFacing = facingOverride || cameraFacing;

      if (userRoleRef.current === 'broadcaster') {
        if (localStreamRef.current && peerConnectionRef.current) {
          peerConnectionRef.current.createOffer({ iceRestart: true })
            .then(offer => peerConnectionRef.current!.setLocalDescription(offer))
            .then(() => newSocket.emit('offer', peerConnectionRef.current!.localDescription))
            .catch(e => console.error("ICE Restart Error from initMedia:", e));
          
          if (videoRef.current && videoRef.current.srcObject !== localStreamRef.current) {
            videoRef.current.srcObject = localStreamRef.current;
          }
          if (previewVideoRef.current && previewVideoRef.current.srcObject !== localStreamRef.current) {
            previewVideoRef.current.srcObject = localStreamRef.current;
          }
          return;
        }

        try {
          const constraints: MediaTrackConstraints = { facingMode: activeFacing };
          if (activeQuality === 'SD') {
             constraints.width = { ideal: 640 }; constraints.height = { ideal: 480 }; 
          } else if (activeQuality === 'FHD') {
             constraints.width = { ideal: 1440 }; constraints.height = { ideal: 1080 }; 
          } else { 
             constraints.width = { ideal: 960 }; constraints.height = { ideal: 720 }; 
          }

          let stream: MediaStream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: true });
          } catch (hwError) {
            console.warn("고급 화질 제약조건 실패, 브라우저 기본 카메라로 폴백합니다.", hwError);
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          }
          
          // [Phase 12] MediaPipe AR 엔진에 원본 스트림 관통
          const processedStream = arEngineInstance.setupProcessingPipeline(stream);
          localStreamRef.current = processedStream; 
          setStreamInstance(processedStream);
          setRemoteStream(null); 
          
          if (videoRef.current) {
             videoRef.current.srcObject = processedStream;
             videoRef.current.play().catch(e => console.warn(e));
          }
          if (previewVideoRef.current) {
             previewVideoRef.current.srcObject = processedStream;
             previewVideoRef.current.play().catch(e => console.warn(e));
          }
          
          setCameraActive(true);
          initBroadcasterPC(processedStream, activeQuality); // 접속 즉시 방송 시작 (offer 생성)
        } catch (err: any) {
          console.error("❌ 카메라 접근 오류:", err);
          alert("카메라 접근에 실패했습니다. 권한을 확인해주세요.");
          setCameraActive(false);
        }
      }
    };
    initMediaRef.current = initMedia; // 초기화 함수를 ref에 저장 (모달에서 수동으로 시작하기 위함)

    // 2.5 라방 시작 동기화 이벤트 리스너 (PC, 모바일 동시 시작)
    newSocket.on('liveStarted', (data) => {
      setIsLiveStarted(true);
      if (data && data.quality) setVideoQuality(data.quality);
      if (data && data.facing) setCameraFacing(data.facing);
      if (initMediaRef.current) initMediaRef.current(data?.quality || 'HD', data?.facing || 'user');
    });

    // initViewerPC를 ref에 저장 (role 변경 시 대기 중 offer 처리용)
    initViewerPCRef.current = initViewerPC;

    // 3. WebRTC 시그널링 이벤트 리스너
    newSocket.on('offer', (offer) => {
      if (userRoleRef.current === 'viewer') {
        initViewerPC(offer); // 시청자 확정 → 즉시 처리
      } else if (userRoleRef.current === null) {
        // 아직 역할 미정 → offer를 임시 저장 (나중에 viewer로 설정되면 처리)
        console.log('[WebRTC] offer 수신했으나 role 미정 → 임시 저장');
        pendingOfferRef.current = offer;
      }
      // broadcaster는 자기 offer를 돌려받을 일이 없으므로 무시
    });

    newSocket.on('answer', async (answer) => {
      if (peerConnectionRef.current && userRoleRef.current === 'broadcaster') {
        if (peerConnectionRef.current.signalingState === 'have-local-offer') {
          await peerConnectionRef.current.setRemoteDescription(answer).catch(e => console.error(e));
          iceCandidateQueue.current.forEach(c => {
             peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(c)).catch(e => console.error("Mobile ICE Queue Add Error:", e));
          });
          iceCandidateQueue.current = [];
        }
      }
    });

    newSocket.on('ice-candidate', async (candidate) => {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
      } else {
        iceCandidateQueue.current.push(candidate);
      }
    });

    // 4. 채팅 및 보이스 재생 이벤트
    newSocket.on("receiveMessage", (data: any) => {
      // 신규 시청자가 접속하거나 새로고침("다시 접근")하여 화면을 요청할 때
      if (data.sender === '시스템_viewer' && userRoleRef.current === 'broadcaster') {
        if (localStreamRef.current) {
          // [핵심 문제 해결 (제1법칙)] PC는 완전 새 RTCPeerConnection을 만드는데,
          // 모바일 쪽에서 기존 RTCPeerConnection을 재사용(iceRestart)하면 상태 불일치(Mismatch) 붕괴 발생!
          // 해결책: 시청자가 접속하면 모바일 쪽도 연결을 완전히 파괴하고 깨끗한 리셋(initBroadcasterPC) 수행.
          console.log('[WebRTC] 시청자 접속 감지 - 방송자쪽 WebRTC 연결 완전 초기화(Reset) 및 새 Offer 발송');
          initBroadcasterPC(localStreamRef.current, videoQuality);
        }
        return;
      }
      if (data.sender === '시스템_viewer') return; // UI 숨김 처리

      if (data.type === 'system') {
        if (data.text === 'cmd_open_ar_preview') { openBeautyPreviewRef.current(true); return; }
        if (data.text === 'cmd_close_ar_preview') { closeBeautyPreviewRef.current(true); return; }
        if (data.text && data.text.startsWith('cmd_ar_param:')) {
           const parts = data.text.split(':');
           if (parts.length === 3) updateBeautyParamRef.current(parts[1] as any, parseInt(parts[2]), true);
           return;
        }
      }

      setMessages((prev) => {
        const existingMessageIndex = prev.findIndex(msg => msg.id === data.id);
        
        // 이미 생성된 봇의 메시지가 스트리밍으로 덮어씌워질 때
        if (existingMessageIndex !== -1) {
          const updatedMessages = [...prev];
          updatedMessages[existingMessageIndex] = {
            ...updatedMessages[existingMessageIndex],
            text: data.text,
            isStreaming: data.isStreaming
          };
          return updatedMessages;
        }
        
        // 완전 새로운 글일 때
        const newMsg: ChatMessage = {
          id: data.id || Date.now().toString() + Math.random().toString(),
          sender: data.sender || "유저",
          type: data.type || "viewer",
          text: data.text,
          color: data.color || "text-white",
          isStreaming: data.isStreaming,
        };
        return [...prev, newMsg];
      });
    });

    newSocket.on("removeMessage", (data: { id: string }) => {
      setMessages(prev => prev.filter(msg => msg.id !== data.id));
    });

    const playNextAudio = () => {
      if (isPlayingRef.current || audioQueueRef.current.length === 0) return;
      
      isPlayingRef.current = true;
      const base64 = audioQueueRef.current.shift();
      if (base64) {
        const audio = new Audio("data:audio/mp3;base64," + base64);
        audio.onended = () => {
          isPlayingRef.current = false;
          playNextAudio();
        };
        audio.play().catch(e => {
          console.error("Audio playback error:", e);
          isPlayingRef.current = false;
          playNextAudio();
        });
      }
    };

    // TTS 음성 재생 요청
    newSocket.on('playAudio', (data: { audioBase64: string }) => {
      // TTS 기능이 꺼져있으면 큐에 넣지 않고 무시
      if (!isTtsEnabledRef.current) return;
      
      // 오디오 큐에 추가
      audioQueueRef.current.push(data.audioBase64);
      // 현재 재생 중이 아니면 재생 시작
      if (!isPlayingRef.current) {
        playNextAudio();
      }
    });
    
    // 내부 코치 UI 수신
    newSocket.on('coachHint', (data: { text: string }) => {
      setCoachHint(data.text);
      if (coachHintTimerRef.current) clearTimeout(coachHintTimerRef.current);
      coachHintTimerRef.current = setTimeout(() => {
        setCoachHint(null);
      }, 7000); // 7초 뒤 자동 소멸
    });

    // 타임라인 업데이트 수신
    newSocket.on('timelineUpdate', (data: { state: string, elapsed: number }) => {
      setTimelineState(data);
    });

    return () => {
      newSocket.off("offer");
      newSocket.off("answer");
      newSocket.off("ice-candidate");
      newSocket.off("receiveMessage");
      newSocket.off("playAudio");
      newSocket.off("removeMessage"); // Add cleanup for removeMessage
      newSocket.off("coachHint"); // Add cleanup for coachHint
      newSocket.off("timelineUpdate");
      newSocket.disconnect();
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (coachHintTimerRef.current) clearTimeout(coachHintTimerRef.current); // Clear timer on unmount
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const showError = (msg: string) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString() + Math.random(),
      sender: "시스템",
      type: "persona",
      text: "🚨 " + msg,
      color: "text-red-400"
    }]);
  };

  const toggleMic = () => {
    try {
      if (!localStreamRef.current) {
        showError("카메라/마이크 권한이 승인되지 않았습니다. 권한을 허용해주세요!");
        return;
      }
      
      const newState = !isListening;
      
      if (newState) {
        // 녹음 시작 모드
        if (!window.MediaRecorder) {
          showError("현재 기기(브라우저)는 오디오 녹음을 지원하지 않습니다.");
          return;
        }

        webmChunksRef.current = [];
        
        // 치명적 버그 수정: 비디오+오디오 전체 스트림을 녹음하면 용량 폭발(Socket.io 한계 초과)로 인해 서버 묵살됨.
        // 오직 오디오 트랙만 분리하여 초경량 스트림으로 녹음합니다!
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (!audioTrack) {
          showError("마이크 오디오 트랙을 찾을 수 없습니다.");
          return;
        }
        const audioOnlyStream = new MediaStream([audioTrack]);
        
        let recorder: MediaRecorder;
        try {
          let options: MediaRecorderOptions | undefined;
          const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg', 'video/webm'];
          for (const t of types) {
            if (MediaRecorder.isTypeSupported(t)) {
              options = { mimeType: t };
              break;
            }
          }
          recorder = new MediaRecorder(audioOnlyStream, options);
        } catch (e1) {
          try {
            recorder = new MediaRecorder(audioOnlyStream);
          } catch (e2) {
            showError("모듈 초기화 실패: " + (e2 as Error).message);
            return;
          }
        }
        
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) webmChunksRef.current.push(e.data);
        };
        
        recorder.onerror = (e: any) => {
          showError("백그라운드 녹음 에러: " + (e.error ? e.error.message : e));
          setIsListening(false);
        };
        
        recorder.onstop = () => {
          if (webmChunksRef.current.length === 0) {
            showError("녹음 실패: 오디오 데이터가 0 바이트입니다.");
            setIsListening(false);
            return;
          }
          
          const blob = new Blob(webmChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = () => {
            const base64data = reader.result?.toString().split(',')[1];
            if (base64data && socket) {
              socket.emit('transcribeAudio', { audioBase64: base64data, mimeType: recorder.mimeType || 'video/webm' });
              setMessages(prev => [...prev.filter(msg => msg.id !== 'stt_loading'), {
                id: 'stt_loading',
                sender: "시스템",
                type: "system",
                text: "음성 인식 중...",
                color: "text-gray-400"
              }]);
            }
          };
        };
        
        try {
          recorder.start(); // 강제 분할(Timeslice) 기능을 제거하여 어떤 안드로이드 기기든 호환되게 함
        } catch (err) {
          showError("녹음 엔진 시작 불가: " + (err as Error).message);
          return;
        }
        
        mediaRecorderRef.current = recorder;
        setIsListening(true); // 성공적으로 구동되었을 때만 UI 버튼 색상을 변경!
      } else {
        // 녹음 종료 모드
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          try {
            mediaRecorderRef.current.stop();
          } catch (fatalStopErr) {
            showError((fatalStopErr as Error).message);
          }
        }
        setIsListening(false);
      }
    } catch (unexpectedErr) {
      showError("치명적 앱 에러 발생: " + (unexpectedErr as Error).message);
      setIsListening(false);
    }
  };

  const handleSendMessage = (e?: FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || !socket) return;
    
    socket.emit("sendMessage", {
      sender: "나",
      type: "viewer",
      text: inputText,
      color: "text-yellow-200"
    });
    
    setInputText("");
  };

  const handleAdminTrigger = (eventType: string) => {
    if (socket) socket.emit('triggerAdminEvent', { eventType });
  };

  const handleStartLive = () => {
    if (!selectedMainCat || !selectedSubCat) {
      alert("상품 카테고리를 모두 선택해주세요.");
      return;
    }
    arEngineInstance.setShowLandmarks(false);
    const fullCategory = `${selectedMainCat} > ${selectedSubCat}`;
    if (socketRef.current) socketRef.current.emit('setCategory', { category: fullCategory, quality: videoQuality, facing: cameraFacing }); // 백엔드에 전송
    setIsLiveStarted(true);
  };

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLiked(true);
    setLikeAnim(true);
    setTimeout(() => setLikeAnim(false), 300);

    const newHeart = { id: Date.now(), left: Math.random() * 40 - 20 };
    setFloatingHearts(prev => [...prev, newHeart]);
    setTimeout(() => {
      setFloatingHearts(prev => prev.filter(h => h.id !== newHeart.id));
    }, 2000);
  };

  if (!mounted) return <div className="flex h-screen w-full items-center justify-center bg-gray-950" />;

  if (!isLiveStarted) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-gray-950 font-sans p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-[2rem] p-8 shadow-2xl flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-500">
          {userRole === null ? (
            <div className="flex flex-col items-center justify-center py-6 gap-6">
              <h1 className="text-2xl font-bold text-white text-center tracking-tight">당신의 역할을 선택하세요</h1>
              <p className="text-zinc-400 text-sm text-center leading-relaxed">
                모바일 기기는 가급적 <span className="text-pink-400 font-bold">방송하기</span>를,<br/>
                PC 환경은 <span className="text-blue-400 font-bold">시청하기</span>를 권장합니다.
              </p>
              <div className="flex flex-col gap-4 w-full mt-4">
                <button 
                  onClick={() => setUserRole('broadcaster')}
                  className="w-full py-5 rounded-xl font-bold text-lg bg-pink-600 hover:bg-pink-500 text-white shadow-lg transition-transform hover:-translate-y-1"
                >
                  📱 방송하기 (Broadcaster)
                </button>
                <button 
                  onClick={async () => {
                    setUserRole('viewer');
                    setIsLiveStarted(true);
                    if (initMediaRef.current) await initMediaRef.current();
                  }}
                  className="w-full py-5 rounded-xl font-bold text-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-transform hover:-translate-y-1"
                >
                  💻 시청하기 (Viewer)
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-white text-center tracking-tight">🎥 라이브 방송 준비</h1>
              <p className="text-zinc-400 text-sm text-center leading-relaxed">
                오늘 판매할 상품의 카테고리를 선택해주세요.<br/>
                선택하신 상품 정보에 맞춰 50명의 AI 봇이<br/>
                생동감 넘치는 반응과 질문을 쏟아냅니다.
              </p>
              
              <div className="flex flex-col gap-5 mt-2">
                <div>
                  <label className="block text-zinc-300 text-sm font-semibold mb-2">1차 카테고리 (대분류)</label>
                  <select 
                    className="w-full bg-zinc-800 text-white rounded-xl p-3.5 outline-none border border-zinc-700 focus:border-pink-500 font-medium transition-colors"
                    value={selectedMainCat}
                    onChange={(e) => {
                      setSelectedMainCat(e.target.value);
                      setSelectedSubCat("");
                    }}
                  >
                    <option value="" disabled>대분류를 선택하세요</option>
                    {Object.keys(PRODUCT_CATEGORIES).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                {selectedMainCat && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="block text-zinc-300 text-sm font-semibold mb-2">2차 카테고리 (소분류)</label>
                    <select 
                      className="w-full bg-zinc-800 text-white rounded-xl p-3.5 outline-none border border-zinc-700 focus:border-pink-500 font-medium transition-colors"
                      value={selectedSubCat}
                      onChange={(e) => setSelectedSubCat(e.target.value)}
                    >
                      <option value="" disabled>소분류를 선택하세요</option>
                      {PRODUCT_CATEGORIES[selectedMainCat].map(sub => (
                        <option key={sub} value={sub}>{sub}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="animate-in fade-in slide-in-from-top-2 duration-300 delay-150">
                  <label className="block text-zinc-300 text-sm font-semibold mb-2">송출 화질 설정</label>
                  <select 
                    className="w-full bg-zinc-800 text-white rounded-xl p-3.5 outline-none border border-zinc-700 focus:border-pink-500 font-medium transition-colors"
                    value={videoQuality}
                    onChange={(e) => setVideoQuality(e.target.value)}
                  >
                    <option value="SD">SD (480p) - 데이터 절약 모드</option>
                    <option value="HD">HD (720p) - 권장 밸런스</option>
                    <option value="FHD">FHD (1080p) - 선명한 해상도 (크롭 없음)</option>
                  </select>
                </div>

                <div className="animate-in fade-in slide-in-from-top-2 duration-300 delay-200">
                  <label className="block text-zinc-300 text-sm font-semibold mb-2">카메라 방향 및 거리</label>
                  <select 
                    className="w-full bg-zinc-800 text-white rounded-xl p-3.5 outline-none border border-zinc-700 focus:border-pink-500 font-medium transition-colors"
                    value={cameraFacing}
                    onChange={(e) => setCameraFacing(e.target.value)}
                  >
                    <option value="user">전면 카메라 (셀카 모드)</option>
                    <option value="environment">후면 카메라 (광각 확보용)</option>
                  </select>
                  <p className="text-xs text-pink-400 mt-2 font-medium bg-pink-500/10 p-2 rounded-lg border border-pink-500/20">
                    💡 쾌적한 화각을 위해 <span className="font-bold">카메라와 1m ~ 1.5m 간격</span>을 두는 것이 권장 세팅입니다. (방송 시작 후 화면 비율 9:16 꽉참 적용)
                  </p>
                </div>

                <div className="animate-in fade-in slide-in-from-top-2 duration-300 delay-300">
                  <button 
                    onClick={() => openBeautyPreview()}
                    className="w-full bg-gradient-to-r from-purple-600/20 to-pink-600/20 hover:from-purple-600/30 hover:to-pink-600/30 border border-purple-500/30 text-white rounded-xl p-4 font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg group"
                  >
                    <Wand2 size={20} className="text-purple-400 group-hover:animate-pulse" /> 
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-pink-400">
                      ✨ AR 모델링 (체형/얼굴) 커스텀 조정
                    </span>
                  </button>
                </div>
              </div>

              <button 
                className={`w-full py-4 rounded-xl font-bold text-lg mt-2 transition-all duration-300 ${(!selectedMainCat || !selectedSubCat) ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-pink-600 hover:bg-pink-500 text-white shadow-[0_0_20px_rgba(219,39,119,0.4)] hover:shadow-[0_0_25px_rgba(219,39,119,0.6)] transform hover:-translate-y-0.5'}`}
                onClick={handleStartLive}
                disabled={!selectedMainCat || !selectedSubCat}
              >
                방송 시작하기 (Start Live)
              </button>
            </>
          )}
        </div>

        {/* AR Beauty Preview Fullscreen Modal */}
        {showBeautyPreview && (
          <div className="fixed inset-0 z-[200] bg-black animate-in fade-in duration-300 flex items-center justify-center overflow-hidden">
            
            {/* 시뮬레이터와 동일한 9:16 비율 화면 */}
            <div className="relative w-full h-full sm:max-w-[500px] sm:h-[90vh] sm:rounded-[2.5rem] sm:border-[12px] sm:border-zinc-800 shadow-2xl bg-zinc-950 flex flex-col overflow-hidden">
              
              <video 
                ref={previewVideoRef} 
                autoPlay playsInline muted 
                className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
              />
              
              <div className="absolute top-6 left-6 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-2 z-10 w-fit">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-bold tracking-wider">AR 실시간 뷰 (9:16)</span>
              </div>

              {/* 우측 1/3 AR 미세조정 탭 바짝 붙이기 */}
              <div className="absolute right-0 top-0 bottom-0 w-[120px] bg-zinc-900/80 backdrop-blur-md border-l border-zinc-700/50 flex flex-col z-20">
                <div className="p-3 border-b border-zinc-800 flex items-center justify-center bg-zinc-900/95 shrink-0">
                  <Wand2 size={12} className="text-purple-400 mr-1" />
                  <h2 className="text-white text-[10px] font-bold">AR 미세조정</h2>
                </div>

                <div className="flex-1 overflow-y-auto p-2 scrollbar-hide flex flex-col gap-4">
                  {/* Auto Beauty Checkbox */}
                  <div className="flex items-center gap-2 py-2 px-1 bg-gradient-to-r from-pink-500/10 to-purple-500/10 rounded-lg border border-pink-500/20">
                    <input 
                      type="checkbox" 
                      id="autoBeauty"
                      checked={beautyParams.autoBeauty === 1}
                      onChange={(e) => updateBeautyParam('autoBeauty' as any, e.target.checked ? 1 : 0)}
                      className="w-3.5 h-3.5 accent-pink-500 cursor-pointer rounded"
                    />
                    <label htmlFor="autoBeauty" className="text-[9px] text-pink-300 font-bold cursor-pointer select-none">✨ 자동 보정</label>
                  </div>

                  {/* Face Section */}
                  <div className="space-y-3">
                    <h3 className="text-pink-400 text-[9px] font-bold border-b border-zinc-800 pb-1 text-center">얼굴</h3>
                    {[
                      { id: 'faceSize', label: '얼굴 크기' }, { id: 'jawline', label: '턱선' }, { id: 'skinTone', label: '피부 톤' },
                      { id: 'smoothing', label: '뾰샤시' },
                      { id: 'eyeSize', label: '눈 크기' }, { id: 'noseSize', label: '코 크기' }, { id: 'mouthSize', label: '입술 볼륨' }
                    ].map(item => (
                      <div key={item.id} className="flex flex-col gap-1 items-center w-full">
                        <span className="text-[9px] text-zinc-300 font-medium">{item.label}</span>
                        <input 
                          type="range" min="0" max="100" 
                          value={beautyParams[item.id as keyof typeof beautyParams]}
                          onChange={(e) => updateBeautyParam(item.id as keyof typeof beautyParams, parseInt(e.target.value))}
                          className="w-full h-1 bg-zinc-700/50 rounded-full appearance-none outline-none accent-pink-500 cursor-pointer"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Background / Lens Section */}
                  <div className="space-y-3 pt-2">
                    <h3 className="text-blue-400 text-[9px] font-bold border-b border-zinc-800 pb-1 text-center">렌즈 효과</h3>
                    {[
                      { id: 'backgroundBlur', label: '배경 아웃포커스' }
                    ].map(item => (
                      <div key={item.id} className="flex flex-col gap-1 items-center w-full">
                        <span className="text-[9px] text-zinc-300 font-medium">{item.label}</span>
                        <input 
                          type="range" min="0" max="100" 
                          value={beautyParams[item.id as keyof typeof beautyParams]}
                          onChange={(e) => updateBeautyParam(item.id as keyof typeof beautyParams, parseInt(e.target.value))}
                          className="w-full h-1 bg-zinc-700/50 rounded-full appearance-none outline-none accent-blue-500 cursor-pointer"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Body Section */}
                  <div className="space-y-3 pt-2">
                    <h3 className="text-purple-400 text-[9px] font-bold border-b border-zinc-800 pb-1 text-center">체형</h3>
                    {[
                      { id: 'shoulders', label: '어깨 라인' }, { id: 'waist', label: '허리 라인' }, { id: 'hips', label: '힙 볼륨' },
                      { id: 'legs', label: '다리 얇게' }, { id: 'arms', label: '팔 얇게' }
                    ].map(item => (
                      <div key={item.id} className="flex flex-col gap-1 items-center w-full">
                        <span className="text-[9px] text-zinc-300 font-medium">{item.label}</span>
                        <input 
                          type="range" min="0" max="100" 
                          value={beautyParams[item.id as keyof typeof beautyParams]}
                          onChange={(e) => updateBeautyParam(item.id as keyof typeof beautyParams, parseInt(e.target.value))}
                          className="w-full h-1 bg-zinc-700/50 rounded-full appearance-none outline-none accent-purple-500 cursor-pointer"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="p-2 border-t border-zinc-800 bg-zinc-900 flex flex-col gap-2 shrink-0">
                  <button 
                    onClick={() => closeBeautyPreview()}
                    className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-[10px] font-bold shadow-[0_0_15px_rgba(147,51,234,0.3)] transition-colors"
                  >
                    OK (적용)
                  </button>
                  <button 
                    onClick={() => closeBeautyPreview()}
                    className="w-full py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg text-[9px] font-bold transition-colors"
                  >
                    초기 화면으로
                  </button>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-950 font-sans">
      {/* 9:16 Mobile Simulator Container */}
      <main className="relative flex h-full w-full max-w-[500px] flex-col overflow-hidden bg-zinc-900 text-white sm:h-[90vh] sm:rounded-[2.5rem] sm:border-[12px] sm:border-zinc-800 sm:shadow-2xl">
        
        {/* Agent Diagnostics Panel */}
        <div className="absolute top-4 left-4 z-[100] bg-black/60 backdrop-blur-md rounded-xl p-3 border border-pink-500/30 shadow-[0_0_15px_rgba(236,72,153,0.2)] flex flex-col gap-2 w-48 transition-all hover:bg-black/80 pointer-events-none">
          <div className="flex items-center gap-2 border-b border-pink-500/30 pb-2 mb-1">
            <span className="animate-pulse">🤖</span>
            <span className="text-[10px] font-bold text-pink-400 tracking-wider">에이전트 감시망</span>
          </div>
          
          <div className="flex flex-col gap-1.5 text-[9px]">
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">📡 통신망</span>
              <span className={`font-bold ${harnessState.socketAgent.status === 'healthy' ? 'text-green-400' : 'text-red-400 animate-pulse'}`}>
                {harnessState.socketAgent.status === 'healthy' ? '🟢 연결됨' : '🔴 복구 중...'}
              </span>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-zinc-400">🎥 미디어 센서</span>
              <span className={`font-bold ${harnessState.mediaAgent.status === 'healthy' ? 'text-green-400' : harnessState.mediaAgent.status === 'warning' ? 'text-yellow-400' : 'text-red-400 animate-pulse'}`}>
                {harnessState.mediaAgent.status === 'healthy' ? '🟢 정상' : harnessState.mediaAgent.status === 'warning' ? '🟡 대기중' : '🔴 리셋가동'}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-zinc-400">⚡ P2P 터널</span>
              <span className={`font-bold ${harnessState.webrtcAgent.status === 'healthy' ? 'text-green-400' : harnessState.webrtcAgent.status === 'warning' ? 'text-yellow-400' : 'text-red-400 animate-pulse'}`}>
                {harnessState.webrtcAgent.status === 'healthy' ? '🟢 정상' : harnessState.webrtcAgent.status === 'warning' ? '🟡 협상중' : '🔴 Restart 🚀'}
              </span>
            </div>
          </div>
          
          <div className="mt-1 pt-2 border-t border-zinc-700/50">
            <p className="text-[8px] text-zinc-500 leading-tight">단절 탐지 시 1초 내 즉각 우회 복구합니다.</p>
          </div>
        </div>

        {/* Background / Real Webcam Video Stream */}
        <div className="absolute inset-0 z-0 bg-black flex flex-col items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`h-full w-full object-cover transition-opacity duration-500 ${cameraActive ? 'opacity-90' : 'opacity-0'}`}
          />
          {!cameraActive && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 border border-zinc-800">
              <CameraOff size={56} className="mb-4 opacity-50" />
              <p className="text-sm font-medium">카메라가 연결되어 있지 않습니다</p>
              <p className="text-xs opacity-70 mt-1">웹캠이 없는 기기(PC)입니다</p>
            </div>
          )}
        </div>

        {/* Top Overlay: Stats & Controls */}
        <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/80 to-transparent z-10 
          pointer-events-none flex justify-between px-4 pt-10">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-sm backdrop-blur-md">
              <User size={14} className="text-pink-400" />
              <span className="font-semibold text-white">{visitorCount.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-red-500/80 px-3 py-1.5 text-sm backdrop-blur-md animate-pulse">
              <span className="h-2 w-2 rounded-full bg-white"></span>
              <span className="tracking-wider text-white font-bold">LIVE</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-full bg-black/40 px-3 py-1.5 font-mono text-sm text-white/90 backdrop-blur-md">
              <Clock size={14} />
              {currentTime || "00:00:00"}
            </div>
          </div>
        </div>

        {/* 디버그용 WebRTC 연결 상태 표시자 (작게 좌측상단에 표기) */}
        {webrtcState !== 'connected' && (
          <div className="absolute top-2 left-2 z-[9999] text-[10px] text-green-400 bg-black bg-opacity-50 px-2 py-1 rounded">
            {webrtcState}
          </div>
        )}

        {/* Director's Coach Hint Overlay (Teleprompter) */}
        {coachHint && (
          <div className="absolute top-28 left-1/2 -translate-x-1/2 w-[92%] max-w-[500px] z-50 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="bg-red-800/95 backdrop-blur-xl border-2 border-red-500 rounded-2xl p-4 shadow-[0_0_40px_rgba(239,68,68,0.6)]">
              <div className="flex items-center gap-2 mb-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-red-300 animate-pulse"></span>
                <p className="text-red-200 text-xs font-black tracking-widest">DIRECTOR'S CUE (내부 코치)</p>
              </div>
              <p className="text-white font-extrabold text-[1.1rem] leading-snug break-keep">
                "{coachHint}"
              </p>
            </div>
          </div>
        )}

        {/* Full-screen Tap-to-Stop Overlay (Moved outside pointer-events-none parent) */}
        {isListening && (
          <div 
            className="fixed inset-0 z-[60] bg-transparent cursor-pointer pointer-events-auto"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleMic();
            }}
          />
        )}

        {/* Middle Spacer (추후 상품 팝업, 내부 코치 힌트 표시 영역) */}
        <div className="relative z-10 flex flex-1 flex-col justify-end px-4 py-2 pointer-events-none">
          {/* Action Buttons (Right side) */}
          <div className="absolute bottom-20 right-4 flex flex-col gap-4 z-[70] pointer-events-auto">
            {/* TTS On/Off Toggle Button */}
            <button 
              onClick={() => {
                const newState = !isTtsEnabled;
                setIsTtsEnabled(newState);
                isTtsEnabledRef.current = newState;
              }}
              className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition active:scale-95 ${
                isTtsEnabled ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700'
              }`}
            >
              {isTtsEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
            </button>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                toggleMic();
              }}
              className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition active:scale-95 ${
                isListening ? 'bg-blue-500/80 text-white animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'bg-white/20 text-white hover:bg-white/30'
              }`}
            >
              {isListening ? <Mic size={24} /> : <MicOff size={24} />}
            </button>
            <button className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-md transition hover:bg-white/30 active:scale-95">
              <Pin size={24} className="text-white" />
            </button>
            <button className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-500/20 backdrop-blur-md transition hover:bg-yellow-500/30 active:scale-95">
              <Gift size={24} className="text-yellow-400" />
            </button>
            <button 
              onClick={handleLike}
              className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition active:scale-95 ${isLiked ? 'bg-pink-500/20' : 'bg-white/20 hover:bg-white/30'}`}
            >
              <Heart
                size={24}
                className={`transition-all duration-300 ${isLiked ? 'fill-pink-500 text-pink-500' : 'text-white'} ${likeAnim ? 'scale-150 animate-pulse' : 'scale-100'}`}
              />
            </button>
          </div>

          {/* Floating Particle Hearts */}
          {floatingHearts.map(heart => (
            <div
              key={heart.id}
              className="absolute bottom-28 right-6 z-[80] pointer-events-none animate-float-heart text-pink-500"
              style={{ marginLeft: `${heart.left}px` }}
            >
              <Heart size={28} className="fill-pink-500" />
            </div>
          ))}

          {/* Interim STT Transcript Subtitles */}
          {isListening && (
            <div className="absolute bottom-60 left-1/2 -translate-x-1/2 w-[85%] rounded-2xl bg-black/80 px-4 py-3 text-center text-sm font-semibold leading-relaxed text-yellow-300 backdrop-blur-md z-[70] border border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.3)] pointer-events-none animate-pulse">
              <Mic className="inline-block mr-2 mb-0.5 text-red-500 animate-bounce" size={16} />
              🔴 녹음 중입니다...<br/>
              <span className="text-white/70 text-xs mt-1 block tracking-wider">아무 곳이나 터치하면 녹음이 종료됩니다</span>
            </div>
          )}

          {/* Chat Area (Left side) */}
          <div className="scrollbar-hide mb-4 flex max-h-[390px] w-[85%] flex-col gap-3 overflow-y-auto pr-4 pointer-events-auto">
            {messages.map((msg) => (
              <div key={msg.id} className="flex flex-col items-start gap-1">
                {msg.type === "newUser" && (
                  <span className="rounded-full bg-black/40 px-2 py-0.5 text-xs text-white/60">
                    {msg.sender === '시스템' ? msg.text : `${msg.sender} 님이 입장하셨습니다`}
                  </span>
                )}
                {msg.type !== "newUser" && (
                  <div className="rounded-2xl rounded-tl-sm bg-black/20 px-3 py-2 text-sm text-white backdrop-blur-sm border border-white/5 shadow-sm">
                    <span className={`mr-2 font-semibold ${msg.color || "text-gray-300"}`}>
                      {msg.sender}
                    </span>
                    <span>{msg.text}</span>
                    {msg.isStreaming && <span className="ml-0.5 animate-pulse text-gray-400">|</span>}
                  </div>
                )}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
        </div>

        {/* Bottom Input Area */}
        <div className="relative z-10 w-full bg-gradient-to-t from-black/80 to-transparent p-4 pb-6">
          <form 
            onSubmit={handleSendMessage}
            className="flex items-center gap-2 rounded-full border border-white/20 bg-black/40 px-4 py-2 backdrop-blur-md transition-all focus-within:border-white/40 focus-within:bg-black/60"
          >
            <input 
              type="text" 
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="시청자로서 채팅 남기기..." 
              className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/50"
            />
            <button 
              type="submit"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-pink-500 text-white transition hover:bg-pink-600"
            >
              <Send size={14} className="ml-0.5" />
            </button>
          </form>
        </div>

        {/* Floating End Broadcast Button at very bottom right */}
        <div className="absolute bottom-20 right-4 z-[99] pointer-events-auto">
          <button 
            onClick={() => window.location.reload()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600/90 text-white shadow-lg backdrop-blur-md transition hover:bg-red-500 active:scale-95 group"
          >
            <X size={20} strokeWidth={2.5} />
            <span className="absolute -top-6 bg-black/60 text-white text-[10px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">방송 종료</span>
          </button>
        </div>

      </main>

      {/* PC Admin Control Panel (Visible only on non-mobile viewers after live starts) */}
      {!cameraActive && isLiveStarted && (
        <aside className="hidden lg:flex w-[340px] h-[90vh] ml-6 flex-col bg-zinc-900 rounded-[2.5rem] border-[8px] border-zinc-800 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-right-8 duration-500">
          <div className="bg-gradient-to-r from-red-600 to-pink-600 p-4 shrink-0 flex items-center justify-between">
            <h2 className="text-white font-black tracking-tight text-lg">📡 ADMIN PANEL</h2>
            <div className="bg-black/30 px-2 py-1 rounded text-xs font-bold text-white tracking-widest animate-pulse">
              {timelineState.state}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-5 pb-8 flex flex-col gap-6 scrollbar-hide">
            
            <section className="flex flex-col gap-2">
              <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">방송 타임라인 현황</h3>
              <div className="bg-black/50 p-4 rounded-xl border border-zinc-800 flex flex-col gap-3 relative overflow-hidden">
                <div className="flex justify-between items-center z-10">
                  <span className="text-zinc-300 text-sm font-semibold">경과 시간</span>
                  <span className="text-white font-mono">{Math.floor(timelineState.elapsed / 60)}분 {timelineState.elapsed % 60}초</span>
                </div>
                
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden z-10 mt-1">
                  <div 
                    className="bg-gradient-to-r from-pink-500 to-purple-500 h-full transition-all duration-1000" 
                    style={{ width: `${Math.min(100, (timelineState.elapsed / 300) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-bold text-zinc-500 z-10 mt-1">
                  <span className={timelineState.state === 'INTRO' ? 'text-pink-400' : ''}>도입</span>
                  <span className={timelineState.state === 'MID' ? 'text-pink-400' : ''}>설명</span>
                  <span className={timelineState.state === 'CLIMAX' ? 'text-pink-400' : ''}>절정</span>
                  <span className={timelineState.state === 'CLOSING' ? 'text-pink-400' : ''}>종료</span>
                </div>
              </div>
            </section>

            <section className="flex flex-col gap-3 mt-2">
              <h3 className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1 border-b border-zinc-800 pb-2">🚨 특수 시뮬레이션 이벤트 발동</h3>
              
              <button 
                onClick={() => handleAdminTrigger('massive_buy')}
                className="w-full bg-gradient-to-r from-green-600/20 to-emerald-600/20 hover:from-green-600/30 hover:to-emerald-600/30 border border-green-500/30 text-white rounded-xl p-4 font-bold flex flex-col items-start gap-1 transition-all active:scale-95 shadow-lg group relative overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">🛒</span>
                  <span className="text-green-400">주문 폭주 트리거</span>
                </div>
                <span className="text-[10px] text-green-200/50 font-normal break-keep text-left mt-1">충성 고객들이 대량 구매 인증을 도배합니다.</span>
              </button>

              <button 
                onClick={() => handleAdminTrigger('haters_attack')}
                className="w-full bg-gradient-to-r from-red-600/20 to-rose-600/20 hover:from-red-600/30 hover:to-rose-600/30 border border-red-500/30 text-white rounded-xl p-4 font-bold flex flex-col items-start gap-1 transition-all active:scale-95 shadow-lg group relative overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">👿</span>
                  <span className="text-red-400">악플 공격 개시</span>
                </div>
                <span className="text-[10px] text-red-200/50 font-normal break-keep text-left mt-1">안티팬들이 비싼 가격이나 품질을 비난합니다.</span>
              </button>

              <button 
                onClick={() => handleAdminTrigger('competitor_mention')}
                className="w-full bg-gradient-to-r from-orange-600/20 to-yellow-600/20 hover:from-orange-600/30 hover:to-yellow-600/30 border border-orange-500/30 text-white rounded-xl p-4 font-bold flex flex-col items-start gap-1 transition-all active:scale-95 shadow-lg group relative overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚔️</span>
                  <span className="text-orange-400">경쟁 플랫폼 언급</span>
                </div>
                <span className="text-[10px] text-orange-200/50 font-normal break-keep text-left mt-1">다른 방송이나 플랫폼 가격 비교 태클을 넣습니다.</span>
              </button>

              <button 
                onClick={() => handleAdminTrigger('random_question')}
                className="w-full bg-gradient-to-r from-blue-600/20 to-cyan-600/20 hover:from-blue-600/30 hover:to-cyan-600/30 border border-blue-500/30 text-white rounded-xl p-4 font-bold flex flex-col items-start gap-1 transition-all active:scale-95 shadow-lg group relative overflow-hidden"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">❓</span>
                  <span className="text-blue-400">디테일 돌발 질문</span>
                </div>
                <span className="text-[10px] text-blue-200/50 font-normal break-keep text-left mt-1">사소하고 날카로운 상품 스펙 질문을 던집니다.</span>
              </button>

            </section>
            
          </div>
        </aside>
      )}
    </div>
  );
}
