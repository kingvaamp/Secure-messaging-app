import { useMemo } from 'react';

export default function RedProgressBar({ ttl, max = 180 }) {
  const pct = Math.max(0, (ttl / max) * 100);
  const isCritical = ttl <= 30 && ttl > 0;

  const color = isCritical ? '#ff3333' : '#ff003c';

  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.08)' }}
    >
      <div
        className="h-full rounded-full transition-all duration-1000 linear"
        style={{
          width: `${pct}%`,
          backgroundColor: color,
          boxShadow: isCritical
            ? '0 0 8px rgba(255, 51, 51, 0.8)'
            : '0 0 4px rgba(255, 0, 60, 0.4)',
          animation: isCritical ? 'ttl-pulse 1s infinite' : 'none',
        }}
      />
    </div>
  );
}
