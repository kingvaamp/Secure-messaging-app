import photoIcon from '@/assets/icons/photo.png';
import videoIcon from '@/assets/icons/video.png';
import fileIcon from '@/assets/icons/file.png';
import cameraIcon from '@/assets/icons/camera.png';

const MEDIA_OPTIONS = [
  { id: 'photo', label: 'Photo', src: photoIcon },
  { id: 'video', label: 'Vidéo', src: videoIcon },
  { id: 'file', label: 'Fichier', src: fileIcon },
  { id: 'camera', label: 'Caméra', src: cameraIcon },
];

export default function MediaTray({ open, onSelect }) {
  if (!open) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 px-4 pb-8 animate-in slide-in-from-bottom-4 duration-500 ease-out"
      style={{ zIndex: 45 }}
    >
      {/* The Bar: Glassmorphic with Red Glow */}
      <div
        className="flex items-center justify-around rounded-[32px] p-5 relative overflow-hidden"
        style={{ 
          backgroundColor: 'rgba(15, 0, 2, 0.45)', 
          backdropFilter: 'blur(30px) saturate(180%)',
          WebkitBackdropFilter: 'blur(30px) saturate(180%)',
          border: '1px solid rgba(255, 0, 60, 0.2)',
          boxShadow: `
            0 15px 45px rgba(0, 0, 0, 0.6),
            0 0 20px rgba(255, 0, 60, 0.1),
            inset 0 0 15px rgba(255, 0, 60, 0.05)
          `
        }}
      >
        {/* Subtle red scanline effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(255,0,60,0.1)_1px,transparent_1px)] bg-[size:100%_4px]" />

        {MEDIA_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onSelect(opt.id)}
            className="flex flex-col items-center gap-2.5 p-2 rounded-2xl transition-all duration-300 hover:scale-110 active:scale-95 group"
          >
            {/* Icon Container: Glassmorphic Inner */}
            <div
              className="relative flex items-center justify-center rounded-[18px] transition-all duration-300 group-hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]"
              style={{
                width: 60,
                height: 60,
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
              }}
            >
              <img 
                src={opt.src} 
                alt={opt.label}
                className="w-full h-full object-contain mix-blend-screen scale-110 brightness-110 transition-all group-hover:brightness-125"
              />
              
              {/* Internal glow on hover */}
              <div className="absolute inset-0 rounded-[18px] opacity-0 group-hover:opacity-100 transition-opacity ring-1 ring-white/10" />
            </div>
            
            <span className="text-[9px] font-black tracking-[0.2em] uppercase text-white/30 group-hover:text-[#ff003c] transition-colors duration-300">
              {opt.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
