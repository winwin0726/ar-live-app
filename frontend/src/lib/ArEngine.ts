// @ts-ignore
import { FaceLandmarker, PoseLandmarker, ImageSegmenter, FilesetResolver } from "@mediapipe/tasks-vision";

export class ArEngine {
  private faceLandmarker: FaceLandmarker | null = null;
  private poseLandmarker: PoseLandmarker | null = null;
  private segmenter: ImageSegmenter | null = null;
  private isInitialized = false;

  // Processing elements
  private hiddenVideo: HTMLVideoElement | null = null;
  private processingCanvas: HTMLCanvasElement | null = null;
  private canvasCtx: CanvasRenderingContext2D | null = null;
  private renderLoopId: number | null = null;
  private processedStream: MediaStream | null = null;

  // WebGL context elements
  private glCanvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  public showLandmarks: boolean = false;

  setShowLandmarks(show: boolean) {
    this.showLandmarks = show;
  }
  private positionBuffer: WebGLBuffer | null = null;
  private texCoordBuffer: WebGLBuffer | null = null;
  private videoTexture: WebGLTexture | null = null;
  private segTexture: WebGLTexture | null = null;
  private segMaskBuffer: Uint8Array | null = null;

  // 시간적 안정화 (Temporal Stabilization) 버퍼
  private prevPointsData: Float32Array | null = null;
  private prevJawArr: Float32Array | null = null;
  private prevDirArr: Float32Array | null = null;
  private readonly EMA_ALPHA = 0.35;

