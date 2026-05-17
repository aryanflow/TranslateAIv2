import { JetBrains_Mono } from "next/font/google";
import { JobDetailView } from "@/components/jobs/JobDetailView";

const jdMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--jd-mono",
  weight: ["400", "500"],
});

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return (
    <div className={jdMono.variable}>
      <JobDetailView jobId={jobId} />
    </div>
  );
}
