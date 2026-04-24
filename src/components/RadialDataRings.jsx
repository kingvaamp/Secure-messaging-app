export default function RadialDataRings() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 150,
            height: 150,
            top: '50%',
            left: '50%',
            marginTop: -75,
            marginLeft: -75,
            border: '1px solid rgba(255, 0, 60, 0.4)',
            animation: `ring-pulse 2s infinite ease-out`,
            animationDelay: `${i * 0.6}s`,
          }}
        />
      ))}
    </>
  );
}
