import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CheckPageScreen } from '@/components/v2/screens/check/CheckPageScreen';
import { checksPublicEnabled } from '@/lib/auth/flags';
import { CHECK_COPY, CHECK_QUESTIONS, isCheckQuestion } from '@/lib/v2/copy/check-pages';
import { socialCardPath } from '@/lib/v2/social-card';
import { socialMetadata } from '@/lib/v2/social-metadata';
import { checkPageView } from '@/lib/v2/view/check-pages';
import '@/styles/v2/tokens.css';

type Params = { params: Promise<{ question: string }> };

/** The three questions (DECISION A10); any other segment is a 404 without rendering. */
export const dynamicParams = false;

export function generateStaticParams() {
  return CHECK_QUESTIONS.map((question) => ({ question }));
}

/**
 * Each page's own title, description, canonical and social metadata; indexable (the root layout's
 * robots apply).
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { question } = await params;
  if (!isCheckQuestion(question)) return {};
  const copy = CHECK_COPY[question];
  const canonical = checkPageView(question).canonical;
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical },
    ...socialMetadata({
      path: canonical,
      title: copy.title,
      description: copy.description,
      image: socialCardPath(`check-${question}`),
    }),
  };
}

/**
 * A `/check` page (CC-29 D8): one question, the home's audit form and live check, a short
 * explanation, and the home's closing form. A 404 unless V2_CHECKS_PUBLIC is on, the flag the form's
 * route (`POST /api/checks`) answers under (Q10). The pages are prerendered, so the flag is read when
 * the site is built: built with it off they are 404s, and turning it on takes a new deployment.
 */
export default async function CheckPage({ params }: Params) {
  if (!checksPublicEnabled()) return notFound();
  const { question } = await params;
  if (!isCheckQuestion(question)) return notFound();
  return <CheckPageScreen data={checkPageView(question)} start />;
}
