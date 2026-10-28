import { needsUpdateCount } from "@/lib/wikipedia";
import Hunter from "./hunter";

export const revalidate = 3600;

export default async function Page() {
  const backlog = await needsUpdateCount();
  return <Hunter backlog={backlog} />;
}
