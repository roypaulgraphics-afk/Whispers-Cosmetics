import React, { useEffect, useRef, useState } from 'react';
import { Camera, ScanBarcode, X } from 'lucide-react';
import { Product } from '../types';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  products: Product[];
  title?: string;
  onClose: () => void;
  onDetected: (barcode: string) => void;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  products,
  title = 'Scan Product Barcode',
  onClose,
  onDetected,
}) => {
  const [manualCode, setManualCode] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setManualCode('');
      setCameraError('');
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 60);
    return () => stopCamera();
  }, [isOpen]);

  useEffect(() => {
    if (!cameraActive || !videoRef.current) return;

    let cancelled = false;
    let timer: number | undefined;

    const startDetection = async () => {
      if (!window.BarcodeDetector) {
        setCameraError(
          'Live camera barcode decoding is unavailable in this browser. Use a USB scanner, type the barcode, or click a catalog barcode below.',
        );
        return;
      }
      const detector = new window.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
      });

      const scanFrame = async () => {
        if (cancelled || !videoRef.current) return;
        try {
          if (videoRef.current.readyState >= 2) {
            const barcodes = await detector.detect(videoRef.current);
            if (barcodes.length > 0 && barcodes[0].rawValue) {
              stopCamera();
              onDetected(barcodes[0].rawValue);
              onClose();
              return;
            }
          }
        } catch {
          // ignore transient frame error
        }
        timer = window.setTimeout(scanFrame, 320);
      };

      void scanFrame();
    };

    void startDetection();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cameraActive, onClose, onDetected]);

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not available in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 50);
    } catch {
      setCameraError(
        'Camera permission denied or no camera detected. You can still type/paste a barcode or use a USB scanner.',
      );
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    onDetected(code);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 p-6 shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <ScanBarcode className="w-5 h-5 text-rose-900 dark:text-rose-400" />
            <h2 className="text-lg font-semibold text-stone-900 dark:text-zinc-100">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Close barcode scanner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Camera viewport */}
        <div className="mb-5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-100 dark:bg-zinc-950 overflow-hidden">
          {cameraActive ? (
            <div className="relative aspect-video bg-black">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-28 border-2 border-rose-500/80 rounded-lg" />
              </div>
              <button
                type="button"
                onClick={stopCamera}
                className="absolute bottom-3 right-3 px-3 py-1.5 rounded-lg bg-black/75 text-white text-xs font-medium cursor-pointer"
              >
                Stop Camera
              </button>
            </div>
          ) : (
            <div className="p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">
                  Camera or USB Scanner Ready
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                  Point a USB barcode gun at the field below or activate device camera.
                </p>
              </div>
              <button
                type="button"
                onClick={startCamera}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-900 hover:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 text-white text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Camera className="w-4 h-4" />
                <span>Use Camera</span>
              </button>
            </div>
          )}
        </div>

        {cameraError && (
          <p className="mb-4 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg px-3 py-2">
            {cameraError}
          </p>
        )}

        {/* USB / Manual barcode input */}
        <form onSubmit={handleSubmit} className="flex gap-2 mb-5">
          <input
            ref={inputRef}
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Scan or enter barcode (e.g. 6164001001021)"
            className="flex-1 px-3.5 py-2.5 rounded-lg border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-sm font-mono-num text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-rose-800/30"
          />
          <button
            type="submit"
            className="px-4 py-2.5 rounded-lg bg-stone-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-medium hover:bg-stone-800 dark:hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Lookup Code
          </button>
        </form>

        {/* Quick-test barcodes from existing catalog */}
        <div>
          <p className="text-xs font-medium text-stone-500 dark:text-zinc-400 mb-2">
            Quick-Scan Catalog Barcodes
          </p>
          <div className="max-h-36 overflow-y-auto divide-y divide-stone-100 dark:divide-zinc-800 border border-stone-200 dark:border-zinc-800 rounded-xl">
            {products.slice(0, 6).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onDetected(p.barcode);
                  onClose();
                }}
                className="w-full px-3.5 py-2 flex items-center justify-between text-left hover:bg-stone-50 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
              >
                <span className="text-xs font-medium text-stone-800 dark:text-zinc-200 truncate pr-3">
                  {p.name}
                </span>
                <span className="text-xs font-mono-num text-stone-500 dark:text-zinc-400 shrink-0">
                  {p.barcode}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
