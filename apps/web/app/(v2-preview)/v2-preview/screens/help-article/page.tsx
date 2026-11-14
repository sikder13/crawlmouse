import { HelpArticleScreen } from '../../../../../components/v2/screens/help/HelpScreens';
import { helpArticleView } from '../../../../../lib/v2/help/view';
import { previewOnly } from '../../_preview/guard';

/** The plans article: it names coming capabilities, so it shows their marks. */
export default function HelpArticlePreview() {
  previewOnly();
  return <HelpArticleScreen data={helpArticleView('plans')} />;
}
