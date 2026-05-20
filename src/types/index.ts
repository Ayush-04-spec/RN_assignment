export type DetectionResult = {
  detected: boolean;
  boundingBox: { x: number; y: number; w: number; h: number } | null;
  corners: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  } | null;
  rotation: 0 | 90 | 180 | 270 | null;
};

export type CapturedMarker = {
  id: string;
  filePath: string;
  timestamp: number;
  rotation: 0 | 90 | 180 | 270;
};

export type RootStackParamList = {
  Camera: undefined;
  Results: { images: string[] };
};