  async initialize() {
    if (this.isInitialized) return;

    const originalConsoleError = console.error;
    console.error = (...args) => {
      if (typeof args[0] === 'string' && args[0].includes('TensorFlow Lite XNNPACK delegate')) return;
      originalConsoleError.apply(console, args);
    };
    
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numFaces: 1
      });

      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numPoses: 1
      });

      this.segmenter = await ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite",
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        outputCategoryMask: false,
        outputConfidenceMasks: true
      });

      this.isInitialized = true;
      console.log("ArEngine: MediaPipe Vision initialized successfully.");
    } catch (e) {
      console.error("ArEngine Initialization Error:", e);
    }
  }

  private currentParams: any = {};

  updateParams(params: any) {
    this.currentParams = params;
  }

  private initWebGL(width: number, height: number) {
    this.glCanvas = document.createElement("canvas");
    this.glCanvas.width = width;
    this.glCanvas.height = height;
    const gl = this.glCanvas.getContext("webgl");
    if (!gl) return;
    this.gl = gl;

    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    const fsSource = `
      precision highp float;
      varying vec2 v_texCoord;
      uniform sampler2D u_image;
      uniform sampler2D u_segMask;
      uniform float u_backgroundBlur;
      uniform float u_aspectRatio;
      
      uniform vec2 u_points[9];
      uniform vec2 u_jawPoints[21];
      uniform vec2 u_jawDirs[21];
      uniform float u_jawline;
      uniform float u_faceScale;
      uniform float u_eyes;
      uniform float u_nose;
      uniform float u_lips;
      uniform float u_skinTone;
      uniform float u_smoothing;
      uniform float u_autoBeauty;

      uniform vec2 u_pose[33];
      uniform float u_shoulders;
      uniform float u_waist;
      uniform float u_hip;
      uniform float u_legs;
      uniform float u_arms;

      // 고개 회전 시 크기가 축소되는 문제 해결을 위한 안정적인 얼굴 크기 반환 함수
      float getFaceSize() {
          vec2 fL = u_jawPoints[0]; fL.x *= u_aspectRatio;
          vec2 fR = u_jawPoints[20]; fR.x *= u_aspectRatio;
          float fW = length(fL - fR);
          
          vec2 nose = u_points[3]; nose.x *= u_aspectRatio;
          vec2 chin = u_jawPoints[10]; chin.x *= u_aspectRatio;
          float fH = length(chin - nose) * 2.2; 
          
          // 고개를 옆으로 돌리면 fW가 0에 수렴하지만 fH는 유지되므로 둘 중 큰 값을 취함
          return max(fW, fH);
      }

      // [업데이트] 피부색 탐지 - 사용되지 않으면 성능상  1.0 반환
      float getSkinMask(vec3 color) {
          return 1.0;
      }

      // 얼굴 동적 마스크 — 턱선 중심점 기반의 부드러운 단일 마스크
      // 개별 점 거리가 아닌 중심점에서의 거리로 처리하여 그림자/울퉁불퉁 제거
      float faceMask(vec2 uv) {
          // 턱선 21개 + 코 + 양눈 = 동적 얼굴 중심 계산
          vec2 centroid = vec2(0.0);
          for (int i = 0; i < 21; i++) {
              centroid += u_jawPoints[i];
          }
          centroid += u_points[3]; // 코
          centroid += u_points[4]; // 왼눈
          centroid += u_points[5]; // 오른눈
          centroid /= 24.0;
          // 중심을 턱 방향으로 살짝 아래로 이동 (목까지 커버)
          vec2 chin = u_jawPoints[10]; // 턱 끝
          centroid = centroid * 0.85 + chin * 0.15; // 15% 턱 방향으로
          
          vec2 pp = uv; pp.x *= u_aspectRatio;
          vec2 cc = centroid; cc.x *= u_aspectRatio;
          
          float stableSize = getFaceSize();
          float faceRadius = stableSize * 0.85; // 이마~턱~목, 볼 바깥쪽까지 완전히 커버 (0.75 -> 0.85 확대)
          
          float dist = length(pp - cc);
          // 중앙부(0~0.6)는 1.0으로 고정하여 얼룩방지, 외곽(0.6~1.0)에서 페이드아웃
          return 1.0 - smoothstep(faceRadius * 0.6, faceRadius, dist);
      }

      vec2 warpPixel(vec2 uv, vec2 center, float radius, float strength) {
          if (abs(strength) < 0.001 || center.x < 0.001) return uv;
          vec2 delta = uv - center;
          delta.x *= u_aspectRatio;
          float dist = length(delta);
          if (dist < radius) {
              float pull = (radius - dist) / radius;
              pull = pull * pull * (3.0 - 2.0 * pull);
              vec2 warpDelta = delta * pull * strength;
              warpDelta.x /= u_aspectRatio;
              return uv + warpDelta;
          }
          return uv;
      }

      // SOTA RBF Jawline 워프
      // 턱선 슬리밍 전용 (얼굴 하관 윤곽을 따라 V라인으로 안쪽으로 당김)
      vec2 warpFaceContour(vec2 uv, float jawStr) {
          if (abs(jawStr) < 0.001) return uv;
          if (u_jawPoints[0].x < 0.001) return uv;
          
          // 비선형 슬라이더 곡선 (sqrt)
          float jSign = 1.0;
          if (jawStr < 0.0) jSign = -1.0;
          jawStr = jSign * sqrt(abs(jawStr));
          
          vec2 p = uv; p.x *= u_aspectRatio;
          
          vec2 J_left = u_jawPoints[0]; J_left.x *= u_aspectRatio;
          vec2 J_right = u_jawPoints[20]; J_right.x *= u_aspectRatio;
          vec2 chin = u_jawPoints[10]; chin.x *= u_aspectRatio;
          
          float faceWidth = getFaceSize();
          
          vec2 totalDisp = vec2(0.0);
          float totalWeight = 0.0;
          
          float radius = faceWidth * 0.60; // 5점만으로도 부드럽게 이어지도록 반경 확대
          
          // 모바일 GPU 병목 렌더링(Timeout)을 막기 위해 21번의 연산을 핵심 앵커 5개로 75% 압축
          for (int i = 0; i <= 20; i += 5) {
              vec2 jp = u_jawPoints[i]; 
              jp.x *= u_aspectRatio;
              
              float dist = length(p - jp);
              if (dist < radius) {
                  float pull = (radius - dist) / radius;
                  float weight = pull * pull * (3.0 - 2.0 * pull); 
                  
                  // 수직 그라데이션 감쇠: 턱 끝 = 100%, 광대 = ~55%, 관자놀이 = ~25%
                  float vertDist = length(jp - chin);
                  float vertFade = 1.0 - smoothstep(0.0, faceWidth * 0.55, vertDist);
                  vertFade = max(vertFade, 0.2);
                  
                  vec2 dir = u_jawDirs[i];
                  
                  // 턱선 효과: 안쪽으로 당김 (슬리밍)
                  vec2 jawDisp = -dir * weight * vertFade * jawStr * faceWidth * 0.025;
                  
                  totalDisp += jawDisp;
                  totalWeight += weight;
              }
          }
          
          if (totalWeight > 0.0) {
              vec2 finalDisp = totalDisp / totalWeight;
              float blend = clamp(totalWeight, 0.0, 1.0);
              uv.x += (finalDisp.x * blend) / u_aspectRatio;
              uv.y += (finalDisp.y * blend);
          }
          return uv;
      }

      vec2 warpBody(vec2 uv) {
          if (u_pose[11].x < 0.001 && u_pose[12].x < 0.001) return uv;

          float shoulders = (u_shoulders - 50.0) / 50.0;
          float waist = (u_waist - 50.0) / 50.0;
          float hip = (u_hip - 50.0) / 50.0;
          float arms = (u_arms - 50.0) / 50.0;
          float legs = (u_legs - 50.0) / 50.0;

          vec2 p = uv;
          // 어깨: +값이면 넓어지도록 중심에서 바깥으로 밂 (-값 활용)
          p = warpPixel(p, u_pose[11], 0.18, -shoulders * 0.1); 
          p = warpPixel(p, u_pose[12], 0.18, -shoulders * 0.1);
          
          // 허리: +값이면 얇아지도록 안으로 당김
          vec2 leftWaist = mix(u_pose[11], u_pose[23], 0.6);
          vec2 rightWaist = mix(u_pose[12], u_pose[24], 0.6);
          p = warpPixel(p, leftWaist, 0.20, waist * 0.12);
          p = warpPixel(p, rightWaist, 0.20, waist * 0.12);
          
          // 힙: +값이면 넓어지도록 벌림
          p = warpPixel(p, u_pose[23], 0.22, -hip * 0.1);
          p = warpPixel(p, u_pose[24], 0.22, -hip * 0.1);
          
          // 팔: +값이면 얇아지도록 당김
          p = warpPixel(p, u_pose[13], 0.15, arms * 0.1);
          p = warpPixel(p, u_pose[14], 0.15, arms * 0.1);
          p = warpPixel(p, mix(u_pose[11], u_pose[13], 0.5), 0.12, arms * 0.1);
          p = warpPixel(p, mix(u_pose[12], u_pose[14], 0.5), 0.12, arms * 0.1);

          // 다리(허벅지): +값이면 얇아지도록 당김
          p = warpPixel(p, mix(u_pose[23], u_pose[25], 0.4), 0.18, legs * 0.1);
          p = warpPixel(p, mix(u_pose[24], u_pose[26], 0.4), 0.18, legs * 0.1);
          p = warpPixel(p, mix(u_pose[23], u_pose[25], 0.7), 0.15, legs * 0.1);
          p = warpPixel(p, mix(u_pose[24], u_pose[26], 0.7), 0.15, legs * 0.1);

          return p;
      }

      void main() {
          vec2 uv = v_texCoord;
          
          float jaw = (u_jawline - 50.0) / 50.0;
          float face = (u_faceScale - 50.0) / 50.0;
          float eyes = (u_eyes - 50.0) / 50.0;
          float nose = (u_nose - 50.0) / 50.0;
          float lips = (u_lips - 50.0) / 50.0;
          
          float skinAdj = (u_skinTone - 50.0) / 50.0;
          float smoothAdj = (u_smoothing - 50.0) / 50.0;

          // 자동보정 활성화 시 파라미터 강제 부스팅 (중복 왜곡/블러 방지)
          float autoVal = u_autoBeauty > 0.5 ? 1.0 : 0.0;
          if (autoVal > 0.5) {
              jaw = clamp(jaw - 0.25, -1.0, 1.0);
              face = clamp(face - 0.15, -1.0, 1.0);
              eyes = clamp(eyes + 0.25, -1.0, 1.0);
              nose = clamp(nose - 0.15, -1.0, 1.0);
              skinAdj = max(skinAdj, 0.6); 
              smoothAdj = max(smoothAdj, 0.7);
          }

          // 0. 얼굴 전체 크기 조절 (코 중심의 3D 구면 렌즈 왜곡)
          // 하관만 찌그러지던 땅콩형 부작용을 없애고, 이마와 두상 전체가 똑같은 비율로 축소/팽창되도록 고도화
          uv = warpPixel(uv, u_points[3], getFaceSize() * 0.70, face * 0.12);

          // 1. 턱선 전용 RBF 워프 (V라인 슬리밍)
          uv = warpFaceContour(uv, jaw);
          
          // 체형 5종 렌더링 필터 적용
          uv = warpBody(uv);
          
          // 2. 눈/코/입 개별 워프
          uv = warpPixel(uv, u_points[4], 0.07, -eyes * 0.10);
          uv = warpPixel(uv, u_points[5], 0.07, -eyes * 0.10);
          uv = warpPixel(uv, u_points[3], 0.06, nose * 0.10);
          uv = warpPixel(uv, u_points[6], 0.07, -lips * 0.15);

          // [배경 보호 및 맵 추출]
          float fgProb = texture2D(u_segMask, v_texCoord).r;
          uv = mix(v_texCoord, uv, fgProb); // 배경 영역 시공간 왜곡 무효화
          
          vec4 color = texture2D(u_image, uv);
          
          // [아웃포커스 (Bokeh)]
          float bgProb = 1.0 - fgProb;
          float bokehAdj = u_backgroundBlur / 100.0;
          if (bokehAdj > 0.01 && bgProb > 0.05) {
              float r1 = 0.010 * bokehAdj;
              float r2 = 0.022 * bokehAdj;
              vec2 t1 = vec2(r1 / u_aspectRatio, r1);
              vec2 t2 = vec2(r1 / u_aspectRatio, -r1);
              vec2 t3 = vec2(r2 / u_aspectRatio, 0.0);
              vec2 t4 = vec2(0.0, r2);
              
              vec4 bgBlur = texture2D(u_image, uv) * 0.20;
              bgBlur += texture2D(u_image, uv + t1) * 0.10;
              bgBlur += texture2D(u_image, uv - t1) * 0.10;
              bgBlur += texture2D(u_image, uv + t2) * 0.10;
              bgBlur += texture2D(u_image, uv - t2) * 0.10;
              bgBlur += texture2D(u_image, uv + t3) * 0.10;
              bgBlur += texture2D(u_image, uv - t3) * 0.10;

          // 피부지역 마스크: 얼굴마스크 * 인물확률 (피부색 판별한앗 제거로 마스크노이즈 없애줌)
          float magicMask = faceMask(uv) * fgProb;

          // 3. 피부톤 보정 (이 세상에서 가장 안전한 단순 뽀새야한기 방식)
          if (abs(skinAdj) > 0.01 && u_points[3].x > 0.0) {
              float mask = magicMask;
              
              if (mask > 0.01) {
                  // 밝기 샆게 올리기 + 따뜻한 피치 새~한 색온도 들어가기
                  vec3 target = color.rgb;
                  target.r += skinAdj * 0.06; // 탁스진한 붉지 새한 느낌
                  target.g += skinAdj * 0.04;
                  target.b -= skinAdj * 0.02;
                  // 밝기도 올리기 (아주 살짝)
                  float brightness = 1.0 + skinAdj * 0.10;
                  target *= brightness;
                  // 영역내에서 마스크 국소간만 일어나도록 mix
                  color.rgb = mix(color.rgb, target, mask * 0.7);
              }
          }

          // 4. 뽀샤시 심화 (True Bilateral Filter 적용)
          if (smoothAdj > 0.01 && u_points[3].x > 0.0) {
              float baseMask = magicMask; // 순수 피부 영역에만 스무딩 적용
              
              if (baseMask > 0.01) {
                  float fww = getFaceSize();
                  
                  // 이목구비 보호 마스크 (눈/코/입/눈썹)
                  vec2 leftEye = u_points[4]; leftEye.x *= u_aspectRatio;
                  vec2 rightEye = u_points[5]; rightEye.x *= u_aspectRatio;
                  vec2 pp = uv; pp.x *= u_aspectRatio;
                  float eyeR = fww * 0.12;
                  float leftEyeDist = length(pp - leftEye);
                  float rightEyeDist = length(pp - rightEye);
                  float eyeGuard = smoothstep(eyeR * 0.5, eyeR, min(leftEyeDist, rightEyeDist));
                  
                  vec2 noseP = u_points[3]; noseP.x *= u_aspectRatio;
                  float noseR = fww * 0.08;
                  float noseGuard = smoothstep(noseR * 0.3, noseR, length(pp - noseP));
                  
                  vec2 lipP = u_points[6]; lipP.x *= u_aspectRatio;
                  float lipR = fww * 0.09;
                  float lipGuard = smoothstep(lipR * 0.3, lipR, length(pp - lipP));
                  
                  vec2 browL = leftEye + vec2(0.0, eyeR * 0.8);
                  vec2 browR = rightEye + vec2(0.0, eyeR * 0.8);
                  float browGuardL = smoothstep(eyeR * 0.3, eyeR * 0.7, length(pp - browL));
                  float browGuardR = smoothstep(eyeR * 0.3, eyeR * 0.7, length(pp - browR));
                  
                  float featureGuard = eyeGuard * noseGuard * lipGuard * browGuardL * browGuardR;
                  float sMask = baseMask * featureGuard;
                  
                  // === 8-Tap 고효율 True Bilateral Filter (모바일 GPU 최적화) ===
                  // 모바일 기기에서의 WebGL Context Timeout 현상을 막기 위해 16-Tap을 8-Tap으로 경량화
                  vec4 blurred = color;
                  float totalW = 1.0;
                  vec3 refC = color.rgb;
                  
                  float sigmaFactor = 30.0; 
                  
                  float r1 = fww * 0.015 * smoothAdj; // Inner Ring
                  float r2 = fww * 0.035 * smoothAdj; // Outer Ring
                  
                  vec2 tx1 = vec2(r1 / u_aspectRatio, 0.0);
                  vec2 ty1 = vec2(0.0, r1);
                  
                  vec2 txy2 = vec2(r2 * 0.707 / u_aspectRatio, r2 * 0.707);
                  vec2 tyx2 = vec2(r2 * 0.707 / u_aspectRatio, -r2 * 0.707);
                  
                  vec4 s; float w; float dSq;
                  
                  // Inner Ring (십자 4 Taps)
                  float wIn = 0.8;
                  s = texture2D(u_image, uv + tx1); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wIn; blurred += s * w; totalW += w;
                  s = texture2D(u_image, uv - tx1); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wIn; blurred += s * w; totalW += w;
                  s = texture2D(u_image, uv + ty1); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wIn; blurred += s * w; totalW += w;
                  s = texture2D(u_image, uv - ty1); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wIn; blurred += s * w; totalW += w;
                  
                  // Outer Ring (대각선 4 Taps)
                  float wOut = 0.5;
                  s = texture2D(u_image, uv + txy2); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wOut; blurred += s * w; totalW += w;
                  s = texture2D(u_image, uv - txy2); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wOut; blurred += s * w; totalW += w;
                  s = texture2D(u_image, uv + tyx2); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wOut; blurred += s * w; totalW += w;
                  s = texture2D(u_image, uv - tyx2); dSq = dot(refC - s.rgb, refC - s.rgb); w = exp(-dSq * sigmaFactor) * wOut; blurred += s * w; totalW += w;
                  
                  blurred /= totalW;
                  
                  // 모공/잡티 요철 제거 (순수 텍스처 뽀샤시 스무딩 적용)
                  // 색상/음영값은 보존하고 물리적인 거친 결점만 흐려줍니다.
                  color = mix(color, blurred, sMask * smoothAdj * 0.95);
              }
          }

          gl_FragColor = color;
      }
    `;

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
         console.error("Shader compile err:", gl.getShaderInfoLog(shader));
      }
      return shader;
    };

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, vs);
    gl.attachShader(this.program, fs);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1.0, -1.0,  1.0, -1.0,  -1.0,  1.0,
      -1.0,  1.0,  1.0, -1.0,   1.0,  1.0,
    ]), gl.STATIC_DRAW);

    this.texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0.0, 0.0,  1.0, 0.0,  0.0, 1.0,
      0.0, 1.0,  1.0, 0.0,  1.0, 1.0,
    ]), gl.STATIC_DRAW);

    this.videoTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.segTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.segTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  setupProcessingPipeline(rawStream: MediaStream): MediaStream {
    if (!this.hiddenVideo) {
      this.hiddenVideo = document.createElement("video");
      this.hiddenVideo.autoplay = true;
      this.hiddenVideo.playsInline = true;
      this.hiddenVideo.muted = true;
    }
    if (!this.processingCanvas) {
      this.processingCanvas = document.createElement("canvas");
      this.canvasCtx = this.processingCanvas.getContext("2d");
    }

    this.hiddenVideo.srcObject = rawStream;
    this.hiddenVideo.play().catch(e => console.error("Hidden video play error:", e));
    
    const track = rawStream.getVideoTracks()[0];
    const settings = track.getSettings();
    this.processingCanvas.width = settings.width || 720;
    this.processingCanvas.height = settings.height || 1280;
    
    this.hiddenVideo.width = this.processingCanvas.width;
    this.hiddenVideo.height = this.processingCanvas.height;

    this.initWebGL(this.processingCanvas.width, this.processingCanvas.height);

    const canvasStream = this.processingCanvas.captureStream(30);
    
    const audioTracks = rawStream.getAudioTracks();
    if (audioTracks.length > 0) {
      canvasStream.addTrack(audioTracks[0]);
    }

    this.processedStream = canvasStream;
    this.startRenderLoop();

    return this.processedStream;
  }

  private startRenderLoop() {
    if (this.renderLoopId) cancelAnimationFrame(this.renderLoopId);

    let lastVideoTime = -1;

    const loop = () => {
      if (this.hiddenVideo && this.processingCanvas && this.canvasCtx && this.isInitialized && this.gl) {
        if (this.hiddenVideo.readyState >= 2 && this.hiddenVideo.currentTime !== lastVideoTime) {
           lastVideoTime = this.hiddenVideo.currentTime;
           const nowInMs = performance.now();
           
           const faceResult = this.faceLandmarker?.detectForVideo(this.hiddenVideo, nowInMs);
           
           const gl = this.gl;
           gl.viewport(0, 0, this.glCanvas!.width, this.glCanvas!.height);
           gl.clearColor(0,0,0,1);
           gl.clear(gl.COLOR_BUFFER_BIT);

           gl.activeTexture(gl.TEXTURE0);
           gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
           gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.hiddenVideo);

           const segResult = this.segmenter?.segmentForVideo(this.hiddenVideo, nowInMs);

           if (this.program) {
              gl.useProgram(this.program);

              const posLoc = gl.getAttribLocation(this.program, "a_position");
              gl.enableVertexAttribArray(posLoc);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
              gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

              const texLoc = gl.getAttribLocation(this.program, "a_texCoord");
              gl.enableVertexAttribArray(texLoc);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
              gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

              gl.uniform1f(gl.getUniformLocation(this.program, "u_aspectRatio"), this.glCanvas!.width / this.glCanvas!.height);
              
              gl.uniform1f(gl.getUniformLocation(this.program, "u_jawline"), this.currentParams.jawline ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_faceScale"), this.currentParams.faceSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_eyes"), this.currentParams.eyeSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_nose"), this.currentParams.noseSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_lips"), this.currentParams.mouthSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_skinTone"), this.currentParams.skinTone ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_smoothing"), this.currentParams.smoothing ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_autoBeauty"), this.currentParams.autoBeauty ?? 0);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_backgroundBlur"), this.currentParams.backgroundBlur ?? 0);

              gl.uniform1f(gl.getUniformLocation(this.program, "u_shoulders"), this.currentParams.shoulderSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_waist"), this.currentParams.waistSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_hip"), this.currentParams.hipSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_legs"), this.currentParams.legSize ?? 50);
              gl.uniform1f(gl.getUniformLocation(this.program, "u_arms"), this.currentParams.armSize ?? 50);

              const poseResult = this.poseLandmarker?.detectForVideo(this.hiddenVideo, nowInMs);
              const uPoseLoc = gl.getUniformLocation(this.program, "u_pose");
              const poseData = new Float32Array(66);
              if (poseResult && poseResult.landmarks.length > 0) {
                  const marks = poseResult.landmarks[0];
                  for (let i = 0; i < 33; i++) {
                      poseData[i*2] = marks[i].x;
                      poseData[i*2+1] = 1.0 - marks[i].y;
                  }
              }
              gl.uniform2fv(uPoseLoc, poseData);

              const uPointsLoc = gl.getUniformLocation(this.program, "u_points");
              const pointsData = new Float32Array(18);
              const jawArr = new Float32Array(42);
              const dirArr = new Float32Array(42);
              
              if (faceResult && faceResult.faceLandmarks.length > 0) {
                 const marks = faceResult.faceLandmarks[0];
                 const lipCenterCX = (marks[0].x + marks[17].x) / 2.0;
                 const lipCenterCY = (marks[0].y + marks[17].y) / 2.0;
                 
                 pointsData.set([
                    marks[152].x, 1.0 - marks[152].y,
                    marks[132].x, 1.0 - marks[132].y,
                    marks[361].x, 1.0 - marks[361].y,
                    marks[1].x,   1.0 - marks[1].y,
                    marks[159].x, 1.0 - marks[159].y,
                    marks[386].x, 1.0 - marks[386].y,
                    lipCenterCX,  1.0 - lipCenterCY,
                    marks[150].x, 1.0 - marks[150].y,
                    marks[379].x, 1.0 - marks[379].y,
                 ]);

                 const JAW_INDICES = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];
                 
                 const lEar = marks[234];
                 const rEar = marks[454];
                 const center3D = { x: (lEar.x + rEar.x)/2, y: (lEar.y + rEar.y)/2, z: (lEar.z + rEar.z)/2 };

                 for (let i = 0; i < 21; i++) {
                     const mark = marks[JAW_INDICES[i]];
                     
                     jawArr[i*2] = mark.x;
                     jawArr[i*2+1] = 1.0 - mark.y;
                     
                     let dx = mark.x - center3D.x;
                     let dy = mark.y - center3D.y;
                     let dz = mark.z - center3D.z;
                     
                     const len3D = Math.sqrt(dx*dx + dy*dy + dz*dz) + 0.0001;
                     dirArr[i*2] = dx / len3D;
                     dirArr[i*2+1] = -(dy / len3D);
                 }

                 // EMA 시간적 안정화
                 const alpha = this.EMA_ALPHA;
                 if (this.prevPointsData) {
                     for (let i = 0; i < pointsData.length; i++) {
                         pointsData[i] = alpha * pointsData[i] + (1 - alpha) * this.prevPointsData[i];
                     }
                 }
                 if (this.prevJawArr) {
                     for (let i = 0; i < jawArr.length; i++) {
                         jawArr[i] = alpha * jawArr[i] + (1 - alpha) * this.prevJawArr[i];
                     }
                 }
                 if (this.prevDirArr) {
                     for (let i = 0; i < dirArr.length; i++) {
                         dirArr[i] = alpha * dirArr[i] + (1 - alpha) * this.prevDirArr[i];
                     }
                 }
                 this.prevPointsData = new Float32Array(pointsData);
                 this.prevJawArr = new Float32Array(jawArr);
                 this.prevDirArr = new Float32Array(dirArr);

              } else {
                 if (this.prevPointsData) pointsData.set(this.prevPointsData);
                 if (this.prevJawArr) jawArr.set(this.prevJawArr);
                 if (this.prevDirArr) dirArr.set(this.prevDirArr);
              }
              gl.uniform2fv(uPointsLoc, pointsData);
              const uJawLoc = gl.getUniformLocation(this.program, "u_jawPoints");
              if (uJawLoc) gl.uniform2fv(uJawLoc, jawArr);
              const uJawDirLoc = gl.getUniformLocation(this.program, "u_jawDirs");
              if (uJawDirLoc) gl.uniform2fv(uJawDirLoc, dirArr);

              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, this.segTexture);
              if (segResult && segResult.confidenceMasks && segResult.confidenceMasks.length > 0) {
                  const maskObj = segResult.confidenceMasks[1] || segResult.confidenceMasks[0];
                  const floatArr = maskObj.getAsFloat32Array();
                  if (!this.segMaskBuffer || this.segMaskBuffer.length !== floatArr.length) {
                      this.segMaskBuffer = new Uint8Array(floatArr.length);
                  }
                  for (let i = 0; i < floatArr.length; i++) {
                      this.segMaskBuffer[i] = floatArr[i] * 255;
                  }
                  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, maskObj.width, maskObj.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.segMaskBuffer);
              } else {
                  const defaultMask = new Uint8Array([255]);
                  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, defaultMask);
              }
              gl.uniform1i(gl.getUniformLocation(this.program, "u_segMask"), 1);

              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
              gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);

              gl.drawArrays(gl.TRIANGLES, 0, 6);
           }

           const ctx = this.canvasCtx;
           ctx.clearRect(0, 0, this.processingCanvas.width, this.processingCanvas.height);
           ctx.drawImage(this.glCanvas!, 0, 0);

           if (this.showLandmarks && faceResult && faceResult.faceLandmarks.length > 0) {
              const marks = faceResult.faceLandmarks[0];
              ctx.fillStyle = "rgba(255, 0, 255, 0.6)";
              const JAW_INDICES = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454];
              for (const i of JAW_INDICES) {
                 const mark = marks[i];
                 ctx.beginPath();
                 ctx.arc(mark.x * this.processingCanvas.width, mark.y * this.processingCanvas.height, 4.0, 0, 2 * Math.PI);
                 ctx.fill();
              }
           }
        }
      }
      this.renderLoopId = requestAnimationFrame(loop);
    };

    loop();
  }

  stop() {
    if (this.renderLoopId) cancelAnimationFrame(this.renderLoopId);
    if (this.hiddenVideo && this.hiddenVideo.srcObject) {
       (this.hiddenVideo.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    }
  }
}

export const arEngineInstance = new ArEngine();
