import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  return Response.json(
    {
      ok: true,
      service: "import-stock-v1",
      timestamp: new Date().toISOString(),
      url: request.url,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export default function HealthRoute() {
  return null;
}
