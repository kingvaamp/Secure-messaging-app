import { Image, Video, FileText, Camera } from 'lucide-react';

const MEDIA_OPTIONS = [
  { id: 'photo', label: 'Photo', Icon: Image, color: '#3b82f6' },
  { id: 'video', label: 'Vidéo', Icon: Video, color: '#8b5cf6' },
  { id: 'file', label: 'Fichier', Icon: FileText, color: '#f59e0b' },
  { id: 'camera', label: 'Caméra', Icon: Camera, color: '#22c55e' },
];

export default function MediaTray({ open, onSelect }) {
  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 px-4 pb-3 animate-in slide-in-from-bottom-2"
      style={{ zIndex: 45 }}
    >
      <div
        className="flex items-center justify-around rounded-2xl p-3"
        style={{ backgroundColor: 'rgba(20, 0, 0, 0.95)', backdropFilter: 'blur(12px)' }}
      >
        {MEDIA_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            className="flex flex-col items-center gap-1.5 p-2 rounded-xl transition-transform active:scale-95"
          >
            <div
              className="flex items-center justify-center rounded-xl"
              style={{
                width: 48,
                height: 48,
                backgroundColor: `${opt.color}15`,
              }}
            >
              <opt.Icon size={22} style={{ color: opt.color }} />
            </div>
            <span className="text-[10px] text-white/60">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
