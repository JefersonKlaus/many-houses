// While the screens are being moved from frontend/js/screens (step 3 of the migration), each page shows this.
export function Placeholder({ name }: { name: string }) {
  return (
    <>
      <h1>{name}</h1>
      <p className="notice">Esta tela ainda está sendo migrada para React. Use o app atual (frontend/) por enquanto.</p>
    </>
  );
}
