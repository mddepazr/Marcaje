import * as faceapi from "@vladmandic/face-api";
import { BiometricProfile } from "./api";

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

export async function ensureFaceModelsLoaded(): Promise<void> {
  if (modelsLoaded) return;
  if (!loadingPromise) {
    loadingPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]).then(() => {
      modelsLoaded = true;
    });
  }
  return loadingPromise;
}

export interface DetectedFaceFrame {
  box: { x: number; y: number; width: number; height: number };
  ear: number;
  descriptor: number[];
}

export interface FrameAnalysisResult {
  faceCount: number;
  primaryFace: DetectedFaceFrame | null;
}

function pointDist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function computeEyeAspectRatio(eye: Array<{ x: number; y: number }>): number {
  if (eye.length < 6) return 0.3;
  const v1 = pointDist(eye[1], eye[5]);
  const v2 = pointDist(eye[2], eye[4]);
  const h = pointDist(eye[0], eye[3]);
  if (h <= 0.0001) return 0.3;
  return (v1 + v2) / (2.0 * h);
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

  const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 192, scoreThreshold: 0.32 });

  if (computeDescriptor) {
    const detections = await faceapi
      .detectAllFaces(video, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length === 0) return { faceCount: 0, primaryFace: null };

    const sorted = [...detections].sort(
      (a, b) => b.detection.box.width * b.detection.box.height - a.detection.box.width * a.detection.box.height
    );
    const main = sorted[0];
    const leftEar = computeEyeAspectRatio(main.landmarks.getLeftEye());
    const rightEar = computeEyeAspectRatio(main.landmarks.getRightEye());

    return {
      faceCount: detections.length,
      primaryFace: {
        box: {
          x: main.detection.box.x,
          y: main.detection.box.y,
          width: main.detection.box.width,
          height: main.detection.box.height,
        },
        ear: (leftEar + rightEar) / 2,
        descriptor: Array.from(main.descriptor),
      },
    };
  }

  if (withLandmarks) {
    const detections = await faceapi.detectAllFaces(video, options).withFaceLandmarks();
    if (detections.length === 0) return { faceCount: 0, primaryFace: null };

    const sorted = [...detections].sort(
      (a, b) => b.detection.box.width * b.detection.box.height - a.detection.box.width * a.detection.box.height
    );
    const main = sorted[0];
    const leftEar = computeEyeAspectRatio(main.landmarks.getLeftEye());
    const rightEar = computeEyeAspectRatio(main.landmarks.getRightEye());

    return {
      faceCount: detections.length,
      primaryFace: {
        box: {
          x: main.detection.box.x,
          y: main.detection.box.y,
          width: main.detection.box.width,
          height: main.detection.box.height,
        },
        ear: (leftEar + rightEar) / 2,
        descriptor: [],
      },
    };
  }

  const detections = await faceapi.detectAllFaces(video, options);
  if (detections.length === 0) return { faceCount: 0, primaryFace: null };
  const main = detections[0];
  return {
    faceCount: detections.length,
    primaryFace: {
      box: { x: main.box.x, y: main.box.y, width: main.box.width, height: main.box.height },
      ear: 0.3,
      descriptor: [],
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

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 });
    const detections = await faceapi
      .detectAllFaces(img, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (detections.length === 0) {
      throw new Error("No se detectó ningún rostro claro en la foto. Usa una imagen frontal con buena luz.");
    }
    if (detections.length > 1) {
      throw new Error("Se detectaron varios rostros en la foto. Sube una foto donde aparezca solo una persona.");
    }

    return Array.from(detections[0].descriptor);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function matchFaceDescriptor(
  descriptor: number[],
  directory: BiometricProfile[],
  maxDistance = 0.56
): { profile: BiometricProfile; similarity: number; distance: number } | null {
  if (descriptor.length !== 128 || directory.length === 0) return null;

  let bestProfile: BiometricProfile | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of directory) {
    if (!Array.isArray(candidate.face_descriptor) || candidate.face_descriptor.length !== 128) {
      continue;
    }
    let sumSq = 0;
    for (let i = 0; i < 128; i++) {
      const diff = descriptor[i] - candidate.face_descriptor[i];
      sumSq += diff * diff;
    }
    const dist = Math.sqrt(sumSq);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestProfile = candidate;
    }
  }

  if (!bestProfile || bestDistance > maxDistance) return null;

  const similarity = Math.max(0.5, Math.min(0.999, 1 - bestDistance * 0.75));
  return { profile: bestProfile, similarity, distance: bestDistance };
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
