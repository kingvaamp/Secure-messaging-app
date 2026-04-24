export default function Tog({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center rounded-full transition-colors duration-200 focus:outline-none"
      style={{
        width: 46,
        height: 26,
        backgroundColor: checked ? '#ff003c' : '#333',
      }}
      aria-label={checked ? 'Activé' : 'Désactivé'}
    >
      <span
        className="absolute rounded-full bg-white transition-transform duration-200"
        style={{
          width: 20,
          height: 20,
          left: 3,
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}
