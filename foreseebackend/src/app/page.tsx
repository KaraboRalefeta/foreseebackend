export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>ForeSee Backend</h1>
      <p>Your Next.js backend is running.</p>
      <p>
        Health check: <code>GET /api/health</code>
      </p>
      <p>
        Echo endpoint: <code>POST /api/echo</code>
      </p>
    </main>
  );
}
 