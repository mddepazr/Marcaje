import * as faceapi from "@vladmandic/face-api";
import { BiometricProfile } from "./api";

export const FACE_MATCH_THRESHOLD = 0.56;
export const FACE_AMBIGUITY_MARGIN = 0.04;
export const ENROLL_MAX_SAMPLE_SPREAD = 0.48;

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

export async function ensureFaceModelsLoaded(): Promise<void> {
  if (modelsLoaded) return;
  if (!loadingPromise) {
    loadingPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]).then(() => {
      modelsLoaded = true;
    });
  }
  return loadingPromise;
}

export interface FaceQuality {
  ok: boolean;
  reason?: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFaceFrame {
  box: Box;
  ear: number;
  descriptor: number[];
  score: number;
  quality: FaceQuality;
  bridgeBox?: Box;
}

export interface FrameAnalysisResult {
  faceCount: number;
  primaryFace: DetectedFaceFrame | null;
}

type Point = { x: number; y: number };

function computeBridgeBox(positions: Point[] | null): Box | undefined {
  if (!positions || positions.length < 68) return undefined;
  const innerLeft = positions[39];
  const innerRight = positions[42];
  const bridgeTop = positions[27];
  const bridgeLow = positions[29];
  const eyeGap = innerRight.x - innerLeft.x;
  if (eyeGap < 6) return undefined;
  const y1 = bridgeTop.y - eyeGap * 0.25;
  const y2 = bridgeLow.y;
  if (y2 - y1 < 6) return undefined;
  return { x: innerLeft.x, y: y1, width: eyeGap, height: y2 - y1 };
}

function pointDist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeEyeAspectRatio(eye: Point[]): number {
  if (eye.length < 6) return 0.3;
  const v1 = pointDist(eye[1], eye[5]);
  const v2 = pointDist(eye[2], eye[4]);
  const h = pointDist(eye[0], eye[3]);
  if (h <= 0.0001) return 0.3;
  return (v1 + v2) / (2.0 * h);
}

function evaluateFaceQuality(
  box: { width: number; height: number },
  score: number,
  positions: Point[] | null,
  frameWidth: number,
  minScore = 0.45
): FaceQuality {
  const minFaceWidth = Math.max(70, frameWidth * 0.09);
  if (box.width < minFaceWidth) {
    return { ok: false, reason: "Acércate un poco más a la cámara" };
  }
  if (score < minScore) {
    return { ok: false, reason: "Rostro poco nítido · Mejora la iluminación" };
  }
  if (positions && positions.length >= 68) {
    const leftEyeOuter = positions[36];
    const rightEyeOuter = positions[45];
    const noseTip = positions[30];
    const eyeSpan = rightEyeOuter.x - leftEyeOuter.x;
    if (Math.abs(eyeSpan) > 1) {
      const yawRatio = (noseTip.x - leftEyeOuter.x) / eyeSpan;
      if (yawRatio < 0.24 || yawRatio > 0.76) {
        return { ok: false, reason: "Mira de frente a la cámara" };
      }
    }
    const rollDeg =
      (Math.atan2(rightEyeOuter.y - leftEyeOuter.y, rightEyeOuter.x - leftEyeOuter.x) * 180) /
      Math.PI;
    if (Math.abs(rollDeg) > 24) {
      return { ok: false, reason: "Endereza la cabeza" };
    }
  }
  return { ok: true };
}

function largestFirst<T extends { detection: faceapi.FaceDetection }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      b.detection.box.width * b.detection.box.height - a.detection.box.width * a.detection.box.height
  );
}

export async function analyzeVideoFaces(
  video: HTMLVideoElement,
  withLandmarks = true,
  computeDescriptor = false
): Promise<FrameAnalysisResult> {
  await ensureFaceModelsLoaded();
  if (video.readyState < 2 || video.videoWidth === 0) {
    return { faceCount: 0, primaryFace: null };
  }

  const tinyOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.32 });

  if (computeDescriptor) {
    const ssdOptions = new faceapi.SsdMobilenetv1Options({ minConfidence: 0.42, maxResults: 5 });
    let detections = await faceapi
      .detectAllFaces(video, ssdOptions)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length === 0) {
      detections = await faceapi
        .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
    }

    if (detections.length === 0) return { faceCount: 0, primaryFace: null };

    const main = largestFirst(detections)[0];
    const leftEar = computeEyeAspectRatio(main.landmarks.getLeftEye());
    const rightEar = computeEyeAspectRatio(main.landmarks.getRightEye());
    const box = main.detection.box;

    return {
      faceCount: detections.length,
      primaryFace: {
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        ear: (leftEar + rightEar) / 2,
        descriptor: Array.from(main.descriptor),
        score: main.detection.score,
        bridgeBox: computeBridgeBox(main.landmarks.positions),
        quality: evaluateFaceQuality(
          box,
          main.detection.score,
          main.landmarks.positions,
          video.videoWidth,
          0.48
        ),
      },
    };
  }

  if (withLandmarks) {
    const detections = await faceapi.detectAllFaces(video, tinyOptions).withFaceLandmarks();
    if (detections.length === 0) return { faceCount: 0, primaryFace: null };

    const main = largestFirst(detections)[0];
    const leftEar = computeEyeAspectRatio(main.landmarks.getLeftEye());
    const rightEar = computeEyeAspectRatio(main.landmarks.getRightEye());
    const box = main.detection.box;

    return {
      faceCount: detections.length,
      primaryFace: {
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        ear: (leftEar + rightEar) / 2,
        descriptor: [],
        score: main.detection.score,
        bridgeBox: computeBridgeBox(main.landmarks.positions),
        quality: evaluateFaceQuality(
          box,
          main.detection.score,
          main.landmarks.positions,
          video.videoWidth,
          0.40
        ),
      },
    };
  }

  const detections = await faceapi.detectAllFaces(video, tinyOptions);
  if (detections.length === 0) return { faceCount: 0, primaryFace: null };
  const main = [...detections].sort(
    (a, b) => b.box.width * b.box.height - a.box.width * a.box.height
  )[0];
  return {
    faceCount: detections.length,
    primaryFace: {
      box: { x: main.box.x, y: main.box.y, width: main.box.width, height: main.box.height },
      ear: 0.3,
      descriptor: [],
      score: main.score,
      quality: { ok: true },
    },
  };
}

