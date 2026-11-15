import { notFound } from 'next/navigation';
import { previewOnly } from '../../v2-preview/_preview/guard';
import { KEPT_RENDERS } from '../_lib/kept-renders';

async function Body({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const render = Object.hasOwn(KEPT_RENDERS, page) ? KEPT_RENDERS[page] : undefined;
  if (render === undefined) notFound();
  return render();
}

/**
 * A kept v1 public page in the v2 shell, as its target draws it (CC-36 D3), for the visual
 * harness. Development only: the guard runs before anything.
 */
export default function KeptPreviewPage(props: { params: Promise<{ page: string }> }) {
  previewOnly();
  return <Body params={props.params} />;
}
