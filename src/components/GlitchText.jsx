import { useState, useEffect } from 'react';

export default function GlitchText({ text, trigger, children }) {
  const [glitching, setGlitching] = useState(false);

  useEffect(() => {
    if (trigger) {
      setGlitching(true);
      const timer = setTimeout(() => setGlitching(false), 150);
      return () => clearTimeout(timer);
    }
  }, [trigger]);

  return (
    <span
      style={{
        filter: glitching ? 'invert(1) skewX(10deg)' : 'none',
        transition: 'filter 0.15s ease',
        display: 'inline',
      }}
    >
      {children || text}
    </span>
  );
}