export async function extractDescriptorFromImageFile(file: File): Promise<number[]> {
  await ensureFaceModelsLoaded();
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
      el.src = objectUrl;
    });

    let detections = await faceapi
      .detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45, maxResults: 5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length === 0) {
      detections = await faceapi
        .detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptors();
    }

    if (detections.length === 0) {
      throw new Error("No se detectó ningún rostro claro en la foto. Usa una imagen frontal con buena luz.");
    }
    if (detections.length > 1) {
      throw new Error("Se detectaron varios rostros en la foto. Sube una foto donde aparezca solo una persona.");
    }

    const main = detections[0];
    const quality = evaluateFaceQuality(
      main.detection.box,
      main.detection.score,
      main.landmarks.positions,
      img.naturalWidth || img.width,
      0.45
    );
    if (!quality.ok) {
      throw new Error(
        `La foto no sirve para enrolar (${quality.reason?.toLowerCase()}). Usa una foto frontal, cercana y con buena luz.`
      );
    }

    return Array.from(main.descriptor);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function descriptorDistance(a: number[], b: number[]): number {
  if (a.length !== 128 || b.length !== 128) return Number.POSITIVE_INFINITY;
  let sumSq = 0;
  for (let i = 0; i < 128; i++) {
    const diff = a[i] - b[i];
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

export function profileDistance(descriptor: number[], profile: BiometricProfile): number {
  let best = Number.POSITIVE_INFINITY;
  const refs: number[][] = [];
  if (Array.isArray(profile.face_descriptor)) refs.push(profile.face_descriptor);
  if (Array.isArray(profile.face_samples)) refs.push(...profile.face_samples);
  for (const ref of refs) {
    if (!Array.isArray(ref) || ref.length !== 128) continue;
    best = Math.min(best, descriptorDistance(descriptor, ref));
  }
  return best;
}

export function distanceToSimilarity(distance: number): number {
  return Math.max(0, Math.min(0.999, 1 - distance * 0.72));
}

export function matchFaceDescriptor(
  descriptor: number[],
  directory: BiometricProfile[],
  maxDistance = FACE_MATCH_THRESHOLD,
  ambiguityMargin = FACE_AMBIGUITY_MARGIN
): { profile: BiometricProfile; similarity: number; distance: number } | null {
  if (descriptor.length !== 128 || directory.length === 0) return null;

  let bestProfile: BiometricProfile | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let secondDistance = Number.POSITIVE_INFINITY;

  for (const candidate of directory) {
    const dist = profileDistance(descriptor, candidate);
    if (!Number.isFinite(dist)) continue;
    if (dist < bestDistance) {
      secondDistance = bestDistance;
      bestDistance = dist;
      bestProfile = candidate;
    } else if (dist < secondDistance) {
      secondDistance = dist;
    }
  }

  if (!bestProfile || bestDistance > maxDistance) return null;

  if (Number.isFinite(secondDistance) && secondDistance - bestDistance < ambiguityMargin) {
    return null;
  }

  return { profile: bestProfile, similarity: distanceToSimilarity(bestDistance), distance: bestDistance };
}

export function averageDescriptors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const avg = new Array<number>(128).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < 128; i++) avg[i] += vec[i];
  }
  for (let i = 0; i < 128; i++) avg[i] /= vectors.length;
  return avg;
}

export function maxPairwiseDistance(vectors: number[][]): number {
  let maxDist = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      maxDist = Math.max(maxDist, descriptorDistance(vectors[i], vectors[j]));
    }
  }
  return maxDist;
}

export function sampleTorsoHeadSignature(
  video: HTMLVideoElement,
  scratchCanvas: HTMLCanvasElement
): { occupancy: number; centerX: number } {
  const w = 48;
  const h = 36;
  scratchCanvas.width = w;
  scratchCanvas.height = h;
  const ctx = scratchCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || video.readyState < 2) return { occupancy: 1, centerX: 0.5 };

  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  let bgSamples = 0;
  for (let y = 0; y < 6; y++) {
    for (const x of [0, 1, w - 2, w - 1]) {
      const idx = (y * w + x) * 4;
      bgR += data[idx];
      bgG += data[idx + 1];
      bgB += data[idx + 2];
      bgSamples++;
    }
  }
  bgR /= bgSamples;
  bgG /= bgSamples;
  bgB /= bgSamples;

  let activePixels = 0;
  let weightedX = 0;
  let totalChecked = 0;

  for (let y = 5; y < h; y++) {
    for (let x = 8; x < w - 8; x++) {
      const idx = (y * w + x) * 4;
      const diff =
        Math.abs(data[idx] - bgR) +
        Math.abs(data[idx + 1] - bgG) +
        Math.abs(data[idx + 2] - bgB);
      totalChecked++;
      if (diff > 50) {
        activePixels++;
        weightedX += x / w;
      }
    }
  }

  if (activePixels === 0 || totalChecked === 0) return { occupancy: 0, centerX: 0.5 };
  return { occupancy: activePixels / totalChecked, centerX: weightedX / activePixels };
}
