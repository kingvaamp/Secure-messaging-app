import { useMemo } from 'react';

export default function RedProgressBar({ ttl, max = 180 }) {
  const pct = Math.max(0, (ttl / max) * 100);
  const isCritical = ttl <= 30 && ttl > 0;

  const color = isCritical ? '#ff3333' : '#ff003c';
  const shadow = isCritical
    ? '0 0 10px rgba(255, 51, 51, 0.8), 0 0 20px rgba(255, 51, 51, 0.4)'
    : '0 0 6px rgba(255, 0, 60, 0.5)';

  return (
    <div
      className="w-full rounded-full overflow-hidden relative"
      style={{
        height: isCritical ? 4 : 3,
        backgroundColor: 'rgba(255,255,255,0.06)',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)',
        transition: 'height 0.3s ease',
      }}
    >
      {/* Animated glowing bar */}
      <div
        className="h-full rounded-full absolute left-0 top-0"
        style={{
          width: `${pct}%`,
          backgroundColor: color,
          boxShadow: shadow,
          transition: 'width 1s linear, background-color 0.5s ease',
        }}
      >
        {/* Leading edge bright spot */}
        <div
          className="absolute right-0 top-0 h-full w-4"
          style={{
            background: 'linear-gradient(90deg, transparent, #ffffff)',
            opacity: 0.8,
            boxShadow: '0 0 8px #fff',
          }}
        />
      </div>
    </div>
  );
}
