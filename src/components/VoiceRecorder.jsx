import { useState, useEffect, useRef } from 'react';
import { X, Check } from 'lucide-react';

export default function VoiceRecorder({ onCancel, onSend }) {
  const [seconds, setSeconds] = useState(0);
  const [bars, setBars] = useState([0.3, 0.5, 0.7, 0.4, 0.6]);
  const intervalRef = useRef(null);
  const barsIntervalRef = useRef(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);

    barsIntervalRef.current = setInterval(() => {
      setBars(Array.from({ length: 5 }, () => 0.2 + Math.random() * 0.8));
    }, 150);

    return () => {
      clearInterval(intervalRef.current);
      clearInterval(barsIntervalRef.current);
    };
  }, []);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 animate-in slide-in-from-bottom-2"
      style={{ backgroundColor: 'rgba(20, 0, 0, 0.95)' }}
    >
      {/* Recording indicator */}
      <span
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{
          backgroundColor: '#ff003c',
          animation: 'rec-blink 1s infinite',
        }}
      />

      {/* Waveform */}
      <div className="flex items-center gap-0.5 flex-1 h-8">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-full transition-all duration-150"
            style={{
              height: `${h * 100}%`,
              backgroundColor: '#ff003c',
              minHeight: 4,
            }}
          />
        ))}
      </div>

      {/* Timer */}
      <span className="text-sm font-mono text-[#ff003c] w-12 text-right">{timeStr}</span>

      {/* Cancel */}
      <button
        onClick={onCancel}
        className="flex items-center justify-center rounded-full"
        style={{ width: 32, height: 32, backgroundColor: 'rgba(255,255,255,0.1)' }}
      >
        <X size={16} className="text-white/70" />
      </button>

      {/* Send */}
      <button
        onClick={() => onSend(timeStr)}
        className="flex items-center justify-center rounded-full"
        style={{ width: 32, height: 32, backgroundColor: '#ff003c' }}
      >
        <Check size={16} className="text-white" />
      </button>
    </div>
  );
}
