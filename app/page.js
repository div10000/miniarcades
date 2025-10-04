export default function HomePage() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh'
    }}>
      <h1 style={{
        fontSize: '3rem',
        textAlign: 'center',
        color: '#fff',
        textShadow: '0 0 10px #00f, 0 0 20px #00f, 0 0 40px #00f'
      }}>
        This will be the Home Page
      </h1>
    </div>
  );
}