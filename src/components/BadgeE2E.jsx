import { Lock } from 'lucide-react';

export default function BadgeE2E() {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide"
      style={{ backgroundColor: 'rgba(255, 0, 60, 0.15)', color: '#ff003c' }}
    >
      <Lock size={9} />
      E2E
    </span>
  );
}
