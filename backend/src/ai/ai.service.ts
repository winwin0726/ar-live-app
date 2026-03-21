import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import * as googleTTS from 'google-tts-api';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || 'missing-key',
    });
  }

  /**
   * 1. STT: Whisper API (OpenAI)
   * Base64 WebM 오디오 파일을 임시 파일로 전환하여 Whisper-1 모델에 전송합니다.
   */
  async transcribeAudio(audioBase64: string, mimeType: string): Promise<string> {
    try {
      this.logger.log(`STT: WebM 오디오 수신. OpenAI Whisper-1으로 음성 인식 분석 중...`);
      
      const tempFilePath = path.join(os.tmpdir(), `stt-${Date.now()}.webm`);
      fs.writeFileSync(tempFilePath, Buffer.from(audioBase64, 'base64'));

      let result: any;
      let retries = 3;
      while (true) {
        try {
          result = await this.openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: 'whisper-1',
            language: 'ko',
          });
          break;
        } catch (e: any) {
          retries--;
          if (retries === 0) throw e;
          this.logger.warn(`OpenAI Whisper API 통신 실패, 1초 뒤 재시도 중... (남은 횟수: ${retries})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // 즉시 임시 파일 삭제하여 용량 확보
      fs.unlinkSync(tempFilePath);
      
      const transcript = result.text;
      this.logger.log(`STT 분석 결과: ${transcript}`);
      return transcript;
    } catch (error) {
      this.logger.error("OpenAI Whisper Transcription Error:", error);
      return "";
    }
  }

  /**
   * 2. LLM: 단기 기억 및 페르소나 적용된 프롬프트 캐싱 오케스트레이터
   * GPT-4o-mini 스트림 요청
   */
  async processLlmStream(prompt: string, personaName: string, personaPrompt: string, productContext: string = "", modelName: string = "gpt-4o-mini"): Promise<AsyncIterable<string>> {
    this.logger.log(`LLM: ${modelName} stream for [${personaName}]...`);

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes('붙여넣어주세요')) {
      this.logger.warn('OPENAI_API_KEY is not set correctly. Using Mock Stream instead.');
      async function* mockStream() {
        const chunks = ['(OpenAI API키를 ', '.env에 ', '정확히 넣어주세요) ', '소재가 ', '부드럽나요?'];
        for (const chunk of chunks) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          yield chunk;
        }
      }
      return mockStream();
    }

    try {
      const systemInstruction = `
[라이브 커머스 방송 상품 정보]
${productContext}

[당신의 역할 및 페르소나]
당신의 시청자 닉네임: ${personaName}
당신의 성격 및 행동 지침: ${personaPrompt}

[필수 규칙 - 아주 중요함!]:
1. 당신은 인공지능이 아니라 실제 라이브 방송을 시청 중인 사람(${personaName})입니다.
2. 현재 화면에서 호스트가 판매중인 상품은 오직 [ ${productContext} ] 단 하나입니다! **절대 이 카테고리를 벗어나는 다른 아이템(예: 신발을 파는데 가방 혜택을 묻는 등)을 상상해서 지어내어 말하지 마세요.**
3. **절대 길게 말하지 마세요.** 스크린에 표시되는 실제 채팅은 무조건 5~15단어 내외, 최대 1문장으로만 치세요.
4. "안녕하세요 호스트님", "네 알겠습니다" 같은 불필요한 인사말이나 서론은 무조건 생략하고 바로 본론만 찌르세요.
5. 앞선 채팅 내역(Context)이 주어지면, 그 상황에 맥락상 완벽하게 물고 늘어지는 핑퐁을 하세요. 엉뚱한 동문서답 절대 금지.
6. **(매우 중요: 사고 과정 프롬프팅)** 당신의 지능을 높이기 위해, 행동 전 반드시 속마음을 먼저 분석하세요. 이후 방송에 나갈 실제 채팅을 적고, 마지막에 심리 상태값을 기입합니다.
   반드시 아래 3단계 형식을 그대로 지켜서 답하세요 (단어 오탈자 주의).

THOUGHT:
(이곳에 현재 상황에 대한 당신의 판단과 속마음을 1~2문장 적으세요)
CHAT:
(이곳에 방송 화면에 출력될 실제 5~15단어짜리 채팅을 적으세요)
||STATE:관심도,신뢰도
`;

      let result: any;
      let retries = 3;
      while (true) {
        try {
          result = await this.openai.chat.completions.create({
            model: modelName,
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: prompt }
            ],
            stream: true,
          });
          break; // 통신 성공 시 루프 탈출
        } catch (e: any) {
          retries--;
          if (retries === 0) throw e;
          this.logger.warn(`OpenAI LLM API 일시적 통신 실패, 1초 뒤 재시도 중... (남은 횟수: ${retries})`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      async function* openAiStream() {
        for await (const chunk of result) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) yield content;
        }
      }
      return openAiStream();
    } catch (error: any) {
      this.logger.error('OpenAI API Error:', error);
      throw new Error(`OpenAI API 통신 실패: ${error.message || '알 수 없는 오류'}`);
    }
  }

  /**
   * 3. TTS: 프론트엔드로 전달할 Base64 포맷의 실제 음성 파일 데이터 생성
   * (google-tts-api는 내부적으로 계속 사용)
   */
  async generateTtsAudioBase64(text: string): Promise<string> {
    try {
      this.logger.log(`TTS: Generating audio for [${text.substring(0, 15)}...]`);
      const url = googleTTS.getAudioUrl(text, {
        lang: 'ko',
        slow: false,
        host: 'https://translate.google.com',
      });
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return base64;
    } catch (error) {
      this.logger.error('TTS Generation Error:', error);
      return '';
    }
  }

  /**
   * [Phase 9 - Step 3] 호스트 화법 분석기 (Intent Analyzer)
   * 호스트 발언의 표면적 의미를 넘어, 당황했는지 자신감이 넘치는지 감정/태도를 태깅
   */
  async analyzeHostIntent(transcript: string, recentChat: string): Promise<string> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `당신은 라이브 방송 심리 분석가입니다. 호스트가 방금 한 말의 의도나 감정 상태(Tone & Manner)를 분석하여 매우 짧은 태그 형태로 반환하세요.\n예: [악플에 다소 당황하여 횡설수설함], [자신감 있게 스펙을 자랑함], [관심을 끌기 위해 호들갑 떪], [특정 시청자의 질문을 회피함], [평이하게 상품 설명 중]`
          },
          {
            role: "user",
            content: `[최근 방송 채팅 맥락]\n${recentChat}\n\n[호스트의 방금 발언]\n"${transcript}"\n\n현재 호스트의 감정/화법 상태는?`
          }
        ],
        temperature: 0.7,
        max_tokens: 30,
      });
      return completion.choices[0].message.content || "[평범한 진행 중]";
    } catch (error) {
      return "[평범한 진행 중]";
    }
  }

  /**
   * 4. 내부 코치 AI (시뮬레이터 전용)
   * 방송인의 발화와 현재 상황을 분석하여 GPT-4o-mini가 1줄짜리 핵심 지시사항을 생성
   */
  async processCoachHint(transcript: string, productContext: string): Promise<string | null> {
    try {
      this.logger.log(`Coach: Analyzing host speech using GPT-4o-mini...`);
      
      const systemInstruction = `
Product Context: [${productContext}]

You are a veteran live commerce director coaching a novice show host. 
The host just said: "${transcript}"

Task: Give a very short, sharp, and practical 1-sentence advice (under 25 characters) to the host in Korean on what to do NEXT to increase sales or handle the situation.
Tone: Professional, urgent, encouraging. (e.g. "가격을 한 번 더 강조하세요!", "원단 질문에 대답할 타이밍입니다!")
Output ONLY the advice string. No quotes, no explanations.
`;

      let result: any;
      let retries = 2;
      while (true) {
        try {
          result = await this.openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemInstruction },
              { role: 'user', content: '지금 상황에 맞는 디렉터 코칭 한 마디 부탁해.' }
            ]
          });
          break;
        } catch (e: any) {
          retries--;
          if (retries === 0) throw e;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      const hint = result.choices[0]?.message?.content?.trim() || "";
      this.logger.log(`Coach Hint: ${hint}`);
      return hint;
    } catch (error) {
      this.logger.error("Coach Hint Generation Error:", error);
      return "";
    }
  }

  /**
   * 5. 대화 개입(Barge-in) 중단 처리 메커니즘
   */
  handleBargeIn(clientId: string) {
    this.logger.warn(`Barge-in detected from client [${clientId}]. Halting current streams.`);
  }
}
