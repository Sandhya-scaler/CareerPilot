import Link from "next/link";
import { Logo } from "@/components/Shell";

export const metadata = { title: "Privacy · CareerPilot" };

export default function Privacy() {
  return (
    <main className="mx-auto max-w-[68ch] px-6 py-12">
      <Link href="/" className="mb-10 flex items-center gap-2.5 font-semibold"><Logo /> CareerPilot</Link>
      <h1 className="text-[28px] font-semibold tracking-tight">How CareerPilot handles your data</h1>
      <div className="source mt-6 space-y-4 text-ink-soft">
        <p>
          <strong className="text-ink">What we store.</strong> Your account (email, name, hashed password), the resumes you upload and the
          evidence extracted from them, job descriptions you save, your plan, practice answers, applications and weekly reports.
        </p>
        <p>
          <strong className="text-ink">What we send elsewhere.</strong> If the operator has configured an Anthropic API key, resume and job
          description text is sent to Anthropic&apos;s API to extract skills, write plans and grade practice answers. Job searches call public
          job-board APIs (Greenhouse, Lever, Ashby, and Adzuna if enabled) with the role and location only, never your resume. GitHub
          import reads public repositories for the username you enter.
        </p>
        <p>
          <strong className="text-ink">What we never do.</strong> Apply to jobs on your behalf, share your resume with employers, or scrape
          sites that forbid it.
        </p>
        <p>
          <strong className="text-ink">Your controls.</strong> Download everything as JSON, or delete your account and all of its data, from
          the <Link href="/account" className="text-action underline">Account</Link> page. Deletion is immediate and permanent.
        </p>
      </div>
    </main>
  );
}
