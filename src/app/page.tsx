import { needsUpdateCount } from "@/lib/wikipedia";
import StaleHunter from "./stale-hunter";

export const revalidate = 3600;

export default async function Page() {
  const backlog = await needsUpdateCount();
  return <StaleHunter backlog={backlog} />;
}
