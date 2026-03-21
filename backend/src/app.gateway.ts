import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AiService } from './ai/ai.service';
import { Persona, VIEWER_PERSONAS_50 } from './ai/personas.data';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class AppGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  private autonomousTimer: NodeJS.Timeout;
  private lastHostActivityTime: number = Date.now();
  private currentProductContext: string = "지정된 카테고리가 없습니다."; 
  
  // 페르소나 50인의 개별 심리 상태 (관심도, 신뢰도)
  private personaStates = new Map<string, { interest: number, trust: number }>();
  
  // 타임라인 상태 (Phase 3 기능)
  private timelineState: 'INTRO' | 'MID' | 'CLIMAX' | 'CLOSING' = 'INTRO';
  private liveStartTime: number = 0;
  private timelineTimer: NodeJS.Timeout | null = null;

  // 라방 전체 채팅 내역 (컨텍스트 유지용, 최근 15개 유지)
  private roomChatHistory: string[] = [];

  constructor(private readonly aiService: AiService) {}

  afterInit(server: Server) {
    // 호스트의 발언에만 반응하도록 돌발 질문(SpontaneousChat) 타이머를 완전히 제거했습니다.
  }

  handleConnection(client: Socket) {
    console.log(`Websocket connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Websocket disconnected: ${client.id}`);
  }

  /**
   * 방장이 방송 카테고리(상품)와 화질 버전을 설정했을 때
   */
  @SubscribeMessage('setCategory')
  handleSetCategory(@MessageBody() data: { category: string, quality?: string, facing?: string }) {
    this.currentProductContext = `오늘 판매할 주인공 상품 카테고리는 [${data.category}] 입니다.`;
    console.log(`방송 카테고리 설정됨: ${this.currentProductContext} (화질: ${data.quality || 'HD'}, 카메라: ${data.facing || 'user'})`);
    
    // 방송 시작 시 50인 페르소나의 초기 상태를 세팅 (기본 랜덤 10~30)
    VIEWER_PERSONAS_50.forEach(p => {
      this.personaStates.set(p.name, { 
        interest: Math.floor(Math.random() * 20) + 10,
        trust: Math.floor(Math.random() * 20) + 10 
      });
    });

    this.liveStartTime = Date.now();
    this.timelineState = 'INTRO';
    if (this.timelineTimer) clearInterval(this.timelineTimer);
    this.timelineTimer = setInterval(() => this.updateTimeline(), 10000);

    // 방송 시작 처리 (카테고리, 화질, 카메라 방향 동기화 분배)
    this.server.emit('liveStarted', { category: data.category, quality: data.quality || 'HD', facing: data.facing || 'user' });
  }

  private updateTimeline() {
    if (!this.liveStartTime) return;
    const elapsedSec = (Date.now() - this.liveStartTime) / 1000;
    
    let newState: 'INTRO' | 'MID' | 'CLIMAX' | 'CLOSING' = 'INTRO';
    if (elapsedSec > 300) newState = 'CLOSING'; // 5분 이후
    else if (elapsedSec > 180) newState = 'CLIMAX'; // 3분 이후
    else if (elapsedSec > 60) newState = 'MID'; // 1분 이후
    
    if (this.timelineState !== newState) {
      this.timelineState = newState;
      console.log(`[타임라인 상태 변경]: ${newState}`);
      
      // 클라이맥스 등 상태 변환시 페르소나 상태(관심도, 신뢰도) 다이내믹 튜닝
      if (newState === 'CLIMAX') {
        this.personaStates.forEach((state) => {
          state.interest = Math.min(100, state.interest + 30);
          state.trust = Math.random() > 0.5 ? Math.min(100, state.trust + 20) : Math.max(0, state.trust - 10);
        });
      }
      
      this.server.emit('timelineUpdate', { state: newState, elapsed: Math.floor(elapsedSec) });
    }
  }

  /**
   * 텍스트 채팅이 들어왔을 때 (주로 테스트용)
   */
  @SubscribeMessage('sendMessage')
  async handleMessage(@MessageBody() data: any) {
    this.server.emit('receiveMessage', data);

    if (data.type === 'viewer' && data.sender === '나') {
      this.lastHostActivityTime = Date.now();
      await this.processHostMessageForAI(data.text);
    }
  }

  /**
   * STT 오디오 파이프라인 (실제 라이브 방송)
   */
  @SubscribeMessage('transcribeAudio')
  async handleTranscribeAudio(
    @MessageBody() data: { audioBase64: string, mimeType: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const transcript = await this.aiService.transcribeAudio(data.audioBase64, data.mimeType);
      
      this.server.emit('removeMessage', { id: 'stt_loading' });

      if (transcript && transcript.trim() !== '') {
        this.lastHostActivityTime = Date.now();
        this.pushToHistory(`호스트: ${transcript.trim()}`);
        
        const chatData = {
          id: Date.now().toString(),
          sender: "나",
          type: "viewer",
          text: transcript.trim(),
          color: "text-blue-200"
        };
        this.server.emit('receiveMessage', chatData);
        
        // 1. 호스트의 의도/감정 상태 분석 (Step 3: Intent Analyzer)
        const recentChatContext = this.roomChatHistory.slice(-5).join('\n');
        const hostIntent = await this.aiService.analyzeHostIntent(transcript, recentChatContext);
        console.log(`[호스트 상태 판독]: ${hostIntent}`);

        // 2. 페르소나 반응 트리거 (상태 패수)
        await this.processHostMessageForAI(transcript, hostIntent);
        
        // 3. 내부 코치 AI(Director) 트리거
        this.triggerDirectorCoach(transcript);
      }
    } catch (error: any) {
      this.server.emit('removeMessage', { id: 'stt_loading' });
      this.server.emit('receiveMessage', {
        id: Date.now().toString(),
        sender: "시스템",
        type: "system",
        text: "🚨 음성 인식에 실패했습니다 (할당량/통신 오류). 다시 시도해주세요.",
        color: "text-red-400"
      });
    }
  }

  /**
   * 채팅 내역 기록 유틸리티
   */
  private pushToHistory(log: string) {
    this.roomChatHistory.push(log);
    if (this.roomChatHistory.length > 15) {
      this.roomChatHistory.shift();
    }
  }

  /**
   * [핵심] 호명 판독기 및 컨텍스트 리플라이 알고리즘
   */
  private async processHostMessageForAI(transcript: string, hostIntent: string = "[평범한 진행 중]") {
    const mentionedPersonas = VIEWER_PERSONAS_50.filter(p => transcript.includes(p.name));
    
    let targetPersonas: Persona[] = [];
    let promptInstruction = "";
    const historyContext = `[최근 방송 채팅 내역]\n${this.roomChatHistory.join('\n')}\n`;

    if (mentionedPersonas.length > 0) {
      targetPersonas = mentionedPersonas.slice(0, 2);
      targetPersonas.forEach(persona => {
        const state = this.personaStates.get(persona.name) || { interest: 20, trust: 20 };
        promptInstruction = `${historyContext}\n[방금 파악된 호스트의 심리/태도]: ${hostIntent}\n[현재 방송 타임라인 단계]: ${this.timelineState}\n[당신의 심리 상태]: 호스트에 대한 신뢰도 ${state.trust}%, 상품 관심도 ${state.interest}%\n[상황조건]: 호스트가 방금 당신의 닉네임(${persona.name})을 부르며 이렇게 대답했습니다 -> "${transcript}"\n[행동지침]: 호스트의 심리 상태와 이전 채팅 내역을 종합하여, 호스트의 답변에 꼬리를 무는 대화를 하세요.`;
        
        const typingDelay = Math.floor(Math.random() * 4000) + 4000;
        setTimeout(() => this.generateAndBroadcast(persona, promptInstruction), typingDelay);
      });
    } else {
      // 일반 발언 시 채팅창이 너무 혼잡하지 않게 60% 확률로 봇들이 듣고만 있음 (침묵)
      if (Math.random() < 0.6) return;

      const shuffled = [...VIEWER_PERSONAS_50].sort(() => 0.5 - Math.random());
      const reactionCount = Math.random() < 0.2 ? 2 : 1;
      targetPersonas = shuffled.slice(0, reactionCount);
      
      targetPersonas.forEach(persona => {
        const state = this.personaStates.get(persona.name) || { interest: 20, trust: 20 };
        promptInstruction = `${historyContext}\n[방금 파악된 호스트의 심리/태도]: ${hostIntent}\n[현재 방송 타임라인 단계]: ${this.timelineState}\n[당신의 심리 상태]: 호스트에 대한 신뢰도 ${state.trust}%, 상품 관심도 ${state.interest}%\n[상황조건]: 방송 중 호스트가 전체를 향해 이렇게 말했습니다 -> "${transcript}"\n[행동지침]: 호스트의 심리 상태와 앞선 흐름에 맞춰 짧게 치고 들어가는 질문/태클/동조를 던지세요.`;
        
        const typingDelay = Math.floor(Math.random() * 3000) + 3000;
        setTimeout(() => this.generateAndBroadcast(persona, promptInstruction), typingDelay);
      });
    }
  }



  /**
   * AI 스트리밍 엔진 및 TTS 브로드캐스팅 래퍼
   */
  private async generateAndBroadcast(persona: Persona, instruction: string) {
    try {
      // [Phase 9 - Step 5] 두뇌 등급 이원화: VIP(id 1~5번)는 최상급 지능인 GPT-4o 모델 배정
      const personaIdNum = parseInt(persona.id);
      const targetModel = (!isNaN(personaIdNum) && personaIdNum <= 5) ? "gpt-4o" : "gpt-4o-mini";
      
      const stream = await this.aiService.processLlmStream(instruction, persona.name, persona.prompt, this.currentProductContext, targetModel);
      
      let fullResponse = '';
      const responseId = Date.now().toString() + '_' + persona.id + '_' + Math.floor(Math.random()*1000);

      // Typing Effect Streaming + State/Thought Tag Interception
      let phase = 'THOUGHT'; // 'THOUGHT' | 'CHAT' | 'STATE'
      
      for await (const chunk of stream) {
        for (let i = 0; i < chunk.length; i++) {
          fullResponse += chunk[i];
          
          if (phase === 'THOUGHT') {
            if (fullResponse.includes('CHAT:\n')) {
              phase = 'CHAT';
            }
          } else if (phase === 'CHAT') {
            if (fullResponse.includes('||')) {
              phase = 'STATE';
            } else {
              // "CHAT:\n" 이후의 문자열만 추출
              const parts = fullResponse.split('CHAT:\n');
              if (parts.length > 1) {
                let emitText = parts[1];
                // '||'의 첫 글자인 '|'가 렌더링되는 눈뽕을 방지
                if (emitText.endsWith('|')) emitText = emitText.slice(0, -1);
                
                this.server.emit('receiveMessage', {
                  id: responseId,
                  sender: persona.name,
                  type: 'persona',
                  text: emitText.trimStart(), // 좌측 공백 제거
                  color: persona.color,
                  isStreaming: true,
                });
                await new Promise(resolve => setTimeout(resolve, 30));
              }
            }
          }
        }
      }

      // Stream End (출력용 채팅 텍스트만 추출, 안전하게 THOUGHT와 STATE 양쪽 제거)
      let finalDisplayText = "";
      const chatSplit = fullResponse.split('CHAT:\n');
      if (chatSplit.length > 1) {
        finalDisplayText = chatSplit[1].split('||')[0].trim();
      } else {
        // 만약 LLM이 포맷을 실수해서 CHAT: 을 안 적었을 경우를 위한 방어 코드
        finalDisplayText = fullResponse.split('||')[0].trim();
      }
      
      this.server.emit('receiveMessage', {
        id: responseId, sender: persona.name, type: 'persona', text: finalDisplayText, color: persona.color, isStreaming: false
      });
      
      // 내역에 봇 대답 기록 (시스템 태그는 뺀 순수 채팅만)
      this.pushToHistory(`${persona.name}: ${finalDisplayText}`);
      
      // 상태(State) 업데이트 추출 (예: ||STATE:45,60)
      const stateMatch = fullResponse.match(/\|\|STATE:\s*(\d+)\s*,\s*(\d+)/);
      if (stateMatch) {
         this.personaStates.set(persona.name, { interest: parseInt(stateMatch[1]), trust: parseInt(stateMatch[2]) });
         console.log(`[상태 전이] ${persona.name} -> 관심도: ${stateMatch[1]}, 신뢰도: ${stateMatch[2]}`);
      }

      // [신규] 봇 간 상호작용 (Inter-Persona) 티키타카 트리거
      // 누군가 채팅을 쳤을 때, 15% 확률로 다른 페르소나가 이 채팅을 보고 대댓글(반박/동조)을 답니다.
      if (Math.random() < 0.15) {
        this.triggerInterPersonaChat(persona.name, finalDisplayText);
      }
      
      // Async TTS Generation
      try {
        const audioData = await this.aiService.generateTtsAudioBase64(finalDisplayText);
        if (audioData) {
          this.server.emit('playAudio', { id: responseId, audioBase64: audioData });
        }
      } catch(ttsErr) { /* ignore */ }
    } catch (e: any) {
      console.error(`Persona Generation Error [${persona.name}]:`, e);
    }
  }

  /**
   * [Phase 9 - Step 2] 봇 간 상호작용 (Inter-Persona Chat)
   * 특명: 시청자끼리 물어뜯고 싸우거나 동조하게 만들기
   */
  private triggerInterPersonaChat(sourcePersonaName: string, sourceChat: string) {
    const shuffled = [...VIEWER_PERSONAS_50].filter(p => p.name !== sourcePersonaName).sort(() => 0.5 - Math.random());
    const targetPersona = shuffled[0];
    
    const historyContext = `[최근 방송 채팅 내역]\n${this.roomChatHistory.join('\n')}\n`;
    const state = this.personaStates.get(targetPersona.name) || { interest: 20, trust: 20 };
    
    // 프롬프트: 다른 시청자의 채팅에 반응하도록 지시
    const promptInstruction = `${historyContext}\n[당신의 심리 상태]: 호스트에 대한 신뢰도 ${state.trust}%, 상품 관심도 ${state.interest}%\n[상황조건]: 방금 다른 시청자인 '${sourcePersonaName}'님이 채팅창에 이렇게 쳤습니다 -> "${sourceChat}"\n[행동지침]: 호스트가 아닌 이 '시청자의 채팅'에 직접적으로 반응(동조, 반박, 훈수 등)하는 짧은 답글을 다세요. 시작을 반드시 "@${sourcePersonaName}" 형식으로 멘션하세요.`;
    
    // 시청자 간 티키타카는 쫀득하게 3~5초 텀을 두고 발생
    const typingDelay = Math.floor(Math.random() * 2000) + 3000;
    setTimeout(() => this.generateAndBroadcast(targetPersona, promptInstruction), typingDelay);
  }

  private triggerDirectorCoach(transcript: string) {
    setTimeout(async () => {
      try {
        const hint = await this.aiService.processCoachHint(transcript, this.currentProductContext);
        if (hint) {
          this.server.emit('coachHint', { text: hint });
        }
      } catch (err) {}
    }, 100);
  }

  @SubscribeMessage('triggerAdminEvent')
  handleAdminEvent(@MessageBody() data: { eventType: string }) {
    console.log(`[어드민 이벤트 발동]: ${data.eventType}`);
    const historyContext = `[최근 방송 채팅 내역]\n${this.roomChatHistory.join('\n')}\n`;
    
    let instructions: { persona: Persona, text: string }[] = [];
    const shuffled = [...VIEWER_PERSONAS_50].sort(() => 0.5 - Math.random());
    
    if (data.eventType === 'massive_buy') {
      const buyers = shuffled.slice(0, 4);
      buyers.forEach(p => {
        instructions.push({ 
          persona: p, 
          text: `[어드민 시뮬레이션: 주문 폭주 이벤트]\n현재 방송에 대량 구매가 터지고 있습니다. 당신도 지금 막 결제를 완료했거나 구매를 결심한 상태입니다. 짧고 강렬하게 구매 인증이나 환호성 채팅을 쓰세요.` 
        });
      });
    } else if (data.eventType === 'haters_attack') {
      const haters = shuffled.slice(0, 3);
      haters.forEach(p => {
        instructions.push({ 
          persona: p, 
          text: `[어드민 시뮬레이션: 악플러 기습 이벤트]\n현재 방송 호스트를 깎아내리거나 상품의 치명적인 단점(비싸다, 구리다 등)을 물고 늘어지는 악플을 쓰세요. 매우 짧고 매섭게 쓰세요.` 
        });
      });
    } else if (data.eventType === 'competitor_mention') {
      const trolls = shuffled.slice(0, 2);
      trolls.forEach(p => {
        instructions.push({ 
          persona: p, 
          text: `[어드민 시뮬레이션: 타사 비교 기습]\n"옆 동네 유튜버 OOO이 비슷한거 더 싸게 팔던데?", "알리익스프레스/무신사에서 비슷한거 반값에 봤어요" 등 타 브랜드/플랫폼을 언급하며 호스트를 당황시키는 짧은 채팅을 치세요.` 
        });
      });
    } else if (data.eventType === 'random_question') {
      const askers = shuffled.slice(0, 2);
      askers.forEach(p => {
        instructions.push({ 
          persona: p, 
          text: `[어드민 시뮬레이션: 뜬금없는 질문 이벤트]\n현재 상품의 아주 디테일하고 사소한 부분(원단 수축률, A/S 기간, 포장박스 색상 등)이나 배송 관련해서 뜬금없이 날카로운 질문을 1문장으로 던지세요.` 
        });
      });
    }

    instructions.forEach((inst, index) => {
      setTimeout(() => this.generateAndBroadcast(inst.persona, inst.text), index * 2000 + 1000);
    });
  }

  // --- WebRTC Signaling ---
  @SubscribeMessage('offer')
  handleOffer(@MessageBody() data: any, @ConnectedSocket() client: Socket) { client.broadcast.emit('offer', data); }

  @SubscribeMessage('answer')
  handleAnswer(@MessageBody() data: any, @ConnectedSocket() client: Socket) { client.broadcast.emit('answer', data); }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(@MessageBody() data: any, @ConnectedSocket() client: Socket) { client.broadcast.emit('ice-candidate', data); }
}
