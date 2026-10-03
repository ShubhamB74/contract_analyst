import { Workspace } from "@/components/Workspace";

export default async function AskPage({ searchParams }: { searchParams: Promise<{ docs?: string }> }) {
  const { docs } = await searchParams;
  return <Workspace docIds={(docs ?? "").split(",").filter(Boolean)} />;
}
