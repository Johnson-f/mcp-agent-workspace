import { AutomationDetailClient } from "./automation-detail-client";

export default async function AutomationDetailPage({
  params,
}: {
  params: Promise<{ automationId: string }>;
}) {
  const { automationId } = await params;
  return <AutomationDetailClient automationId={automationId} />;
}
