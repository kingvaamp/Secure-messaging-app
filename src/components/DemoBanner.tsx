// src/components/DemoBanner.tsx
// Renders only in development builds (__DEV_DEMO__ === true).
// In production, the entire component returns null and tree-shakes out.

export function DemoBanner() {
  if (!__DEV_DEMO__) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        backgroundColor: 'rgba(255, 0, 60, 0.85)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        color: '#fff',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        padding: '3px 12px',
        borderRadius: '0 0 8px 8px',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      Mode Démo — données fictives
    </div>
  );
}
